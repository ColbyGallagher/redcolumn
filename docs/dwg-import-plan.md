# DWG import plan (issue #230)

Open a `.dwg` (or `.dxf`) in the browser, convert it locally to a vector PDF, and open that PDF
with the normal markup, measure and takeoff tools. No CAD editor, no CAD viewer, no upload.

## Requirements (from the issue)

| # | Requirement | How it is met |
|---|---|---|
| R1 | Drag-and-drop / file picker for DWG in the browser | `.dwg`/`.dxf` added to Open, drop targets, Combine and Insert Pages |
| R2 | Local conversion (WASM or browser-compatible) | TypeScript DWG reader + PDF writer, run in a Web Worker, lazy-loaded chunk |
| R3 | Keep vector linework, text, paper-space layouts, sheet sizes, scales | One PDF page per layout at its plot paper size; viewports clipped and transformed; `/VP` + `/Measure` per viewport |
| R4 | Open the result with existing tools | Converted bytes go through `openStored` like `imageToPdf` output does today |
| R5 | Original DWG untouched | Converted file saved as `<name>.pdf`; the DWG's disk handle is never remembered, so Save cannot write over it |
| R6 | Warn about missing xrefs, fonts, conversion issues | Conversion report with per-item warnings; option to supply reference files |
| — | Web first, desktop gets it for free | Same code path in Electron; no native converter |

## Key decision: the conversion engine

| Option | Licence | Verdict |
|---|---|---|
| LibreDWG compiled to WASM (e.g. `libredwg-web`) | GPL-3.0 | **Reject.** Bundling makes the shipped app a GPL combined work; repo is Apache-2.0. |
| ODA Drawings SDK (Web/WASM) | Commercial, paid membership, redistribution terms | **Reject** for now: cost, closed source, licence terms on a free app. Revisit only if our reader stalls. |
| Own TypeScript DWG reader, ported from ACadSharp (MIT) using the public Open Design Specification for .dwg | MIT source, Apache-2.0 result (add to `THIRD_PARTY_NOTICES.md`) | **Recommend.** Licence-clean, no WASM toolchain, fits the repo habit of own parsers (`ifc.ts`, `landxml.ts`, `dxf.ts`). |

Phase 0 confirms ACadSharp's licence, version coverage (target R2000–R2018: AC1015…AC1032) and
read-side size before committing.

## Architecture

```
File (.dwg/.dxf)
  └─ worker: cad/convert.worker.ts            (lazy chunk, never in the main bundle)
       ├─ readDwg(bytes) ─┐
       ├─ readDxf(text)  ─┴─> Drawing          (one in-memory model for both formats)
       ├─ plan(Drawing, options) -> SheetPlan[] (layouts, page sizes, viewports, scales)
       └─ writePdf(SheetPlan[]) -> PDF bytes + ConversionReport
  └─ main: openNewFile -> saveFile(name.pdf) -> openStored
```

New code under `apps/web/src/cad/` (or a `packages/cad` package if it grows past ~5k lines;
decide in phase 1):

- `drawing.ts` — the `Drawing` model: header vars (`$INSUNITS`, `$LTSCALE`, `$PSLTSCALE`,
  `$DWGCODEPAGE`, text defaults), tables (LAYER, LTYPE, STYLE, BLOCK_RECORD, DIMSTYLE), blocks,
  entities, objects (LAYOUT, PLOTSETTINGS, DICTIONARY, IMAGEDEF, XRECORD as needed).
- `dxf/` — full DXF reader to `Drawing`. Existing `geospatial/dxf.ts` stays as is (model-space
  linework for registration) or later becomes a thin view over the new reader.
- `dwg/` — DWG reader: file header and version detection, section map, R2004+ LZ77
  decompression and section decryption, R2007 page format, bit-stream decoding (BS/BL/BD/MC/
  handles), class map, object map, then objects to `Drawing`.
- `render/` — geometry: INSERT expansion (nested, scaled, rotated, MINSERT arrays, ATTRIBs),
  viewport transforms (view centre, height, twist, per-viewport frozen layers, clip polygon),
  arcs/ellipses/splines to Béziers, linetype dashing, hatch fill (solid + pattern lines),
  lineweights, ACI/true colour, text layout (TEXT, MTEXT with basic inline codes, ATTRIB).
- `pdf/` — pdf-lib writer: one page per layout; vector paths; text as real (searchable) text
  with embedded TTF; one optional-content group per DWG layer (works with `documents/layers.ts`);
  `/VP` arrays with `/Measure` so `importViewports` in `packages/markup/src/bluebeam.ts` picks
  the scale up with no new import code; page labels = layout names; source name/hash and
  converter version in document info.

