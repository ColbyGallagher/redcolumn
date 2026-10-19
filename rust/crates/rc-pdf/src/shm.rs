//! Shared memory between the app and a worker: files in the temp folder, mapped by both.
//!
//! - The **control** file is a few bytes that never change size: the cancel generation the app
//!   writes and the worker's render pause callback reads.
//! - The **payload** file holds one response's large data. When a payload outgrows it, the worker
//!   writes a new, larger file and names it in the response (Windows cannot resize a mapped file).

use memmap2::{MmapMut, MmapOptions};
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub const CONTROL_SIZE: u64 = 4096;

/// A mapped shared file.
pub struct Shared {
    pub path: PathBuf,
    map: MmapMut,
    _file: File,
}

impl Shared {
    /// Creates (or truncates) the file at `path` with `size` bytes and maps it.
    pub fn create(path: &Path, size: u64) -> std::io::Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)?;
        file.set_len(size.max(1))?;
        // SAFETY: the file is private to the app and its worker; both only access it through
        // atomics (control) or under the request/response protocol (payload), never concurrently.
        let map = unsafe { MmapOptions::new().map_mut(&file)? };
        Ok(Self {
            path: path.to_path_buf(),
            map,
            _file: file,
        })
    }

    /// Maps an existing file.
    pub fn open(path: &Path) -> std::io::Result<Self> {
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        // SAFETY: as in `create`.
        let map = unsafe { MmapOptions::new().map_mut(&file)? };
        Ok(Self {
            path: path.to_path_buf(),
            map,
            _file: file,
        })
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn bytes(&self) -> &[u8] {
        &self.map
    }

    pub fn bytes_mut(&mut self) -> &mut [u8] {
        &mut self.map
    }

    /// The control file's cancel generation.
    pub fn cancel_generation(&self) -> &AtomicU64 {
        assert!(self.map.len() >= 8);
        // SAFETY: the map is page-aligned and at least 8 bytes; AtomicU64 has the layout of u64.
        unsafe { &*(self.map.as_ptr() as *const AtomicU64) }
    }

    pub fn set_cancel_generation(&self, generation: u64) {
        self.cancel_generation().fetch_max(generation, Ordering::SeqCst);
    }
}

/// A unique path in the temp folder for this process's shared files.
pub fn temp_path(tag: &str) -> PathBuf {
    use std::sync::atomic::AtomicU32;
    static N: AtomicU32 = AtomicU32::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("rc-{}-{}-{}.shm", std::process::id(), tag, n))
}
