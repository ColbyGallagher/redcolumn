//! The worker process: owns one PDFium instance and answers requests from the app.
//!
//! PDFium is not thread-safe, so each worker is single-threaded and the app runs several workers
//! for parallelism. A worker maps each document read-only (the operating system shares the pages
//! between workers), keeps recently used pages parsed, and renders straight into the shared
//! payload file so a tile is never copied inside the worker.

use crate::extract;
use crate::protocol::*;
use crate::shm::{self, Shared};
use memmap2::Mmap;
use pdfium_render::prelude::*;
use std::collections::HashMap;
use std::ffi::c_void;
use std::io::{BufRead, Write};
use std::os::raw::c_int;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::Instant;

const FPDF_ANNOT: c_int = 0x01;
const FPDF_REVERSE_BYTE_ORDER: c_int = 0x10;
const FPDF_THIN_LINE: c_int = 0x20;
const FPDF_ERR_PASSWORD: u64 = 4;
const FPDFBITMAP_BGRA: c_int = 4;
/// FPDF_RenderPageBitmap_Start / _Continue status.
const FPDF_RENDER_TOBECONTINUED: c_int = 1;
/// Parsed pages kept per document.
const PAGE_CACHE: usize = 6;
/// Initial payload file size; it grows (as a new file) when a response needs more.
const PAYLOAD_INITIAL: u64 = 32 << 20;

pub struct Pdf {
    pub b: Box<dyn PdfiumLibraryBindings>,
}

impl Pdf {
    pub fn load(library: &Path) -> anyhow::Result<Self> {
        let b = Pdfium::bind_to_library(library)
            .map_err(|e| anyhow::anyhow!("cannot load PDFium from {}: {e}", library.display()))?;
        // SAFETY: called once, before any other PDFium call, on the only thread that uses it.
        unsafe { b.FPDF_InitLibrary() };
        Ok(Self { b })
    }
}

/// The PDFium library next to this executable, or where `RC_PDFIUM` points.
pub fn default_library_path() -> PathBuf {
    if let Some(p) = std::env::var_os("RC_PDFIUM") {
        return PathBuf::from(p);
    }
    let name = Pdfium::pdfium_platform_library_name();
    std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join(&name))).unwrap_or_else(|| PathBuf::from(name))
}

struct CachedPage {
    page: FPDF_PAGE,
    parse_ms: f64,
}

/// An overlay page: a second load of the page in the scratch document with objects removed.
struct OverlayPage {
    page: FPDF_PAGE,
    key: (bool, Vec<u32>),
}

struct Doc {
    // Field order matters: documents close (in Drop) before the map they read from goes.
    handle: FPDF_DOCUMENT,
    /// A second load of the same bytes, for overlay layers (which remove objects from pages).
    scratch: FPDF_DOCUMENT,
    pages: Vec<(u32, CachedPage)>,
    overlays: HashMap<u32, OverlayPage>,
    _map: Mmap,
}

pub struct Worker {
    pdf: Pdf,
    docs: HashMap<DocId, Doc>,
    control: Shared,
    payload: Shared,
    payload_gen: u32,
    control_path: PathBuf,
}

impl Worker {
    pub fn new(pdf: Pdf, control: &Path) -> anyhow::Result<Self> {
        let control_shm = Shared::open(control)?;
        let payload_path = shm::temp_path("payload");
        let payload = Shared::create(&payload_path, PAYLOAD_INITIAL)?;
        Ok(Self { pdf, docs: HashMap::new(), control: control_shm, payload, payload_gen: 0, control_path: control.to_path_buf() })
    }

    /// Makes sure the payload file holds at least `len` bytes, replacing it with a larger one if not.
    fn reserve(&mut self, len: usize) -> anyhow::Result<()> {
        if self.payload.len() >= len {
            return Ok(());
        }
        let size = (len as u64).next_power_of_two().max(PAYLOAD_INITIAL);
        self.payload_gen += 1;
        let path = shm::temp_path(&format!("payload{}", self.payload_gen));
        let old = std::mem::replace(&mut self.payload, Shared::create(&path, size)?);
        // The app maps the new file when it sees it named; the old one is no longer referenced.
        let _ = std::fs::remove_file(&old.path);
        Ok(())
    }

