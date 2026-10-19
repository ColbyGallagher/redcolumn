//! The window: menus, the canvas (pages drawn by the viewer, markups drawn over them), the
//! sidebar (pages, layers, markups), the properties panel, the status bar and the tools.

use crate::settings::Settings;
use eframe::egui_wgpu::wgpu;
use egui::{
    Color32, CornerRadius, CursorIcon, Event, FontFamily, FontId, Key, Modifiers, PointerButton, Pos2, Rect, Sense,
    Stroke, StrokeKind, Vec2,
};
use rc_gpu::{GpuTexture, PageFilter};
use rc_markup::geometry::{self, HANDLES, Handle, bounds, corners, handle_at, outer, resized};
use rc_markup::store::Store;
use rc_markup::{Markup, Point, RECT, TEXT, parse_color};
use rc_pdf::PoolOptions;
use rc_view::layout::{Mode, apply};
use rc_view::viewer::{GpuCtx, PageMode, Source, Verdict, Viewer, ViewerOptions};
use std::collections::{HashMap, HashSet};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

pub struct BenchSpec {
    pub file: PathBuf,
    pub out: Option<PathBuf>,
}

struct Bench {
    spec: BenchSpec,
    stage: u8,
    out: Box<dyn std::io::Write>,
    started: Instant,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Tool {
    Select,
    Rect,
    Text,
}

enum Drag {
    Pan,
    Create {
        page: usize,
        start: Point,
        cur: Point,
    },
    Move {
        page: usize,
        start: Point,
        cur: Point,
    },
    Resize {
        id: String,
        handle: Handle,
        orig: geometry::Rect,
        cur: Point,
    },
    Band {
        page: usize,
        start: Point,
        cur: Point,
    },
}

struct Editing {
    id: String,
    text: String,
    focus: bool,
}

/// What to do once the user has answered "save changes?".
#[derive(Clone)]
enum After {
    Open(PathBuf),
    Close,
    Exit,
}

pub struct App {
    settings: Settings,
    viewer: Viewer,
    render_state: eframe::egui_wgpu::RenderState,
    canvas_tex: Option<egui::TextureId>,
    store: Store,
    /// Pages whose annotations were imported as markups.
    imported_pages: HashSet<usize>,
    tool: Tool,
    sel: Vec<String>,
    drag: Option<Drag>,
    editing: Option<Editing>,
    clipboard: Vec<Markup>,
    thumbs: HashMap<usize, (egui::TextureId, Arc<GpuTexture>)>,
    goto: String,
    show_diag: bool,
    message: Option<String>,
    confirm: Option<After>,
    exit_confirmed: bool,
    bench: Option<Bench>,
    /// egui font size per point of Helvetica size (so text widths match the PDF's).
    font_calib: f32,
    has_helv: bool,
    sidebar_tab: u8,
    last_title: String,
}

const HELV: &str = "helv";

/// Fonts with Helvetica's widths: Arial on Windows, Liberation Sans elsewhere.
const HELV_FONTS: &[&str] = &[
    "C:\\Windows\\Fonts\\arial.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf",
    "/usr/share/fonts/TTF/LiberationSans-Regular.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
];

impl App {
    pub fn new(
        cc: &eframe::CreationContext<'_>,
        file: Option<PathBuf>,
        bench: Option<BenchSpec>,
    ) -> anyhow::Result<Self> {
        let rs = cc
            .wgpu_render_state
            .clone()
            .ok_or_else(|| anyhow::anyhow!("no wgpu renderer"))?;
        let settings = Settings::load();
        let info = rs.adapter.get_info();
        let force_scenes = std::env::var_os("RC_FORCE_SCENES").is_some();
        let gpu = GpuCtx {
            device: rs.device.clone(),
            queue: rs.queue.clone(),
            sample_count: rc_gpu::sample_count(&rs.adapter),
            software: rc_gpu::is_software(&info) && !force_scenes,
        };
        tracing::info!(adapter = %info.name, backend = ?info.backend, software = gpu.software, "GPU");
        let mut opts = ViewerOptions::new(PoolOptions::current_exe(8)?);
        opts.use_parser = settings.use_parser;
        opts.use_scenes = settings.use_scenes;
        opts.check = settings.check;
        opts.cache = settings.disk_cache;
        opts.tile_budget = settings.tile_budget_mb << 20;
        let mut viewer = Viewer::new(gpu, opts)?;
        viewer.thin = settings.thin_lines;
        viewer.filter = filter_from(&settings.page_filter);
        viewer.layout.mode = if settings.continuous {
            Mode::Continuous
        } else {
            Mode::Single
        };
        let ctx = cc.egui_ctx.clone();
        viewer.set_waker(move || ctx.request_repaint());

        // A Helvetica-width font for markup text.
        let mut fonts = egui::FontDefinitions::default();
        let mut has_helv = false;
        if let Some(bytes) = HELV_FONTS.iter().find_map(|p| std::fs::read(p).ok()) {
            fonts
                .font_data
                .insert(HELV.into(), Arc::new(egui::FontData::from_owned(bytes)));
            let mut family = vec![HELV.to_string()];
            family.extend(
                fonts
                    .families
                    .get(&FontFamily::Proportional)
                    .cloned()
                    .unwrap_or_default(),
            );
            fonts.families.insert(FontFamily::Name(HELV.into()), family);
            has_helv = true;
        }
        cc.egui_ctx.set_fonts(fonts);

        let bench = match bench {
            Some(spec) => {
                let out: Box<dyn std::io::Write> = match &spec.out {
                    Some(p) => Box::new(std::fs::File::create(p)?),
                    None => Box::new(std::io::stdout()),
                };
                Some(Bench {
                    spec,
                    stage: 0,
                    out,
                    started: Instant::now(),
                })
            }
            None => None,
        };
        let mut app = Self {
            settings,
            viewer,
            render_state: rs,
            canvas_tex: None,
            store: Store::new(),
            imported_pages: HashSet::new(),
            tool: Tool::Select,
            sel: Vec::new(),
            drag: None,
            editing: None,
            clipboard: Vec::new(),
            thumbs: HashMap::new(),
            goto: String::new(),
            show_diag: false,
            message: None,
            confirm: None,
            exit_confirmed: false,
            bench,
            font_calib: 1.0,
            has_helv,
            sidebar_tab: 0,
            last_title: String::new(),
        };
        let first = app.bench.as_ref().map(|b| b.spec.file.clone()).or(file);
        if let Some(f) = first {
            app.open(&f);
        }
        Ok(app)
    }

    fn helv(&self, size: f32) -> FontId {
        let family = if self.has_helv {
            FontFamily::Name(HELV.into())
        } else {
            FontFamily::Proportional
        };
        FontId::new((size * self.font_calib).max(0.5), family)
    }

    /// Measures the markup font once so its widths match Helvetica's.
    fn calibrate(&mut self, ctx: &egui::Context) {
        if self.font_calib != 1.0 {
            return;
        }
        let sample = "The quick brown fox jumps over 0123456789";
        let g = ctx.fonts_mut(|f| f.layout_no_wrap(sample.into(), self.helv(100.0), Color32::BLACK));
        let want = rc_markup::text::width(sample, 100.0) as f32;
        if g.size().x > 1.0 {
            self.font_calib = want / g.size().x;
        }
    }

    // ---- Files ----

    fn open(&mut self, path: &Path) {
        if self.store.dirty && !matches!(self.confirm, Some(After::Open(_))) {
            self.confirm = Some(After::Open(path.to_path_buf()));
            return;
        }
        self.confirm = None;
        self.close_doc();
        match self.viewer.open(path) {
            Ok(()) => {
                self.settings.add_recent(path);
                self.settings.save();
            }
            Err(e) => self.message = Some(format!("Could not open {}: {e}", path.display())),
        }
    }

