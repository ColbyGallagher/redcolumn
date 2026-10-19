//! The viewer: one open document, its pages' state, and everything that turns the camera into a
//! frame.
//!
//! - **Loading** a page tries, in order: the disk cache (scene and fidelity verdict), our own
//!   parser, and PDFium's page object API. Loading runs on the rayon pool; scenes are built and
//!   uploaded there, so the interface thread never waits for a page.
//! - **Drawing** a page uses tiles at the zoom level the view needs: drawn by the GPU from the
//!   page's scene (milliseconds), or by PDFium (the raster path) when the page has no trusted
//!   scene. Missing tiles are covered by coarser or finer ones already made, or the page's preview,
//!   until they arrive, so the view never waits either.
//! - **The fidelity check** compares each new scene with PDFium's render in the background. A
//!   scene from our parser that fails is replaced by one from PDFium's extraction; a scene that
//!   still fails sends the page to the raster path. Verdicts are cached with the scene.

use crate::layout::{self, Camera, Layout, Mode, apply, invert, page_to_screen};
use crate::tiles::{self, Kind, TILE, TileKey, level_for, level_scale, tile_rect, tile_size, tile_transform};
use crossbeam_channel::{Receiver, Sender, unbounded};
use rc_cache::DiskCache;
use rc_gpu::{Affine2, Draw, GpuScene, GpuTexture, PageFilter, Renderer, Target, wgpu};
use rc_pdf::{DocId, Job, JobId, JobResult, Layer, Pool, PoolOptions, RenderRequest};
use rc_scene::content::flags;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

/// The device the viewer draws with.
#[derive(Clone)]
pub struct GpuCtx {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub sample_count: u32,
    /// A software adapter (WARP, llvmpipe): pages are drawn by the raster path only.
    pub software: bool,
}

#[derive(Clone, Debug)]
pub struct ViewerOptions {
    pub pool: PoolOptions,
    /// Read pages with our own parser (else PDFium's page object API only).
    pub use_parser: bool,
    /// Draw pages from GPU scenes (else the raster path only).
    pub use_scenes: bool,
    /// Check every scene against PDFium in the background.
    pub check: bool,
    pub cache: bool,
    pub cache_root: PathBuf,
    pub cache_budget: u64,
    /// GPU memory for tiles, in bytes.
    pub tile_budget: u64,
    /// GPU memory for page scenes, in bytes.
    pub scene_budget: u64,
    /// Scene tiles drawn per frame at most (the rest come next frame).
    pub tiles_per_frame: usize,
    /// Pages loaded ahead on each side of the one in view.
    pub prefetch: usize,
    /// Supersampling for scene tiles (2 matches PDFium's antialiasing within the check's limits).
    pub supersample: u32,
}

