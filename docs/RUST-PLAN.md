# redcolumn in Rust: a native Windows viewer for heavy drawings

A plan for a native redcolumn written in Rust, Windows first, built for one job above all others:
**opening and moving around large, heavy engineering drawings as fast as the hardware allows.**
The first version is a PDF viewer with two markup tools, Rectangle and Text, measured against the
current Electron desktop app on the same machines, files and actions.

Rewriting in Rust is not enough on its own to get there. The current app already uses a fast engine
(PDFium); what limits it on heavy sheets is the *shape* of the pipeline: one engine thread, and every
tile walking every object on the page again. So this plan changes the architecture, not just the
language, and the language is what makes the new architecture practical.

Sizes follow [ROADMAP.md](ROADMAP.md): **S** (a day or two), **M** (about a week), **L** (several
weeks). The prototype is roughly 18 to 24 weeks for one developer, most of it in the rendering engine.

## Contents

- [What "heavy" means](#what-heavy-means)
- [Where the time goes today](#where-the-time-goes-today)
- [Performance targets](#performance-targets)
- [Design rules](#design-rules)
- [Architecture](#architecture)
  - [Three ways to draw a page](#three-ways-to-draw-a-page)
  - [Processes and threads](#processes-and-threads)
  - [Scene extraction](#scene-extraction)
  - [The scene format](#the-scene-format)
  - [Spatial index and level of detail](#spatial-index-and-level-of-detail)
  - [The GPU renderer](#the-gpu-renderer)
  - [The raster path](#the-raster-path)
  - [Fidelity check and fallback](#fidelity-check-and-fallback)
  - [Caches](#caches)
  - [Scheduling and prefetch](#scheduling-and-prefetch)
  - [The frame loop and input latency](#the-frame-loop-and-input-latency)
  - [Memory](#memory)
  - [Markups](#markups)
- [Technology choices](#technology-choices)
- [Repository layout](#repository-layout)
- [Phases](#phases)
- [Performance engineering practice](#performance-engineering-practice)
- [The comparison with the current app](#the-comparison-with-the-current-app)
- [Testing](#testing)
- [CI](#ci)
- [Security and privacy](#security-and-privacy)
- [Licences and notices](#licences-and-notices)
- [Risks](#risks)
- [Open questions](#open-questions)

## What "heavy" means

Engineering drawings exported from AutoCAD, Revit, MicroStation, Civil 3D and similar tools are
nothing like ordinary PDFs. The plan is built around these properties:

| Property | Typical range | Why it hurts |
|---|---|---|
| Page size | A1 to A0 (up to 3370 × 2384 pt), sometimes longer roll sheets | A full-detail view at 400% is hundreds of megapixels |
| Path objects per page | 50,000 to 2,000,000+ | PDFium walks every object on every render, even for a small tile |
| Segments per page | Up to tens of millions | Hatches and curves exported as thousands of tiny lines |
| Hatching | Dense line hatches, often one object per line, often as repeated Form XObjects | The single biggest cost on most heavy sheets |
| Text | SHX fonts exported as strokes (thousands of tiny polylines), or TrueType text | Stroked text multiplies segment counts; real text needs fonts |
| Clipping | Viewports and hatch boundaries as clipping paths, sometimes one per object | Clips are expensive per object in a CPU rasteriser |
| Line weights | Many distinct widths, many hairlines (width 0) | Hairlines must stay one device pixel at every zoom |
| Layers | Optional content groups, dozens to hundreds | Toggling a layer must not mean a full re-render |
| Images | Aerial photos, scanned underlays, logos; often far sharper than the sheet shows them | Decode time and memory |
| Sets | 50 to 1,000 sheets in one file, or many files | Page changes and thumbnails across the whole set |

## Where the time goes today

From the current code (`packages/pdf-core/src/worker.ts`, `apps/web/src/viewer/TileViewer.ts`,
`apps/web/src/documents/renderCopy/`):

- **One engine, one core.** PDFium runs as WebAssembly in one Web Worker. A heavy sheet gets one
  CPU core however many the machine has, and wasm runs slower than native code.
- **Every tile pays for the whole page.** Each 512 px tile is a call to `FPDF_RenderPageBitmap_Start`,
  which walks every object on the page and culls by bounding box. The viewer already knows this:
  pages up to 9 MP are drawn whole because "every render of a sheet pays for walking all its
  objects, so one whole-page render beats a dozen tiles".
- **Zooming means re-rendering.** A new zoom level throws away the tiles' resolution and asks PDFium
  again, so a zoom on a 1,000,000-object sheet costs a full walk of that sheet per visible tile.
- **No quick preview on the heaviest pages.** At 300 ms+ parse or 100,000+ objects the 512 px
  preview is skipped, because drawing even a small one walks every object.
- **The render copy is a workaround for the above.** It rewrites heavy pages (merging stroke objects,
  drawing hatch forms inline, cutting clips into lines, downsampling images) so PDFium has less to
  walk. It works, and every one of its tricks is carried into this plan, but done once at load into a
  structure built for drawing, rather than written back into a PDF for the same engine to walk again.
- **Nothing survives a restart.** Every open parses from scratch.

The conclusion: on heavy sheets the cost is *re-walking the page*. The new design walks each page
once, keeps the result in a form the GPU can draw at any zoom, and keeps it on disk for next time.

## Performance targets

Initial targets, to be confirmed or reset with real numbers in Phase 0. "Reference laptop" is a
typical office laptop of 2024–2026 (8+ cores, integrated graphics, 16 GB, 1920 × 1200 at 150%);
"reference workstation" is a desktop with a discrete GPU and a 4K display. A "heavy sheet" is A0
with 1,000,000 path objects; the corpus defines the exact files.

| # | Measure | Target, reference laptop | Notes |
|---|---|---|---|
| T1 | Cold start to window | < 150 ms | Nothing open |
| T2 | Heavy sheet, first open, first content on screen | < 500 ms | Something recognisable, even if coarse |
| T3 | Heavy sheet, first open, full detail at fit page | < 1.5 s | |
| T4 | Heavy sheet, reopened (disk cache), full detail | < 150 ms | |
| T5 | Pan and zoom on a heavy sheet, frame time p99 | < 8.3 ms (120 Hz) on the workstation, < 16.7 ms on the laptop | At every zoom, including during and right after a zoom |
| T6 | Zoom step to full detail at the new zoom | < 50 ms | No blurry phase visible at 60 Hz |
| T7 | Next sheet in a set (prefetched) | < 50 ms to full detail | |
| T8 | Next sheet in a set (not prefetched) | Same as T2/T3 | |
| T9 | Layer on/off on a heavy sheet | < 16 ms | One frame |
| T10 | Thumbnails for a 300-sheet set | Visible ones < 1 s; all < 30 s in the background | |
| T11 | Memory, heavy sheet open | < 400 MB private bytes | Scene + GPU + caches |
| T12 | Idle CPU with a document open | ~0% | Nothing renders without a reason |
| T13 | Drawing a rectangle or typing a character | Visible on the next frame | Never waits on PDFium |

Every target gets a matching measurement in the benchmark and, from Phase 2, a regression gate.

## Design rules

1. **Walk each page once.** Parse and extract a page's content one time, into a scene built for
   drawing. Never ask PDFium to walk a page again to pan or zoom.
2. **The GPU draws while you interact.** Pan, zoom, layer toggles and markups are GPU work over
   data already in memory. The CPU prepares data; it does not rasterise frames.
3. **PDFium stays the reference for what is correct.** Every page drawn by the GPU is checked
   against a PDFium render in the background, and a page that does not match is drawn the PDFium
   way. Printing and export always use PDFium. Fast never means wrong.
4. **Use every core.** Parse, extract, decode images and build indexes across all cores, across
   pages and inside a page where the format allows.
5. **Never block a frame.** Nothing on the UI thread waits for parsing, decoding, disk or PDFium.
   If the data is not ready, draw the best thing that is (coarser detail, the last frame scaled),
   and replace it when it is.
6. **Cache to disk.** A sheet opened once opens instantly the next time.
7. **Work in proportion to pixels, not objects.** At any zoom, the cost of a frame is bounded by
   what is on screen and how many pixels it covers, not by how many objects the page has.
8. **Memory is performance.** A compact scene fits in cache and in GPU memory; an integrated GPU
   shares the laptop's RAM with everything else.
9. **Measure before and after every change.** Each claimed gain has a benchmark number; each
   regression gate is enforced in CI on fixed hardware.
10. **Idle means idle.** No continuous render loop; the app draws only when something changed.

## Architecture

```text
                       ┌───────────────────────── rc-app (UI thread) ──────────────────────────┐
  mouse, pen, keys ──▶ │ tools · commands · undo · panels · menus · frame loop                 │
                       └─────────┬─────────────────────────────────────────────┬───────────────┘
                                 │ view (page, zoom, rect, layers)             │ markup edits
                       ┌─────────▼──────────────── rc-view ────────────────┐   │
                       │ picks a path per page and zoom; GPU draw calls     │◀──┘
                       │  ① scene (vector)  ② overview pyramid  ③ raster    │
                       └───┬──────────────────────┬─────────────────┬───────┘
                 scene     │      pyramid tiles   │    raster tiles │
                 cells     │                      │                 │
          ┌────────────────▼───┐   ┌──────────────▼──┐   ┌──────────▼─────────┐
          │ rc-scene           │   │ rc-cache        │   │ rc-pdf  (pool of    │
          │ display lists,     │◀─▶│ memory, GPU,    │◀─▶│ PDFium processes):  │
          │ index, LOD, meshes │   │ disk (mmap)     │   │ parse, extract,     │
          └────────▲───────────┘   └─────────────────┘   │ render, check       │
                   │ extracted objects                    └──────────▲──────────┘
                   └─────────────────────────────────────────────────┘
```

### Three ways to draw a page

The view picks one per page and per zoom, every frame, from whatever is ready:

1. **Scene (vector, GPU).** The page's paths, text and images in a GPU-friendly display list,
   culled with a spatial index and drawn by our own shaders. Used for interaction at any zoom where
   the visible geometry is within budget. Pan and zoom cost only GPU time.
2. **Overview pyramid (raster, GPU-made).** At zooms where many objects land in each pixel
   (fit page on a 1,000,000-object A0 sheet), drawing every line is wasted work. The renderer draws
   the scene once into a mip pyramid of textures (supersampled, so hatches keep their tone) and
   shows that instead. Built on the GPU from the scene in milliseconds, cached to disk.
3. **Raster tiles (PDFium).** PDFium renders tiles, in parallel across the process pool. Used
   while the scene is still being built on first open, for pages that fail the fidelity check, on
   machines without a usable GPU (WARP, some Remote Desktop sessions), and always for printing.

On first open of a heavy sheet: PDFium raster tiles (or a coarse PDFium render) appear first, the
scene replaces them when extraction finishes, and from then on everything is the scene or the
pyramid. On reopen: the pyramid and scene come straight from the disk cache.

### Processes and threads

PDFium is not thread-safe: one PDFium instance can only be used from one thread. Parallelism
therefore comes from **several PDFium processes**, each with its own copy of the open document.

| Process or thread | What it does |
|---|---|
| UI thread (main process) | Input, layout, frame building, GPU submission. Never waits on anything below. |
| Scene workers (main process, `rayon` pool) | Build display lists, spatial indexes, LOD levels and GPU meshes from extracted objects; decode images; read and write the disk cache |
| GPU upload thread | Streams meshes and textures to the GPU with a per-frame budget |
| PDFium workers (N child processes) | Parse pages, extract page objects, render raster tiles, render reference images for the fidelity check |

- **N** defaults to physical cores − 1, capped by memory: each process holds the document and its
  parsed pages. A file of 200 MB with 8 workers must not use 8 × 200 MB, so workers map the file
  read-only (`FPDF_LoadCustomDocument` over a shared memory map) instead of copying it.
- **Work split:** across pages for sets (each worker owns different pages), and for a single heavy
  sheet across tiles for raster rendering. Extraction of one page is one worker's job; see
  [Phase 3](#phase-3-own-content-parser-experiment-gated) for splitting inside a page.
- **Protocol:** requests and results over shared memory rings (`shared_memory`/`windows` file
  mappings) with a small control channel. Bitmaps and extracted geometry go through shared memory,
  never through a pipe copy.
- **Crash isolation:** a PDFium crash on a malformed file kills one worker, not the app. The pool
  restarts it and the page falls back or reports an error. This is also the security boundary (see
  [Security and privacy](#security-and-privacy)).
- **Priorities:** the visible page first, then the next and previous sheets, then the rest of the
  set; background work runs at below-normal priority and backs off on battery.

### Scene extraction

Phase 0 decides between two sources of page content, and may end up using both:

**A. Through PDFium's page object API** (start here). After `FPDF_LoadPage`, walk
`FPDFPage_CountObjects`/`FPDFPage_GetObject`, recursing into Form XObjects
(`FPDFFormObj_CountObjects`/`GetObject`) and reading for each object:

- Paths: `FPDFPath_CountSegments`, `FPDFPath_GetPathSegment`, `FPDFPathSegment_GetPoint/GetType/GetClose`,
  `FPDFPath_GetDrawMode` (fill rule, stroke), `FPDFPageObj_GetMatrix`, stroke and fill colour, width,
  `GetLineJoin`, `GetLineCap`, `GetDashArray`/`GetDashPhase`, `FPDFPageObj_GetClipPath`.
- Text: font, size, matrix, and glyph outlines through `FPDFFont_GetGlyphPath`, if the glyph ids
  of a text object can be read through the API (a Phase 0 question). If not, text objects are drawn
  by the raster path in a text layer (see [The raster path](#the-raster-path)) until Phase 3.
- Images: `FPDFImageObj_GetRenderedBitmap` (masks applied) or `GetImageDataRaw` for our own faster
  JPEG decode, with the image's matrix.
- Optional content: which layer each object belongs to, so layers toggle on the GPU.
- Anything with transparency groups, soft masks, blend modes or shadings is marked; such pages
  either draw those objects from the raster path or fail the fidelity check and use raster tiles.

Cost: the PDFium parse plus one native call per segment (tens of nanoseconds each), in parallel
across pages. Same interpretation of the file as PDFium, so the least risk.

**B. Our own content stream interpreter in Rust** (Phase 3, only if Phase 0 and Phase 2 show
parsing is the limit on first open). It would let us: decompress and tokenise with SIMD, show
geometry while a page is still being parsed, parse one huge page on several cores (decompress the
`/Contents` streams and Form XObjects in parallel, tokenise in chunks, interpret in order), and read
glyph outlines directly (`skrifa` for TrueType and CFF fonts). PDFium stays the reference that it is
checked against.

While extracting, the scene builder applies the render copy's lessons:

- **Merge** consecutive path objects with the same style into one draw batch.
- **Instance** Form XObjects used many times (hatch tiles, blocks, symbols): one mesh, many
  transforms, instead of copies.
- **Pre-clip** where a clip is a rectangle or simple polygon: cut segments to it once at load
  rather than clipping per object per frame; keep the stencil path for the rest.
- **Downsample** images to the largest size the page can show them at (and keep mip levels).
- **Drop** objects that can never be seen (fully clipped, zero area, white on white under nothing,
  outside the crop box).

### The scene format

Compact, flat and directly mappable from disk, so a cached scene is used without parsing:

- **Coordinates:** page space split into cells (for example 256 × 256 pt); each vertex stored as
  two `i16`/`u16` offsets within its cell (a resolution of about 0.004 pt, far finer than any print),
  so 4 bytes a vertex instead of 16 for two `f64`. Curves are kept as curves and flattened on the
  GPU or per LOD level, not pre-flattened to the finest zoom.
- **Styles:** stroke width, colour, caps, joins, dash and layer deduplicated into a style table;
  each batch refers to a style by index.
- **Batches:** a run of segments with one style, in paint order. Paint order is preserved exactly:
  PDF is painter's-model, and drawings rely on it (white masks over hatches, for example).
- **Instances:** a reference to a shared mesh plus a 2 × 3 matrix.
- **Layout:** structure of arrays in a few large buffers (positions, segment indices, batch table,
  style table, instance table, cell index), written with a header and version so it can be
  `mmap`'d and handed to the GPU without a transform.
- **Size goal:** under 10 bytes per segment on average including indexes, so a 5,000,000-segment
  sheet is ~50 MB in memory and on disk, and compresses well (`zstd`) for the disk cache.

### Spatial index and level of detail

- **Index:** a fixed grid of cells per page, each with a list of batch ranges in paint order, plus a
  coarser quadtree above it. Culling a view is a range lookup, not a walk of the page.
- **Per-zoom detail:** for each cell, precomputed simplified versions at a few zoom levels
  (each level halving the resolution): segments shorter than a pixel at that level are merged or
  dropped by a simplification that keeps the cell's ink coverage, so a dense hatch keeps its tone
  without drawing every line.
- **Density switch:** when a cell's segment count per screen pixel passes a threshold, that cell is
  drawn from the overview pyramid instead of geometry. The switch is per cell, so a dense hatched
  area and a sparse area next to it each use the cheaper path.
- **Budgets:** the view keeps a per-frame budget of segments drawn (measured per GPU tier at
  start-up) and picks the detail level per cell to stay within it, finest near the cursor and the
  centre of the screen.
- **Layers:** each batch carries its layer; a hidden layer is a bit in a GPU buffer, so toggling
  costs one frame (target T9).

### The GPU renderer

`wgpu` on Direct3D 12, our own pipelines:

- **Strokes:** each segment drawn as an instanced quad, expanded in the vertex shader to the stroke
  width in device pixels, with analytic anti-aliasing in the fragment shader (distance to the
  segment). Hairlines (width 0 or below one pixel) clamp to one device pixel as PDFium draws them.
  Joins and caps for thick lines computed in the shader; dashes from a per-segment running length.
  This draws millions of segments per frame on integrated graphics.
- **Fills:** tessellated at scene build time on the scene workers (`lyon`), with even-odd and
  non-zero rules; large complex fills that tessellate badly use stencil-then-cover instead.
- **Text:** glyph outlines tessellated once per font, glyph and detail level, then instanced. Stroked
  SHX text is ordinary path data.
- **Images:** GPU textures with mip levels; images larger than the texture limit split into tiles;
  decode on the scene workers, never on the UI thread.
- **Clipping:** pre-clipped geometry where possible; otherwise clip paths into the stencil buffer,
  grouped so a run of objects sharing a clip pays for it once.
- **Overview pyramid:** the same pipelines drawing into an offscreen texture at 2× supersampling,
  then mip-mapped on the GPU.
- **Colour and look:** the page white, dark mode (inverted, hues kept) and the dimmer as shader
  settings, matching the current app's page filters, with no re-render.
- **GPU tiers:** at start-up, a two-second micro-benchmark (or the cached result) sets the budgets.
  On WARP (software Direct3D) and other software adapters, the view uses the raster path only.

### The raster path

PDFium's own rendering, made as fast as it can be:

- **Parallel tiles:** visible tiles of one heavy sheet rendered by all PDFium workers at once,
  each worker with the page parsed once and kept (a page cache per worker).
- **Progressive with cancel:** `FPDF_RenderPageBitmap_Start`/`_Continue` with a pause callback
  that checks a cancel flag, so a tile that leaves the view stops immediately.
- **Larger tiles for heavy pages:** a tile render costs a walk of the page whatever its size, so
  heavy pages use fewer, larger tiles (decided from the page's measured walk cost, as the current
  viewer's `PageCost` does).
- **Text layer:** if text cannot be extracted as glyphs (see [Scene extraction](#scene-extraction)),
  a worker loads a scratch copy of the page, removes every non-text object (`FPDFPage_RemoveObject`),
  and renders that as a transparent layer drawn over the scene. Checked by the fidelity check like
  everything else.
- **PDFium build:** Phase 0 compares prebuilt pdfium-binaries (AGG renderer) with our own build
  (`is_official_build`, LTO, no V8 or XFA, and the Skia renderer) on the heavy corpus; the fastest
  build that renders correctly ships.

### Fidelity check and fallback

So that speed never costs correctness:

1. After a page's scene is built, a PDFium worker renders the page at two zooms (fit page and a
   detailed crop around the densest cell), and the GPU renders the scene at the same zooms.
2. The images are compared with the same per-pixel threshold `scripts/render-bench.mjs` uses for
   the render copy. If the share of differing pixels is above the limit, the page is drawn by
   the raster path from then on, and the result is logged (with `--diag`) so the scene builder can be
   fixed.
3. The verdict is cached with the scene, so the check runs once per page per file version.
4. Until the check passes, the scene is used for interaction (it is far more likely right than
   wrong), and the check result can swap it out a moment later. A setting can make the app wait for
   the check instead.
5. Printing, export and anything that writes pixels to a file always use PDFium.

### Caches

| Cache | Holds | Budget | Evicts |
|---|---|---|---|
| Scene (memory) | Display lists of open and prefetched pages | 25% of RAM, capped | LRU by page, visible page never |
| GPU | Meshes, glyphs, image textures, pyramid levels | Measured from the adapter (dedicated VRAM, or a share of shared memory on integrated GPUs) | LRU by cell and level |
| Raster tiles | PDFium tiles | ~160 MB, like today | LRU |
| PDFium pages | Parsed pages in each worker | By measured parse cost | Cheapest to re-parse first |
| Disk | Scene, pyramid, thumbnails, fidelity verdicts, page costs | 5 GB default, configurable | LRU by file |

- The disk cache lives in `%LOCALAPPDATA%\redcolumn-native\cache\`, keyed by a fast hash
  (`blake3`) of the file's size, modification time and first and last megabytes, confirmed with a
  full hash in the background. A changed file gets a new key.
- Entries are written atomically and are memory-mapped when read: no parsing, no copying, and the
  operating system pages in only the cells being drawn.
- A whole set can be indexed in the background on first open, so every sheet in it opens at the
  T4 speed afterwards.

### Scheduling and prefetch

- One priority queue for all background work: visible page detail first, then the fidelity check,
  then the next and previous sheets (in the direction of travel), then thumbnails, then the rest of
  the set.
- Requests carry a generation number; a zoom or page change makes older ones stale, and stale work
  is dropped before it starts and cancelled while it runs.
- Prefetch respects memory: it stops when the scene cache is at budget, and evicts pages farthest
  from the current one first.
- On battery, background indexing of the whole set pauses; visible work is unaffected.

### The frame loop and input latency

- Event-driven: a frame is drawn when input arrives, new data lands, or an animation runs. Nothing
  otherwise (target T12).
- During interaction, a waitable flip-model swap chain (`wgpu` `Mailbox`/`FifoRelaxed` where the
  driver supports it) keeps input-to-screen latency to one frame; high refresh rate displays are
  used at their full rate.
- Pan and zoom are applied to the GPU view transform as input arrives, before any data work, so the
  page moves under the cursor on the next frame whatever is still loading.
- Frame building on the UI thread is bounded (culling is a grid lookup, uploads are budgeted per
  frame); any work that does not fit in the frame moves to a worker.
- `tracy` zones around every stage of a frame, so a slow frame shows exactly where its time went.

### Memory

- `mimalloc` as the global allocator; arenas for per-page build data, freed in one step.
- Nothing allocates per frame in the steady state (checked with a counting allocator in tests).
- The original file is memory-mapped, never read into a buffer.
- Image pixels are kept only at the sizes the page shows them, plus mips.
- Large buffers come from the scene's mapped file where possible, so they count as file-backed
  memory the operating system can drop and re-read rather than private memory.

### Markups

Rectangle and Text are drawn by the same GPU pipelines as the page, in a layer above it, so drawing,
moving and editing them never involves PDFium (target T13). Model, import and save keep full
compatibility with the current app:

- **Model:** a Rust struct mirroring the `Markup` subset in `packages/markup/src/model.ts`, with
  the same JSON field names (`serde(rename_all = "camelCase")`) and unknown fields kept in a
  flattened map, so `/NBData` written by either app reads in the other and nothing is lost.
- **Save:** `lopdf` incremental update with `/Square` and `/FreeText` dictionaries matching
  `packages/markup/src/export.ts` (`/RD`, `/DA` with `/Helv`, `/Q`, `/RC`, `/C`, `/NBData`), an
  appearance stream, written to a temporary file and swapped in with `ReplaceFileW`, as
  `apps/desktop/src/atomic.ts` does. Saving appends only the change, so it costs the size of the
  edit, not the size of the file, and signatures stay valid.
- **Import:** Rectangle and FreeText annotations become markups; every other annotation is left
  exactly as it is and drawn by PDFium (the raster path draws annotations as a separate layer, so
  the scene does not need to know them).

## Technology choices

| Need | Choice | Why |
|---|---|---|
| PDF engine | PDFium, native, via `pdfium-render` raw bindings; prebuilt from pdfium-binaries or our own optimised build (Phase 0 decides) | The engine the app already trusts; BSD/Apache licence |
| Our own parser (Phase 3, gated) | Rust, with `zlib-rs` or `libdeflater` for Flate, `memchr`/SIMD tokenising, `skrifa` for fonts | Faster first open, streaming display, parallel parse of one page |
| PDF writing | `lopdf` incremental updates | Full control of annotation dictionaries; appended saves |
| GPU | `wgpu` (Direct3D 12), own WGSL shaders | Modern, portable, fast; a path to Mac later |
| Tessellation | `lyon` | Robust fills, run on workers |
| Interface | `egui`/`eframe` for menus, panels and dialogs, isolated in `rc-app` | Fastest route to a working interface; the canvas is ours, so the toolkit never limits drawing speed |
| Parallelism | `rayon` for CPU work, `crossbeam` channels, child processes for PDFium | |
| Shared memory | Windows file mappings via `windows` | Zero-copy between processes |
| Disk cache | `memmap2`, `zstd`, `blake3` | Zero-parse reads, fast hashing |
| Allocator | `mimalloc` | Fast with many threads |
| Profiling | `tracy-client` (frames and zones), ETW events, Windows Performance Recorder, PIX for GPU | |
| Benchmarks | `criterion` for micro-benchmarks, our own driver for end to end | |
| Release build | `lto = "fat"`, `codegen-units = 1`, `panic = "abort"`, PGO with `cargo-pgo` on the heavy corpus, `x86-64-v2` baseline with AVX2 paths chosen at run time (`multiversion`) | Speed without dropping older CPUs |

Rejected: MuPDF (AGPL), Tauri or any web view for the page area (it would keep the costs this plan
removes), pure-Rust renderers as the *reference* (not yet at PDFium's fidelity on these files).

## Repository layout

```text
rust/
  Cargo.toml              workspace, lints, release and bench profiles
  rust-toolchain.toml     pinned toolchain
  deny.toml               licences, advisories
  crates/
    rc-pdf/               PDFium worker process, pool, shared-memory protocol, raster tiles, extraction
    rc-parse/             our own content stream interpreter (Phase 3)
    rc-scene/             scene format, builder, spatial index, LOD, simplification
    rc-gpu/               wgpu pipelines: strokes, fills, text, images, stencil clips, pyramid
    rc-view/              path choice per page and zoom, budgets, scheduling, prefetch
    rc-cache/             memory, GPU and disk caches
    rc-check/             fidelity check (scene vs PDFium)
    rc-markup/            markup model, hit testing, JSON
    rc-pdfwrite/          annotation dictionaries, appearance streams, incremental save
    rc-app/               the egui application
    rc-win/               every Windows-only call
    rc-bench/             engine benchmarks, end-to-end driver, synthetic drawing generator
  xtask/                  fetch or build PDFium, package, notices, bench report
```

`#![forbid(unsafe_code)]` everywhere except `rc-pdf`, `rc-gpu` (buffer casts) and `rc-win`, where
each `unsafe` block carries a `// SAFETY:` comment.

## Phases

### Phase 0: corpus, measurement and spikes

**Size: L (2 to 3 weeks).** Nothing is built for real until the numbers say where the time goes.

1. **Corpus (M).** Collect the heavy files (see [Files](#files)) and write `rc-bench gen`, a
   generator of synthetic sheets with controlled knobs: segment count (10k to 10M), hatch density,
   hatch as forms or inline, clip count, SHX-style stroked text, TrueType text, image size, layers.
   Synthetic sheets give scaling curves and can be published; real files keep it honest.
2. **Profile today's app (S).** Run the current app on the corpus with the `--bench` marks (see
   [Timestamps](#timestamps)) and a Windows Performance Recorder trace: how the time splits
   between parse, render and everything else, per file.
3. **Engine benchmark (M).** `rc-bench render` (native PDFium) against `scripts/render-bench.mjs`
   (wasm PDFium): parse ms and draw ms per page. Also: prebuilt AGG build vs our own optimised AGG
   and Skia builds. Answers how much is the wasm cost and how much is the design.
4. **Extraction spike (M).** Extract a heavy sheet through the page object API; measure extraction
   time per million segments; confirm glyph outlines for text objects can be read; confirm optional
   content membership can be read.
5. **GPU spike (M).** Draw 5,000,000 extracted segments with the instanced stroke shader on the
   reference laptop's integrated GPU; measure frame time at fit page and at 800%; compare a pixel
   diff with PDFium's render.
6. **Process pool spike (S).** Two to eight PDFium processes rendering tiles of one heavy page over
   a shared memory map: speed-up and memory per process.

**Exit:** the [targets](#performance-targets) confirmed or reset with numbers; extraction source A
confirmed (or the parser moved earlier); PDFium build chosen; a short write-up added here.

### Phase 1: the fast raster viewer

**Size: L (3 to 4 weeks).** A complete, usable viewer on the raster path alone. It is the fallback
forever and the baseline every later phase is measured against.

- App shell: window, menus (File, View, Help), status bar, settings, `--diag` overlay (cache, queue,
  render times, path used per page), per-monitor DPI.
- Opening: dialog, drag and drop, command line, recent files, passwords, readable errors.
- PDFium worker pool with shared memory, crash restart, priorities, cancellation.
- Parallel progressive raster tiles, page cache per worker, larger tiles for heavy pages.
- Navigation: wheel, Ctrl+wheel and touchpad pinch zoom about the cursor, middle-drag and Space pan,
  touch, keyboard shortcuts as in `e2e/specs/shortcuts.spec.ts`, single and continuous layouts,
  rotation, go to page, page labels, thumbnails.
- Prefetch of neighbouring sheets and background thumbnails.
- Disk cache for thumbnails and page costs.
- Benchmark marks (`--bench`) from day one.

**Exit:** the full corpus opens and renders correctly; the comparison with the current app run on
the raster path alone (this already measures native vs wasm and multi-core vs one core).

### Phase 2: the GPU scene

**Size: L (6 to 8 weeks).** The core of the plan.

1. Scene format and builder (merge, instance, pre-clip, downsample, drop) on the scene workers.
2. Spatial index, LOD levels and simplification with tone preserved.
3. GPU pipelines: strokes (widths, hairlines, caps, joins, dashes), fills, stencil clips, images,
   text (glyphs or the raster text layer), layers.
4. Overview pyramid and the per-cell density switch.
5. Path choice per page and zoom, per-frame budgets, GPU tiers.
6. Fidelity check and per-page fallback.
7. Disk cache for scenes, pyramids and verdicts.
8. Layers panel (on/off) using the scene's layer bits.

**Exit:** targets T2 to T7 and T9 met on the reference laptop for every corpus file that passes the
fidelity check; at least 95% of corpus pages pass it; regression gates switched on.

### Phase 3: own content parser experiment (gated)

**Size: L (3 to 5 weeks), only if Phase 2 shows first-open time (T2/T3) is limited by PDFium's
parse.** Our own interpreter for the content stream subset engineering drawings use (paths,
painting, clipping, graphics state, colour, Form XObjects, images, text with TrueType/CFF/Type1
fonts), with SIMD tokenising, parallel decompression, chunked parallel parse of one page, and
streaming display. Every page it handles is still checked against PDFium; anything it does not
support goes to the PDFium extractor. Kept only if it beats source A by a clear margin on the corpus.

### Phase 4: Rectangle and Text markups

**Size: M to L (2 to 3 weeks).**

- Model, store, undo and redo (`seq` numbering as `MarkupStore.add`).
- Select tool: click, Shift/Ctrl+click, box select, move (drag, arrows), 8 resize handles, delete,
  copy and paste, locked markups.
- Rectangle tool: drag, Shift for squares, defaults from `TYPE_INFO.rect` in
  `packages/markup/src/types.ts`.
- Text tool: click or drag to place, in-place editing with IME, wrapping with Helvetica metrics so
  the screen, the saved appearance and Revu agree, double-click to edit.
- Properties panel: colour, fill, fill opacity, width, opacity, font size, alignment, comment.
- Import on open and incremental save, as in [Markups](#markups); prompt on unsaved changes.

**Exit:** round trips in every direction pass (see [Testing](#testing)); a person confirms the
saved files in Bluebeam Revu; markups add no measurable cost to pan and zoom on a heavy sheet.

### Phase 5: Windows integration and packaging

**Size: M (1 to 2 weeks).** Per-user MSI (`cargo-wix`) with `pdfium.dll` (or the static build);
installs side by side with the Electron app (different name, folders and settings); "Open with"
association; single instance over a named pipe, like `apps/desktop/src/pdf-args.ts`; signing if the
certificate is available; local crash logs and minidumps, never sent anywhere, as
[PRIVACY.md](../PRIVACY.md) promises; a CI job that builds the MSI as an artifact.

### Phase 6: the comparison report

**Size: M (1 to 2 weeks).** See [The comparison with the current app](#the-comparison-with-the-current-app).

### Phase 7: decision

**Size: S.** With the report: **port** (carry measurements and takeoff over next, with the
TypeScript tests in `packages/markup` and `packages/measure` as the specification), **hybrid**
(if most of the gain turns out to be the engine and the pool, put native PDFium behind the existing
interface), or **stop** (keep the benchmark harness for the current app).

## Performance engineering practice

- **A benchmark for every target.** Each of T1–T13 is a scenario in `rc-bench`, run on the corpus.
- **A dedicated performance machine.** A self-hosted Windows runner with fixed hardware (the
  reference laptop class), power settings locked, nothing else running. Hosted CI runners are too
  noisy for performance numbers.
- **Regression gates.** From Phase 2, every PR touching `rust/` runs the heavy scenarios on that
  machine; a median more than 5% slower than the base branch, outside the run-to-run noise
  measured for that scenario, fails the check with the trace attached.
- **Profiles on demand.** `--trace` writes a `tracy` capture or an ETW trace; slow frames over
  budget are logged with their zones in `--diag` builds.
- **Micro-benchmarks.** `criterion` benches for the hot loops: tokenising, extraction per segment,
  simplification, tessellation, culling, cache reads.
- **PGO.** Release builds are trained on the heavy corpus with `cargo-pgo`; the gain is measured,
  not assumed, and kept only if it holds.
- **Check the GPU, not just the CPU.** PIX captures for the stroke and fill pipelines on integrated
  and discrete GPUs; GPU time per frame reported next to CPU time.
- **Scaling curves, not single numbers.** Every engine change is checked on the synthetic sheets
  from 10k to 10M segments, so a change that helps the middle but hurts the extremes shows.

## The comparison with the current app

### What is compared

1. **Electron:** the current desktop app, latest release, render copy off and on (labelled).
2. **Native, raster only:** the Rust app forced to the raster path (Phase 1). Measures native PDFium
   and multi-core rendering with the same drawing method.
3. **Native, full:** scene, pyramid and caches (Phase 2).
4. **Engine only:** wasm and native PDFium with no UI.

Together these say where each gain comes from: the engine, the cores, the GPU scene, or the cache.

### Metrics

Every target T1–T13, plus: frame time distributions (p50, p95, p99, frames over 8.3, 16.7 and
33 ms) through scripted pans and zooms at five zoom levels; peak and steady memory summed over
each app's process tree (Electron has several processes; so does the native app's pool); CPU time
per scenario; energy on battery for a scripted 5-minute session (Windows energy estimation);
installer and installed size; and scaling curves of T3, T5 and T11 against segment count.

### Timestamps

Both apps get a `--bench <file.jsonl>` flag writing one JSON line per event (`window-shown`,
`doc-opened`, `first-paint`, `page-sharp`, `zoom-sharp`, `markup-drawn`, `save-done`,
`thumbs-done`) with time from process creation, and the same events as ETW markers. "Sharp" means
every visible part of the page at full detail for the current zoom, presented. The change to the
current app is a small separate PR that only acts when the flag is passed.

### Driving the scenarios

`rc-bench drive` sends the same `SendInput` script to either app (window at a fixed position and
size, same DPI), with PresentMon capturing frame times. 20 runs per app per file per scenario,
alternating apps, one discarded warm-up. Cold runs flush the file from the standby list first; warm
and cached runs are labelled as such. Results are medians with interquartile ranges and the
native/Electron ratio with a 95% bootstrap interval; a difference is only called a difference when
the interval excludes 1.

### Files

| File | Why |
|---|---|
| `e2e/fixtures/*.pdf` | Small and public: anyone can rerun them |
| Synthetic sheets from `rc-bench gen`, 10k to 10M segments | Scaling curves, publishable |
| AutoCAD sheet with SHX text and dense hatching | Stroked text and hatch forms |
| Revit floor plan, A0 | Typical architectural export |
| Civil sheet with an aerial image underlay | Large images under vector work |
| MEP sheet with hundreds of layers | Layers and clipping |
| A 300-sheet drawing set | Page changes, prefetch, thumbnails, memory over time |
| A scanned set | Image decode, raster-only pages |
| A sheet with Bluebeam markups | Annotation import and the annotation layer |

Files that are not ours to publish stay outside the repository; the report lists their SHA-256
hashes and describes them.

### Machines

The reference laptop and reference workstation above, plus a low-end machine (8 GB, older
four-core CPU) if possible, each with full specifications in the report: CPU, cores, RAM, GPU and
driver, disk, Windows build, display resolution, scale and refresh rate, power plan. Optionally
Bluebeam Revu timed by hand on the same files, labelled as manual timings.

### The report

`docs/benchmarks/native-vs-electron.md`: method, machines, files and hashes, raw CSVs, tables,
scaling charts, and plain conclusions, including where native is not better. Published with its
files and hardware, as the README asks of any performance claim.

## Testing

| Level | What |
|---|---|
| Unit and property | Coordinate maths at every rotation, quantisation round trips, culling, LOD tone preservation, hit testing, JSON |
| Scene vs PDFium | Every corpus page: the fidelity check at fixed zooms, results stored; a page that used to pass and now fails is a test failure |
| Raster parity | Native PDFium renders vs the wasm build within the render-bench threshold |
| Cache | Write, read back, file changed, file moved, cache corrupted, version mismatch: all safe |
| Process pool | Worker crash mid-render, out of memory, hung worker: the app keeps going |
| Allocation | No allocations per frame in the steady state |
| Round trips | Rust → Rust, current app → Rust (files from `exportWithAnnotations`), Rust → current app (through `importAnnotations`), unknown data kept byte for byte |
| Bluebeam | Manual checklist each release |
| Performance | The regression gates above |
| UI smoke | `rc-bench drive` scripts on the fixtures: open, zoom, draw, type, save |

## CI

A new workflow, `.github/workflows/rust.yml`, for changes under `rust/`, on `windows-latest`:
fetch PDFium (pinned, hash checked), `cargo fmt --check`, `cargo clippy -- -D warnings`,
`cargo test`, `cargo deny check`, and the MSI on manual runs. Plus the performance job on the
self-hosted runner from Phase 2. Per [the PR workflow](../.claude/skills/pr-workflow/SKILL.md),
adding workflows needs explicit human approval.

## Security and privacy

- **PDFium outside the main process.** Today a malicious PDF meets PDFium inside wasm inside a
  sandboxed Chromium renderer. The worker pool keeps a process boundary: workers run with a
  restricted token (later an AppContainer), no network, and only the document mapping they are
  handed. A crash or exploit in PDFium lands in a worker.
- **Our own parser** (if built) handles untrusted input: no `unsafe`, fuzzed with `cargo-fuzz` on
  the corpus and PDFium's own test files, and every page still checked against PDFium.
- **The disk cache holds derived drawing data** (geometry, images, thumbnails) on the local disk.
  That is consistent with keeping documents on the device, but it is a copy: a setting turns it off,
  a button clears it, size and location are shown, and it is never synced anywhere.
- `cargo deny` and `cargo audit` on every push; PDFium version checked for security releases.

## Licences and notices

New code under Apache 2.0. PDFium is BSD-3-Clause with Apache-2.0 parts and its own third-party code
(FreeType, libjpeg-turbo, OpenJPEG, zlib, Skia if used); notices ship with the installer.
`cargo-about` generates the Rust crates' notices, merged by `cargo xtask notices` in the format of
`scripts/third-party-notices.mjs`. `deny.toml` accepts only licences compatible with Apache 2.0.

## Risks

| Risk | Likelihood | Effect | Response |
|---|---|---|---|
| The GPU scene does not match PDFium closely on some drawings | High on some pages | Pages that cannot use the fast path | Per-page fidelity check and raster fallback; fix the builder from the logged failures |
| Text glyphs cannot be read through PDFium's API | Medium | Text needs the raster text layer | Text layer first; own parser in Phase 3 if it matters |
| First open is limited by PDFium's parse, which we cannot parallelise inside a page | Medium | T2/T3 missed on the heaviest sheets | Raster first paint from the pool meanwhile; Phase 3 parser |
| Integrated GPUs or old drivers are slower than measured | Medium | Lower frame rates on some laptops | GPU tiers and budgets; overview pyramid at low zoom; raster path on software adapters |
| Memory of several PDFium processes on large files | Medium | Pool too small on 8 GB machines | Shared mapped file; pool size by memory; measured in Phase 0 |
| Disk cache invalidation bugs show stale drawings | Low | Wrong drawing shown: serious | Content-hash keys, versioned format, full hash check in the background, fidelity verdicts tied to the key |
| `egui` not suited to the full interface later | Medium | UI rewrite if the port goes ahead | All `egui` code in `rc-app`; the canvas is ours either way |
| The scope (an engine, not just a viewer) runs long | High | Later results | Phase 1 is useful and measurable on its own; Phase 3 is optional |
| Benchmarks favour one app by accident | Medium | Wrong conclusions | Alternating runs, cold caches labelled, render copy off and on, intervals not single numbers |

## Open questions

1. Can you share a set of real heavy drawings for the corpus, and which may be named in a published
   report?
2. Which machines are "reference"? The plan assumes a typical office laptop with integrated graphics
   as the main target; if most users have discrete GPUs, the budgets change.
3. Is a self-hosted Windows runner for performance gates possible (a spare laptop is enough)?
4. Is a background index of the whole set on first open acceptable (CPU and disk use while you
   work), or should it only happen on request?
5. Should the disk cache be on by default?
6. Windows 10 21H2+ and 11, or 11 only? Arm64 now or later?