    fn close_doc(&mut self) {
        self.viewer.close();
        self.store = Store::new();
        self.imported_pages.clear();
        self.sel.clear();
        self.editing = None;
        self.drag = None;
        self.free_thumbs();
    }

    fn free_thumbs(&mut self) {
        let mut r = self.render_state.renderer.write();
        for (_, (id, _)) in self.thumbs.drain() {
            r.free_texture(&id);
        }
    }

    /// Saves the markups into the file (an incremental update), then reads them back from it.
    fn save(&mut self) -> bool {
        self.commit_edit();
        let Some(path) = self.viewer.path().map(Path::to_path_buf) else {
            return false;
        };
        let doc = match self.viewer.parser() {
            Some(d) => d,
            None => match std::fs::read(&path)
                .map_err(|e| e.to_string())
                .and_then(|b| rc_parse::Document::open(&b).map_err(|e| e.to_string()))
            {
                Ok(d) => Arc::new(d),
                Err(e) => {
                    self.message = Some(format!("Could not read the file to save into it: {e}"));
                    return false;
                }
            },
        };
        let tmp = match rc_pdfwrite::prepare(&path, &doc, self.store.all(), &self.store.imported) {
            Ok(Some(t)) => t,
            Ok(None) => {
                self.store.dirty = false;
                return true;
            }
            Err(e) => {
                self.message = Some(format!("Could not save: {e}"));
                return false;
            }
        };
        drop(doc);
        // Let go of the file (workers and our map) so it can be replaced.
        self.viewer.prepare_save();
        let result = rc_pdfwrite::replace(&tmp, &path);
        if let Err(e) = self.viewer.reopen() {
            self.message = Some(format!("Saved, but could not open the file again: {e}"));
        }
        // The markups come back from the file, now linked to their annotations.
        self.store = Store::new();
        self.imported_pages.clear();
        self.sel.clear();
        self.free_thumbs();
        match result {
            Ok(()) => true,
            Err(e) => {
                self.message = Some(format!("Could not save: {e}"));
                false
            }
        }
    }

    fn open_dialog(&mut self) {
        if let Some(p) = rfd::FileDialog::new().add_filter("PDF", &["pdf"]).pick_file() {
            self.open(&p);
        }
    }

    // ---- Markups ----

    /// Imports the annotations of pages whose annotations have arrived, and hides those
    /// annotations from PDFium's layer (the markups draw them).
    fn import_pages(&mut self) {
        for i in 0..self.viewer.page_count() {
            if self.imported_pages.contains(&i) {
                continue;
            }
            let Some(info) = self.viewer.page_info(i) else { continue };
            if !info.annots_loaded || (info.annots.is_empty() && info.mode == PageMode::Loading) {
                continue;
            }
            let ms = rc_markup::import::import(i, self.viewer.page_rotate(i), &info.annots);
            self.imported_pages.insert(i);
            if ms.is_empty() {
                continue;
            }
            let hide: Vec<u32> = ms
                .iter()
                .filter_map(|m| m.pdf_annot.as_ref().map(|l| l.index))
                .collect();
            if !show_pdf_appearances() {
                self.viewer.set_hidden_annots(i, hide.clone());
            }
            let mut all = self.store.all().to_vec();
            all.extend(ms);
            let mut imported = std::mem::take(&mut self.store.imported);
            imported.extend(hide.into_iter().map(|h| (i, h)));
            let dirty = self.store.dirty;
            // Loading never adds an undo step; edits made before keep theirs.
            if self.store.can_undo() || self.store.can_redo() {
                for m in all.into_iter().skip(self.store.all().len()) {
                    self.store.add(m);
                }
                self.store.imported = imported;
            } else {
                self.store.load(all, imported);
            }
            self.store.dirty = dirty;
        }
    }

    fn commit_edit(&mut self) {
        let Some(e) = self.editing.take() else { return };
        let text = e.text;
        self.store.update(std::slice::from_ref(&e.id), |m| {
            m.text = Some(text.clone());
            // Grow the box to fit its text.
            let need = rc_markup::text::needed_height(m);
            let b = bounds(&m.points);
            if b[3] - b[1] < need {
                m.points = corners([b[0], b[1], b[2], b[1] + need]);
            }
        });
    }

    fn selected(&self) -> Vec<&Markup> {
        self.sel.iter().filter_map(|id| self.store.get(id)).collect()
    }

    fn delete_selected(&mut self) {
        self.store.remove(&self.sel);
        self.sel.retain(|id| self.store.get(id).is_some());
    }

    fn copy_selected(&mut self, ctx: &egui::Context) {
        self.clipboard = self.selected().into_iter().cloned().collect();
        if let Ok(json) = serde_json::to_string(&self.clipboard) {
            ctx.copy_text(json);
        }
    }

    fn paste(&mut self, text: Option<&str>) {
        let from_os: Option<Vec<Markup>> = text.and_then(|t| serde_json::from_str(t).ok());
        let items = from_os.unwrap_or_else(|| self.clipboard.clone());
        if items.is_empty() {
            return;
        }
        let page = self.viewer.current_page();
        let size = self.viewer.page_info(page).map_or([1e6, 1e6], |p| p.size);
        let ms: Vec<Markup> = items
            .into_iter()
            .filter(|m| Markup::supported(&m.kind))
            .map(|mut m| {
                m.id = rc_markup::new_id();
                m.seq = None;
                m.pdf_annot = None;
                m.locked = None;
                m.page_index = page;
                m.author = self.settings.author.clone();
                let (now, b) = (rc_markup::now_ms(), outer(&m));
                m.created_at = now;
                m.modified_at = now;
                geometry::translate(&mut m, 12.0, 12.0);
                let (dx, dy) = geometry::clamp_to_page(
                    [b[0] + 12.0, b[1] + 12.0, b[2] + 12.0, b[3] + 12.0],
                    [size[0] as f64, size[1] as f64],
                );
                geometry::translate(&mut m, dx, dy);
                m
            })
            .collect();
        self.clipboard = ms.clone();
        self.sel = self.store.add_all(ms);
    }

    // ---- Frame ----