### Fonts

SHX fonts are not ours to ship. v1 maps SHX and missing TTF styles to bundled Liberation fonts
(`apps/web/public/fonts/`) by width class (txt/simplex/romans → Sans, monotxt → Mono) and lists
each substitution in the report. Later: when the user supplies the drawing's folder (directory
picker / desktop), read `.shx` found there and draw glyphs as strokes, with invisible text on top
so search and OCR-free takeoff still work.

### Xrefs and images

Detected from BLOCK_RECORD xref flags and IMAGEDEF paths. The browser cannot read sibling files
unprompted, so the report offers **Add reference files** (multi-select or directory picker where
supported). Supplied xrefs are read with the same reader and inserted; missing ones draw nothing and
are listed by path. Raster images: embed when supplied, else warn.

### Scale

- Viewport scale = paper height / view height; snap to the nearest standard ratio within 0.5%
  and write it, else write the exact ratio and flag it.
- Model-space only (no layouts, or user picks Model): use the active PLOTSETTINGS scale; if it is
  "fit", warn that measurements need calibration.
- **Self-check:** for every DIMENSION in a viewport, measure its definition points through the
  written PDF scale and compare to the dimension's stored measurement. Mismatch > 1% → warning
  ("viewport 2 on A-101 measures 2% long"). This catches transform bugs and non-uniform scaling,
  and reuses the phase-0 scale-integrity work (`packages/measure/src/paper.ts`).

## Phases

Each phase is its own PR on the usual stacked flow (`pr-workflow` skill), behind an
**Experimental** toggle until phase 4.

### Phase 0 — Spike and fixtures (small)
- Confirm engine choice above; read ACadSharp's DWG reader to size the port.
- Fixture corpus: `scripts/make_cad_fixtures.py` writes DXF with ezdxf (MIT, dev-only, never
  shipped). The drawings use known sheet sizes and viewport scales, and the plan drawing reuses the
  Kestrel Road alignment from `scripts/roadset`. Each fixture has a manifest of expected values.
  DWG twins (R2000–R2018) come from the free ODA File Converter, installed by the developer
  (also dev-only). Real drawings supplied by users stay in `reference_data/`, uncommitted.
- Bundle budget: converter chunk target ≤ 400 kB gzip, loaded only on first DWG open.

### Phase 1 — Drawing model + DXF → PDF (medium-large)
- DXF reader to `Drawing`; renderer; PDF writer; layout/viewport/scale planning.
- Entities v1: LINE, LWPOLYLINE, POLYLINE (2D), ARC, CIRCLE, ELLIPSE, SPLINE, POINT, SOLID, TRACE,
  HATCH, TEXT, MTEXT, ATTRIB/ATTDEF, INSERT/MINSERT, DIMENSION (via its `*D` block), LEADER,
  MLEADER (basic), VIEWPORT, WIPEOUT, IMAGE (placeholder until phase 3).
- Skipped with a count in the report: 3D solids/meshes, proxy entities without graphics, TABLE
  (later: via its anonymous block), OLE.
- Unit tests per entity and transform; golden-PDF tests on generated fixtures (page size, path
  count, viewport `/Measure` values, OCG names).
- Ships DXF import on its own — useful immediately and de-risks everything but the binary reader.

### Phase 2 — DWG reader (large, main risk)
- R2000 (AC1015) first, then R2004 (AC1018, compression + section map), R2010–R2018
  (AC1024/27/32), R2007 (AC1021) last since it has its own page/encoding scheme.
- Older than R2000 → clear "save as a newer DWG version" error.
- Tests: every fixture's DWG reads to the same `Drawing` as its DXF twin (entity counts, layer
  table, layout list, extents within tolerance). Fuzz the bit reader with truncated files: must
  error, never hang (cap object count and decompressed size).

### Phase 3 — App integration (medium)
- Open, drop zones, `diskHandles.ts` picker types, Combine, Insert Pages, Library accept
  `.dwg`/`.dxf` (`App.tsx` around `openNewFile`, `components/CombineDialog.tsx`,
  `BulkInsertDialog.tsx`).
- `openNewFile`: like pictures, converted bytes ≠ raw so `rememberHandle` is skipped — add a
  test that Save on a converted file prompts Save As and never touches the `.dwg`.
- Convert dialog (shown when a file has >1 layout or warnings): layouts to include (default all
  paper-space layouts; Model if none), colour / greyscale / monochrome, lineweights on/off.
  Remember choices in settings.
- Progress + cancel (worker); large files stream page-by-page.
- Conversion report: a dismissible banner on open plus a panel listing warnings (missing xrefs,
  fonts substituted, skipped entities, scale self-check failures, unsupported version), with
  **Add reference files** and **Convert again**.