    fn payload_of(&self, len: usize) -> Payload {
        Payload { file: self.payload.path.clone(), len: len as u64 }
    }

    pub fn handle(&mut self, req: Request) -> Response {
        match self.try_handle(req) {
            Ok(r) => r,
            Err(e) => Response::Error { message: format!("{e:#}") },
        }
    }

    fn try_handle(&mut self, req: Request) -> anyhow::Result<Response> {
        match req {
            Request::Open { doc, path, password } => self.open(doc, &path, password.as_deref()),
            Request::Close { doc } => {
                if let Some(d) = self.docs.remove(&doc) {
                    self.close_doc(d);
                }
                Ok(Response::Closed { doc })
            }
            Request::Pages { doc } => self.pages(doc),
            Request::Render(r) => self.render(&r),
            Request::Extract { doc, page } => self.extract(doc, page),
            Request::Annotations { doc, page } => self.annotations(doc, page),
            Request::Text { doc, page } => self.text(doc, page),
        }
    }

    fn open(&mut self, doc: DocId, path: &Path, password: Option<&str>) -> anyhow::Result<Response> {
        if let Some(d) = self.docs.remove(&doc) {
            self.close_doc(d);
        }
        let file = std::fs::File::open(path)?;
        // SAFETY: mapped read-only; the app replaces files atomically (a new file, then a rename),
        // and closes documents in every worker before it does, so the bytes never change under us.
        let map = unsafe { Mmap::map(&file)? };
        let b = &self.pdf.b;
        // SAFETY: `map` outlives the document: both live in `Doc`, which closes the document first.
        let bytes: &'static [u8] = unsafe { std::slice::from_raw_parts(map.as_ptr(), map.len()) };
        let handle = unsafe { b.FPDF_LoadMemDocument64(bytes, password) };
        if handle.is_null() {
            let err = unsafe { b.FPDF_GetLastError() } as u64;
            if err == FPDF_ERR_PASSWORD {
                return Ok(Response::PasswordRequired);
            }
            anyhow::bail!("PDFium could not open the file (error {err})");
        }
        let scratch = unsafe { b.FPDF_LoadMemDocument64(bytes, password) };
        let pages = unsafe { b.FPDF_GetPageCount(handle) }.max(0) as u32;
        self.docs.insert(doc, Doc { handle, scratch, pages: Vec::new(), overlays: HashMap::new(), _map: map });
        Ok(Response::Opened { doc, pages })
    }

    fn close_doc(&self, mut d: Doc) {
        let b = &self.pdf.b;
        // SAFETY: handles came from this PDFium and are closed once, pages before documents.
        unsafe {
            for (_, p) in d.pages.drain(..) {
                b.FPDF_ClosePage(p.page);
            }
            for (_, o) in d.overlays.drain() {
                b.FPDF_ClosePage(o.page);
            }
            if !d.scratch.is_null() {
                b.FPDF_CloseDocument(d.scratch);
            }
            b.FPDF_CloseDocument(d.handle);
        }
    }

    fn doc(&mut self, doc: DocId) -> anyhow::Result<&mut Doc> {
        self.docs.get_mut(&doc).ok_or_else(|| anyhow::anyhow!("document {doc} is not open"))
    }

    /// The page, parsed (from the cache when it is there). Returns it and the parse time this
    /// call spent.
    fn page(&mut self, doc: DocId, index: u32) -> anyhow::Result<(FPDF_PAGE, f64)> {
        let b = &self.pdf.b as *const Box<dyn PdfiumLibraryBindings>;
        let d = self.doc(doc)?;
        if let Some(i) = d.pages.iter().position(|(n, _)| *n == index) {
            let entry = d.pages.remove(i);
            let page = entry.1.page;
            d.pages.push(entry);
            return Ok((page, 0.0));
        }
        // SAFETY: `b` points at self.pdf.b, which is not touched by the borrow of `d`.
        let b = unsafe { &*b };
        let t = Instant::now();
        let page = unsafe { b.FPDF_LoadPage(d.handle, index as c_int) };
        if page.is_null() {
            anyhow::bail!("page {} could not be loaded", index + 1);
        }
        let parse_ms = t.elapsed().as_secs_f64() * 1000.0;
        if d.pages.len() >= PAGE_CACHE {
            // Evict the cheapest page to parse again, never the newest.
            let (i, _) = d.pages[..d.pages.len() - 1]
                .iter()
                .enumerate()
                .min_by(|a, b| a.1.1.parse_ms.total_cmp(&b.1.1.parse_ms))
                .unwrap();
            let (_, old) = d.pages.remove(i);
            unsafe { b.FPDF_ClosePage(old.page) };
        }
        d.pages.push((index, CachedPage { page, parse_ms }));
        Ok((page, parse_ms))
    }

