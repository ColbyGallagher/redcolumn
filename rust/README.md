# redcolumn for heavy drawings (Rust)

A native viewer for large engineering drawings, with Rectangle and Text markups, built to the
plan in [docs/RUST-PLAN.md](../docs/RUST-PLAN.md) (phases 1 to 4). Windows first; it also builds
and runs on Linux.

## How a page gets on screen

1. **Our own parser** (`rc-parse`) reads the page's content into vector items, in parallel for
   big content streams. Pages it cannot read go to **PDFium's page objects** (`rc-pdf`, in a
   pool of worker processes, since PDFium is not thread-safe).
2. **The scene** (`rc-scene`) turns them into GPU-ready data: line segments and triangles sorted
   into 128 pt cells, with clipping and dashes resolved. Scenes go to the **disk cache**
   (`rc-cache`), so the next open of the file skips steps 1 and 2.
3. **The GPU** (`rc-gpu`, wgpu) draws tiles from the scene in milliseconds at any zoom.
4. **The fidelity check** (`rc-check`) compares each new scene with PDFium's own render in the
   background. A page that differs is drawn by PDFium instead (the raster path), so the GPU
   path never shows a page wrong.

The viewer (`rc-view`) schedules all of this around the camera, and shows coarser tiles or a
preview until the sharp ones arrive. The app (`rc-app`) is egui on the same wgpu device.

Markups (`rc-markup`) use the TypeScript app's JSON. Saving (`rc-pdfwrite`) appends an
incremental update: Square and FreeText annotations with appearance streams, each carrying the
markup's JSON in `/NBData`, so either app reads the other's markups back exactly.

## Build and run

```sh
cd rust
cargo xtask fetch-pdfium            # the pinned PDFium build, into vendor/pdfium/
cargo run --release -p rc-app -- drawing.pdf
```

A release package needs `pdfium.dll` (or `libpdfium.so`) next to `redcolumn-rs.exe`; set
`RC_PDFIUM` to use one elsewhere.

Keys: Ctrl+O open, Ctrl+S save, V select, R rectangle, T text box, Ctrl+Z / Ctrl+Y undo and
redo, Ctrl+C / Ctrl+V copy and paste, Del delete, Ctrl+0 fit page, Ctrl+2 fit width, Ctrl+1
actual size, Ctrl+wheel zoom, middle drag or Space+drag pan, Ctrl+R rotate, PgUp/PgDn pages,
F12 diagnostics.

## Comparing performance

```sh
cargo run --release -p rc-bench -- gen sheet.pdf --segments 3000000   # a heavy test sheet
redcolumn-rs --bench sheet.pdf --bench-out timings.jsonl
```

`--bench` opens the file, waits until the page is sharp, zooms in 4×, pans, and writes one JSON
line per event (`first-paint`, `page-sharp`, `zoom-sharp`, `pan-sharp`, then `done` with the
page's parse, build and upload times) and exits. Run it twice to see a cold and a warm (disk
cache) open. `rc-bench parse|scene|render FILE` time the stages alone.

Settings live in `%APPDATA%\redcolumn-rs\settings.json` (Settings menu): our parser, GPU scenes,
the fidelity check and the disk cache can each be turned off to compare. On a software GPU
adapter (WARP, llvmpipe) pages use the raster path; `RC_FORCE_SCENES=1` draws scenes anyway.
`RC_PDF_APPEARANCES=1` shows markups as PDFium draws their saved appearances.

## Tests

```sh
cargo test --workspace
```

Besides unit tests: `rc-check`'s fidelity test (every fixture and generated sheet, both
parsers, against PDFium), `rc-view`'s viewer test (open, zoom, rotate, layers, the disk cache,
reopen), and `rc-pdfwrite`'s round trip (save, read back with our parser and PDFium, check where
PDFium draws the markups, edit, delete, save again).