impl ViewerOptions {
    pub fn new(pool: PoolOptions) -> Self {
        Self {
            pool,
            use_parser: true,
            use_scenes: true,
            check: true,
            cache: true,
            cache_root: DiskCache::default_root(),
            cache_budget: 5 << 30,
            tile_budget: 320 << 20,
            scene_budget: 1536 << 20,
            tiles_per_frame: 12,
            prefetch: 2,
            supersample: rc_check::SUPERSAMPLE,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageMode {
    Loading,
    /// Drawn from the GPU scene.
    Scene,
    /// Drawn by PDFium.
    Raster,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Cache,
    Parser,
    Pdfium,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Unknown,
    Checking,
    Pass,
    Fail,
}

#[derive(Clone, Debug, Default)]
pub struct PageStats {
    pub parse_ms: f64,
    pub build_ms: f64,
    pub upload_ms: f64,
    /// From asking for the page to its scene being on the GPU.
    pub load_ms: f64,
    pub segments: usize,
    pub triangles: usize,
    pub gpu_bytes: u64,
    pub diffs: [f32; 2],
}

/// What the interface can know about a page.
#[derive(Clone, Debug)]
pub struct PageInfo {
    pub size: [f32; 2],
    pub label: Option<String>,
    pub mode: PageMode,
    pub source: Option<Source>,
    pub verdict: Verdict,
    pub stats: PageStats,
    /// The content's flags (what the scene cannot draw).
    pub flags: u32,
    /// Text is drawn by PDFium's text layer, not the scene.
    pub lacks_text: bool,
    pub layers: Vec<String>,
    pub annots: Vec<rc_parse::Annotation>,
    pub annots_loaded: bool,
}

struct Page {
    info: PageInfo,
    gpu: Option<Arc<GpuScene>>,
    loading: bool,
    load_started: Option<Instant>,
    preview_requested: bool,
    tried_pdfium: bool,
    hidden_annots: Vec<u32>,
    check: Option<CheckRun>,
    thumb: Option<Arc<GpuTexture>>,
    thumb_requested: bool,
    last_seen: u64,
}

struct CheckRun {
    views: [rc_check::View; 2],
    /// Full renders for both views, then overlays for both.
    images: [Option<Vec<u8>>; 4],
}

struct Doc {
    id: DocId,
    path: PathBuf,
    key: Option<String>,
    parser: Option<Arc<rc_parse::Document>>,
    pages: Vec<Page>,
}

enum Msg {
    Scene {
        doc: DocId,
        page: usize,
        result: Result<Option<LoadedScene>, String>,
        flags: u32,
        source: Source,
        stats: PageStats,
        verdict: Verdict,
    },
    Annots {
        doc: DocId,
        page: usize,
        annots: Vec<rc_parse::Annotation>,
    },
    Check {
        doc: DocId,
        page: usize,
        verdict: rc_check::Verdict,
    },
}

struct LoadedScene {
    gpu: Arc<GpuScene>,
    layers: Vec<String>,
    lacks_text: bool,
}

#[derive(Clone, Copy, Debug)]
enum Pending {
    Tile(TileKey),
    Pages(DocId),
    Extract(DocId, usize),
    Check(DocId, usize, usize),
    Thumb(DocId, usize),
    Annots(DocId, usize),
}

struct Tile {
    texture: GpuTexture,
    last_used: u64,
}

/// Diagnostics for the overlay (F12).
#[derive(Clone, Debug, Default)]
pub struct Diag {
    pub level: i32,
    pub tiles_cached: usize,
    pub tile_mb: f64,
    pub scene_tiles_this_frame: usize,
    pub scene_tile_ms: f64,
    pub raster_pending: usize,
    pub missing: usize,
    pub draw_calls: u32,
    pub frame_ms: f64,
    pub scenes_mb: f64,
}

pub struct Viewer {
    pub gpu: GpuCtx,
    renderer: Arc<Renderer>,
    pool: Arc<Pool>,
    cache: Arc<DiskCache>,
    pub opts: ViewerOptions,
    doc: Option<Doc>,
    next_doc: DocId,
    pub layout: Layout,
    pub camera: Camera,
    pub filter: PageFilter,
    pub thin: bool,
    /// Layers hidden by name (applied to every page's scene).
    hidden_layers: HashSet<String>,
    tiles: BTreeMap<TileKey, Tile>,
    tile_bytes: u64,
    requested: HashSet<TileKey>,
    pending: HashMap<JobId, Pending>,
    tx: Sender<Msg>,
    rx: Receiver<Msg>,
    scratch: Option<Target>,
    generation: u64,
    last_level: i32,
    frame: u64,
    canvas: Option<Target>,
    loading_count: usize,
    /// Fidelity comparisons running on the rayon pool.
    checks_running: usize,
    /// Timing events for `--bench`: (name, milliseconds since the viewer started).
    pub events: Vec<(&'static str, f64)>,
    t0: Instant,
    first_paint: bool,
    awaiting_sharp: Option<&'static str>,
    pub diag: Diag,
    pub error: Option<String>,
}

impl Viewer {
    pub fn new(gpu: GpuCtx, opts: ViewerOptions) -> anyhow::Result<Self> {
        let pool = Arc::new(Pool::new(opts.pool.clone())?);
        let renderer = Arc::new(Renderer::new(&gpu.device, &gpu.queue, gpu.sample_count));
        let mut cache = DiskCache::new(opts.cache_root.clone(), opts.cache_budget);
        cache.enabled = opts.cache;
        let (tx, rx) = unbounded();
        Ok(Self {
            gpu,
            renderer,
            pool,
            cache: Arc::new(cache),
            opts,
            doc: None,
            next_doc: 1,
            layout: Layout::new(Vec::new(), Mode::Continuous, 0, 0),
            camera: Camera::default(),
            filter: PageFilter::None,
            thin: false,
            hidden_layers: HashSet::new(),
            tiles: BTreeMap::new(),
            tile_bytes: 0,
            requested: HashSet::new(),
            pending: HashMap::new(),
            tx,
            rx,
            scratch: None,
            generation: 1,
            last_level: i32::MIN,
            frame: 0,
            canvas: None,
            loading_count: 0,
            checks_running: 0,
            events: Vec::new(),
            t0: Instant::now(),
            first_paint: false,
            awaiting_sharp: None,
            diag: Diag::default(),
            error: None,
        })
    }

    /// Asks for a repaint when background work finishes (the interface passes its own).
    pub fn set_waker(&self, f: impl Fn() + Send + Sync + Clone + 'static) {
        self.pool.set_waker(f);
    }

    fn event(&mut self, name: &'static str) {
        self.events.push((name, self.t0.elapsed().as_secs_f64() * 1000.0));
    }

    pub fn renderer(&self) -> &Arc<Renderer> {
        &self.renderer
    }

    pub fn has_document(&self) -> bool {
        self.doc.is_some()
    }

    pub fn path(&self) -> Option<&Path> {
        self.doc.as_ref().map(|d| d.path.as_path())
    }

    pub fn page_count(&self) -> usize {
        self.doc.as_ref().map_or(0, |d| d.pages.len())
    }

    pub fn page_info(&self, i: usize) -> Option<&PageInfo> {
        self.doc.as_ref()?.pages.get(i).map(|p| &p.info)
    }

    /// Opens a file, laying it out at once when our parser can read its page sizes.
    pub fn open(&mut self, path: &Path) -> anyhow::Result<()> {
        self.close();
        let id = self.next_doc;
        self.next_doc += 1;
        let key = DiskCache::key_for(path).ok();
        let file = std::fs::File::open(path)?;
        // SAFETY: mapped read-only. The viewer drops the map (close or prepare_save) before the
        // app replaces the file, and files are only replaced by renaming a new one over them.
        let map = unsafe { memmap2::Mmap::map(&file)? };
        let parser = if self.opts.use_parser {
            rc_parse::Document::open_shared(Arc::new(map)).ok().map(Arc::new)
        } else {
            None
        };
        self.pool.open(id, path.to_path_buf(), None);
        let sizes = parser.as_ref().map(|d| rc_parse::page_sizes(d));
        // PDFium knows the page labels (and the sizes when our parser cannot read the file).
        let pid = self.pool.submit(Job::Pages { doc: id }, 100);
        self.pending.insert(pid, Pending::Pages(id));
        self.doc = Some(Doc {
            id,
            path: path.to_path_buf(),
            key,
            parser,
            pages: Vec::new(),
        });
        if let Some(sizes) = sizes {
            self.set_pages(sizes, vec![]);
        }
        self.event("doc-opened");
        self.awaiting_sharp = Some("page-sharp");
        self.first_paint = false;
        Ok(())
    }

    fn set_pages(&mut self, sizes: Vec<[f32; 2]>, labels: Vec<Option<String>>) {
        let Some(doc) = self.doc.as_mut() else { return };
        if doc.pages.len() == sizes.len() {
            for (p, l) in doc.pages.iter_mut().zip(labels) {
                p.info.label = l;
            }
            return;
        }
        doc.pages = sizes
            .iter()
            .enumerate()
            .map(|(i, &size)| Page {
                info: PageInfo {
                    size,
                    label: labels.get(i).cloned().flatten(),
                    mode: PageMode::Loading,
                    source: None,
                    verdict: Verdict::Unknown,
                    stats: PageStats::default(),
                    flags: 0,
                    lacks_text: false,
                    layers: Vec::new(),
                    annots: Vec::new(),
                    annots_loaded: false,
                },
                gpu: None,
                loading: false,
                load_started: None,
                preview_requested: false,
                tried_pdfium: false,
                hidden_annots: Vec::new(),
                check: None,
                thumb: None,
                thumb_requested: false,
                last_seen: 0,
            })
            .collect();
        self.layout = Layout::new(sizes, self.layout.mode, self.layout.rotation, 0);
        self.fit_width();
        self.camera.scroll[1] = self.layout.bounds()[1];
    }

    pub fn close(&mut self) {
        if let Some(d) = self.doc.take() {
            self.pool.close(d.id);
        }
        self.tiles.clear();
        self.tile_bytes = 0;
        self.requested.clear();
        self.pending.clear();
        self.loading_count = 0;
        self.layout = Layout::new(Vec::new(), self.layout.mode, self.layout.rotation, 0);
    }

    /// Lets go of the file (workers and our map) so it can be replaced on disk. Call
    /// [`Self::reopen`] after.
    pub fn prepare_save(&mut self) -> Option<PathBuf> {
        let d = self.doc.as_mut()?;
        self.pool.close_and_wait(d.id);
        d.parser = None;
        let path = d.path.clone();
        // Background loads hold the parser too; wait for them to finish with it.
        while self.loading_count > 0 {
            if let Ok(m) = self.rx.recv_timeout(std::time::Duration::from_secs(30)) {
                self.handle_msg(m);
            } else {
                break;
            }
        }
        Some(path)
    }

    /// Opens the document again (after a save), keeping the view where it was.
    pub fn reopen(&mut self) -> anyhow::Result<()> {
        let Some(path) = self.path().map(Path::to_path_buf) else {
            return Ok(());
        };
        let (camera, layout_mode, rotation, current) =
            (self.camera, self.layout.mode, self.layout.rotation, self.layout.current);
        self.open(&path)?;
        self.layout = Layout::new(self.layout.sizes.clone(), layout_mode, rotation, current);
        self.camera = camera;
        Ok(())
    }

    // ---- Navigation ----

    pub fn zoom_at(&mut self, factor: f32, anchor: [f32; 2]) {
        self.camera.zoom_at(factor, anchor);
        self.awaiting_sharp = Some("zoom-sharp");
    }

    pub fn scroll_by(&mut self, dx_px: f32, dy_px: f32) {
        self.camera.scroll[0] += dx_px / self.camera.scale;
        self.camera.scroll[1] += dy_px / self.camera.scale;
    }

    pub fn current_page(&self) -> usize {
        if self.layout.sizes.is_empty() {
            return 0;
        }
        match self.layout.mode {
            Mode::Single => self.layout.current,
            Mode::Continuous => {
                let v = self.camera.visible();
                self.layout.nearest_page([(v[0] + v[2]) / 2.0, (v[1] + v[3]) / 2.0])
            }
        }
    }

    pub fn go_to_page(&mut self, i: usize) {
        if i >= self.layout.sizes.len() {
            return;
        }
        match self.layout.mode {
            Mode::Single => {
                self.layout.current = i;
                self.layout = Layout::new(self.layout.sizes.clone(), Mode::Single, self.layout.rotation, i);
                self.fit_page();
            }
            Mode::Continuous => {
                let r = self.layout.rects[i];
                self.camera.scroll[1] = r[1] - layout::MARGIN;
            }
        }
        self.awaiting_sharp = Some("page-sharp");
    }

    pub fn fit_width(&mut self) {
        let i = self.current_page();
        if i >= self.layout.sizes.len() {
            return;
        }
        let [w, _] = self.layout.rotated_size(i);
        self.camera.scale = ((self.camera.viewport[0] - 32.0) / w).clamp(layout::MIN_SCALE, layout::MAX_SCALE);
        let r = self.layout.rects[i];
        self.camera.scroll[0] = r[0] - 16.0 / self.camera.scale;
    }

    pub fn fit_page(&mut self) {
        let i = self.current_page();
        if i >= self.layout.sizes.len() {
            return;
        }
        let [w, h] = self.layout.rotated_size(i);
        let s = ((self.camera.viewport[0] - 32.0) / w).min((self.camera.viewport[1] - 32.0) / h);
        self.camera.scale = s.clamp(layout::MIN_SCALE, layout::MAX_SCALE);
        let r = self.layout.rects[i];
        self.camera.scroll = [
            (r[0] + r[2]) / 2.0 - self.camera.viewport[0] / 2.0 / self.camera.scale,
            (r[1] + r[3]) / 2.0 - self.camera.viewport[1] / 2.0 / self.camera.scale,
        ];
    }

    /// Actual size: one point is `px_per_pt` device pixels (96 / 72 times the display scale).
    pub fn actual_size(&mut self, px_per_pt: f32) {
        let c = [self.camera.viewport[0] / 2.0, self.camera.viewport[1] / 2.0];
        let f = px_per_pt / self.camera.scale;
        self.zoom_at(f, c);
    }

    pub fn set_mode(&mut self, mode: Mode) {
        let cur = self.current_page();
        self.layout = Layout::new(self.layout.sizes.clone(), mode, self.layout.rotation, cur);
        self.go_to_page(cur);
    }

    /// Rotates the view a quarter turn clockwise (negative: anticlockwise).
    pub fn rotate(&mut self, quarter_turns: i32) {
        let cur = self.current_page();
        let r = (self.layout.rotation as i32 + quarter_turns).rem_euclid(4) as u8;
        self.layout = Layout::new(self.layout.sizes.clone(), self.layout.mode, r, cur);
        self.tiles.clear();
        self.tile_bytes = 0;
        self.requested.clear();
        self.go_to_page(cur);
        self.fit_page();
    }

    pub fn set_thin(&mut self, thin: bool) {
        if self.thin != thin {
            self.thin = thin;
            self.drop_tiles(|_| true);
        }
    }

    /// Annotation indices on a page that the app draws itself (imported markups): left out of
    /// PDFium's overlay.
    pub fn set_hidden_annots(&mut self, page: usize, mut hide: Vec<u32>) {
        hide.sort_unstable();
        let Some(p) = self.doc.as_mut().and_then(|d| d.pages.get_mut(page)) else {
            return;
        };
        if p.hidden_annots != hide {
            p.hidden_annots = hide;
            self.drop_tiles(|k| k.page as usize == page && matches!(k.kind, Kind::Overlay | Kind::Raster));
        }
    }

    /// Every layer name on the pages loaded so far.
    pub fn layers(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        if let Some(d) = &self.doc {
            for p in &d.pages {
                for l in &p.info.layers {
                    if !out.contains(l) {
                        out.push(l.clone());
                    }
                }
            }
        }
        out
    }

    pub fn layer_visible(&self, name: &str) -> bool {
        !self.hidden_layers.contains(name)
    }

    /// Shows or hides a layer on every page drawn from a scene (one frame; the raster path draws
    /// the document's default layers).
    pub fn set_layer_visible(&mut self, name: &str, visible: bool) {
        if visible {
            self.hidden_layers.remove(name);
        } else {
            self.hidden_layers.insert(name.to_string());
        }
        let mut changed = Vec::new();
        if let Some(d) = &self.doc {
            for (i, p) in d.pages.iter().enumerate() {
                if let (Some(g), Some(li)) = (&p.gpu, p.info.layers.iter().position(|l| l == name)) {
                    g.set_layer_visible(&self.gpu.queue, li, visible);
                    changed.push(i);
                }
            }
        }
        self.drop_tiles(|k| k.kind == Kind::Scene && changed.contains(&(k.page as usize)));
    }

    fn drop_tiles(&mut self, pred: impl Fn(&TileKey) -> bool) {
        let mut freed = 0;
        self.tiles.retain(|k, t| {
            let keep = !pred(k);
            if !keep {
                freed += (t.texture.width * t.texture.height * 4) as u64;
            }
            keep
        });
        self.tile_bytes -= freed.min(self.tile_bytes);
        self.requested.retain(|k| !pred(k));
    }

    /// Page space to screen pixels for page `i`.
    pub fn page_to_screen(&self, i: usize) -> Affine2 {
        page_to_screen(&self.layout, &self.camera, i)
    }

    /// The page and page-space point under a screen pixel.
    pub fn screen_to_page(&self, px: [f32; 2]) -> Option<(usize, [f32; 2])> {
        let p = self.camera.to_layout(px);
        let i = self.layout.page_at(p)?;
        let inv = invert(&self.page_to_screen(i))?;
        Some((i, apply(&inv, px)))
    }

    // ---- Background work ----

    /// Takes in finished background work. Returns true when anything changed.
    pub fn update(&mut self) -> bool {
        let mut changed = false;
        while let Ok(m) = self.rx.try_recv() {
            self.handle_msg(m);
            changed = true;
        }
        while let Ok(e) = self.pool.events().try_recv() {
            self.handle_event(e);
            changed = true;
        }
        changed
    }

    fn handle_msg(&mut self, m: Msg) {
        let doc_id = self.doc.as_ref().map(|d| d.id);
        match m {
            Msg::Scene {
                doc,
                page,
                result,
                flags: content_flags,
                source,
                stats,
                verdict,
            } => {
                self.loading_count = self.loading_count.saturating_sub(1);
                if Some(doc) != doc_id {
                    return;
                }
                let check = self.opts.check;
                let hidden: Vec<String> = self.hidden_layers.iter().cloned().collect();
                let queue = self.gpu.queue.clone();
                let d = self.doc.as_mut().unwrap();
                let Some(p) = d.pages.get_mut(page) else { return };
                p.loading = false;
                p.info.flags = content_flags;
                p.info.stats = PageStats {
                    load_ms: p.load_started.map_or(0.0, |t| t.elapsed().as_secs_f64() * 1000.0),
                    ..stats
                };
                match result {
                    Ok(Some(s)) => {
                        for (i, l) in s.layers.iter().enumerate() {
                            if hidden.contains(l) {
                                s.gpu.set_layer_visible(&queue, i, false);
                            }
                        }
                        p.info.layers = s.layers;
                        p.info.lacks_text = s.lacks_text;
                        p.info.source = Some(source);
                        p.info.mode = PageMode::Scene;
                        p.info.verdict = verdict;
                        p.gpu = Some(s.gpu);
                        let start_check = check && verdict == Verdict::Unknown;
                        self.drop_tiles(|k| k.page as usize == page && k.kind == Kind::Scene);
                        if start_check {
                            self.start_check(page);
                        }
                    }
                    Ok(None) | Err(_) => {
                        // Nothing the scene can draw faithfully (or reading failed): PDFium draws it.
                        let d = self.doc.as_mut().unwrap();
                        let p = &mut d.pages[page];
                        if source == Source::Parser && !p.tried_pdfium && content_flags & flags::NEEDS_RASTER == 0 {
                            // Our parser could not read it: try PDFium's extraction.
                            p.tried_pdfium = true;
                            p.loading = true;
                            self.loading_count += 1;
                            let id = self.pool.submit(Job::Extract { doc, page: page as u32 }, 50);
                            self.pending.insert(id, Pending::Extract(doc, page));
                        } else {
                            p.info.mode = PageMode::Raster;
                            p.gpu = None;
                        }
                    }
                }
            }
            Msg::Annots { doc, page, annots } => {
                if Some(doc) != doc_id {
                    return;
                }
                if let Some(p) = self.doc.as_mut().unwrap().pages.get_mut(page) {
                    p.info.annots = annots;
                    p.info.annots_loaded = true;
                }
            }
            Msg::Check { doc, page, verdict } => {
                self.checks_running = self.checks_running.saturating_sub(1);
                if Some(doc) != doc_id {
                    return;
                }
                let key = self.doc.as_ref().unwrap().key.clone();
                let p = &mut self.doc.as_mut().unwrap().pages[page];
                p.check = None;
                p.info.stats.diffs = verdict.diffs;
                let source = p.info.source;
                if verdict.ok {
                    p.info.verdict = Verdict::Pass;
                    if let Some(k) = &key {
                        let _ = self.cache.put(k, &format!("verdict-{page}"), b"pass");
                    }
                    return;
                }
                tracing::info!(page, ?verdict, ?source, "scene differs from PDFium");
                if let Some(k) = &key {
                    let _ = self.cache.put(k, &format!("verdict-{page}"), b"fail");
                }
                p.gpu = None;
                if source != Some(Source::Pdfium) && !p.tried_pdfium {
                    p.tried_pdfium = true;
                    p.info.mode = PageMode::Loading;
                    p.info.verdict = Verdict::Unknown;
                    p.loading = true;
                    self.loading_count += 1;
                    let id = self.pool.submit(Job::Extract { doc, page: page as u32 }, 10);
                    self.pending.insert(id, Pending::Extract(doc, page));
                } else {
                    p.info.verdict = Verdict::Fail;
                    p.info.mode = PageMode::Raster;
                }
                self.drop_tiles(|k| k.page as usize == page && k.kind == Kind::Scene);
            }
        }
    }

    fn handle_event(&mut self, e: rc_pdf::Event) {
        let Some(what) = self.pending.remove(&e.id) else { return };
        let doc_id = self.doc.as_ref().map(|d| d.id);
        match what {
            Pending::Tile(key) => {
                self.requested.remove(&key);
                if let JobResult::Rendered {
                    width, height, rgba, ..
                } = e.result
                    && doc_id.is_some()
                {
                    let texture = self
                        .renderer
                        .texture(&self.gpu.device, &self.gpu.queue, width, height, &rgba);
                    self.tile_bytes += (width * height * 4) as u64;
                    self.tiles.insert(
                        key,
                        Tile {
                            texture,
                            last_used: self.frame,
                        },
                    );
                }
            }
            Pending::Pages(doc) => {
                if Some(doc) != doc_id {
                    return;
                }
                if let JobResult::Pages(pages) = e.result {
                    let sizes: Vec<[f32; 2]> = pages.iter().map(|p| [p.width, p.height]).collect();
                    let labels = pages.into_iter().map(|p| p.label).collect();
                    self.set_pages(sizes, labels);
                } else if self.page_count() == 0 {
                    self.error = Some(match e.result {
                        JobResult::PasswordRequired => {
                            "This file needs a password, which this prototype does not ask for yet.".into()
                        }
                        JobResult::Failed(m) => m,
                        other => format!("{other:?}"),
                    });
                }
            }
            Pending::Extract(doc, page) => {
                if Some(doc) != doc_id {
                    self.loading_count = self.loading_count.saturating_sub(1);
                    return;
                }
                match e.result {
                    JobResult::Extracted { content, timing } => {
                        self.spawn_build(page, *content, Source::Pdfium, timing.parse_ms + timing.work_ms);
                    }
                    other => {
                        let _ = self.tx.send(Msg::Scene {
                            doc,
                            page,
                            result: Err(format!("{other:?}")),
                            flags: 0,
                            source: Source::Pdfium,
                            stats: PageStats::default(),
                            verdict: Verdict::Unknown,
                        });
                    }
                }
            }
            Pending::Check(doc, page, slot) => {
                if Some(doc) != doc_id {
                    return;
                }
                let rgba = match e.result {
                    JobResult::Rendered { rgba, .. } => rgba,
                    _ => {
                        // The reference could not be drawn: leave the page unchecked.
                        self.doc.as_mut().unwrap().pages[page].check = None;
                        return;
                    }
                };
                let p = &mut self.doc.as_mut().unwrap().pages[page];
                let Some(run) = p.check.as_mut() else { return };
                run.images[slot] = Some(rgba);
                if run.images.iter().all(Option::is_some) {
                    self.finish_check(page);
                }
            }
            Pending::Thumb(doc, page) => {
                if Some(doc) != doc_id {
                    return;
                }
                if let JobResult::Rendered {
                    width, height, rgba, ..
                } = e.result
                {
                    let t = self
                        .renderer
                        .texture(&self.gpu.device, &self.gpu.queue, width, height, &rgba);
                    if let Some(p) = self.doc.as_mut().unwrap().pages.get_mut(page) {
                        p.thumb = Some(Arc::new(t));
                    }
                }
            }
            Pending::Annots(doc, page) => {
                if Some(doc) != doc_id {
                    return;
                }
                if let JobResult::Annotations(list) = e.result {
                    let annots = list
                        .into_iter()
                        .map(|a| rc_parse::Annotation {
                            index: a.index,
                            subtype: a.subtype,
                            rect: a.rect,
                            color: a
                                .color
                                .map(|c| [c[0] as f32 / 255.0, c[1] as f32 / 255.0, c[2] as f32 / 255.0]),
                            interior: a
                                .interior
                                .map(|c| [c[0] as f32 / 255.0, c[1] as f32 / 255.0, c[2] as f32 / 255.0]),
                            border_width: Some(a.border_width),
                            opacity: a.opacity,
                            contents: a.contents,
                            author: a.author,
                            name: a.name,
                            subject: a.subject,
                            da: a.da,
                            quadding: a.quadding,
                            intent: a.intent,
                            app_data: a.app_data,
                            flags: a.flags,
                            ..Default::default()
                        })
                        .collect();
                    let _ = self.tx.send(Msg::Annots { doc, page, annots });
                }
            }
        }
    }

    /// Starts loading a page's scene (cache, parser or PDFium) if it is not loaded or loading.
    fn ensure_page(&mut self, page: usize) {
        let use_scenes = self.opts.use_scenes && !self.gpu.software;
        let Some(d) = self.doc.as_mut() else { return };
        let doc = d.id;
        let Some(p) = d.pages.get_mut(page) else { return };
        if !p.info.annots_loaded && !p.loading {
            match &d.parser {
                Some(parser) => {
                    let parser = parser.clone();
                    let tx = self.tx.clone();
                    p.info.annots_loaded = true;
                    rayon::spawn(move || {
                        let annots = parser
                            .page(page)
                            .map(|n| rc_parse::annotations(&parser, n))
                            .unwrap_or_default();
                        let _ = tx.send(Msg::Annots { doc, page, annots });
                    });
                }
                None => {
                    p.info.annots_loaded = true;
                    let id = self.pool.submit(Job::Annotations { doc, page: page as u32 }, 20);
                    self.pending.insert(id, Pending::Annots(doc, page));
                }
            }
        }
        if !use_scenes {
            p.info.mode = PageMode::Raster;
            return;
        }
        if p.gpu.is_some() || p.loading || p.info.mode == PageMode::Raster {
            return;
        }
        let max_loading = (rayon::current_num_threads() / 2).max(2);
        if self.loading_count >= max_loading {
            return;
        }
        p.loading = true;
        p.load_started = Some(Instant::now());
        self.loading_count += 1;
        let parser = d.parser.clone();
        let key = d.key.clone();
        let tx = self.tx.clone();
        let cache = self.cache.clone();
        let gpu = self.gpu.clone();
        let renderer = self.renderer.clone();
        let tried_pdfium = p.tried_pdfium;
        let want_pdfium = parser.is_none() || tried_pdfium;
        if want_pdfium {
            let id = self.pool.submit(Job::Extract { doc, page: page as u32 }, 50);
            self.pending.insert(id, Pending::Extract(doc, page));
            return;
        }
        rayon::spawn(move || {
            let send = |result, flags, source, stats, verdict| {
                let _ = tx.send(Msg::Scene {
                    doc,
                    page,
                    result,
                    flags,
                    source,
                    stats,
                    verdict,
                });
            };
            // The disk cache first: a scene and its verdict.
            if let Some(k) = &key {
                let verdict = cache.get(k, &format!("verdict-{page}"));
                if verdict.as_deref() == Some(b"fail") {
                    send(
                        Ok(None),
                        flags::UNSUPPORTED,
                        Source::Cache,
                        PageStats::default(),
                        Verdict::Fail,
                    );
                    return;
                }
                if let Some(bytes) = cache.get(k, &format!("scene-{page}"))
                    && let Ok(scene) = rc_scene::scene_io::decode(&bytes)
                {
                    let verdict = if verdict.as_deref() == Some(b"pass") {
                        Verdict::Pass
                    } else {
                        Verdict::Unknown
                    };
                    let (loaded, stats) = upload(&renderer, &gpu, &scene, PageStats::default());
                    send(loaded, scene.flags, Source::Cache, stats, verdict);
                    return;
                }
            }
            let Some(parser) = parser else { return };
            let t = Instant::now();
            let Some(content) = rc_parse::page_content(&parser, page, &Default::default()) else {
                send(
                    Err("no such page".into()),
                    0,
                    Source::Parser,
                    PageStats::default(),
                    Verdict::Unknown,
                );
                return;
            };
            let parse_ms = t.elapsed().as_secs_f64() * 1000.0;
            if content.flags & flags::NEEDS_RASTER != 0 {
                send(
                    Ok(None),
                    content.flags,
                    Source::Parser,
                    PageStats {
                        parse_ms,
                        ..Default::default()
                    },
                    Verdict::Unknown,
                );
                return;
            }
            let t = Instant::now();
            let scene = rc_scene::build_scene(&content, &Default::default());
            drop(content);
            let stats = PageStats {
                parse_ms,
                build_ms: t.elapsed().as_secs_f64() * 1000.0,
                ..Default::default()
            };
            if let Some(k) = &key {
                let _ = cache.put(k, &format!("scene-{page}"), &rc_scene::scene_io::encode(&scene));
                cache.evict();
            }
            let (loaded, stats) = upload(&renderer, &gpu, &scene, stats);
            send(loaded, scene.flags, Source::Parser, stats, Verdict::Unknown);
        });
    }

    fn spawn_build(&mut self, page: usize, content: rc_scene::PageContent, source: Source, parse_ms: f64) {
        let Some(d) = self.doc.as_ref() else { return };
        let (doc, key) = (d.id, d.key.clone());
        let (tx, cache, gpu, renderer) = (
            self.tx.clone(),
            self.cache.clone(),
            self.gpu.clone(),
            self.renderer.clone(),
        );
        rayon::spawn(move || {
            let send = |result, flags, stats| {
                let _ = tx.send(Msg::Scene {
                    doc,
                    page,
                    result,
                    flags,
                    source,
                    stats,
                    verdict: Verdict::Unknown,
                });
            };
            if content.flags & flags::NEEDS_RASTER != 0 {
                send(
                    Ok(None),
                    content.flags,
                    PageStats {
                        parse_ms,
                        ..Default::default()
                    },
                );
                return;
            }
            let t = Instant::now();
            let scene = rc_scene::build_scene(&content, &Default::default());
            let stats = PageStats {
                parse_ms,
                build_ms: t.elapsed().as_secs_f64() * 1000.0,
                ..Default::default()
            };
            if let Some(k) = &key {
                let _ = cache.put(k, &format!("scene-{page}"), &rc_scene::scene_io::encode(&scene));
            }
            let (loaded, stats) = upload(&renderer, &gpu, &scene, stats);
            send(loaded, scene.flags, stats);
        });
    }

    fn start_check(&mut self, page: usize) {
        let Some(d) = self.doc.as_mut() else { return };
        let doc = d.id;
        let p = &mut d.pages[page];
        let Some(g) = &p.gpu else { return };
        let views = rc_check::views(p.info.size, g.densest_point());
        p.info.verdict = Verdict::Checking;
        p.check = Some(CheckRun {
            views,
            images: [None, None, None, None],
        });
        let text = p.info.lacks_text;
        for (slot, (v, layer)) in [
            (views[0], Layer::Full),
            (views[1], Layer::Full),
            (views[0], Layer::Overlay { text }),
            (views[1], Layer::Overlay { text }),
        ]
        .into_iter()
        .enumerate()
        {
            let id = self
                .pool
                .submit(Job::Render(rc_check::request(doc, page as u32, v, layer, vec![])), -10);
            self.pending.insert(id, Pending::Check(doc, page, slot));
        }
    }

    fn finish_check(&mut self, page: usize) {
        let Some(d) = self.doc.as_mut() else { return };
        let doc = d.id;
        let p = &mut d.pages[page];
        let (Some(run), Some(g)) = (p.check.take(), p.gpu.clone()) else {
            return;
        };
        let (tx, gpu, renderer) = (self.tx.clone(), self.gpu.clone(), self.renderer.clone());
        self.checks_running += 1;
        rayon::spawn(move || {
            let [r0, r1, o0, o1] = run.images.map(Option::unwrap);
            let mut g0 = rc_check::draw_scene(&gpu.device, &gpu.queue, &renderer, &g, run.views[0]);
            let mut g1 = rc_check::draw_scene(&gpu.device, &gpu.queue, &renderer, &g, run.views[1]);
            rc_check::composite(&mut g0, &o0);
            rc_check::composite(&mut g1, &o1);
            let verdict = rc_check::judge([&g0, &g1], [&r0, &r1]);
            let _ = tx.send(Msg::Check { doc, page, verdict });
        });
    }

    // ---- Drawing ----

    /// Draws a frame `width` × `height` pixels. Returns the canvas and whether more work is
    /// pending (the caller should draw again soon).
    pub fn render(&mut self, width: u32, height: u32) -> (&Target, bool) {
        let t0 = Instant::now();
        self.frame += 1;
        let frame = self.frame;
        let (width, height) = (width.max(1), height.max(1));
        if self
            .canvas
            .as_ref()
            .is_none_or(|c| c.width != width || c.height != height)
        {
            self.canvas = Some(Target::new(&self.gpu.device, width, height, self.renderer.sample_count));
        }
        self.camera.viewport = [width as f32, height as f32];
        self.camera.clamp(self.layout.bounds());
        let level = level_for(self.camera.scale);
        if level != self.last_level {
            // Raster tiles for the old level are no longer worth drawing.
            self.generation += 1;
            self.pool.cancel_below(self.generation);
            self.last_level = level;
        }
        self.diag.level = level;
        let mut missing = 0usize;
        let mut busy = false;
        let screen = [0.0, 0.0, width as f32, height as f32];
        let visible_layout = self.camera.visible();
        let center = self.current_page();
        let shown: Vec<usize> = self
            .layout
            .shown()
            .filter(|&i| overlaps(self.layout.rects[i], visible_layout))
            .collect();
        // Load what is in view, then neighbours.
        for &i in &shown {
            self.ensure_page(i);
        }
        let n = self.page_count();
        for k in 1..=self.opts.prefetch {
            if center + k < n {
                self.ensure_page(center + k);
            }
            if center >= k {
                self.ensure_page(center - k);
            }
        }
        // Per page: background, base tiles (fallbacks first), overlay tiles.
        struct PageDraw {
            page: usize,
            transform: Affine2,
            dest: [f32; 4],
            base: Vec<(TileKey, [f32; 4])>,
            overlay: Vec<(TileKey, [f32; 4])>,
            preview: Option<[f32; 4]>,
        }
        let mut scene_jobs: Vec<(f32, TileKey)> = Vec::new();
        let mut page_draws: Vec<PageDraw> = Vec::new();
        let mut raster_wanted: Vec<(TileKey, i64)> = Vec::new();
        for &i in &shown {
            let m = self.page_to_screen(i);
            let r = self.layout.rects[i];
            let tl = self.camera.to_screen([r[0], r[1]]);
            let br = self.camera.to_screen([r[2], r[3]]);
            let dest = [tl[0], tl[1], br[0], br[1]];
            // The visible part of the page, in the rotated page's points.
            let vis = [
                (visible_layout[0].max(r[0]) - r[0]),
                (visible_layout[1].max(r[1]) - r[1]),
                (visible_layout[2].min(r[2]) - r[0]),
                (visible_layout[3].min(r[3]) - r[1]),
            ];
            let Some(info) = self.doc.as_ref().map(|d| &d.pages[i].info) else {
                continue;
            };
            let mode = info.mode;
            let base_kind = if mode == PageMode::Scene {
                Kind::Scene
            } else {
                Kind::Raster
            };
            let hidden = &self.doc.as_ref().unwrap().pages[i].hidden_annots;
            let has_annots = info.annots.iter().any(|a| a.visible() && !hidden.contains(&a.index));
            let overlay = mode != PageMode::Loading && (has_annots || (mode == PageMode::Scene && info.lacks_text));
            let mut pd = PageDraw {
                page: i,
                transform: m,
                dest,
                base: Vec::new(),
                overlay: Vec::new(),
                preview: None,
            };
            let preview_key = TileKey {
                page: i as u32,
                kind: Kind::Preview,
                level: 0,
                tx: 0,
                ty: 0,
            };
            if self.tiles.contains_key(&preview_key) {
                pd.preview = Some(dest);
                self.tiles.get_mut(&preview_key).unwrap().last_used = frame;
            } else if !self.doc.as_ref().unwrap().pages[i].preview_requested {
                self.request_preview(i);
            }
            if mode != PageMode::Loading {
                for (kind, out) in [(base_kind, &mut pd.base), (Kind::Overlay, &mut pd.overlay)] {
                    if kind == Kind::Overlay && !overlay {
                        continue;
                    }
                    // Fallbacks: coarser levels, then one finer, then the level itself.
                    for l in [level - 4, level - 3, level - 2, level - 1, level + 1] {
                        for (tx, ty) in tiles::covering(&self.layout, i, l, vis) {
                            let k = TileKey {
                                page: i as u32,
                                kind,
                                level: l,
                                tx,
                                ty,
                            };
                            if let Some(t) = self.tiles.get_mut(&k) {
                                t.last_used = frame;
                                out.push((k, tile_dest(&self.layout, &self.camera, &k)));
                            }
                        }
                    }
                    for (tx, ty) in tiles::covering(&self.layout, i, level, vis) {
                        let k = TileKey {
                            page: i as u32,
                            kind,
                            level,
                            tx,
                            ty,
                        };
                        if let Some(t) = self.tiles.get_mut(&k) {
                            t.last_used = frame;
                            out.push((k, tile_dest(&self.layout, &self.camera, &k)));
                            continue;
                        }
                        missing += 1;
                        let d = tile_dest(&self.layout, &self.camera, &k);
                        let c = [
                            (d[0] + d[2]) / 2.0 - width as f32 / 2.0,
                            (d[1] + d[3]) / 2.0 - height as f32 / 2.0,
                        ];
                        let dist = c[0] * c[0] + c[1] * c[1];
                        match kind {
                            Kind::Scene => scene_jobs.push((dist, k)),
                            _ => raster_wanted.push((k, 1000 - (dist.sqrt() as i64 / 64))),
                        }
                    }
                }
            } else {
                busy = true;
            }
            page_draws.push(pd);
            if let Some(p) = self.doc.as_mut().and_then(|d| d.pages.get_mut(i)) {
                p.last_seen = frame;
            }
        }
        for (k, prio) in raster_wanted {
            self.request_raster(k, prio);
        }
        // Draw the nearest missing scene tiles now, within the frame's budget.
        scene_jobs.sort_by(|a, b| a.0.total_cmp(&b.0));
        let t_tiles = Instant::now();
        let mut drawn_now = 0;
        for &(_, k) in scene_jobs.iter().take(self.opts.tiles_per_frame) {
            let Some(g) = self.doc.as_ref().and_then(|d| d.pages[k.page as usize].gpu.clone()) else {
                continue;
            };
            let texture = self.renderer.render_tile(
                &self.gpu.device,
                &self.gpu.queue,
                &g,
                tile_transform(&self.layout, &k),
                tile_size(&self.layout, &k),
                self.opts.supersample,
                self.thin,
                &mut self.scratch,
            );
            self.tile_bytes += (texture.width * texture.height * 4) as u64;
            self.tiles.insert(
                k,
                Tile {
                    texture,
                    last_used: frame,
                },
            );
            if let Some(pd) = page_draws.iter_mut().find(|p| p.page == k.page as usize) {
                pd.base.push((k, tile_dest(&self.layout, &self.camera, &k)));
            }
            drawn_now += 1;
            missing -= 1;
        }
        self.diag.scene_tiles_this_frame = drawn_now;
        self.diag.scene_tile_ms = t_tiles.elapsed().as_secs_f64() * 1000.0;
        // Build the frame.
        let white = self.renderer.white();
        let mut draws: Vec<Draw> = Vec::new();
        let full_uv = [0.0, 0.0, 1.0, 1.0];
        for pd in &page_draws {
            draws.push(Draw::Quad {
                texture: white,
                dest: pd.dest,
                uv: full_uv,
                opacity: 1.0,
                straight: false,
                filter: self.filter,
            });
            if let Some(dest) = pd.preview {
                let key = TileKey {
                    page: pd.page as u32,
                    kind: Kind::Preview,
                    level: 0,
                    tx: 0,
                    ty: 0,
                };
                let t = &self.tiles[&key].texture;
                draws.push(Draw::Quad {
                    texture: t,
                    dest,
                    uv: full_uv,
                    opacity: 1.0,
                    straight: true,
                    filter: self.filter,
                });
            }
            for (k, dest) in pd.base.iter().chain(&pd.overlay) {
                let t = &self.tiles[k].texture;
                let straight = k.kind != Kind::Scene;
                draws.push(Draw::Quad {
                    texture: t,
                    dest: *dest,
                    uv: full_uv,
                    opacity: 1.0,
                    straight,
                    filter: self.filter,
                });
            }
            let _ = pd.transform;
        }
        let canvas = self.canvas.as_ref().unwrap();
        let mut enc = self.gpu.device.create_command_encoder(&Default::default());
        let stats = self.renderer.draw(
            &self.gpu.device,
            &self.gpu.queue,
            &mut enc,
            canvas,
            wgpu::Color {
                r: 0.32,
                g: 0.33,
                b: 0.35,
                a: 1.0,
            },
            &draws,
        );
        self.gpu.queue.submit([enc.finish()]);
        let _ = screen;
        // Bookkeeping, events, eviction.
        if !self.first_paint && page_draws.iter().any(|p| p.preview.is_some() || !p.base.is_empty()) {
            self.first_paint = true;
            self.event("first-paint");
        }
        let loading = page_draws.iter().any(|p| {
            self.doc
                .as_ref()
                .is_some_and(|d| d.pages[p.page].info.mode == PageMode::Loading)
        });
        if missing == 0
            && !loading
            && !shown.is_empty()
            && let Some(name) = self.awaiting_sharp.take()
        {
            self.event(name);
        }
        self.evict_tiles(frame);
        self.evict_scenes(center);
        self.diag.missing = missing;
        self.diag.draw_calls = stats.draw_calls;
        self.diag.tiles_cached = self.tiles.len();
        self.diag.tile_mb = self.tile_bytes as f64 / 1e6;
        self.diag.raster_pending = self.requested.len();
        self.diag.frame_ms = t0.elapsed().as_secs_f64() * 1000.0;
        self.diag.scenes_mb = self.doc.as_ref().map_or(0.0, |d| {
            d.pages
                .iter()
                .filter_map(|p| p.gpu.as_ref())
                .map(|g| g.bytes)
                .sum::<u64>() as f64
                / 1e6
        });
        let more = missing > 0 || busy || self.loading_count > 0 || self.checks_running > 0 || !self.pending.is_empty();
        (self.canvas.as_ref().unwrap(), more)
    }

    fn request_preview(&mut self, page: usize) {
        let Some(d) = self.doc.as_mut() else { return };
        let doc = d.id;
        let p = &mut d.pages[page];
        p.preview_requested = true;
        let [w, h] = self.layout.rotated_size(page);
        let s = 1024.0 / w.max(h);
        let req = RenderRequest {
            doc,
            page: page as u32,
            scale: s,
            x: 0,
            y: 0,
            width: (w * s).ceil().max(1.0) as u32,
            height: (h * s).ceil().max(1.0) as u32,
            layer: Layer::Full,
            thin_lines: self.thin,
            rotate: self.layout.rotation,
            hide_annots: vec![],
            generation: rc_pdf::pool::NEVER_CANCEL,
        };
        let key = TileKey {
            page: page as u32,
            kind: Kind::Preview,
            level: 0,
            tx: 0,
            ty: 0,
        };
        let id = self.pool.submit(Job::Render(req), 200);
        self.pending.insert(id, Pending::Tile(key));
        self.requested.insert(key);
    }

    fn request_raster(&mut self, k: TileKey, priority: i64) {
        if self.requested.contains(&k) {
            return;
        }
        let Some(d) = self.doc.as_ref() else { return };
        let p = &d.pages[k.page as usize];
        let [w, h] = tile_size(&self.layout, &k);
        let layer = match k.kind {
            Kind::Overlay => Layer::Overlay {
                text: p.info.mode == PageMode::Scene && p.info.lacks_text,
            },
            _ => Layer::Content,
        };
        let req = RenderRequest {
            doc: d.id,
            page: k.page,
            scale: level_scale(k.level),
            x: k.tx * TILE as i32,
            y: k.ty * TILE as i32,
            width: w,
            height: h,
            layer,
            thin_lines: self.thin,
            rotate: self.layout.rotation,
            hide_annots: p.hidden_annots.clone(),
            generation: self.generation,
        };
        let id = self.pool.submit(Job::Render(req), priority);
        self.pending.insert(id, Pending::Tile(k));
        self.requested.insert(k);
    }

    /// A page's thumbnail, made on first asking (from its scene when it has one, else by PDFium).
    pub fn thumbnail(&mut self, page: usize) -> Option<Arc<GpuTexture>> {
        const SIDE: f32 = 160.0;
        let d = self.doc.as_mut()?;
        let doc = d.id;
        let p = d.pages.get_mut(page)?;
        if let Some(t) = &p.thumb {
            return Some(t.clone());
        }
        let [w, h] = p.info.size;
        let s = SIDE / w.max(h);
        let size = [(w * s).ceil().max(1.0) as u32, (h * s).ceil().max(1.0) as u32];
        if let Some(g) = p.gpu.clone() {
            let t = self.renderer.render_tile(
                &self.gpu.device,
                &self.gpu.queue,
                &g,
                [s, 0.0, 0.0, s, 0.0, 0.0],
                size,
                2,
                false,
                &mut self.scratch,
            );
            let t = Arc::new(t);
            p.thumb = Some(t.clone());
            return Some(t);
        }
        if !p.thumb_requested {
            p.thumb_requested = true;
            let req = RenderRequest {
                doc,
                page: page as u32,
                scale: s,
                x: 0,
                y: 0,
                width: size[0],
                height: size[1],
                layer: Layer::Full,
                thin_lines: false,
                rotate: 0,
                hide_annots: vec![],
                generation: rc_pdf::pool::NEVER_CANCEL,
            };
            let id = self.pool.submit(Job::Render(req), -20);
            self.pending.insert(id, Pending::Thumb(doc, page));
        }
        None
    }

    fn evict_tiles(&mut self, frame: u64) {
        if self.tile_bytes <= self.opts.tile_budget {
            return;
        }
        let mut order: Vec<(u64, TileKey)> = self
            .tiles
            .iter()
            .filter(|(_, t)| t.last_used < frame)
            .map(|(k, t)| (t.last_used, *k))
            .collect();
        order.sort_unstable();
        for (_, k) in order {
            if self.tile_bytes <= self.opts.tile_budget * 3 / 4 {
                break;
            }
            if let Some(t) = self.tiles.remove(&k) {
                self.tile_bytes -= ((t.texture.width * t.texture.height * 4) as u64).min(self.tile_bytes);
            }
        }
    }

    /// Lets go of scenes far from the view when they use more than their budget (they come back
    /// from the disk cache in a moment).
    fn evict_scenes(&mut self, center: usize) {
        let budget = self.opts.scene_budget;
        let frame = self.frame;
        let Some(d) = self.doc.as_mut() else { return };
        let mut total: u64 = d.pages.iter().filter_map(|p| p.gpu.as_ref()).map(|g| g.bytes).sum();
        if total <= budget {
            return;
        }
        let mut order: Vec<usize> = (0..d.pages.len())
            .filter(|&i| d.pages[i].gpu.is_some() && d.pages[i].last_seen < frame)
            .collect();
        order.sort_by_key(|&i| std::cmp::Reverse(i.abs_diff(center)));
        for i in order {
            if total <= budget * 3 / 4 {
                break;
            }
            let p = &mut d.pages[i];
            if let Some(g) = p.gpu.take() {
                total -= g.bytes.min(total);
                p.info.mode = PageMode::Loading;
            }
        }
    }

    /// Drains the timing events.
    pub fn take_events(&mut self) -> Vec<(&'static str, f64)> {
        std::mem::take(&mut self.events)
    }
}

fn upload(
    renderer: &Renderer,
    gpu: &GpuCtx,
    scene: &rc_scene::Scene,
    mut stats: PageStats,
) -> (Result<Option<LoadedScene>, String>, PageStats) {
    let t = Instant::now();
    let r = renderer.upload(&gpu.device, &gpu.queue, scene);
    stats.upload_ms = t.elapsed().as_secs_f64() * 1000.0;
    stats.segments = scene.stats.segments;
    stats.triangles = scene.stats.triangles;
    match r {
        Ok(g) => {
            stats.gpu_bytes = g.bytes;
            let lacks_text = scene.flags & flags::TEXT_NOT_EXTRACTED != 0;
            (
                Ok(Some(LoadedScene {
                    gpu: Arc::new(g),
                    layers: scene.layers.clone(),
                    lacks_text,
                })),
                stats,
            )
        }
        Err(e) => (Err(e.to_string()), stats),
    }
}

fn overlaps(a: [f32; 4], b: [f32; 4]) -> bool {
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

/// Where a tile lands on screen.
fn tile_dest(layout: &Layout, camera: &Camera, k: &TileKey) -> [f32; 4] {
    let r = layout.rects[k.page as usize];
    let t = tile_rect(layout, k);
    let a = camera.to_screen([r[0] + t[0], r[1] + t[1]]);
    let b = camera.to_screen([r[0] + t[2], r[1] + t[3]]);
    [a[0], a[1], b[0], b[1]]
}
