//! The disk cache: what the viewer derived from a document (GPU scenes, thumbnails, fidelity
//! verdicts, page costs), kept so a document opened before opens at once.
//!
//! - Entries are grouped per document under a key from a fast hash of the file's size,
//!   modification time and first and last megabytes, so a changed file gets a new key. The full
//!   file can be hashed in the background ([`full_hash`]) to confirm it.
//! - Writes are atomic (a temporary file, then a rename), so a crash never leaves half an entry.
//! - When the cache passes its size budget, the least recently used documents go first.
//! - It holds derived drawing data on the local disk only; it can be turned off and cleared.

use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Bytes hashed from each end of the file for the key.
const SAMPLE: u64 = 1 << 20;
/// Changes when anything stored changes format; older entries are ignored.
pub const FORMAT: u32 = 1;

pub struct DiskCache {
    root: PathBuf,
    pub budget: u64,
    pub enabled: bool,
}

impl DiskCache {
    pub fn new(root: PathBuf, budget: u64) -> Self {
        Self {
            root,
            budget,
            enabled: true,
        }
    }

    /// `%LOCALAPPDATA%\redcolumn-native\cache` on Windows (the platform cache folder elsewhere).
    pub fn default_root() -> PathBuf {
        dirs::cache_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("redcolumn-native")
            .join("cache")
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The key for a file as it is now.
    pub fn key_for(path: &Path) -> std::io::Result<String> {
        let mut f = fs::File::open(path)?;
        let meta = f.metadata()?;
        let len = meta.len();
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_nanos());
        let mut h = blake3::Hasher::new();
        h.update(&FORMAT.to_le_bytes());
        h.update(&len.to_le_bytes());
        h.update(&mtime.to_le_bytes());
        let mut buf = vec![0u8; SAMPLE.min(len) as usize];
        f.read_exact(&mut buf)?;
        h.update(&buf);
        if len > SAMPLE {
            f.seek(SeekFrom::Start(len - SAMPLE.min(len)))?;
            f.read_exact(&mut buf)?;
            h.update(&buf);
        }
        Ok(h.finalize().to_hex()[..32].to_string())
    }

    fn dir(&self, key: &str) -> PathBuf {
        self.root.join(key)
    }

    pub fn get(&self, key: &str, name: &str) -> Option<Vec<u8>> {
        if !self.enabled {
            return None;
        }
        let p = self.dir(key).join(name);
        let data = fs::read(&p).ok()?;
        // Mark the document as recently used.
        let _ = fs::File::options()
            .write(true)
            .open(self.dir(key).join(".used"))
            .and_then(|mut f| f.write_all(b"1"));
        Some(data)
    }

    /// Stores an entry atomically.
    pub fn put(&self, key: &str, name: &str, data: &[u8]) -> std::io::Result<()> {
        if !self.enabled {
            return Ok(());
        }
        let dir = self.dir(key);
        fs::create_dir_all(&dir)?;
        let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(data)?;
            f.sync_data()?;
        }
        fs::rename(&tmp, dir.join(name))?;
        fs::write(dir.join(".used"), b"1")?;
        Ok(())
    }

    /// Total bytes held.
    pub fn size(&self) -> u64 {
        dir_entries(&self.root).iter().map(|(_, size, _)| size).sum()
    }

    /// Removes the least recently used documents until the cache fits its budget.
    pub fn evict(&self) -> u64 {
        let mut docs = dir_entries(&self.root);
        let mut total: u64 = docs.iter().map(|(_, s, _)| s).sum();
        docs.sort_by_key(|(_, _, used)| *used);
        let mut freed = 0;
        for (dir, size, _) in docs {
            if total <= self.budget {
                break;
            }
            if fs::remove_dir_all(&dir).is_ok() {
                total -= size;
                freed += size;
            }
        }
        freed
    }

    pub fn clear(&self) -> std::io::Result<()> {
        if self.root.exists() {
            fs::remove_dir_all(&self.root)?;
        }
        Ok(())
    }
}

/// Each document folder with its size and when it was last used.
fn dir_entries(root: &Path) -> Vec<(PathBuf, u64, SystemTime)> {
    let Ok(rd) = fs::read_dir(root) else { return Vec::new() };
    rd.filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| {
            let dir = e.path();
            let size = fs::read_dir(&dir)
                .map(|r| r.filter_map(|f| f.ok()?.metadata().ok()).map(|m| m.len()).sum())
                .unwrap_or(0);
            let used = fs::metadata(dir.join(".used"))
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            (dir, size, used)
        })
        .collect()
}

/// The whole file's hash, for confirming a key in the background.
pub fn full_hash(path: &Path) -> std::io::Result<String> {
    let mut h = blake3::Hasher::new();
    h.update_mmap_rayon_or_read(path)?;
    Ok(h.finalize().to_hex().to_string())
}

trait HashFile {
    fn update_mmap_rayon_or_read(&mut self, path: &Path) -> std::io::Result<()>;
}

impl HashFile for blake3::Hasher {
    fn update_mmap_rayon_or_read(&mut self, path: &Path) -> std::io::Result<()> {
        let mut f = fs::File::open(path)?;
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = f.read(&mut buf)?;
            if n == 0 {
                return Ok(());
            }
            self.update(&buf[..n]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn put_get_evict() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.pdf");
        fs::write(&file, b"%PDF-1.7 hello").unwrap();
        let key = DiskCache::key_for(&file).unwrap();
        assert_eq!(key, DiskCache::key_for(&file).unwrap());
        let cache = DiskCache::new(dir.path().join("cache"), 10);
        assert!(cache.get(&key, "scene-0").is_none());
        cache.put(&key, "scene-0", &[1, 2, 3]).unwrap();
        assert_eq!(cache.get(&key, "scene-0"), Some(vec![1, 2, 3]));
        // A changed file gets a new key.
        fs::write(&file, b"%PDF-1.7 hello, changed").unwrap();
        assert_ne!(key, DiskCache::key_for(&file).unwrap());
        // Over budget: evicted.
        cache.put(&key, "big", &[0u8; 100]).unwrap();
        assert!(cache.evict() > 0);
        assert!(cache.get(&key, "scene-0").is_none());
        assert_eq!(full_hash(&file).unwrap().len(), 64);
    }
}