- Desktop: optional `.dwg`/`.dxf` file association in `apps/desktop/electron-builder.yml`.

### Phase 4 — Fidelity and polish (medium)
- Raster diff of converted pages vs reference plots (reuse the compat harness approach in
  `reference_data/`), tracked per fixture, threshold in CI only for generated fixtures.
- SHX glyph rendering from user-supplied fonts; MTEXT columns/stacking; TABLE; field text;
  annotative scale handling; plot style tables (.ctb/.stb) when supplied.
- Help page + screenshot (`scripts/help`), e2e web + desktop (open DWG → page count, scale shows
  on hover, measure a known length), `docs/compatibility.md` entry, remove Experimental flag.

## Risks

- **DWG breadth.** Format is large and versions differ; mitigated by DXF-first, DXF-twin tests,
  and shipping R2000/R2018 before the rest.
- **Visual fidelity** (fonts, hatch patterns, linetypes, plot styles) will lag a CAD plot. The
  issue asks for "basic support for common 2D construction drawings"; set that expectation in
  the help page and report.
- **Memory** on 50+ MB drawings: worker, transferables, per-layout rendering, hard caps with a
  clear error.
- **Hostile input:** parser runs in a worker with object/size caps; output PDF has no
  JavaScript or actions.

## Notes

- Commits and PRs: describe the feature by format (DWG/DXF), not by competitor product names.
- Add ACadSharp (MIT) to `THIRD_PARTY_NOTICES.md` once code is ported.

## Phase 0 findings (2026-11-05)

**ACadSharp** (github.com/DomCR/ACadSharp): MIT, actively maintained (v3.8.35, 2026-10-28).
Its DWG reader handles AC1014–AC1032, which covers R14 to R2018 (our target is R2000+).
- Read side to port: 42 C# files, about 520 kB (roughly 13k lines). The bulk is
  `DwgObjectReader*.cs` (330 kB) and `DwgHeaderReader.cs` (37 kB). We also need the two
  LZ77 decompressors (AC18 and AC21), the AC21 Reed-Solomon page decoding and CRC.
- We need only a subset of the object reader, because we render and never round-trip. Skip
  3D solids (ACIS), most dictionaries and objects, and writers. Estimate: 6–8k lines of
  TypeScript.
- Bundle estimate: about 200 kB minified, 60 kB gzip, as its own lazy chunk. That is well
  inside the 400 kB budget.

**Fixtures:** `scripts/make_cad_fixtures.py` writes 5 DXF drawings plus a manifest of
expectations to `apps/web/test/fixtures/cad/` (see the README there), plus 30 DWG twins
(R2000–R2018). In total that is 2.3 MB. The DXFs are byte-for-byte reproducible; the ODA
twins are not (timestamps). `--check` checks the DXFs against the manifest and every twin
against its DXF. All pass.

Lessons for the converter:
- **Undeclared layers are normal.** ezdxf puts layout viewports on a `VIEWPORTS` layer it
  never adds to the layer table, and ODA silently adds it. The reader must create missing
  layers with defaults, not fail.
- **Layout order is not table order.** ODA writes Model last. Order pages by each LAYOUT's
  tab order, never by the order of the dictionary or objects.
