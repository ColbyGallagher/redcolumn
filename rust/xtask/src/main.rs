//! Repository tasks: `cargo xtask <task>`.
//!
//! - `fetch-pdfium [--target linux-x64|win-x64]`: downloads the pinned PDFium build into
//!   `rust/vendor/pdfium/<target>/` and checks its SHA-256. Uses the system `curl` and `tar`, which
//!   ship with Windows 10 and later as well as Linux and macOS.

use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};
use std::process::Command;

/// The pdfium-binaries release every build uses, and each archive's SHA-256.
const PDFIUM_TAG: &str = "chromium/8100";
const PDFIUM_ARCHIVES: &[(&str, &str)] = &[
    (
        "linux-x64",
        "1c1894a12d4d96ee01400c3874444126254180c5c7d2ab628576b67f8120320a",
    ),
    (
        "win-x64",
        "51621bcc1d9be9ea448f4b84b0516862b928e3968d3fca899af1a6d6e2848d6d",
    ),
];

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("fetch-pdfium") => {
            let target = match args.iter().position(|a| a == "--target") {
                Some(i) => args.get(i + 1).context("--target needs a value")?.clone(),
                None => host_target().to_string(),
            };
            fetch_pdfium(&target)
        }
        _ => {
            eprintln!("Usage: cargo xtask fetch-pdfium [--target linux-x64|win-x64]");
            std::process::exit(2);
        }
    }
}

fn host_target() -> &'static str {
    if cfg!(windows) { "win-x64" } else { "linux-x64" }
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

fn fetch_pdfium(target: &str) -> Result<()> {
    let Some(&(_, sha)) = PDFIUM_ARCHIVES.iter().find(|(t, _)| *t == target) else {
        bail!("no pinned PDFium archive for {target}");
    };
    let dir = workspace_root().join("vendor/pdfium").join(target);
    let stamp = dir.join(".sha256");
    if std::fs::read_to_string(&stamp).ok().as_deref() == Some(sha) {
        println!("PDFium {PDFIUM_TAG} ({target}) already in {}", dir.display());
        return Ok(());
    }
    std::fs::create_dir_all(&dir)?;
    let archive = dir.join("pdfium.tgz");
    let url = format!(
        "https://github.com/bblanchon/pdfium-binaries/releases/download/{}/pdfium-{target}.tgz",
        PDFIUM_TAG.replace('/', "%2F")
    );
    println!("Downloading {url}");
    let ok = Command::new("curl")
        .args(["-fsSL", "--retry", "4", "-o"])
        .arg(&archive)
        .arg(&url)
        .status()?;
    if !ok.success() {
        bail!("download failed");
    }
    let got = sha256(&std::fs::read(&archive)?);
    if got != sha {
        bail!("SHA-256 mismatch for {url}: expected {sha}, got {got}");
    }
    let ok = Command::new("tar")
        .arg("xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&dir)
        .status()?;
    if !ok.success() {
        bail!("extracting {} failed", archive.display());
    }
    std::fs::remove_file(&archive)?;
    std::fs::write(&stamp, sha)?;
    println!("PDFium {PDFIUM_TAG} ({target}) in {}", dir.display());
    Ok(())
}

/// SHA-256 (FIPS 180-4), so the task needs no crates beyond anyhow.
fn sha256(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
        0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
        0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
        0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64) * 8;
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(chunk[i * 4..i * 4 + 4].try_into().unwrap());
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7]
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [
                t1.wrapping_add(t2),
                v[0],
                v[1],
                v[2],
                v[3].wrapping_add(t1),
                v[4],
                v[5],
                v[6],
            ];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}
