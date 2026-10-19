# Handoff: Rust viewer for heavy drawings (redcolumn)

## Where things are
- Repo `ColbyGallagher/redcolumn`, branch `ccr-45f9c4ec-jh426b`, draft PR #95 (https://github.com/ColbyGallagher/redcolumn/pull/95). Head is `823ee8b`.
- PR state when handed off:
  - All CI is green on Windows and Linux.
  - The branch merges cleanly with no conflicts.
  - There are no review comments.
- PR #95 is waiting on the user: a review, plus explicit approval of `.github/workflows/rust.yml`, because the repo's pr-workflow skill requires human approval for changes under `.github/`.
- The plan is `docs/RUST-PLAN.md`. The user said **not to change it**.
- The user asked for phases 1–4 of that plan. All four are built, in `rust/`.

## What was built (`rust/crates/`)
- `rc-pdf`: a pool of PDFium worker processes. The same exe runs as a worker when started with `--rc-pdfium-worker`. Requests and replies are JSON lines, and page data is passed through shared memory.
- `rc-parse`: our own PDF parser. It reads content streams (large ones in parallel), fonts, images, layers (optional content) and annotations.
- `rc-scene`: turns page content into GPU-ready data: line segments and triangles sorted into 128 pt cells, with clipping and dashes resolved.
- `rc-gpu`: the wgpu 30 renderer. Lines get analytic coverage, with 4× MSAA.
- `rc-check`: the fidelity check. It compares the GPU scene against PDFium's own render; a page that fails falls back to PDFium raster.
- `rc-cache`: the disk cache for scenes and check verdicts.
- `rc-view`:
  - `viewer.rs` is the core: page loading (cache, then our parser, then PDFium), tiles with fallbacks, prefetch, the background fidelity check, and a per-frame GPU time budget for drawing tiles.
  - `layout.rs` and `tiles.rs` hold the layout, camera and tile maths.
- `rc-markup`: Rectangle and Text markups.
  - Same JSON as the TypeScript app's `Markup`; unknown fields are kept in `extra`.
  - A store with undo/redo, geometry, Helvetica text layout, and import from `/NBData` or from Square/FreeText annotations.
- `rc-pdfwrite`: saving as an incremental update.
  - Square and FreeText annotations with appearance streams, plus `/NBData`.
  - Writes an xref table or an xref stream to match the file, chained with `/Prev`.
  - Replaces the file atomically, with `ReplaceFileW` on Windows.
- `rc-app` (binary `redcolumn-rs`):
  - egui 0.37 / eframe running on the renderer's wgpu device.
  - Menus, thumbnails, layers, a markups list, properties, a status bar, F12 diagnostics, settings and recent files.
  - Tools: Select, Rectangle and Text (keys V, R, T).
  - `--bench FILE --bench-out x.jsonl` writes timing events: `first-paint`, `page-sharp`, `zoom-sharp`, `pan-sharp`, then `done`.
- `rc-bench`: `gen|parse|scene|render` tools for generating test sheets and timing each stage.
- `rust/README.md` explains how to build, run and benchmark.

## Build and test
```sh
cd rust
cargo xtask fetch-pdfium          # puts PDFium in vendor/pdfium/<target>/ (dev builds find it there; release needs it beside the exe)
cargo test --workspace            # unit tests plus fidelity (rc-check), viewer (rc-view) and roundtrip (rc-pdfwrite)
cargo clippy --workspace --all-targets -- -D warnings ; cargo fmt --all --check
cargo build --release --target x86_64-pc-windows-gnu -p rc-app   # Windows cross-build (mingw is installed)
```
- The Windows test zip sent to the user is `redcolumn-rs.exe` + `pdfium.dll` + `rc-bench.exe` + a sample PDF + README.txt.
  - It is the stripped GNU build of `823ee8b`.
  - It needs only Windows system DLLs besides `pdfium.dll`.
- To run the app headless here, use Xvfb plus xdotool. xdotool was installed during the session (`apt-get install xdotool`) and is not part of the image, so reinstall it in a new container.
  1. Start `Xvfb :77`.
  2. Run `DISPLAY=:77 ./target/release/redcolumn-rs file.pdf`.
  3. Give the window focus with `xdotool windowfocus $(xdotool search --name redcolumn)`; without that, keystrokes don't arrive.
  4. Take screenshots with `import -window root`.
- Environment switches:
  - `RC_FORCE_SCENES=1` uses the GPU path even on a software adapter.
  - `RC_PDF_APPEARANCES=1` shows PDFium's saved appearances instead of our own markup drawing.
  - `RC_PDFIUM=path` overrides where the PDFium library is loaded from.

## Results so far
- Every test passes:
  - fixtures and generated sheets match PDFium from both sources (PDFium extraction and our parser);
  - the save round trip works on the 5 fixtures, an xref-stream file, and pages rotated 90/180/270, with PDFium drawing the markups in the right places.
- Our parser is about 2.5× faster than PDFium extraction: 1M segments in ~225 ms versus ~584 ms; 2.9M in ~670 ms versus ~1.75 s.
- Container timings are on llvmpipe (a software GPU) and mean nothing for real hardware. On a 1M-segment sheet:

  | Path | first paint | sharp |
  |---|---|---|
  | Raster | 1.5 s | 2.6 s |

  A warm open loaded the cached scene in 0.18 s, against about 1.3 s to parse and build it cold.
- **Real GPU numbers are still needed.** The user should run `--bench` on Windows and compare with the current desktop app.

## Deviations from the plan (stated in the PR)
- Form XObjects are expanded, not instanced on the GPU.
- The workers are not sandboxed.
- The tokenizer is a scalar loop, not SIMD.
- The overview pyramid is supersampled GPU tiles.
- Annotations are read with our parser rather than PDFium's annotation API.
- There is no password prompt; locked files only show a message.
- Saving reloads the markups from the file, so undo history is lost on save.

## Gotchas
- `FPDF_GetLastError` returns a C `unsigned long`, which is 32 bits on Windows. Use `c_ulong`, and don't let clippy "fix" the type.
- PDFium's segment types are LINETO=0, BEZIERTO=1, MOVETO=2.
- The container's disk fills quickly, because `rust/target` grows to about 20 GB. To free space, delete `target/debug/incremental` and the Windows debug build.
- Overlay tiles (PDFium drawing annotations and text over the GPU scene) are transparent. Their coarser fallback tiles must not be drawn once the sharp ones are in, or a blurry halo shows around markups.
- egui's Ctrl+wheel zoom is ×1.5 per notch, so the app uses `powf(0.5)`.

## Possible next steps
1. Get the user's `--bench` results from a real GPU and tune from them.
2. If the user wants it (it needs their approval), add a CI step that uploads the Windows zip as a build artifact.
3. A password prompt.
4. Keeping undo history across a save.
5. GPU instancing of Form XObjects.
6. Sandboxing the workers.
7. More markup types (phase 5 onward in the plan).