    fn pages(&mut self, doc: DocId) -> anyhow::Result<Response> {
        let handle = self.doc(doc)?.handle;
        let b = &self.pdf.b;
        let n = unsafe { b.FPDF_GetPageCount(handle) }.max(0);
        let mut pages = Vec::with_capacity(n as usize);
        for i in 0..n {
            // Page sizes without parsing content: FPDF_GetPageSizeByIndexF reads only the
            // page dictionary.
            let mut size = FS_SIZEF { width: 0.0, height: 0.0 };
            unsafe { b.FPDF_GetPageSizeByIndexF(handle, i, &mut size) };
            let label = page_label(b.as_ref(), handle, i);
            pages.push(PageInfo { width: size.width, height: size.height, rotation: 0, label });
        }
        Ok(Response::Pages { doc, pages })
    }

    fn render(&mut self, r: &RenderRequest) -> anyhow::Result<Response> {
        if self.control.cancel_generation().load(Ordering::SeqCst) > r.generation {
            return Ok(Response::Cancelled);
        }
        let len = r.width as usize * r.height as usize * 4;
        if len == 0 || r.width > 16384 || r.height > 16384 {
            anyhow::bail!("bad render size {}x{}", r.width, r.height);
        }
        self.reserve(len)?;
        let t0 = Instant::now();
        let (page, parse_ms) = match r.layer {
            Layer::Overlay { text } => self.overlay_page(r.doc, r.page, text, &r.hide_annots)?,
            _ => self.page(r.doc, r.page)?,
        };
        let parse_done = Instant::now();
        let b = &self.pdf.b;
        let buf = self.payload.bytes_mut().as_mut_ptr() as *mut c_void;
        // SAFETY: the payload holds at least width*height*4 bytes (reserved above); the bitmap
        // borrows it only until it is destroyed below.
        let bitmap = unsafe { b.FPDFBitmap_CreateEx(r.width as c_int, r.height as c_int, FPDFBITMAP_BGRA, buf, (r.width * 4) as c_int) };
        if bitmap.is_null() {
            anyhow::bail!("could not create a {}x{} bitmap", r.width, r.height);
        }
        let background = if matches!(r.layer, Layer::Overlay { .. }) { 0x0000_0000 } else { 0xffff_ffff };
        unsafe { b.FPDFBitmap_FillRect(bitmap, 0, 0, r.width as c_int, r.height as c_int, background) };
        let mut flags = FPDF_REVERSE_BYTE_ORDER;
        if !matches!(r.layer, Layer::Content) {
            flags |= FPDF_ANNOT;
        }
        if r.thin_lines {
            flags |= FPDF_THIN_LINE;
        }
        let page_w = unsafe { b.FPDF_GetPageWidthF(page) } * r.scale;
        let page_h = unsafe { b.FPDF_GetPageHeightF(page) } * r.scale;
        let cancel = PauseState { flag: self.control.cancel_generation() as *const _, generation: r.generation };
        let mut pause = IFSDK_PAUSE { version: 1, NeedToPauseNow: Some(need_to_pause), user: &cancel as *const _ as *mut c_void };
        let size_x = page_w.round() as c_int;
        let size_y = page_h.round() as c_int;
        // SAFETY: page and bitmap are live; `pause` and `cancel` outlive the render calls.
        let mut status = unsafe { b.FPDF_RenderPageBitmap_Start(bitmap, page, -r.x, -r.y, size_x, size_y, 0, flags, &mut pause) };
        let mut cancelled = false;
        while status == FPDF_RENDER_TOBECONTINUED {
            if cancel.cancelled() {
                cancelled = true;
                break;
            }
            status = unsafe { b.FPDF_RenderPage_Continue(page, &mut pause) };
        }
        unsafe {
            b.FPDF_RenderPage_Close(page);
            b.FPDFBitmap_Destroy(bitmap);
        }
        if cancelled {
            return Ok(Response::Cancelled);
        }
        let objects = unsafe { b.FPDFPage_CountObjects(page) }.max(0) as u32;
        Ok(Response::Rendered {
            width: r.width,
            height: r.height,
            payload: self.payload_of(len),
            timing: Timing { parse_ms, work_ms: (Instant::now() - parse_done).as_secs_f64() * 1000.0, objects },
        })
        .inspect(|_| tracing::trace!(ms = t0.elapsed().as_secs_f64() * 1000.0, "render"))
    }