    fn shortcuts(&mut self, ctx: &egui::Context) {
        let typing = ctx.egui_wants_keyboard_input() || self.editing.is_some();
        let events = ctx.input(|i| i.events.clone());
        if !typing {
            for e in &events {
                match e {
                    Event::Copy => self.copy_selected(ctx),
                    Event::Cut => {
                        self.copy_selected(ctx);
                        self.delete_selected();
                    }
                    Event::Paste(t) => self.paste(Some(t)),
                    _ => {}
                }
            }
        }
        let k = |m: Modifiers, key: Key| ctx.input_mut(|i| i.consume_key(m, key));
        let cmd = Modifiers::COMMAND;
        if k(cmd, Key::O) {
            self.open_dialog();
        }
        if k(cmd, Key::S) {
            self.save();
        }
        if k(Modifiers::NONE, Key::F12) {
            self.show_diag = !self.show_diag;
        }
        if typing {
            if self.editing.is_some() && k(Modifiers::NONE, Key::Escape) {
                self.commit_edit();
            }
            return;
        }
        if k(cmd | Modifiers::SHIFT, Key::Z) || k(cmd, Key::Y) {
            self.store.redo();
        } else if k(cmd, Key::Z) {
            self.store.undo();
        }
        if k(cmd, Key::A) {
            let p = self.viewer.current_page();
            self.sel = self.store.on_page(p).map(|m| m.id.clone()).collect();
        }
        if k(Modifiers::NONE, Key::Delete) || k(Modifiers::NONE, Key::Backspace) {
            self.delete_selected();
        }
        if k(Modifiers::NONE, Key::Escape) {
            self.tool = Tool::Select;
            self.sel.clear();
            self.drag = None;
        }
        if k(Modifiers::NONE, Key::V) {
            self.tool = Tool::Select;
        }
        if k(Modifiers::NONE, Key::R) {
            self.tool = Tool::Rect;
        }
        if k(Modifiers::NONE, Key::T) {
            self.tool = Tool::Text;
        }
        let center = [
            self.viewer.camera.viewport[0] / 2.0,
            self.viewer.camera.viewport[1] / 2.0,
        ];
        if k(cmd, Key::Num0) {
            self.viewer.fit_page();
        }
        if k(cmd, Key::Num1) {
            self.viewer.actual_size(96.0 / 72.0 * ctx.pixels_per_point());
        }
        if k(cmd, Key::Num2) {
            self.viewer.fit_width();
        }
        if k(cmd, Key::Equals) || k(cmd, Key::Plus) {
            self.viewer.zoom_at(1.25, center);
        }
        if k(cmd, Key::Minus) {
            self.viewer.zoom_at(0.8, center);
        }
        if k(cmd | Modifiers::SHIFT, Key::R) {
            self.viewer.rotate(-1);
        } else if k(cmd, Key::R) {
            self.viewer.rotate(1);
        }
        let n = self.viewer.page_count();
        let cur = self.viewer.current_page();
        if k(Modifiers::NONE, Key::PageDown) && cur + 1 < n {
            self.viewer.go_to_page(cur + 1);
        }
        if k(Modifiers::NONE, Key::PageUp) && cur > 0 {
            self.viewer.go_to_page(cur - 1);
        }
        if k(Modifiers::NONE, Key::Home) {
            self.viewer.go_to_page(0);
        }
        if k(Modifiers::NONE, Key::End) && n > 0 {
            self.viewer.go_to_page(n - 1);
        }
        // Arrows nudge the selection, else scroll.
        let step = if ctx.input(|i| i.modifiers.shift) { 10.0 } else { 1.0 };
        let arrows = [
            (Key::ArrowLeft, -1.0, 0.0),
            (Key::ArrowRight, 1.0, 0.0),
            (Key::ArrowUp, 0.0, -1.0),
            (Key::ArrowDown, 0.0, 1.0),
        ];
        for (key, dx, dy) in arrows {
            if ctx.input(|i| i.key_pressed(key)) {
                if self.sel.is_empty() {
                    self.viewer.scroll_by(dx * 60.0, dy * 60.0);
                } else {
                    let (dx, dy) = self.page_delta(self.viewer.current_page(), dx * step, dy * step);
                    self.store
                        .update_coalesced(&self.sel.clone(), "nudge", |m| geometry::translate(m, dx, dy));
                }
            }
        }
    }

    /// A movement on screen (in the view's rotation) as a movement in page space.
    fn page_delta(&self, page: usize, dx: f32, dy: f32) -> (f64, f64) {
        let m = self.viewer.page_to_screen(page);
        let s = (m[0] * m[0] + m[1] * m[1]).sqrt().max(1e-6);
        // The rotation part of page→screen, inverted (it is orthogonal).
        let (a, b, c, d) = (m[0] / s, m[1] / s, m[2] / s, m[3] / s);
        let x = a * dx + b * dy;
        let y = c * dx + d * dy;
        (x as f64, y as f64)
    }

    fn menu(&mut self, ui: &mut egui::Ui) {
        egui::MenuBar::new().ui(ui, |ui| {
            ui.menu_button("File", |ui| {
                if ui.button("Open…\tCtrl+O").clicked() {
                    self.open_dialog();
                }
                ui.menu_button("Open Recent", |ui| {
                    let recent = self.settings.recent.clone();
                    if recent.is_empty() {
                        ui.label("Nothing yet");
                    }
                    for p in recent {
                        if ui.button(p.display().to_string()).clicked() {
                            self.open(&p);
                        }
                    }
                });
                if ui
                    .add_enabled(self.viewer.has_document(), egui::Button::new("Save\tCtrl+S"))
                    .clicked()
                {
                    self.save();
                }
                if ui
                    .add_enabled(self.viewer.has_document(), egui::Button::new("Close"))
                    .clicked()
                {
                    if self.store.dirty {
                        self.confirm = Some(After::Close);
                    } else {
                        self.close_doc();
                    }
                }
                ui.separator();
                if ui.button("Exit").clicked() {
                    ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                }
            });
            ui.menu_button("Edit", |ui| {
                if ui
                    .add_enabled(self.store.can_undo(), egui::Button::new("Undo\tCtrl+Z"))
                    .clicked()
                {
                    self.store.undo();
                }
                if ui
                    .add_enabled(self.store.can_redo(), egui::Button::new("Redo\tCtrl+Y"))
                    .clicked()
                {
                    self.store.redo();
                }
                ui.separator();
                if ui
                    .add_enabled(!self.sel.is_empty(), egui::Button::new("Copy\tCtrl+C"))
                    .clicked()
                {
                    let ctx = ui.ctx().clone();
                    self.copy_selected(&ctx);
                }
                if ui
                    .add_enabled(!self.clipboard.is_empty(), egui::Button::new("Paste\tCtrl+V"))
                    .clicked()
                {
                    self.paste(None);
                }
                if ui
                    .add_enabled(!self.sel.is_empty(), egui::Button::new("Delete\tDel"))
                    .clicked()
                {
                    self.delete_selected();
                }
            });
            ui.menu_button("View", |ui| {
                let center = [
                    self.viewer.camera.viewport[0] / 2.0,
                    self.viewer.camera.viewport[1] / 2.0,
                ];
                if ui.button("Fit Page\tCtrl+0").clicked() {
                    self.viewer.fit_page();
                }
                if ui.button("Fit Width\tCtrl+2").clicked() {
                    self.viewer.fit_width();
                }
                if ui.button("Actual Size\tCtrl+1").clicked() {
                    self.viewer.actual_size(96.0 / 72.0 * ui.ctx().pixels_per_point());
                }
                if ui.button("Zoom In\tCtrl++").clicked() {
                    self.viewer.zoom_at(1.25, center);
                }
                if ui.button("Zoom Out\tCtrl+-").clicked() {
                    self.viewer.zoom_at(0.8, center);
                }
                ui.separator();
                let mut continuous = self.viewer.layout.mode == Mode::Continuous;
                if ui.checkbox(&mut continuous, "Continuous").changed() {
                    self.viewer
                        .set_mode(if continuous { Mode::Continuous } else { Mode::Single });
                    self.settings.continuous = continuous;
                    self.settings.save();
                }
                if ui.button("Rotate Clockwise\tCtrl+R").clicked() {
                    self.viewer.rotate(1);
                }
                if ui.button("Rotate Anticlockwise\tCtrl+Shift+R").clicked() {
                    self.viewer.rotate(-1);
                }
                ui.separator();
                let mut thin = self.viewer.thin;
                if ui.checkbox(&mut thin, "Thin Lines").changed() {
                    self.viewer.set_thin(thin);
                    self.settings.thin_lines = thin;
                    self.settings.save();
                }
                ui.menu_button("Page Colours", |ui| {
                    for (name, label) in [("none", "Normal"), ("dark", "Dark"), ("dim", "Dim")] {
                        if ui.radio(self.settings.page_filter == name, label).clicked() {
                            self.settings.page_filter = name.into();
                            self.viewer.filter = filter_from(name);
                            self.settings.save();
                        }
                    }
                });
                ui.separator();
                ui.checkbox(&mut self.settings.show_sidebar, "Sidebar");
                ui.checkbox(&mut self.settings.show_properties, "Properties");
                ui.checkbox(&mut self.show_diag, "Diagnostics\tF12");
            });
            ui.menu_button("Tools", |ui| {
                for (t, label) in [
                    (Tool::Select, "Select\tV"),
                    (Tool::Rect, "Rectangle\tR"),
                    (Tool::Text, "Text Box\tT"),
                ] {
                    if ui.radio(self.tool == t, label).clicked() {
                        self.tool = t;
                    }
                }
            });
            ui.menu_button("Settings", |ui| {
                ui.label("Applied when a file is next opened:");
                let mut changed = false;
                changed |= ui
                    .checkbox(&mut self.settings.use_parser, "Read pages with our own parser")
                    .changed();
                changed |= ui
                    .checkbox(&mut self.settings.use_scenes, "Draw pages on the GPU")
                    .changed();
                changed |= ui
                    .checkbox(&mut self.settings.check, "Check pages against PDFium")
                    .changed();
                changed |= ui.checkbox(&mut self.settings.disk_cache, "Disk cache").changed();
                if changed {
                    self.viewer.opts.use_parser = self.settings.use_parser;
                    self.viewer.opts.use_scenes = self.settings.use_scenes;
                    self.viewer.opts.check = self.settings.check;
                    self.settings.save();
                }
                ui.horizontal(|ui| {
                    ui.label("Author:");
                    if ui.text_edit_singleline(&mut self.settings.author).lost_focus() {
                        self.settings.save();
                    }
                });
                if ui.button("Clear Disk Cache").clicked() {
                    let c = rc_cache::DiskCache::new(rc_cache::DiskCache::default_root(), 0);
                    self.message = Some(match c.clear() {
                        Ok(()) => "The disk cache is empty.".into(),
                        Err(e) => format!("Could not clear the cache: {e}"),
                    });
                }
            });
        });
    }

