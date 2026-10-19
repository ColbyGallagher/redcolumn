# redcolumn in Rust: plan for a native Windows prototype

A plan for a native redcolumn written in Rust, starting on Windows. It is first a basic PDF viewer
with two markup tools, Rectangle and Text, built so it can be measured against the current Electron
desktop app on the same machines, files and actions. Whether a full port is worth it is decided
from those measurements (see [Phase 5](#phase-5-decision)).

Sizes follow [ROADMAP.md](ROADMAP.md): **S** (a day or two), **M** (about a week), **L** (several
weeks). The whole prototype is roughly 10 to 14 weeks for one developer.

## Contents

- [Goals and non-goals](#goals-and-non-goals)
- [What the current app does that the prototype must match](#what-the-current-app-does-that-the-prototype-must-match)
- [Technology choices](#technology-choices)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Phase 0: spikes and decisions](#phase-0-spikes-and-decisions)
- [Phase 1: the viewer](#phase-1-the-viewer)
- [Phase 2: Rectangle and Text markups](#phase-2-rectangle-and-text-markups)
- [Phase 3: Windows integration and packaging](#phase-3-windows-integration-and-packaging)
- [Phase 4: the performance comparison](#phase-4-the-performance-comparison)
- [Phase 5: decision](#phase-5-decision)
- [Testing](#testing)
- [CI](#ci)
- [Security](#security)
- [Licences and notices](#licences-and-notices)
- [Risks](#risks)
- [Open questions](#open-questions)

## Goals and non-goals

### Goals

1. A Windows 10 (21H2+) and Windows 11 x64 app that opens a PDF at its real path and shows it in
   single-page and continuous layouts, with smooth zoom, pan, page navigation and thumbnails.
2. Two markup tools, **Rectangle** and **Text** (text box), with select, move, resize, delete,
   undo and redo, and basic properties (colour, fill, line width, opacity, font size).
3. Save markups into the PDF as standard annotations that Bluebeam Revu, Acrobat and the current
   redcolumn all open, and open markups saved by the current redcolumn.
4. A repeatable benchmark that compares the prototype with the current desktop app on start-up,
   rendering, interaction, memory and size, and a published report with the files and hardware used,
   as the README promises for any performance claim.

### Non-goals for the prototype

- Every other markup type, measurements, takeoff, compare, OCR, sheets, stitching, OneDrive, Live
  Sessions, the MCP server, forms, signatures, redaction, batch work.
- The optimised render copy (`apps/web/src/documents/renderCopy`). It is benchmarked separately so
  it does not hide a difference in the engine or interface (see [Phase 4](#phase-4-the-performance-comparison)).
- Mac and Linux builds. The code is kept portable (no Windows calls outside one crate), but only
  Windows is built, tested and packaged.
- A web build. The browser version stays TypeScript.
- Auto-update. A manual download is enough for a prototype.

## What the current app does that the prototype must match

The comparison is only fair if the prototype does the same work. From the current code:

| Area | Current app | Prototype |
|---|---|---|
| Engine | PDFium compiled to WebAssembly (`@embedpdf/pdfium` 2.15.1) in one Web Worker (`packages/pdf-core/src/worker.ts`) | Native PDFium, **the same PDFium revision** as the wasm build, so the engine version is not a variable |
| Tiles | 512 px tiles, ~160 MB tile budget, 2 renders in flight, a 512 px quick preview, whole-page images up to 9 MP with a ~190 MB budget, cancellation of renders that leave the view (`apps/web/src/viewer/TileViewer.ts`) | The same constants to start with, so the first comparison is like for like; tuned afterwards in a separate, labelled run |
| Heavy pages | No quick preview when a page takes 300 ms+ to parse or has 100,000+ objects | The same rule |
| Page space | Points, origin top-left of the displayed (rotated) page, y down (`packages/markup/src/model.ts`) | The same, so markup geometry converts one to one |
| Rectangle | `/Subtype /Square` with `/RD`, appearance stream, `/NBData` JSON of the full markup (`packages/markup/src/export.ts`) | The same dictionary keys and the same `/NBData` JSON for the fields it supports |
| Text box | `/Subtype /FreeText` with `/DA` (`/Helv 12 Tf r g b rg`), `/Q` alignment, `/RC` rich text, `/C` background, `/RD` | The same, plain text first, `/RC` written for Bluebeam |
| Existing annotations | Read through PDFium (`PdfAnnotation`), imported as markups, the originals hidden while drawn by the app | Rectangle and FreeText imported; every other annotation left untouched and drawn by PDFium as part of the page |
| Saving | Opens and saves at the real path with an atomic replace (`apps/desktop/src/atomic.ts`); a signed file is appended to | Atomic replace; incremental update so signatures stay valid |

## Technology choices

Each choice has a recommendation and the reason. Phase 0 confirms or replaces each one with a spike
before any real work builds on it.

### PDF engine: PDFium, native, through `pdfium-render`

- **Recommendation:** [`pdfium-render`](https://crates.io/crates/pdfium-render) over a prebuilt
  `pdfium.dll` from [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries), pinned
  to the Chromium branch that `@embedpdf/pdfium` 2.15.1 was built from (look it up in that package's
  build metadata in Phase 0).
- **Why:** it is the engine the app already uses, so rendering looks the same, Bluebeam files behave
  the same, and the benchmark measures wasm against native and Electron against native UI rather
  than one engine against another. It is BSD/Apache licensed, which fits Apache 2.0.
- **Low-level calls:** `pdfium-render` exposes the raw `FPDF_*` bindings. Use them where the safe API
  falls short: `FPDF_RenderPageBitmapWithMatrix` for tiles, `FPDF_RenderPageBitmap_Start` /
  `_Continue` with an `IFSDK_PAUSE` callback so a long render can be stopped when its tile leaves the
  view, and `FPDFAnnot_*` for reading annotations.
- **Linking:** load the DLL dynamically from the install folder for the prototype. Static linking is
  a later option once the build is settled.
- **Rejected:** MuPDF (AGPL, incompatible with the project's licence unless commercially licensed),
  `pdf-rs` / `hayro` and other pure-Rust renderers (promising, but not yet at PDFium's fidelity on
  construction drawings; worth re-checking at Phase 5).

### Writing PDFs: `lopdf`

- **Recommendation:** [`lopdf`](https://crates.io/crates/lopdf) for writing annotations, with
  incremental updates (`IncrementalDocument`), the same split as today (PDFium reads, `pdf-lib` writes).
- **Why:** full control of each annotation dictionary (`/RD`, `/DA`, `/RC`, `/NBData`, the
  appearance stream), and an appended update keeps signatures valid and makes saving a large file
  cost the size of the change rather than the size of the file.
- **Alternative kept open:** PDFium's own `FPDFAnnot_*` write calls plus `FPDF_SaveAsCopy` with
  `FPDF_INCREMENTAL`. Fewer moving parts, but less control over the dictionaries. Phase 0 tries both
  on the Bluebeam fixture files and keeps the one whose output Revu opens cleanly.

### Interface: `egui` on `wgpu`, with the page canvas drawn by our own `wgpu` code

- **Recommendation:** [`eframe`](https://crates.io/crates/eframe) /
  [`egui`](https://crates.io/crates/egui) with the `wgpu` backend for menus, toolbars, the
  properties panel, thumbnails and dialogs. The page area is an `egui` paint callback that draws
  tiles and markups with our own `wgpu` pipelines.
- **Why:** quickest route to a working, good-looking app with real GPU drawing; mature on Windows;
  IME support for typed text; AccessKit for screen readers; `egui_dock` exists for the docking panels
  already on the roadmap. Keeping the canvas in our own `wgpu` code means the part that decides
  performance does not depend on the UI toolkit.
- **Backend:** let `wgpu` pick Direct3D 12 on Windows, with a fallback to its GL backend and to
  WARP (the Direct3D software rasteriser) for virtual machines and Remote Desktop.
- **Rule:** no `egui` types outside `rc-app`. If `egui` turns out wrong for the full app (a
  ribbon-style interface and dense panels are a lot of immediate-mode code), the core crates move to
  another toolkit unchanged.
- **Alternatives considered:** Slint (good declarative UI, smaller ecosystem for a custom GPU canvas),
  Iced (fine, but text input and IME were weaker at the time of writing), GPUI (fast, Windows support
  is newer), plain Win32 with Direct2D through `windows-rs` (fastest and most native, but the most
  code and no path to Mac later), Tauri (keeps a web view, so it would not tell us what native UI
  buys).

### Other crates

| Need | Crate | Notes |
|---|---|---|
| Windowing, input | `winit` (through `eframe`) | Touch and precision touchpads; pen pressure is not needed for these tools |
| Markup vector drawing on screen | `lyon` tessellation into our `wgpu` pipeline | Strokes, fills, dashes later. Text through `egui`'s font atlas for the prototype, `cosmic-text` if text quality needs it |
| Serialisation | `serde`, `serde_json` | `/NBData` JSON, settings |
| Errors | `thiserror` in libraries, `anyhow` in the app | |
| Logging and timing | `tracing`, `tracing-subscriber`; `tracing-chrome` for timeline traces | The benchmark's timestamps come through here |
| Threads | `crossbeam-channel` | Render queue and results |
| File dialogs | `rfd` | Native Windows dialogs |
| Windows APIs | `windows` (windows-rs) | `ReplaceFileW`, DPI, file association, single instance, ETW markers |
| Memory map | `memmap2` | Hand PDFium the file without copying it |
| Tests | `insta` (snapshots), `proptest` (geometry), `image` (render diffs) | |

## Architecture

```text
            ┌──────────────────────── rc-app (egui) ────────────────────────┐
 input ───▶ │ tools (select, rect, text) · commands · undo · panels · menus │
            └───────┬───────────────────────────────┬───────────────────────┘
                    │ view state (page, zoom, scroll)│ markup edits
            ┌───────▼─────────┐              ┌───────▼────────┐
            │ rc-view         │              │ rc-markup      │
            │ layout, tiles,  │◀── markups ──│ model, hit test│
            │ scheduler, GPU  │              │ geometry, JSON │
            └───────┬─────────┘              └───────┬────────┘
     tile requests  │  ▲ bitmaps                     │ save
            ┌───────▼──┴──────┐              ┌───────▼────────┐
            │ rc-pdf          │              │ rc-pdfwrite    │
            │ PDFium thread   │              │ lopdf, AP      │
            │ (owns all FPDF) │              │ streams, save  │
            └─────────────────┘              └────────────────┘
```

### The PDFium thread

PDFium is not thread-safe. Every `FPDF_*` call happens on one dedicated thread that owns the
library, every open document and the page cache, the same shape as today's worker.

- **Requests:** `Open`, `Close`, `PageSizes`, `RenderTile`, `RenderThumb`, `Text`, `Annotations`,
  `Cancel`. Each tile request carries a generation number; the view bumps it on zoom, and the
  thread drops anything older before starting it.
- **Priority queue:** visible tiles at the current zoom first, then the quick preview, then tiles
  just outside the view, then thumbnails.
- **Pausable renders:** progressive rendering with a pause callback that checks a cancel flag every
  few milliseconds, so a tile scrolled away mid-render on a heavy sheet stops at once instead of
  finishing.
- **Bitmaps:** `FPDFBitmap_CreateEx` over a buffer from a reusable pool (BGRA, which matches the
  GPU texture format, so no swizzle). The buffer is sent to the UI thread and returned to the pool
  after upload.
- **Page cache:** parsed pages are kept (LRU, by parse cost and count) because a construction sheet
  can take hundreds of milliseconds to parse.
- **Later, measured not assumed:** a pool of render processes, each with its own PDFium and its
  own copy of the document, to draw tiles on several cores. The web app cannot do this cheaply; it
  is likely the biggest structural win, and also the biggest memory cost. It is an experiment in
  Phase 4, behind a setting, after the like-for-like comparison.

### Tiles and the view (`rc-view`)

- Device pixels per point = zoom × monitor scale. Tiles are 512 × 512 device pixels in a grid per
  page per zoom level.
- While zooming, the existing tiles are drawn scaled (blurry but instant), and new tiles replace
  them when they arrive. This is what makes zoom feel immediate.
- Small pages (≤ 9 MP at the current zoom) are drawn as one image, like today.
- Tiles live in GPU textures from a texture atlas, evicted LRU against the same budgets as today.
  The CPU copy is dropped after upload.
- Thumbnails are rendered at a fixed width once and cached by page.
- Dark mode and the dimmer are a fragment shader setting, not a re-render.

### Markups on screen

- Markups are drawn every frame on top of the tiles, as GPU geometry, not baked into tiles, so
  moving or resizing one costs nothing in PDFium.
- Tessellated meshes are cached per markup and rebuilt only when the markup or the zoom bucket
  changes.
- Selection handles, the rubber band and the text cursor are drawn in screen space.
- Imported Rectangle and FreeText annotations are hidden from PDFium's page render (render without
  `FPDF_ANNOT`, then draw every other annotation's appearance on top through
  `FPDF_FFLDraw`/per-annotation rendering, or remove ours from the render with a flag; Phase 0
  picks the cheapest that is exact) and drawn by us, as the current app does with `hideAnnots`.

### The markup model (`rc-markup`)

A Rust struct that mirrors the subset of `Markup` in `packages/markup/src/model.ts` the prototype
supports, with the same JSON field names:

```rust
pub struct Markup {
    pub id: String,
    pub seq: Option<u32>,
    pub r#type: MarkupType,      // Rect | Text for now
    pub page_index: u32,
    pub points: Vec<[f64; 2]>,   // page space, two opposite corners
    pub style: MarkupStyle,      // stroke, fill, width, opacity, font_size, font_family, text_align, ...
    pub text: Option<String>,
    pub comment: Option<String>,
    pub subject: Option<String>,
    pub rotation: Option<f64>,
    pub locked: Option<bool>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>, // fields this build does not know, kept as they were
}
```

- `#[serde(rename_all = "camelCase")]`, so `/NBData` written by either app reads in the other.
- `extra` keeps fields the prototype does not understand, so opening and saving a file marked up in
  the current app never drops data from a Rectangle or Text box it touched.
- Annotations of other types are not imported at all and are left byte for byte as they are.
- Undo and redo are a command stack of whole-markup before/after values, the simplest thing that
  is always right.

### Saving (`rc-pdfwrite`)

1. Open the original with `lopdf` as an incremental document.
2. For each new or changed markup, write an annotation dictionary with the keys in the table above,
   an appearance stream (`/AP /N`) and `/NBData`; add it to the page's `/Annots`.
3. For each deleted imported markup, remove its reference from `/Annots`.
4. Append the update, write to a temporary file in the same folder, flush, and replace the
   original with `ReplaceFileW` (keeping its permissions and attributes), as `atomic.ts` does.
5. Reopen in PDFium from the saved bytes so the view matches the file on disk.

Appearance streams must look the same in Revu, Acrobat, the current app and the prototype:

- **Rectangle:** a stroked (and optionally filled) path inset by half the line width, `/RD` set to
  that inset, an `ExtGState` for opacity.
- **Text box:** a `BT ... ET` block in Helvetica (`/Helv`, a standard font, so nothing is embedded),
  lines wrapped with Helvetica's standard widths (AFM metrics, built in) so the wrapping matches what
  PDF readers regenerate from `/DA`. Non-Latin text needs an embedded font; that is out of scope for
  the prototype and the tool says so instead of writing a broken file.

## Repository layout

The Rust code lives in the same repository, beside the TypeScript, so fixtures and tests are shared
and the comparison runs from one checkout. pnpm ignores it.

```text
rust/
  Cargo.toml              workspace, shared lints and profile settings
  rust-toolchain.toml     pinned stable toolchain
  deny.toml               cargo-deny: licences, advisories, duplicates
  crates/
    rc-pdf/               PDFium thread, requests, bitmaps, annotations read
    rc-markup/            model, geometry, hit testing, JSON (no UI, no PDF)
    rc-pdfwrite/          annotation dictionaries, appearance streams, incremental save
    rc-view/              layout, tile cache, scheduler, wgpu pipelines for tiles and markups
    rc-app/               the egui application: tools, panels, menus, undo, settings
    rc-win/               every Windows-only call: atomic replace, DPI, single instance, ETW
    rc-bench/             headless engine benchmark and the Windows benchmark driver
  xtask/                  fetch-pdfium, package, notices, bench (cargo xtask ...)
  assets/                 icons, the installer's files
```

Release profile: `lto = "fat"`, `codegen-units = 1`, `panic = "abort"` for the app binary,
`opt-level = 3`, and debug info kept in a separate PDB so crash dumps and profiles have symbols.

## Phase 0: spikes and decisions

**Size: M to L (1 to 2 weeks).** Each spike is thrown away or kept as the start of its crate.

| Spike | Question it answers | Done when |
|---|---|---|
| PDFium native | Which pdfium-binaries build matches the wasm build's revision? Do progressive render and cancel work through `pdfium-render`? | A CLI renders page 1 of every e2e fixture to PNG, and the pixels match `pnpm bench:render`'s wasm render within the same 48-level threshold that script uses |
| Engine-only benchmark | How much faster is native PDFium than wasm PDFium on the same pages, before any UI? | `rc-bench render file.pdf` prints the same table as `scripts/render-bench.mjs` (parse ms, draw ms per page at 2048 px), and both are run on the same Windows machine |
| egui + wgpu canvas | Can 512 px tiles stream into textures at 60 fps while panning a heavy sheet? | A window pans a 20 MP render cut into tiles with frame times logged, no stutter on upload |
| Writing annotations | `lopdf` incremental update or PDFium `FPDFAnnot`: which gives files Revu opens cleanly? | A Rectangle and a Text box written to the Bluebeam fixtures open in Revu, Acrobat and the current redcolumn, with the current app reading them back as the same markups |
| Hiding our annotations | Cheapest exact way to draw a page without the annotations we draw ourselves | Render with and without, diff the pixels |
| Bench harness | Can we time cold start and first paint for both apps the same way? | A driver launches each app with a file and records the first-paint timestamp from each |

Exit: the decisions in [Technology choices](#technology-choices) confirmed or changed, written in
this file, and the engine-only numbers recorded. **If native PDFium is not clearly faster than
wasm on the heavy sheets, say so here before going on**: it changes what the rest of the work can
win.

## Phase 1: the viewer

**Size: L (3 to 4 weeks).**

### 1.1 Window and app shell (S)

- `eframe` app, Direct3D 12 through `wgpu`, per-monitor DPI v2, dark title bar when Windows is in
  dark mode.
- Menu: File (Open, Open Recent, Save, Save As, Close, Exit), View (Single, Continuous, Zoom In,
  Zoom Out, Fit Width, Fit Page, Actual Size, Rotate View), Help (About, with versions of the app
  and PDFium).
- Status bar: page *n* of *m*, zoom, and in a `--diag` build, tile cache, queue and render times
  (the same numbers as `ViewerDiagnostics`).
- Settings saved as JSON under `%APPDATA%\redcolumn-native\`.

### 1.2 Opening documents (S)

- Open from the dialog, drag and drop, the command line (`redcolumn-native.exe file.pdf`), and Open
  Recent.
- Passwords: prompt and retry on `FPDF_ERR_PASSWORD`.
- Errors: a readable message for damaged and unsupported files; PDFium errors never crash the app.
- One document at a time for the prototype (tabs later).

### 1.3 Rendering and the tile cache (M)

- Everything in [The PDFium thread](#the-pdfium-thread) and [Tiles and the view](#tiles-and-the-view-rc-view).
- Quick preview at 512 px while the page's first tiles render, skipped for heavy pages.
- Correct at page rotations 0/90/180/270 and with crop boxes not at the origin.
- Render options: annotations on, `FPDF_LCD_TEXT` off (tiles are scaled while zooming), the same
  flags as the current worker (`0x11` in the bench script: `FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER`,
  adjusted for BGRA).

### 1.4 Navigation (M)

- Scroll wheel scrolls; Ctrl+wheel zooms about the cursor; precision-touchpad pinch (arrives as
  Ctrl+wheel on Windows) zooms smoothly; two-finger pan; touch pinch and pan.
- Middle-button drag pans; the Pan tool (H) and Space held down pan with the left button.
- Keyboard: Page Up/Down, Home/End, arrows, Ctrl+0 (fit page), Ctrl+1 (actual size), Ctrl+2 (fit
  width), Ctrl+= / Ctrl+-, Ctrl+G go to page. Match the current app's shortcuts where they exist
  (`e2e/specs/shortcuts.spec.ts` lists them).
- Zoom range 10% to the current app's maximum zoom setting; zoom steps as `steppedZoom`.
- Thumbnails panel with the current page highlighted, click to go.
- Page labels (`FPDF_GetPageLabel`) shown in the page box and thumbnails when the file has them.

### 1.5 Text selection (S, optional for the comparison)

- Select and copy text with `FPDFText_*`. Useful, cheap, and it exercises the text layer that later
  tools need. Drop it if Phase 1 runs long.

**Exit for Phase 1:** every file in `e2e/fixtures` and the benchmark corpus opens, renders correctly
at all rotations, and zooms and pans with no visible stall on the heavy sheets; unit tests for
layout and tile maths pass.

## Phase 2: Rectangle and Text markups

**Size: L (3 to 4 weeks).**

### 2.1 Model, store and undo (S)

- `rc-markup` types as above, a `MarkupStore` per document (add, update, delete, by page, by id,
  `seq` numbering as `MarkupStore.add`), and a change log that marks the document dirty.
- Undo/redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z) over every edit, including property changes and text
  typed in a box (typing undoes word by word, not letter by letter).

### 2.2 Select tool (M)

- Click to select, Shift/Ctrl+click to add, drag a box to select several, Esc to clear.
- Hit testing in page space with a tolerance in screen pixels (stroke, or fill when filled, or the
  text box's area).
- Move by dragging or with arrow keys (Shift for bigger steps). Resize with 8 handles; Shift keeps
  the aspect ratio. Delete key deletes. Ctrl+C / Ctrl+V copy and paste on the same or another page.
- Locked markups select but do not move, resize or delete.

### 2.3 Rectangle tool (S)

- Drag to draw; Shift draws a square; Esc cancels; the tool stays on after each rectangle or goes
  back to Select, per the current app's setting.
- Defaults from `TYPE_INFO.rect` in `packages/markup/src/types.ts` (colour, width, no fill).
- A minimum size so a click does not leave an invisible markup.

### 2.4 Text tool (M)

- Click to place a box at a default width, or drag to set its width; type straight away.
- Editing in place: an `egui` text field positioned and scaled over the box, with IME for other
  input languages, selection, Ctrl+A/C/X/V, and Enter for a new line (Esc or a click outside ends
  editing).
- Wrapping with Helvetica metrics so the screen, the saved appearance and other readers agree.
- Box grows down as text is added; resize changes the wrap width.
- Double-click a text box to edit it again.

### 2.5 Properties panel (S)

- Colour (preset swatches plus a picker), fill (none or colour), fill opacity, line width,
  opacity, font size, alignment (left, centre, right), and comment.
- Changes apply to every selected markup of a type that has that property, as one undo step.

### 2.6 Import and save (M)

- **Import on open:** read `/Square` and `/FreeText` annotations through PDFium. If `/NBData` is
  present, parse it into the model (keeping unknown fields in `extra`); otherwise build the markup
  from `/Rect`, `/RD`, `/C`, `/IC`, `/CA`, `/BS`, `/DA`, `/Q`, `/Contents`, as
  `packages/markup/src/import.ts` does for these two types.
- **Save:** as in [Saving](#saving-rc-pdfwrite), Ctrl+S to the same path, Save As to another.
- **Unsaved changes:** prompt on close and exit.

**Exit for Phase 2:** round trips in all four directions pass (see [Testing](#testing)), and a person
has opened the saved fixtures in Bluebeam Revu and confirmed the two markups look and edit right.

## Phase 3: Windows integration and packaging

**Size: M (1 to 2 weeks).**

- **Installer:** MSI built with `cargo-wix` (WiX), per-user install by default so it needs no admin
  rights, matching how the Electron NSIS installer installs today. Ships `redcolumn-native.exe` and
  `pdfium.dll`.
- **Side by side:** a different product name, executable name, install folder and settings folder
  from the Electron app, so both can be installed on the benchmark machine at once.
- **File association:** offered as "Open with", never taken as the default for `.pdf` silently.
- **Single instance:** a second launch with a file passes it to the running app over a named pipe,
  like the Electron app's `pdf-args.ts`.
- **Code signing:** the same certificate and process as the Electron release, if available, or
  unsigned with a SmartScreen note for an internal prototype.
- **Crash dumps:** a panic hook that writes the panic and a backtrace to a log next to the settings,
  and a minidump on hard crashes, kept local. No reporting, matching [PRIVACY.md](../PRIVACY.md).
- **Release build in CI:** a workflow job on `windows-latest` builds and attaches the MSI as an
  artifact, separate from the existing Release workflow so the Electron release is untouched.

## Phase 4: the performance comparison

**Size: M to L (1 to 2 weeks).** This is the main output of the prototype.

### 4.1 What is compared

Three apps, so the result says where any difference comes from:

1. **Electron:** the current desktop app, latest release.
2. **Native:** the Rust prototype.
3. **Engine only:** `scripts/render-bench.mjs` (wasm PDFium in Node) against `rc-bench render`
   (native PDFium), with no UI. This separates "wasm is slower than native" from "Electron and the
   web interface are slower than a native interface".

Each Electron run is done twice, with the optimised render copy off and on, labelled as such.
Comparisons are made with it off; the "on" column shows what that feature already buys.

### 4.2 Metrics

| # | Metric | Definition | How it is measured |
|---|---|---|---|
| M1 | Cold start to window | Process start to first frame presented, nothing open | Bench timestamps (below); confirmed with PresentMon |
| M2 | Cold open to first paint | Process start with a file argument to the first frame showing any page content | Bench timestamps |
| M3 | Open to sharp page | File argument to every visible tile at full resolution | Bench timestamps |
| M4 | Warm open | A second file opened in the running app, to sharp page | Bench timestamps |
| M5 | Page change | Page Down to the new page sharp, averaged over 20 pages | Bench timestamps |
| M6 | Zoom latency | Ctrl+wheel step to the view sharp at the new zoom | Bench timestamps |
| M7 | Pan smoothness | Frame times while panning a heavy sheet at a fixed speed for 10 s: p50, p95, p99, frames over 16.7 ms and 33 ms | PresentMon |
| M8 | Zoom smoothness | Frame times through a scripted continuous zoom from fit page to 800% and back | PresentMon |
| M9 | Markup latency | Mouse up after drawing a rectangle, and a key press in a text box, to the frame showing it | Bench timestamps |
| M10 | Save time | Ctrl+S with 100 rectangles and 20 text boxes on a 100-page set, to the file replaced | Bench timestamps |
| M11 | Memory | Peak and steady private bytes and working set, all processes of the app summed (Electron has several) | Sampled every 100 ms with `GetProcessMemoryInfo` over the process tree |
| M12 | CPU | CPU time used during each scenario, and idle CPU over 60 s with a document open | Process times over the tree |
| M13 | Size | Installer size, installed size on disk | File sizes |
| M14 | Thumbnails | Time to render all thumbnails of a 100-page set | Bench timestamps |

### 4.3 Timestamps, the same way in both apps

- Both apps get a `--bench <file.jsonl>` flag. When set, they append one JSON line per event:
  `{"event":"first-paint","t":123.4,"page":0}`, with `t` in milliseconds from process creation
  (`GetProcessTimes` creation time against `QueryPerformanceCounter`, so the time before `main`
  and before Electron's renderer starts counts too).
- Events: `window-shown`, `doc-opened`, `first-paint`, `page-sharp`, `zoom-sharp`, `markup-drawn`,
  `save-done`, `thumbs-done`.
- "Sharp" means the frame after the last visible tile for the current zoom was presented, both
  apps using the same definition. In the Electron app it is the `requestAnimationFrame` after the
  tile's draw call; in the native app it is the frame after the tile's upload.
- **Changes to the current app:** a small, separate PR that adds the `--bench` flag to the
  Electron main process and the event marks in `TileViewer.ts`. Off unless the flag is passed; no
  effect on normal use. It is the only change the current app needs.
- Both apps also emit ETW events with the same names, so a Windows Performance Recorder trace of
  either shows them on its timeline next to CPU, GPU and disk activity.

### 4.4 Driving the scenarios

- `rc-bench drive` (Windows only) launches an app, waits for the right event, then sends input with
  `SendInput`: wheel steps, key presses, mouse drags at fixed speed and fixed screen positions. The
  same script drives both apps; each app's window is placed at the same position and size first.
- Pan and zoom smoothness runs are wrapped in a PresentMon capture of the app's process.
- Every scenario is run **20 times** per app per file, alternating apps, after one discarded warm-up.
  Cold runs clear the file from the standby list first (RAMMap `-Et`, or a fresh boot for the
  official run) so the disk cache does not favour whichever app ran second.
- Results go to CSV; `cargo xtask bench report` writes a Markdown table of medians with the
  interquartile range, and the ratio native/Electron with a 95% bootstrap interval. A difference is
  only reported as a difference when that interval does not include 1.

### 4.5 Files

The corpus, kept in a folder outside the repository when the files are not ours to publish, with
their SHA-256 hashes recorded in the report:

| File | Why |
|---|---|
| `e2e/fixtures/plan.pdf`, `sheets.pdf`, `stitch.pdf` | Small and in the repository: anyone can rerun them |
| A large architectural set (100+ sheets, A1) | Page changes, thumbnails, memory over a real set |
| A sheet with hundreds of thousands of hatch lines | The worst case for parsing and drawing; what the render copy exists for |
| A scanned sheet (one large image per page) | Image decode and memory, rather than vector drawing |
| A text-heavy specification (300+ pages, A4) | Many small pages, fast scrolling |
| A file with existing Bluebeam markups | Import cost and annotation drawing |

### 4.6 Machines

At least two, with full specifications in the report (CPU, cores, RAM, GPU and driver, disk,
Windows build, display resolution and scale, power plan):

- A typical office laptop (integrated graphics, 16 GB, 150% scale), the machine most users have.
- A desktop with a discrete GPU and a 4K display at 100% or 150%.
- If possible, a low-end machine (8 GB, older CPU), where differences in memory are felt most.

Both apps run with the Windows "Best performance" power mode, plugged in, nothing else running,
antivirus exclusions identical for both install folders.

### 4.7 The report

`docs/benchmarks/native-vs-electron.md`: method, machines, files with hashes, the raw CSVs, the
tables, and plain conclusions: what is faster, by how much, where it comes from (engine or
interface), and where native is not better. Published with its files and hardware, as the README
asks.

### 4.8 Follow-on experiments (each its own labelled run)

- Native with tuned tile settings (larger tiles, more in flight).
- Native with a multi-process render pool (2, 4 processes): speed against memory.
- Native with the optimised render copy ported, against Electron with it on.
- Electron with the native engine (PDFium as a Node add-on in the main process instead of wasm in a
  worker). If most of the gain is the engine, this gets much of it for far less work, and the
  report should say so.

## Phase 5: decision

**Size: S.** With the report in hand, decide one of:

1. **Port:** the native app is clearly better where users feel it (opening big sets, heavy sheets,
   memory on laptops). Plan the port by feature area, starting with measurements and takeoff since
   they are the most used, and decide how the TypeScript `packages/markup` and `packages/measure`
   logic is carried over (rewritten in Rust with the TypeScript tests ported as the specification).
2. **Hybrid:** most of the gain comes from the engine. Keep the interface in TypeScript and move
   PDFium to native code inside the Electron app (or a Tauri shell).
3. **Stop:** the gains are small. Keep the prototype and the benchmark harness, which stays useful
   for catching performance regressions in the current app.

## Testing

| Level | What | Where |
|---|---|---|
| Unit | Layout, zoom maths, tile grids, hit testing, geometry, JSON | Each crate, `cargo test` |
| Property | Page space ↔ device space round trips at every rotation; resize never makes a negative box | `proptest` in `rc-view`, `rc-markup` |
| Render snapshots | Each fixture page rendered by `rc-pdf` against stored PNGs, with a pixel tolerance | `rc-pdf/tests`, PNGs under `rust/tests/snapshots` |
| Engine parity | Native and wasm renders of the same pages differ by under 0.1% of pixels | `cargo xtask parity`, which also runs the Node script |
| Round trip, Rust → Rust | Draw, save, reopen: the same markups | `rc-pdfwrite/tests` |
| Round trip, TS → Rust | Files saved by `exportWithAnnotations` with rectangles and text boxes open in the prototype as the same markups | Fixtures made by a Node script in `rust/tests/fixtures/make.mjs` |
| Round trip, Rust → TS | Files saved by the prototype import through `importAnnotations` as the same markups | A test in `packages/markup` that reads fixtures from `rust/tests/out/` |
| Unknown data kept | A file with every markup type from the current app: open, move one rectangle, save, and every other annotation and every `/NBData` field is unchanged | `rc-pdfwrite/tests` |
| Bluebeam | Saved files open in Revu with the right look and are editable there; Revu's files open in the prototype | Manual checklist each release, as for the current app |
| UI | Scripted input through `rc-bench drive` on the fixtures: open, zoom, draw, type, save, compare the file | Windows CI job, smoke level |

## CI

A new workflow, `.github/workflows/rust.yml`, triggered by changes under `rust/` (so the TypeScript
pipeline is unchanged), on `windows-latest`:

1. Cache `~/.cargo` and `rust/target` (`Swatinem/rust-cache`).
2. `cargo xtask fetch-pdfium` (pinned version, SHA-256 checked).
3. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`.
4. `cargo test --workspace`.
5. `cargo deny check` (licences, advisories, bans).
6. On `workflow_dispatch`: build the MSI and upload it as an artifact.

Per [the PR workflow](../.claude/skills/pr-workflow/SKILL.md), adding this workflow needs explicit
human approval before merge. Benchmarks are not run in CI: hosted runners are noisy, and the
numbers would mislead.

## Security

Moving from Electron changes the security picture, and the plan should say how:

- **Lost:** today PDFium runs as wasm inside a sandboxed renderer process, so a bug in PDFium
  exploited by a malicious PDF is contained twice (wasm memory and the Chromium sandbox). Native
  PDFium in the app process has neither.
- **Mitigations for the prototype:** keep PDFium current (Dependabot-style check on the pinned
  version), build with Control Flow Guard and ASLR (Rust and pdfium-binaries both support them),
  and only open files the user chooses.
- **Before any public release:** run the PDFium thread in a separate low-privilege process (a
  restricted token or AppContainer, no file system access except the document handle passed in).
  That is the same process boundary as the multi-process render pool, so the two are designed
  together.
- `cargo deny` and `cargo audit` on every push; `unsafe` only in `rc-pdf` and `rc-win`, each block
  with a `// SAFETY:` comment, and `#![forbid(unsafe_code)]` in every other crate.
- [SECURITY-HARDENING.md](SECURITY-HARDENING.md) gets a section for the native app if it continues
  past Phase 5.

## Licences and notices

- New code under Apache 2.0, like the rest of the repository.
- PDFium: BSD-3-Clause with Apache-2.0 parts, and its own third-party code (FreeType, libjpeg-turbo,
  OpenJPEG, zlib, and others); its notices ship in the installer.
- `cargo-about` generates the Rust crates' notices; `cargo xtask notices` merges them into a
  `THIRD_PARTY_NOTICES.md` for the native app, in the same format as `scripts/third-party-notices.mjs`.
- `deny.toml` allows only licences compatible with Apache 2.0 (MIT, Apache-2.0, BSD, ISC, Zlib,
  Unicode, MPL-2.0 as a library), and rejects GPL and AGPL.

## Risks

| Risk | Likelihood | Effect | Response |
|---|---|---|---|
| Native PDFium is not much faster than wasm on the heavy sheets that matter | Medium | The engine part of the gain is small | Measured first, in Phase 0, before most of the work |
| The wasm build's PDFium revision cannot be matched exactly | Medium | Render differences muddy the comparison | Build PDFium from source at that revision, or accept the nearest and report pixel differences |
| `egui` does not scale to the full app's interface (ribbon, dense panels, docking) | Medium | A UI rewrite if the port goes ahead | Keep all `egui` code in `rc-app`; reassess in Phase 5 |
| Text in boxes wraps differently on screen, in the saved file, and in Revu | High | Text that looks right here overflows in Revu | Wrap with Helvetica metrics everywhere; test in Revu early (Phase 0) |
| Blurry or slow GPU drawing on old drivers, VMs, Remote Desktop | Medium | Bad first impression on some machines | WARP and GL fallbacks; a software tile path if needed |
| PDFium in the app process is a larger attack surface | High (for any native PDF app) | A malicious PDF is more dangerous | Sandboxed render process before public release |
| Two codebases to maintain if both continue | High if Phase 5 says port | Slower progress on both | Phase 5 decides one direction; the prototype is not shipped to users until then |
| The benchmark favours one app by accident (disk cache, window size, DPI, render copy) | Medium | Wrong conclusions | Alternate runs, cold caches, fixed window, render copy off and on, intervals not single numbers |

## Open questions

1. Which files can go in the corpus and be named in a published report, and which must stay private
   and be described only?
2. Is Bluebeam Revu available on the benchmark machines for the compatibility check?
3. Is the Windows code-signing certificate available for a second product, or should the prototype
   ship unsigned to a few testers?
4. Which Windows versions must it support: Windows 10 21H2+ and 11, or 11 only (which allows
   newer APIs and drops some testing)?
5. Arm64 Windows: needed for the prototype, or later? pdfium-binaries and Rust both support it; it
   would add one CI target.