    /// The page in the scratch document with every non-text object (or every object) and the
    /// hidden annotations removed, for drawing over the GPU scene.
    fn overlay_page(&mut self, doc: DocId, index: u32, text: bool, hide: &[u32]) -> anyhow::Result<(FPDF_PAGE, f64)> {
        let b = &self.pdf.b as *const Box<dyn PdfiumLibraryBindings>;
        let d = self.doc(doc)?;
        let mut hide = hide.to_vec();
        hide.sort_unstable();
        hide.dedup();
        let key = (text, hide);
        if let Some(o) = d.overlays.get(&index)
            && o.key == key
        {
            return Ok((o.page, 0.0));
        }
        // SAFETY: as in `page`.
        let b = unsafe { &*b };
        if let Some(o) = d.overlays.remove(&index) {
            // Removing objects is permanent for this load: close and reload the page.
            unsafe { b.FPDF_ClosePage(o.page) };
        }
        if d.scratch.is_null() {
            anyhow::bail!("no scratch document");
        }
        let t = Instant::now();
        let page = unsafe { b.FPDF_LoadPage(d.scratch, index as c_int) };
        if page.is_null() {
            anyhow::bail!("page {} could not be loaded", index + 1);
        }
        // SAFETY: page is live; removed objects are destroyed once, after removal.
        unsafe {
            let n = b.FPDFPage_CountObjects(page);
            for i in (0..n).rev() {
                let obj = b.FPDFPage_GetObject(page, i);
                if obj.is_null() {
                    continue;
                }
                if !(text && keep_text(b.as_ref(), obj)) && b.FPDFPage_RemoveObject(page, obj) != 0 {
                    b.FPDFPageObj_Destroy(obj);
                }
            }
            for &i in key.1.iter().rev() {
                b.FPDFPage_RemoveAnnot(page, i as c_int);
            }
        }
        if d.overlays.len() >= PAGE_CACHE {
            let k = *d.overlays.keys().next().unwrap();
            let o = d.overlays.remove(&k).unwrap();
            unsafe { b.FPDF_ClosePage(o.page) };
        }
        d.overlays.insert(index, OverlayPage { page, key });
        Ok((page, t.elapsed().as_secs_f64() * 1000.0))
    }

    fn extract(&mut self, doc: DocId, index: u32) -> anyhow::Result<Response> {
        let (page, parse_ms) = self.page(doc, index)?;
        let handle = self.doc(doc)?.handle;
        let t = Instant::now();
        let content = extract::extract_page(self.pdf.b.as_ref(), handle, page);
        let objects = unsafe { self.pdf.b.FPDFPage_CountObjects(page) }.max(0) as u32;
        let bytes = rc_scene::wire::encode(&content);
        let work_ms = t.elapsed().as_secs_f64() * 1000.0;
        self.reserve(bytes.len())?;
        self.payload.bytes_mut()[..bytes.len()].copy_from_slice(&bytes);
        Ok(Response::Extracted { payload: self.payload_of(bytes.len()), timing: Timing { parse_ms, work_ms, objects } })
    }

    fn annotations(&mut self, doc: DocId, index: u32) -> anyhow::Result<Response> {
        let (page, _) = self.page(doc, index)?;
        let annots = extract::annotations(self.pdf.b.as_ref(), page);
        Ok(Response::Annotations { annots })
    }

    fn text(&mut self, doc: DocId, index: u32) -> anyhow::Result<Response> {
        let (page, _) = self.page(doc, index)?;
        Ok(Response::Text { runs: extract::text_runs(self.pdf.b.as_ref(), page) })
    }

