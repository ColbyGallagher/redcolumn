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

## Decisions (2026-11-05)

1. Engine: port the DWG reader from ACadSharp (MIT). No LibreDWG, no ODA SDK.
2. Model space: not a page when layouts exist. It is an opt-in in the Convert dialog, and the
   only page when a drawing has no paper-space layouts.
3. Fonts: v1 substitutes bundled Liberation fonts for SHX and lists each substitution.