    fn status_bar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            let n = self.viewer.page_count();
            if n == 0 {
                ui.label("Open a PDF (Ctrl+O, or drop it here)");
                return;
            }
            let cur = self.viewer.current_page();
            ui.label("Page");
            let r = ui.add(
                egui::TextEdit::singleline(&mut self.goto)
                    .desired_width(40.0)
                    .hint_text((cur + 1).to_string()),
            );
            if r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter)) {
                if let Ok(p) = self.goto.trim().parse::<usize>()
                    && p >= 1
                    && p <= n
                {
                    self.viewer.go_to_page(p - 1);
                }
                self.goto.clear();
            }
            ui.label(format!("of {n}"));
            if let Some(l) = self.viewer.page_info(cur).and_then(|i| i.label.clone()) {
                ui.label(format!("({l})"));
            }
            ui.separator();
            let zoom = self.viewer.camera.scale / ui.ctx().pixels_per_point() * 72.0 / 96.0 * 100.0;
            ui.label(format!("{zoom:.0}%"));
            ui.separator();
            if let Some(info) = self.viewer.page_info(cur) {
                let how = match (info.mode, info.source) {
                    (PageMode::Loading, _) => "loading".to_string(),
                    (PageMode::Raster, _) => "PDFium raster".to_string(),
                    (PageMode::Scene, Some(Source::Cache)) => "GPU (cached)".to_string(),
                    (PageMode::Scene, Some(Source::Parser)) => "GPU (own parser)".to_string(),
                    (PageMode::Scene, _) => "GPU (PDFium extraction)".to_string(),
                };
                let verdict = match info.verdict {
                    Verdict::Pass => " ✔ matches PDFium",
                    Verdict::Fail => " ✖ differs from PDFium",
                    Verdict::Checking => " … checking",
                    Verdict::Unknown => "",
                };
                ui.label(format!("{how}{verdict}"));
            }
            ui.separator();
            ui.label(match self.tool {
                Tool::Select => "Select",
                Tool::Rect => "Rectangle",
                Tool::Text => "Text Box",
            });
            if self.store.dirty {
                ui.separator();
                ui.label("Unsaved changes");
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let d = &self.viewer.diag;
                ui.label(format!(
                    "{:.1} ms/frame · {} tiles · {:.0} MB scenes",
                    d.frame_ms, d.tiles_cached, d.scenes_mb
                ));
            });
        });
    }

    fn sidebar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.sidebar_tab, 0, "Pages");
            ui.selectable_value(&mut self.sidebar_tab, 1, "Layers");
            ui.selectable_value(&mut self.sidebar_tab, 2, "Markups");
        });
        ui.separator();
        match self.sidebar_tab {
            0 => self.thumbnails(ui),
            1 => {
                let layers = self.viewer.layers();
                if layers.is_empty() {
                    ui.label("No layers on the pages loaded so far.");
                }
                egui::ScrollArea::vertical().show(ui, |ui| {
                    for l in layers {
                        let mut on = self.viewer.layer_visible(&l);
                        if ui.checkbox(&mut on, &l).changed() {
                            self.viewer.set_layer_visible(&l, on);
                        }
                    }
                });
            }
            _ => {
                let rows: Vec<(String, String, usize)> = self
                    .store
                    .all()
                    .iter()
                    .map(|m| {
                        let what = m
                            .text
                            .as_deref()
                            .filter(|t| !t.is_empty())
                            .map(|t| t.lines().next().unwrap_or("").to_string())
                            .unwrap_or_else(|| m.label().into());
                        (
                            m.id.clone(),
                            format!(
                                "#{} {} · p{} · {}",
                                m.seq.unwrap_or(0),
                                what,
                                m.page_index + 1,
                                m.author
                            ),
                            m.page_index,
                        )
                    })
                    .collect();
                if rows.is_empty() {
                    ui.label("No markups yet. R draws a rectangle, T a text box.");
                }
                egui::ScrollArea::vertical().show(ui, |ui| {
                    for (id, label, page) in rows {
                        if ui.selectable_label(self.sel.contains(&id), label).clicked() {
                            self.sel = vec![id];
                            if page != self.viewer.current_page() {
                                self.viewer.go_to_page(page);
                            }
                        }
                    }
                });
            }
        }
    }

    fn thumbnails(&mut self, ui: &mut egui::Ui) {
        let n = self.viewer.page_count();
        let cur = self.viewer.current_page();
        let row = 190.0;
        egui::ScrollArea::vertical().show_rows(ui, row, n, |ui, range| {
            for i in range {
                let tex = match self.thumbs.get(&i) {
                    Some((id, t)) => Some((*id, [t.width, t.height])),
                    None => self.viewer.thumbnail(i).map(|t| {
                        let id = self.render_state.renderer.write().register_native_texture(
                            &self.render_state.device,
                            &t.view,
                            wgpu::FilterMode::Linear,
                        );
                        let size = [t.width, t.height];
                        self.thumbs.insert(i, (id, t));
                        (id, size)
                    }),
                };
                let r = ui.vertical_centered(|ui| {
                    ui.set_height(row - 8.0);
                    let resp = match tex {
                        Some((id, [w, h])) => {
                            let s = 160.0 / w.max(h) as f32;
                            ui.add(egui::Image::new((id, Vec2::new(w as f32 * s, h as f32 * s))).sense(Sense::click()))
                        }
                        None => ui.add(egui::Label::new("…").sense(Sense::click())),
                    };
                    if i == cur {
                        ui.painter().rect_stroke(
                            resp.rect.expand(2.0),
                            2.0,
                            Stroke::new(2.0, ui.visuals().selection.bg_fill),
                            StrokeKind::Outside,
                        );
                    }
                    let label = self
                        .viewer
                        .page_info(i)
                        .and_then(|p| p.label.clone())
                        .unwrap_or_else(|| (i + 1).to_string());
                    ui.label(label);
                    resp
                });
                if r.inner.clicked() {
                    self.viewer.go_to_page(i);
                }
            }
        });
    }

    fn properties(&mut self, ui: &mut egui::Ui) {
        ui.heading("Properties");
        let Some(first) = self.selected().first().map(|m| (*m).clone()) else {
            ui.label("Select a markup to change it.");
            return;
        };
        let ids = self.sel.clone();
        let n = ids.len();
        ui.label(if n == 1 {
            format!("{} #{}", first.label(), first.seq.unwrap_or(0))
        } else {
            format!("{n} markups")
        });
        ui.add_space(6.0);
        let locked = first.is_locked();
        ui.add_enabled_ui(!locked, |ui| {
            egui::Grid::new("props")
                .num_columns(2)
                .spacing([8.0, 6.0])
                .show(ui, |ui| {
                    ui.label(if first.kind == TEXT { "Border" } else { "Line" });
                    let mut c = rgb8(&first.style.stroke);
                    if ui.color_edit_button_srgb(&mut c).changed() {
                        let hex = hex8(c);
                        self.store
                            .update_coalesced(&ids, "stroke", |m| m.style.stroke = hex.clone());
                    }
                    ui.end_row();
                    ui.label("Fill");
                    ui.horizontal(|ui| {
                        let mut on = first.style.fill.is_some();
                        if ui.checkbox(&mut on, "").changed() {
                            let fill = on.then(|| "#ffffff".to_string());
                            self.store.update(&ids, |m| m.style.fill = fill.clone());
                        }
                        if let Some(f) = &first.style.fill {
                            let mut c = rgb8(f);
                            if ui.color_edit_button_srgb(&mut c).changed() {
                                let hex = hex8(c);
                                self.store
                                    .update_coalesced(&ids, "fill", |m| m.style.fill = Some(hex.clone()));
                            }
                        }
                    });
                    ui.end_row();
                    ui.label("Width");
                    let mut w = first.style.width;
                    if ui
                        .add(egui::DragValue::new(&mut w).range(0.0..=72.0).speed(0.1).suffix(" pt"))
                        .changed()
                    {
                        self.store.update_coalesced(&ids, "width", |m| m.style.width = w);
                    }
                    ui.end_row();
                    ui.label("Opacity");
                    let mut o = first.style.opacity;
                    if ui.add(egui::Slider::new(&mut o, 0.0..=1.0)).changed() {
                        self.store.update_coalesced(&ids, "opacity", |m| m.style.opacity = o);
                    }
                    ui.end_row();
                    if first.kind == TEXT {
                        ui.label("Font size");
                        let mut s = first.style.font_size();
                        if ui
                            .add(
                                egui::DragValue::new(&mut s)
                                    .range(2.0..=288.0)
                                    .speed(0.25)
                                    .suffix(" pt"),
                            )
                            .changed()
                        {
                            self.store
                                .update_coalesced(&ids, "size", |m| m.style.font_size = Some(s));
                        }
                        ui.end_row();
                        ui.label("Text colour");
                        let mut c = rgb8(first.style.text_color());
                        if ui.color_edit_button_srgb(&mut c).changed() {
                            let hex = hex8(c);
                            self.store
                                .update_coalesced(&ids, "textColor", |m| m.style.text_color = Some(hex.clone()));
                        }
                        ui.end_row();
                        ui.label("Align");
                        ui.horizontal(|ui| {
                            for a in ["left", "center", "right"] {
                                if ui.selectable_label(first.style.text_align() == a, a).clicked() {
                                    self.store.update(&ids, |m| {
                                        m.style.extra.insert("textAlign".into(), a.into());
                                    });
                                }
                            }
                        });
                        ui.end_row();
                    }
                });
        });
        ui.add_space(6.0);
        let mut lock = locked;
        if ui.checkbox(&mut lock, "Locked").changed() {
            for id in &ids {
                self.store.update_any(id, |m| m.locked = lock.then_some(true));
            }
        }
        if n == 1 {
            ui.add_space(6.0);
            ui.label("Comment");
            let mut c = first.comment.clone().unwrap_or_default();
            let r = ui.add(egui::TextEdit::multiline(&mut c).desired_rows(3));
            if r.changed() {
                let id = first.id.clone();
                self.store
                    .update_any(&id, |m| m.comment = (!c.is_empty()).then(|| c.clone()));
            }
            ui.add_space(6.0);
            ui.label(format!(
                "By {}",
                if first.author.is_empty() {
                    "unknown"
                } else {
                    &first.author
                }
            ));
            if first.pdf_annot.is_some() {
                ui.label("Imported from the file");
            }
        }
    }

    /// The canvas: pages, markups, and the pointer.
    fn canvas(&mut self, ui: &mut egui::Ui) {
        let rect = ui.available_rect_before_wrap();
        let resp = ui.allocate_rect(rect, Sense::click_and_drag());
        let ctx = ui.ctx().clone();
        let ppp = ctx.pixels_per_point();
        let (w, h) = (
            (rect.width() * ppp).round().max(1.0) as u32,
            (rect.height() * ppp).round().max(1.0) as u32,
        );
        let (view, more) = {
            let (target, more) = self.viewer.render(w, h);
            (target.srgb_view.clone(), more)
        };
        {
            let mut r = self.render_state.renderer.write();
            match self.canvas_tex {
                Some(id) => r.update_egui_texture_from_wgpu_texture(
                    &self.render_state.device,
                    &view,
                    wgpu::FilterMode::Nearest,
                    id,
                ),
                None => {
                    self.canvas_tex =
                        Some(r.register_native_texture(&self.render_state.device, &view, wgpu::FilterMode::Nearest))
                }
            }
        }
        let painter = ui.painter_at(rect);
        painter.image(
            self.canvas_tex.unwrap(),
            Rect::from_min_size(rect.min, Vec2::new(w as f32 / ppp, h as f32 / ppp)),
            Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)),
            Color32::WHITE,
        );
        if more {
            ctx.request_repaint();
        }
        let to_px = |p: Pos2| [(p.x - rect.min.x) * ppp, (p.y - rect.min.y) * ppp];
        let hover = resp.hover_pos().map(to_px);

        // Zoom and scroll.
        if resp.hovered() {
            let (scroll, zoom) = ui.input(|i| (i.smooth_scroll_delta, i.zoom_delta()));
            if (zoom - 1.0).abs() > 1e-4 {
                let at = hover.unwrap_or([w as f32 / 2.0, h as f32 / 2.0]);
                // egui gives ×1.5 a wheel notch; drawings want finer steps.
                self.viewer.zoom_at(zoom.powf(0.5), at);
            } else if scroll != Vec2::ZERO {
                self.viewer.scroll_by(-scroll.x * ppp, -scroll.y * ppp);
            }
        }
        // Panning: middle drag, or Space and drag.
        let space = ui.input(|i| i.key_down(Key::Space)) && self.editing.is_none() && !ctx.egui_wants_keyboard_input();
        if resp.dragged_by(PointerButton::Middle)
            || (space && resp.dragged_by(PointerButton::Primary))
            || matches!(self.drag, Some(Drag::Pan))
        {
            let d = resp.drag_delta();
            self.viewer.scroll_by(-d.x * ppp, -d.y * ppp);
            if resp.drag_started() {
                self.drag = Some(Drag::Pan);
            }
            if resp.drag_stopped() {
                self.drag = None;
            }
            ctx.set_cursor_icon(CursorIcon::Grabbing);
        } else {
            self.pointer(&ctx, &resp, ppp, rect, space);
        }
        self.draw_markups(&painter, rect, ppp);
        self.text_editor(ui, rect, ppp);
    }

    /// The tools: what the primary button does on the canvas.
    fn pointer(&mut self, ctx: &egui::Context, resp: &egui::Response, ppp: f32, rect: Rect, space: bool) {
        let to_px = |p: Pos2| [(p.x - rect.min.x) * ppp, (p.y - rect.min.y) * ppp];
        let at_page = |v: &Viewer, p: Pos2| v.screen_to_page(to_px(p)).map(|(i, q)| (i, [q[0] as f64, q[1] as f64]));
        let tol = 6.0 * ppp as f64 / self.viewer.camera.scale as f64;
        let shift = ctx.input(|i| i.modifiers.shift);
        if space {
            ctx.set_cursor_icon(CursorIcon::Grab);
            return;
        }
        // Hover cursor.
        if let Some(p) = resp.hover_pos().and_then(|p| at_page(&self.viewer, p)) {
            let icon = match self.tool {
                Tool::Rect | Tool::Text => CursorIcon::Crosshair,
                Tool::Select => match self.single_handle(p, tol) {
                    Some((_, h)) => match h.diagonal() {
                        Some(true) => CursorIcon::ResizeNwSe,
                        Some(false) => CursorIcon::ResizeNeSw,
                        None if matches!(h, Handle::Left | Handle::Right) => CursorIcon::ResizeHorizontal,
                        None => CursorIcon::ResizeVertical,
                    },
                    None if geometry::pick(self.store.all(), p.0, p.1, tol).is_some() => CursorIcon::Move,
                    None => CursorIcon::Default,
                },
            };
            ctx.set_cursor_icon(icon);
        }
        if resp.drag_started_by(PointerButton::Primary) {
            self.commit_edit();
            let origin = ctx.input(|i| i.pointer.press_origin()).unwrap_or_default();
            if let Some((page, p)) = at_page(&self.viewer, origin) {
                self.drag = Some(match self.tool {
                    Tool::Rect | Tool::Text => Drag::Create { page, start: p, cur: p },
                    Tool::Select => {
                        if let Some((id, handle)) = self.single_handle((page, p), tol) {
                            let orig = bounds(&self.store.get(&id).unwrap().points);
                            Drag::Resize {
                                id,
                                handle,
                                orig,
                                cur: p,
                            }
                        } else if let Some(m) = geometry::pick(self.store.all(), page, p, tol) {
                            if !self.sel.contains(&m.id) {
                                if !shift {
                                    self.sel.clear();
                                }
                                self.sel.push(m.id.clone());
                            }
                            Drag::Move { page, start: p, cur: p }
                        } else {
                            if !shift {
                                self.sel.clear();
                            }
                            Drag::Band { page, start: p, cur: p }
                        }
                    }
                });
            }
        }
        if resp.dragged_by(PointerButton::Primary)
            && let Some(pos) = resp.interact_pointer_pos()
        {
            let px = to_px(pos);
            if let Some(d) = &mut self.drag {
                let page = match d {
                    Drag::Create { page, .. } | Drag::Move { page, .. } | Drag::Band { page, .. } => *page,
                    Drag::Resize { id, .. } => self.store.get(id).map_or(0, |m| m.page_index),
                    Drag::Pan => 0,
                };
                // The point on the drag's own page (even past its edge).
                let inv = rc_view::layout::invert(&self.viewer.page_to_screen(page));
                if let Some(inv) = inv {
                    let q = apply(&inv, px);
                    let q = [q[0] as f64, q[1] as f64];
                    match d {
                        Drag::Create { cur, .. }
                        | Drag::Move { cur, .. }
                        | Drag::Band { cur, .. }
                        | Drag::Resize { cur, .. } => *cur = q,
                        Drag::Pan => {}
                    }
                }
            }
        }
        if resp.drag_stopped_by(PointerButton::Primary) {
            match self.drag.take() {
                Some(Drag::Create { page, start, cur }) => {
                    let size = self.page_size(page);
                    let r = clamp_rect(
                        [
                            start[0].min(cur[0]),
                            start[1].min(cur[1]),
                            start[0].max(cur[0]),
                            start[1].max(cur[1]),
                        ],
                        size,
                    );
                    if r[2] - r[0] >= 2.0 && r[3] - r[1] >= 2.0 {
                        let kind = if self.tool == Tool::Text { TEXT } else { RECT };
                        let id = self
                            .store
                            .add(Markup::new(kind, page, corners(r), &self.settings.author));
                        self.sel = vec![id.clone()];
                        if kind == TEXT {
                            self.editing = Some(Editing {
                                id,
                                text: String::new(),
                                focus: true,
                            });
                        }
                    }
                }
                Some(Drag::Move { page, start, cur }) => {
                    let (dx, dy) = self.clamped_move(page, cur[0] - start[0], cur[1] - start[1]);
                    if dx != 0.0 || dy != 0.0 {
                        self.store.update(&self.sel.clone(), |m| geometry::translate(m, dx, dy));
                    }
                }
                Some(Drag::Resize { id, handle, orig, cur }) => {
                    let page = self.store.get(&id).map_or(0, |m| m.page_index);
                    let r = clamp_rect(resized(orig, handle, cur, 2.0), self.page_size(page));
                    self.store.update(&[id], |m| m.points = corners(r));
                }
                Some(Drag::Band { page, start, cur }) => {
                    let band = [
                        start[0].min(cur[0]),
                        start[1].min(cur[1]),
                        start[0].max(cur[0]),
                        start[1].max(cur[1]),
                    ];
                    for m in self.store.on_page(page) {
                        if geometry::intersects(outer(m), band) && !m.is_hidden() && !self.sel.contains(&m.id) {
                            self.sel.push(m.id.clone());
                        }
                    }
                }
                _ => {}
            }
        }
        if resp.clicked_by(PointerButton::Primary)
            && let Some((page, p)) = resp.interact_pointer_pos().and_then(|q| at_page(&self.viewer, q))
        {
            match self.tool {
                Tool::Text => {
                    self.commit_edit();
                    // A click places a box 3 inches wide, one line high.
                    let mut m = Markup::new(TEXT, page, vec![p, [p[0] + 216.0, p[1] + 24.0]], &self.settings.author);
                    let need = rc_markup::text::needed_height(&m);
                    m.points = corners(clamp_rect(
                        [p[0], p[1], p[0] + 216.0, p[1] + need],
                        self.page_size(page),
                    ));
                    let id = self.store.add(m);
                    self.sel = vec![id.clone()];
                    self.editing = Some(Editing {
                        id,
                        text: String::new(),
                        focus: true,
                    });
                }
                Tool::Rect => {}
                Tool::Select => {
                    self.commit_edit();
                    match geometry::pick(self.store.all(), page, p, tol).map(|m| m.id.clone()) {
                        Some(id) if shift => {
                            if let Some(i) = self.sel.iter().position(|s| *s == id) {
                                self.sel.remove(i);
                            } else {
                                self.sel.push(id);
                            }
                        }
                        Some(id) => self.sel = vec![id],
                        None => self.sel.clear(),
                    }
                }
            }
        }
        if resp.double_clicked_by(PointerButton::Primary)
            && self.tool == Tool::Select
            && let Some((page, p)) = resp.interact_pointer_pos().and_then(|q| at_page(&self.viewer, q))
            && let Some(m) = geometry::pick(self.store.all(), page, p, tol)
            && m.kind == TEXT
            && !m.is_locked()
        {
            self.editing = Some(Editing {
                id: m.id.clone(),
                text: m.text.clone().unwrap_or_default(),
                focus: true,
            });
        }
    }

    /// The handle under `p` when exactly one unlocked markup is selected.
    fn single_handle(&self, (page, p): (usize, Point), tol: f64) -> Option<(String, Handle)> {
        let [id] = self.sel.as_slice() else { return None };
        let m = self.store.get(id)?;
        if m.page_index != page || m.is_locked() {
            return None;
        }
        handle_at(bounds(&m.points), p, tol).map(|h| (id.clone(), h))
    }

    fn page_size(&self, page: usize) -> [f64; 2] {
        self.viewer
            .page_info(page)
            .map_or([1e6, 1e6], |i| [i.size[0] as f64, i.size[1] as f64])
    }

    /// A move of the selection, kept on the page.
    fn clamped_move(&self, page: usize, mut dx: f64, mut dy: f64) -> (f64, f64) {
        let size = self.page_size(page);
        for m in self.selected() {
            let b = outer(m);
            let (cx, cy) = geometry::clamp_to_page([b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy], size);
            dx += cx;
            dy += cy;
        }
        (dx, dy)
    }

    /// The markups as they would be with the drag in progress applied.
    fn preview(&self) -> HashMap<String, Markup> {
        let mut out = HashMap::new();
        match &self.drag {
            Some(Drag::Move { page, start, cur }) => {
                let (dx, dy) = self.clamped_move(*page, cur[0] - start[0], cur[1] - start[1]);
                for m in self.selected() {
                    if !m.is_locked() {
                        let mut n = m.clone();
                        geometry::translate(&mut n, dx, dy);
                        out.insert(n.id.clone(), n);
                    }
                }
            }
            Some(Drag::Resize { id, handle, orig, cur }) => {
                if let Some(m) = self.store.get(id) {
                    let mut n = m.clone();
                    n.points = corners(clamp_rect(
                        resized(*orig, *handle, *cur, 2.0),
                        self.page_size(m.page_index),
                    ));
                    out.insert(n.id.clone(), n);
                }
            }
            _ => {}
        }
        out
    }

    fn draw_markups(&self, painter: &egui::Painter, rect: Rect, ppp: f32) {
        if show_pdf_appearances() {
            return;
        }
        let preview = self.preview();
        let scale = self.viewer.camera.scale / ppp;
        let angle = self.viewer.layout.rotation as f32 * std::f32::consts::FRAC_PI_2;
        let visible: HashSet<usize> = self.viewer.layout.shown().collect();
        // Page space → canvas points.
        let to_screen = |page: usize, p: Point| {
            let m = self.viewer.page_to_screen(page);
            let q = apply(&m, [p[0] as f32, p[1] as f32]);
            Pos2::new(rect.min.x + q[0] / ppp, rect.min.y + q[1] / ppp)
        };
        let screen_rect = |page: usize, r: geometry::Rect| {
            Rect::from_two_pos(to_screen(page, [r[0], r[1]]), to_screen(page, [r[2], r[3]]))
        };
        for m in self.store.all() {
            if m.is_hidden() || !visible.contains(&m.page_index) {
                continue;
            }
            let m = preview.get(&m.id).unwrap_or(m);
            let page = m.page_index;
            let b = screen_rect(page, bounds(&m.points));
            if !b.expand(100.0).intersects(rect) {
                continue;
            }
            let op = m.style.opacity.clamp(0.0, 1.0) as f32;
            if let Some(f) = &m.style.fill {
                painter.rect_filled(b, CornerRadius::ZERO, color(f, op));
            }
            if m.style.width > 0.0 {
                let w = (m.style.width as f32 * scale).max(1.0 / ppp);
                painter.rect_stroke(
                    b,
                    CornerRadius::ZERO,
                    Stroke::new(w, color(&m.style.stroke, op)),
                    StrokeKind::Middle,
                );
            }
            let editing = self.editing.as_ref().is_some_and(|e| e.id == m.id);
            if m.kind == TEXT && !editing {
                let size = m.style.font_size() as f32 * scale;
                if size < 1.5 {
                    continue;
                }
                let font = self.helv(size);
                let tc = color(m.style.text_color(), op);
                let clip = painter.with_clip_rect(b.intersect(rect));
                for l in rc_markup::text::layout(m) {
                    let g = painter.layout_no_wrap(l.text.clone(), font.clone(), tc);
                    // Place the galley so its baseline lands on the line's baseline.
                    let base = g.rows.first().map_or(size * 0.8, |r| {
                        r.pos.y + r.row.glyphs.first().map_or(size * 0.8, |gl| gl.pos.y)
                    });
                    let at = to_screen(page, [l.x, l.baseline]);
                    let (s, c) = angle.sin_cos();
                    let pos = Pos2::new(at.x + s * base, at.y - c * base);
                    let mut shape = egui::epaint::TextShape::new(pos, g, tc);
                    shape.angle = angle;
                    clip.add(shape);
                }
            }
        }
        // Selection.
        let accent = Color32::from_rgb(0x25, 0x63, 0xeb);
        for id in &self.sel {
            let Some(m) = preview.get(id).or_else(|| self.store.get(id)) else {
                continue;
            };
            if !visible.contains(&m.page_index) {
                continue;
            }
            let b = screen_rect(m.page_index, outer(m)).expand(2.0);
            painter.rect_stroke(b, CornerRadius::ZERO, Stroke::new(1.0, accent), StrokeKind::Outside);
            if self.sel.len() == 1 && !m.is_locked() {
                for h in HANDLES {
                    let p = to_screen(m.page_index, h.at(bounds(&m.points)));
                    let r = Rect::from_center_size(p, Vec2::splat(7.0));
                    painter.rect_filled(r, CornerRadius::ZERO, Color32::WHITE);
                    painter.rect_stroke(r, CornerRadius::ZERO, Stroke::new(1.0, accent), StrokeKind::Inside);
                }
            }
        }
        // A shape being drawn, or the selection band.
        match &self.drag {
            Some(Drag::Create { page, start, cur }) => {
                let r = screen_rect(
                    *page,
                    [
                        start[0].min(cur[0]),
                        start[1].min(cur[1]),
                        start[0].max(cur[0]),
                        start[1].max(cur[1]),
                    ],
                );
                let style = if self.tool == Tool::Text {
                    rc_markup::Style::text()
                } else {
                    rc_markup::Style::rect()
                };
                painter.rect_stroke(
                    r,
                    CornerRadius::ZERO,
                    Stroke::new((style.width as f32 * scale).max(1.0), color(&style.stroke, 1.0)),
                    StrokeKind::Middle,
                );
            }
            Some(Drag::Band { page, start, cur }) => {
                let r = screen_rect(
                    *page,
                    [
                        start[0].min(cur[0]),
                        start[1].min(cur[1]),
                        start[0].max(cur[0]),
                        start[1].max(cur[1]),
                    ],
                );
                painter.rect_filled(r, CornerRadius::ZERO, accent.gamma_multiply(0.08));
                painter.rect_stroke(r, CornerRadius::ZERO, Stroke::new(1.0, accent), StrokeKind::Inside);
            }
            _ => {}
        }
    }

    /// Typing into a text box: an editor over the box, at the box's size.
    fn text_editor(&mut self, ui: &mut egui::Ui, rect: Rect, ppp: f32) {
        let Some(e) = &self.editing else { return };
        let Some(m) = self.store.get(&e.id).cloned() else {
            self.editing = None;
            return;
        };
        let scale = self.viewer.camera.scale / ppp;
        let mm = self.viewer.page_to_screen(m.page_index);
        let b = bounds(&m.points);
        let p0 = apply(&mm, [b[0] as f32, b[1] as f32]);
        let p1 = apply(&mm, [b[2] as f32, b[3] as f32]);
        let r = Rect::from_two_pos(
            Pos2::new(rect.min.x + p0[0] / ppp, rect.min.y + p0[1] / ppp),
            Pos2::new(rect.min.x + p1[0] / ppp, rect.min.y + p1[1] / ppp),
        );
        let pad = rc_markup::text::PADDING as f32 * scale;
        let font = self.helv((m.style.font_size() as f32 * scale).max(4.0));
        let tc = color(m.style.text_color(), 1.0);
        let focus = e.focus;
        let mut text = e.text.clone();
        let resp = egui::Area::new(egui::Id::unique(("edit", &m.id)))
            .fixed_pos(r.min + Vec2::splat(pad))
            .order(egui::Order::Foreground)
            .show(ui.ctx(), |ui| {
                ui.set_max_width((r.width() - 2.0 * pad).max(20.0));
                ui.add(
                    egui::TextEdit::multiline(&mut text)
                        .font(font)
                        .text_color(tc)
                        .frame(egui::Frame::NONE)
                        .background_color(Color32::from_white_alpha(200))
                        .desired_width((r.width() - 2.0 * pad).max(20.0))
                        .desired_rows(1),
                )
            })
            .inner;
        if focus {
            resp.request_focus();
        }
        let clicked_away = ui.input(|i| i.pointer.any_pressed()) && !resp.hovered() && !resp.has_focus() && !focus;
        if let Some(e) = &mut self.editing {
            e.text = text;
            e.focus = false;
        }
        if clicked_away || (resp.lost_focus() && !ui.input(|i| i.pointer.any_down())) {
            self.commit_edit();
        }
    }

    fn dialogs(&mut self, ctx: &egui::Context) {
        if let Some(msg) = self.message.clone() {
            egui::Modal::new(egui::Id::unique("message")).show(ctx, |ui| {
                ui.set_max_width(420.0);
                ui.label(msg);
                if ui.button("OK").clicked() {
                    self.message = None;
                }
            });
        }
        if let Some(e) = self.viewer.error.take() {
            self.message = Some(e);
        }
        if let Some(after) = self.confirm.clone() {
            let mut answer = None;
            egui::Modal::new(egui::Id::unique("confirm")).show(ctx, |ui| {
                ui.label("Save the changes to your markups first?");
                ui.horizontal(|ui| {
                    if ui.button("Save").clicked() {
                        answer = Some(1);
                    }
                    if ui.button("Don't Save").clicked() {
                        answer = Some(2);
                    }
                    if ui.button("Cancel").clicked() {
                        answer = Some(0);
                    }
                });
            });
            match answer {
                Some(0) => self.confirm = None,
                Some(a) => {
                    if a == 1 && !self.save() {
                        self.confirm = None;
                        return;
                    }
                    self.store.dirty = false;
                    self.confirm = None;
                    match after {
                        After::Open(p) => self.open(&p),
                        After::Close => self.close_doc(),
                        After::Exit => {
                            self.exit_confirmed = true;
                            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                        }
                    }
                }
                None => {}
            }
        }
        if self.show_diag {
            let d = self.viewer.diag.clone();
            let cur = self.viewer.current_page();
            let info = self.viewer.page_info(cur).cloned();
            egui::Window::new("Diagnostics").open(&mut self.show_diag).default_pos([60.0, 80.0]).show(ctx, |ui| {
                ui.monospace(format!(
                    "frame {:.2} ms  level {}  missing {}\ntiles {} ({:.0} MB)  drawn this frame {} in {:.1} ms\nraster pending {}  draw calls {}  scenes {:.0} MB",
                    d.frame_ms, d.level, d.missing, d.tiles_cached, d.tile_mb, d.scene_tiles_this_frame, d.scene_tile_ms, d.raster_pending, d.draw_calls, d.scenes_mb
                ));
                if let Some(i) = info {
                    let s = &i.stats;
                    ui.separator();
                    ui.monospace(format!(
                        "page {}: {:?} from {:?}, {:?}\nparse {:.0} ms  build {:.0} ms  upload {:.0} ms  load {:.0} ms\n{} segments  {} triangles  {:.1} MB  diff {:.3}% / {:.3}%\nflags {:#x}  text by PDFium: {}",
                        cur + 1, i.mode, i.source, i.verdict, s.parse_ms, s.build_ms, s.upload_ms, s.load_ms, s.segments, s.triangles, s.gpu_bytes as f64 / 1e6, s.diffs[0] * 100.0, s.diffs[1] * 100.0, i.flags, i.lacks_text
                    ));
                }
            });
        }
    }

    /// `--bench`: open, wait until sharp, zoom in, pan, then write the timings and exit.
    fn bench_step(&mut self, ctx: &egui::Context) {
        let events = self.viewer.take_events();
        let Some(b) = &mut self.bench else { return };
        for (name, ms) in &events {
            let _ = writeln!(b.out, "{}", serde_json::json!({ "event": name, "ms": ms }));
        }
        ctx.request_repaint();
        let center = [
            self.viewer.camera.viewport[0] / 2.0,
            self.viewer.camera.viewport[1] / 2.0,
        ];
        let has = |n: &str| events.iter().any(|e| e.0 == n);
        match b.stage {
            0 if has("page-sharp") => {
                b.stage = 1;
                self.viewer.zoom_at(4.0, center);
            }
            1 if has("zoom-sharp") => {
                b.stage = 2;
                self.viewer.scroll_by(self.viewer.camera.viewport[0] * 0.75, 0.0);
                self.viewer.expect_sharp("pan-sharp");
            }
            2 if has("pan-sharp") => {
                b.stage = 3;
                let info = self.viewer.page_info(0).cloned();
                let summary = serde_json::json!({
                    "event": "done",
                    "ms": b.started.elapsed().as_secs_f64() * 1000.0,
                    "file": b.spec.file.display().to_string(),
                    "page0": info.map(|i| serde_json::json!({
                        "mode": format!("{:?}", i.mode),
                        "source": format!("{:?}", i.source),
                        "verdict": format!("{:?}", i.verdict),
                        "parseMs": i.stats.parse_ms,
                        "buildMs": i.stats.build_ms,
                        "uploadMs": i.stats.upload_ms,
                        "loadMs": i.stats.load_ms,
                        "segments": i.stats.segments,
                    })),
                    "frameMs": self.viewer.diag.frame_ms,
                });
                let _ = writeln!(b.out, "{summary}");
                let _ = b.out.flush();
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
            _ => {}
        }
        if b.started.elapsed().as_secs() > 300 {
            let _ = writeln!(b.out, "{}", serde_json::json!({ "event": "timeout", "stage": b.stage }));
            let _ = b.out.flush();
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
    }
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.calibrate(&ctx);
        self.viewer.update();
        self.import_pages();
        // Files dropped on the window.
        if let Some(p) = ctx.input(|i| i.raw.dropped_files.first().map(|f| f.path().to_path_buf())) {
            self.open(&p);
        }
        if ctx.input(|i| i.viewport().close_requested())
            && self.store.dirty
            && !self.exit_confirmed
            && self.bench.is_none()
        {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.confirm = Some(After::Exit);
        }
        self.shortcuts(&ctx);
        let title = match self.viewer.path() {
            Some(p) => format!(
                "{}{} — redcolumn",
                p.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(),
                if self.store.dirty { " •" } else { "" }
            ),
            None => "redcolumn".into(),
        };
        if title != self.last_title {
            ctx.send_viewport_cmd(egui::ViewportCommand::Title(title.clone()));
            self.last_title = title;
        }

        egui::Panel::top("menu").show(ui, |ui| self.menu(ui));
        egui::Panel::bottom("status").show(ui, |ui| self.status_bar(ui));
        if self.settings.show_sidebar {
            egui::Panel::left("sidebar")
                .resizable(true)
                .default_size(200.0)
                .show(ui, |ui| self.sidebar(ui));
        }
        if self.settings.show_properties {
            egui::Panel::right("properties")
                .resizable(true)
                .default_size(220.0)
                .show(ui, |ui| self.properties(ui));
        }
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE)
            .show(ui, |ui| self.canvas(ui));
        self.dialogs(&ctx);
        if self.bench.is_some() {
            self.bench_step(&ctx);
        } else {
            self.viewer.take_events();
        }
    }

    fn on_exit(&mut self) {
        self.settings.save();
        self.viewer.close();
    }
}

/// `RC_PDF_APPEARANCES=1`: show markups as PDFium draws their saved appearances instead of
/// drawing them here (to compare the two).
fn show_pdf_appearances() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("RC_PDF_APPEARANCES").is_some())
}

fn filter_from(name: &str) -> PageFilter {
    match name {
        "dark" => PageFilter::Dark,
        "dim" => PageFilter::Dim,
        _ => PageFilter::None,
    }
}

fn color(hex: &str, opacity: f32) -> Color32 {
    let [r, g, b] = parse_color(hex);
    Color32::from_rgba_unmultiplied(
        (r * 255.0) as u8,
        (g * 255.0) as u8,
        (b * 255.0) as u8,
        (opacity * 255.0) as u8,
    )
}

fn rgb8(hex: &str) -> [u8; 3] {
    parse_color(hex).map(|v| (v * 255.0).round() as u8)
}

fn hex8(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

fn clamp_rect(r: geometry::Rect, size: [f64; 2]) -> geometry::Rect {
    [
        r[0].clamp(0.0, size[0]),
        r[1].clamp(0.0, size[1]),
        r[2].clamp(0.0, size[0]),
        r[3].clamp(0.0, size[1]),
    ]
}
