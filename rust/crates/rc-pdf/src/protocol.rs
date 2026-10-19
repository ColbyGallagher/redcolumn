//! Messages between the app and a PDFium worker process.
//!
//! Requests and responses are single lines of JSON over the worker's stdin and stdout. Anything
//! large (bitmaps, extracted content) is written by the worker into its shared payload file and
//! only described here, so the pipe carries a few hundred bytes per request.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Identifies a document within the pool (the app picks it; every worker uses the same one).
pub type DocId = u32;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum Request {
    /// Open (map) a file. Workers open documents lazily, before their first job on it.
    Open { doc: DocId, path: PathBuf, password: Option<String> },
    Close { doc: DocId },
    /// Page sizes, rotations and labels, for laying out the document.
    Pages { doc: DocId },
    Render(RenderRequest),
    /// The page's content through PDFium's page object API, as `rc_scene::wire` bytes.
    Extract { doc: DocId, page: u32 },
    /// Annotations on a page (for importing markups).
    Annotations { doc: DocId, page: u32 },
    /// Text runs on a page, for selection and search.
    Text { doc: DocId, page: u32 },
}

/// What a render draws.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Layer {
    /// The page as printed: content and annotations, on white.
    Full,
    /// Content only, no annotations, on white (the raster path under our own markups).
    Content,
    /// Annotations only (minus hidden ones), and text objects when `text` is set, on transparent.
    /// Drawn over the GPU scene.
    Overlay { text: bool },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RenderRequest {
    pub doc: DocId,
    pub page: u32,
    /// Device pixels per point.
    pub scale: f32,
    /// The region of the page at `scale` to draw, in device pixels.
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub layer: Layer,
    /// Draw every line at hairline weight.
    pub thin_lines: bool,
    /// Annotation indices not to draw (markups the app draws itself).
    pub hide_annots: Vec<u32>,
    /// The request's generation: the worker stops it when the app's cancel generation passes it.
    pub generation: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PageInfo {
    /// Size in points with rotation applied.
    pub width: f32,
    pub height: f32,
    /// /Rotate in quarter turns clockwise.
    pub rotation: u8,
    pub label: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AnnotInfo {
    /// Position in the page's /Annots array.
    pub index: u32,
    pub subtype: String,
    /// Rectangle in page space (top-left origin, y down).
    pub rect: [f32; 4],
    /// Stroke (/C) and interior (/IC) colours as RGBA, when set.
    pub color: Option<[u8; 4]>,
    pub interior: Option<[u8; 4]>,
    pub border_width: f32,
    /// /CA opacity (1 when unset).
    pub opacity: f32,
    pub contents: String,
    /// /T, /NM, /Subj, /DA.
    pub author: String,
    pub name: String,
    pub subject: String,
    pub da: String,
    /// /Q alignment for FreeText.
    pub quadding: i32,
    /// /IT intent.
    pub intent: String,
    /// The app's own markup data (`/NBData`), when present.
    pub app_data: String,
    pub flags: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TextRun {
    pub text: String,
    /// Bounds in page space.
    pub rect: [f32; 4],
}

/// Where a response's payload is: `len` bytes at the start of the worker's payload file `file`
/// (a new file each time the payload outgrows the old one).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Payload {
    pub file: PathBuf,
    pub len: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum Response {
    Opened { doc: DocId, pages: u32 },
    Closed { doc: DocId },
    Pages { doc: DocId, pages: Vec<PageInfo> },
    /// RGBA pixels, row by row, `width * 4` bytes a row.
    Rendered { width: u32, height: u32, payload: Payload, timing: Timing },
    /// The render was stopped because its generation was cancelled.
    Cancelled,
    Extracted { payload: Payload, timing: Timing },
    Annotations { annots: Vec<AnnotInfo> },
    Text { runs: Vec<TextRun> },
    /// The file needs a password (or the one given was wrong).
    PasswordRequired,
    Error { message: String },
}

/// What a job cost the worker.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Timing {
    /// Parsing the page, when this job had to (0 when it was cached).
    pub parse_ms: f64,
    /// Rendering or extracting.
    pub work_ms: f64,
    /// Top-level page objects.
    pub objects: u32,
}