    pub fn control_path(&self) -> &Path {
        &self.control_path
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        for (_, d) in std::mem::take(&mut self.docs) {
            self.close_doc(d);
        }
        let _ = std::fs::remove_file(&self.payload.path);
    }
}

/// Strips everything but text from an object: true when something is left to keep. Forms are
/// kept with only their text inside (blocks often carry the drawing's text).
///
/// # Safety
/// `obj` must be a live object of a page loaded in this PDFium.
unsafe fn keep_text(b: &dyn PdfiumLibraryBindings, obj: FPDF_PAGEOBJECT) -> bool {
    // SAFETY: per the function's contract; children are live while their form is.
    unsafe {
        match b.FPDFPageObj_GetType(obj) as u32 {
            FPDF_PAGEOBJ_TEXT => true,
            FPDF_PAGEOBJ_FORM => {
                let n = b.FPDFFormObj_CountObjects(obj);
                for i in (0..n.max(0)).rev() {
                    let child = b.FPDFFormObj_GetObject(obj, i as std::os::raw::c_ulong);
                    if child.is_null() {
                        continue;
                    }
                    if !keep_text(b, child) && b.FPDFFormObj_RemoveObject(obj, child) != 0 {
                        b.FPDFPageObj_Destroy(child);
                    }
                }
                b.FPDFFormObj_CountObjects(obj) > 0
            }
            _ => false,
        }
    }
}

struct PauseState {
    flag: *const std::sync::atomic::AtomicU64,
    generation: u64,
}

impl PauseState {
    fn cancelled(&self) -> bool {
        // SAFETY: the flag lives in the control map, which outlives every render.
        unsafe { &*self.flag }.load(Ordering::Relaxed) > self.generation
    }
}

unsafe extern "C" fn need_to_pause(this: *mut IFSDK_PAUSE) -> FPDF_BOOL {
    // SAFETY: PDFium passes back the IFSDK_PAUSE we gave it, whose `user` is a live PauseState.
    let state = unsafe { &*((*this).user as *const PauseState) };
    state.cancelled() as FPDF_BOOL
}

fn page_label(b: &dyn PdfiumLibraryBindings, doc: FPDF_DOCUMENT, index: c_int) -> Option<String> {
    // SAFETY: two-call pattern: the first call returns the size in bytes (UTF-16LE with NUL).
    let n = unsafe { b.FPDF_GetPageLabel(doc, index, std::ptr::null_mut(), 0) } as usize;
    if n <= 2 {
        return None;
    }
    let mut buf = vec![0u16; n / 2];
    unsafe { b.FPDF_GetPageLabel(doc, index, buf.as_mut_ptr() as *mut c_void, n as _) };
    let s = String::from_utf16_lossy(&buf[..buf.len() - 1]);
    (!s.is_empty()).then_some(s)
}

/// The worker's main loop: one JSON request per stdin line, one JSON response per stdout line.
/// Returns when stdin closes (the app exited or dropped the worker).
pub fn run(library: &Path, control: &Path) -> anyhow::Result<()> {
    let pdf = Pdf::load(library)?;
    let mut worker = Worker::new(pdf, control)?;
    let stdin = std::io::stdin();
    let mut stdout = std::io::BufWriter::new(std::io::stdout().lock());
    let mut line = String::new();
    let mut input = stdin.lock();
    loop {
        line.clear();
        if input.read_line(&mut line)? == 0 {
            return Ok(());
        }
        let response = match serde_json::from_str::<Request>(line.trim_end()) {
            Ok(req) => worker.handle(req),
            Err(e) => Response::Error { message: format!("bad request: {e}") },
        };
        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
}

/// Parses the worker's command line (`--pdfium <lib> --control <file>`) and runs it. The app
/// binary calls this when started as a worker.
pub fn main_from_args(args: impl Iterator<Item = String>) -> anyhow::Result<()> {
    let args: Vec<String> = args.collect();
    let get = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let library = get("--pdfium").unwrap_or_else(default_library_path);
    let control = get("--control").ok_or_else(|| anyhow::anyhow!("--control is required"))?;
    run(&library, &control)
}