- ODA File Converter 27.x installs to a versioned folder
  (`C:\Program Files\ODA\ODAFileConverter 27.10.0\`) that ezdxf does not search. The script
  finds it.
- ezdxf's renderer is good enough as a second opinion (page sizes, viewport placement and
  scale look right on every fixture), but it is not ground truth for clipping or hatch
  islands. Real CAD plots remain the reference for phase 4.

## Phase 1 status (2026-11-05)

DXF to PDF works end to end in `apps/web/src/cad/`. It is a library only; nothing in the app
calls it until phase 3.

| File | Role |
|---|---|
| `drawing.ts` | The `Drawing` model and group-code helpers |
| `dxf.ts` | ASCII DXF reader (UTF-8 / code-page decoding, sections, tables, blocks, layouts, image defs) |
| `geom.ts` | Affine maps, OCS, arcs and bulges as Béziers, B-splines |
| `text.ts` | `%%` codes, `\U+`, MTEXT formatting to plain paragraphs |
| `render.ts` | Entities to page primitives: properties (BYLAYER/BYBLOCK, layer 0), linetypes as PDF dashes, lineweights, blocks/MINSERT/attributes, dimensions, hatches (solid, pattern lines clipped even-odd), text |
| `sheets.ts` | Pages: layouts at plot paper size, viewports (twist, frozen layers, clip), scales snapped to standard ratios, model-space page fitted to A0 |
| `pdf.ts` | pdf-lib writer: one PDF layer per CAD layer, searchable text in subset Liberation fonts, `/VP` + `/Measure`, page labels |
| `convert.ts` | `convertCad(name, bytes, { fonts, layouts, includeModel, colorMode, lineweights })` → PDF bytes plus a report |

`convert.test.ts` checks every fixture against `manifest.json`: page names and sizes,
viewport ratios, twist and frozen layers, non-plotting layers, expected warnings, and text. It
also reads the written scales back through the viewer's own `importViewports`. All five
fixtures convert in 10–140 ms.

Notes:
- The dimension scale check uses the measurement a dimension records (group 42). ezdxf does
  not write it, so the fixtures test the same thing another way: each dimension measured
  through its viewport's scale must equal the manifest's length.
- Not yet drawn: MLEADER, WIPEOUT, linetype shapes and text, arrowheads on LEADER, polyline
  widths that vary along a segment, raster images (a frame stands in), non-rectangular viewport
  clips other than LWPOLYLINE, and plot style tables. Each skipped entity type is counted in
  the report.

## Phase 2 status (2026-11-05)

DWG R2000 to R2018 (AC1015–AC1032) reads into the same `Drawing` as DXF, in
`apps/web/src/cad/dwg/`, ported from ACadSharp (MIT; notice in `THIRD_PARTY_NOTICES.md`).
`convertCad` takes `.dwg` as well as `.dxf`, and tells them apart by content.

| File | Role |
|---|---|
| `bits.ts` | Bit reader: B/BB/BS/BL/BLL/BD/DD/RD, MC/MS, handles, TV (code page before R2007, UTF-16 after), CMC/ENC colours, object type, the R2007+ string stream |
| `container.ts` | R2000 section locators; R2004/R2010/R2013/R2018 encrypted header, page map and section map, encrypted data pages |
| `lz77.ts` | R2004+ page decompression |
| `r2007.ts` | R2007: Reed-Solomon de-interleaving, its LZ77 variant, page and section maps |
| `header.ts` | Header variables walked in order to INSUNITS (LTSCALE, TEXTSIZE, PSLTSCALE, INSUNITS) |
| `objects.ts` | Common object and entity data, then every entity the renderer draws, plus LAYER, LTYPE, STYLE, BLOCK_HEADER, LAYOUT (with plot settings) and IMAGEDEF, written out as DXF group codes |
| `index.ts` | Classes, handle map, objects, then the `Drawing`: tables, blocks in drawing order (owned lists from R2004, the entity chain in R2000), layouts, viewport ids |

Verified:
- All 30 DWG copies (5 fixtures × R2000, 2004, 2007, 2010, 2013, 2018) read with the same
  entities per layout, layers and layouts as their DXF.
- They pass the same manifest tests, and their PDFs render pixel-identical to the DXF ones.
- Fuzzing (truncation, and 900 random corruptions across versions) either reads, counting
  objects it could not read, or refuses with a `CadReadError`. Nothing hangs: the worst case
  took 22 ms. Decompressed sizes are capped relative to the file size.

Not yet:
- R14 and older are refused with a message to resave.
- Objects read by type only (and counted when drawn): MLEADER, WIPEOUT, ACAD_TABLE (as an
  entity), proxies, OLE and 3D solids.
- Multi-line attributes are read as single-line text.
- The test files all come from ODA File Converter. Real AutoCAD drawings, especially large
  ones, still need checking for speed and fidelity (phase 4).

## Phase 3 status (2026-11-06)

DWG and DXF open in the app, on web and desktop, labelled Experimental.

**Where drawings open:** File › Open (system picker and file input), drag and drop, Combine,
Bulk Insert and Insert Pages all take `.dwg`/`.dxf`.
- Conversion runs in a worker (`cad/convert.worker.ts`, via `cad/client.ts`), as a job in the
  jobs bar that can be cancelled.
- The worker chunk loads only when a drawing is opened.
- Fonts are fetched from `public/fonts`.

**What the user sees:**
- **The PDF:** it opens as `<name>.pdf`, with every paper-space layout as a page (model space
  when there are none). It uses the colour and lineweight options last chosen
  (`cadColorMode`, `cadLineweights` in settings).
- **Report bar** (`CadReportBar`), over a PDF converted in this visit: a one-line summary,
  Details (each warning in plain words), Convert Again… and Close.
  Document › Convert Drawing Again… (Experimental) brings it back after Close.
- **Convert Again** (`CadConvertDialog`): which layouts become pages, model space, colour /
  greyscale / black, lineweights, and **reference drawings**. Reference drawings are DWG/DXF
  files matched to the drawing's xrefs by file name and drawn in place, with their own tables.
  The result opens as a new PDF.

**The original is never written:**
- On the web, a converted PDF's file handle is never remembered, so Save goes to a new PDF.
- On desktop the main process refuses to write any `.dwg` or `.dxf` path (`isWritable` in
  `allowlist.ts`), even through Save As onto one.
- Desktop also gains `.dwg`/`.dxf` in the Open dialog, drops, launch arguments and file
  associations (Viewer role, never the default handler).

Verified:
- Unit tests: converter 46 (references, layout list), desktop 94 (drawings openable, never
  writable, launch arguments).
- `e2e/specs/cad-import.spec.ts`: 4 tests, passing in web and desktop. They cover open with
  scales, Save writes a new PDF and leaves the DWG byte-identical, a missing reference then
  supplied through Convert Again, one-layout Convert Again, and a damaged file.
- Checked by hand in the browser preview.

Not yet: raster images in drawings are not embedded (a frame stands in). The conversion and
its report are kept for the visit only. The worker chunk is 1.2 MB (531 KB gzip); most of it
is pdf-lib and fontkit, which the app already loads but a worker cannot share. That is over the
400 KB budget set in phase 0.

## Phase 4 status (2026-11-06)

Checked against real drawings: 393 files, of which 183 are unique drawings (the rest are
copies or Git LFS pointers). There are 133 R2018, 42 R2000 and 8 R2013. They stay outside the
repo.

`pnpm cad:corpus <folder> [--pdf]` converts each drawing in its own thread with a timeout and
writes `corpus.json` and `corpus.md` (to `reference_data/cad-corpus`, not committed).

Result: **183 of 183 convert**, median 250 ms, slowest 6.2 s (a 16 MB 3D model).

Fixed from real drawings:
- **Handle map sections over 2032 bytes:** the CRC follows the last entry. This was misread,
  and 35 drawings failed.
- **R2018 multi-line attributes:** their MTEXT carries its own entity properties. 336 objects
  in one drawing were unreadable.
- **Model space rotation:** model space plots turned by the active view's twist, as AutoCAD
  plots it.
- **Units:** unitless drawings at survey grid coordinates are taken as metres (they were
  measuring 1000× wrong) and reported.
- **"As plotted" colour (the new default):** monochrome and grayscale plot style tables plot
  black and grey.

Newly drawn:
- wipeouts, as white masks;
- tables, via their block (DWG too);
- multileaders: leader lines, landing, arrowheads, text or block content;
- polyface meshes, as visible face edges;
- **pictures, PNG/JPEG supplied in Convert Again**, embedded and drawn across the image;
- **plot style tables (.ctb) supplied in Convert Again**, giving each ACI colour its plotted
  colour, greyscale, screening and lineweight. A page setup naming a table that wasn't
  supplied is reported. 26 layouts in the set name one.

Narrow fonts (Arial Narrow) are squeezed to their width. A plotted cover sheet compared with
its conversion (with its `.ctb`): layout, linework and text match within about 2%.

New fixtures `masks` (wipeouts, polyface) and `leaders`, with DWG copies. Converter tests: 68.
Help: Getting Started › Open a DWG or DXF drawing, with screenshots.

Still not drawn: REGION (27 drawings; the outlines are stored as 3D-modeller (ACIS) data), 3D
solids, surfaces and bodies, OLE frames, and colour set inside MTEXT. CAD fonts are substituted
(no SHX rendering). The Experimental label stays until these drawings have been checked in use.

## Decisions (2026-11-05)

1. Engine: port the DWG reader from ACadSharp (MIT). No LibreDWG, no ODA SDK.
2. Model space: not a page when layouts exist. It is an opt-in in the Convert dialog, and the
   only page when a drawing has no paper-space layouts.
3. Fonts: v1 substitutes bundled Liberation fonts for SHX and lists each substitution.

## Ported from the external compatibility contribution (#246)

Zero-area models get a positive sheet with stroke clearance. MTEXT inline heights (`\H`, braces)
are kept as runs and drawn at their own size; wrapped or inline-styled text in a model sheet that
would leave the computed page is refused rather than cropped. DXF straight leaders draw the
default closed-filled arrowhead from DIMSTYLE size and scale; custom or unavailable styles and
spline paths are reported by name. The DWG reader keeps the leader flags and geometry but does
not decode DIMSTYLE yet, so DWG leader arrowheads are reported as "style unavailable".
Optional pinned external checks are in `apps/web/test/fixtures/cad/README.md`; no external
drawings are committed.
