//! Settings and recent files, kept as JSON in the user's config folder.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub author: String,
    pub recent: Vec<PathBuf>,
    /// Read pages with our own parser (else PDFium only).
    pub use_parser: bool,
    /// Draw pages from scenes (else PDFium's raster only).
    pub use_scenes: bool,
    /// What draws scenes: `auto` (the GPU, or the CPU on a software GPU), `gpu` or `cpu`.
    pub scene_engine: String,
    /// Send pages whose scene is slower than PDFium to PDFium.
    pub speed_gate: bool,
    /// Check each scene against PDFium in the background.
    pub check: bool,
    pub disk_cache: bool,
    pub thin_lines: bool,
    /// `none`, `dark` or `dim`.
    pub page_filter: String,
    pub continuous: bool,
    pub tile_budget_mb: u64,
    pub show_sidebar: bool,
    pub show_properties: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            author: std::env::var("USERNAME")
                .or_else(|_| std::env::var("USER"))
                .unwrap_or_default(),
            recent: Vec::new(),
            use_parser: true,
            use_scenes: true,
            scene_engine: "auto".into(),
            speed_gate: true,
            check: true,
            disk_cache: true,
            thin_lines: false,
            page_filter: "none".into(),
            continuous: true,
            tile_budget_mb: 320,
            show_sidebar: true,
            show_properties: true,
        }
    }
}

pub fn path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("redcolumn-rs")
        .join("settings.json")
}

impl Settings {
    pub fn load() -> Self {
        std::fs::read(path())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) {
        let p = path();
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        if let Ok(b) = serde_json::to_vec_pretty(self) {
            let tmp = p.with_extension("json.tmp");
            if std::fs::write(&tmp, b).is_ok() {
                let _ = std::fs::rename(tmp, p);
            }
        }
    }

    pub fn add_recent(&mut self, p: &Path) {
        self.recent.retain(|r| r != p);
        self.recent.insert(0, p.to_path_buf());
        self.recent.truncate(12);
    }
}
