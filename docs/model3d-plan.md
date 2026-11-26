# Issue 191: IFC 3D viewer linked to geo-registered drawings

## Context
Issue #191 asks for a 3D model viewer with a two-way overlay between models and drawings: open and navigate a model, put drawings on the model, put the model on drawings, adjust alignment, and link elements to drawings in both directions. The user's extra requirements:
- IFC opens like any other file, in a document tab in the same stage area as PDFs.
- New **3D sidebar tab** and a new **3D ribbon tab**. Properties can go in a second (right) sidebar.
- Expose That Open's 3D navigation features.
- When models and drawings are both geo-aligned, **markups appear in both**:
  - Drawing markups show in 3D as a textured **sheet plane** at an elevation, or **draped** on the model surface (toggle per overlay).
  - Markups made in 3D are **BCF topics/viewpoints**. Each one is mirrored as a normal PDF markup on every aligned sheet.
- Works on web and desktop. Delivered as a full stack of PRs.
- **Hard constraint:** no extra weight or slowdown on the PDF path.

**Library: That Open Company (agree).** Use `@thatopen/components` 3.6, `components-front` 3.6, `fragments` 3.6 (MIT), `web-ifc` 0.0.80 (MPL-2.0, ~1.7 MB wasm; we only have to publish changes we make to web-ifc itself), three ≥0.182 and camera-controls.
- It covers orbit, first-person and plan cameras, perspective/ortho, fit, clipping with section fills, storey plans and elevations, highlight/hover/outline, hide/isolate, classifier, properties, spatial tree, length/area/angle/volume measurement, grids, postproduction, BCF topics/viewpoints, markers and multi-model federation.
- Gaps:
  - It does **not apply IfcMapConversion**. We do that with our own parser.
  - It has no minimap.
  - The view cube is a Lit component, so we build our own small one.
- Rejected alternatives: xeokit is AGPL. The legacy IFC.js viewer is dead. Plain three + web-ifc means rebuilding culling, selection and BCF ourselves.

## Architecture
- **Isolation:** new package `packages/model3d` holds every three, @thatopen and web-ifc import. The web app reaches it only through `apps/web/src/model3d/host.ts`, which does `await import('@nb/model3d')`. Pure geo maths goes in `packages/measure`, so it can be tested without three.
- **Assets:**
  - web-ifc.wasm and the fragments worker are copied to `/model3d/` and served locally. Set `autoSetWasm` off so nothing loads from unpkg.
  - Excluded from the PWA precache (`vite.config.ts` ~142-177: `globIgnores: ['model3d/**']`) and given a CacheFirst runtime cache instead.
  - A "Make 3D available offline" button, like the OCR one.
- **Tabs:**
  - `OpenFile` (App.tsx:269) becomes `OpenTab = OpenPdf | OpenModel` with a `kind` field.
  - Helper `pdfOf(tab)` guards the PDF-only paths. The `MarkupStore`-keyed WeakMaps (App.tsx:276-286) stay PDF-only.
  - A model tab mounts `<div class="model-stage">` with its own WebGL canvas inside `<main className="stage">` and hides the PDF canvas. `TileViewer` is not changed.
- **Render loop:** renders on demand. Pauses when the tab is inactive or `document.visibilityState` is hidden. Closing the tab disposes Components, the WebGL context, workers and textures.
- **Conversion:** IFC → fragments runs in a worker with progress and cancel. The resulting `.frag` is cached in OPFS keyed by the IFC hash, so reopening skips conversion. Above ~500 MB, warn and offer to load only some categories.
- **World frame:**
  - Everything is placed in MGA grid E,N + AHD height, using one whole-km origin per 3D session for float precision.
  - `modelToWorld = originOffset⁻¹ · ifcGrid · coordinationMatrix⁻¹`. `ifcGrid` comes from our IfcMapConversion reader. `coordinationMatrix` is That Open's `model.getCoordinationMatrix()`.
  - Drawings join the frame through their `/GEO` regions:
    - `importGeoRegions` in `packages/markup/src/geo.ts:86`, indexed in `sheets/indexer.ts:319,341`.
    - Page→lat/lon via `geoTransform` in `packages/measure/src/geo.ts:240`, plus a new grid→page inverse.
    - CRS via `packages/measure/src/crs.ts` (GDA2020 MGA zones).
- **Persistence:** a per-model Yjs sidecar store keyed by IFC hash holds BCF topics, overlay settings, alignment nudges and link records. `.bcfzip` handles import/export.
- **Flag:** the feature is behind `features.model3d`, and the rail entry is marked `experimental`.

## PR stack (each stacked on the previous)
1. **Bundle guard, no feature code.**
   - Turn on `build.manifest`. Add `scripts/check-bundle.mjs`.
   - Fail if the main entry's static graph contains three, web-ifc, @thatopen or camera-controls, or if main gzip grows >5% over the recorded baseline.
   - Add it to `pnpm verify` and CI (`.github/workflows/ci.yml`). Unit test it with fixture manifests.
2. **Tab union.**
   - `OpenTab` / `pdfOf` in App.tsx, guarding `showInPane`/`activateTab` (1820-1857) and the save, close and compare paths.
   - `DocTabStrip.tsx` shows an icon per kind. `storage/recents.ts` gets a `kind` field.
   - PDF behaviour must not change: existing unit and e2e tests pass untouched.
3. **Geo maths, fixture and scaffold.**
   - Extract `ifcGridTransform(entities)` from `parseIfc` in `apps/web/src/geospatial/ifc.ts` (~216-241), covering IfcMapConversion, the Scaled variant and units.
   - Add `packages/measure/src/frame.ts` (WorldFrame, `gridToPage`, `pageToGrid`).
   - Add `scripts/roadset/ifc.mjs` to generate a synthetic IFC4X3 Kestrel Road model: alignment, pavement and kerb solids, two RLs, MGA zone 56, matching the demo sheets' GEO regions. Synthetic data only, and it must pass `check:client-data`.
   - Scaffold `packages/model3d` with exact version pins.
4. **Open IFC end to end.**
   - Add `.ifc` to every list of openable file types:
     - `storage/diskHandles.ts` (147-151, 233-260) and the accept strings in App.tsx (10284/10296/10309).
     - `offline/manifest.ts`, `offline/launch.ts` and `desktop/tokens.ts`.
     - Desktop `allowlist.ts`, `paths.ts`, `pdf-args.ts` and `electron-builder.yml` (file associations).
   - `openStored` routes to `openModel()`.
   - Add `packages/model3d/src/session.ts` (Components, SimpleWorld, FragmentsManager, IfcLoader, OrthoPerspectiveCamera) and `apps/web/src/model3d/{host.ts, ModelStage.tsx}`.
   - Wire up the Vite asset copy and cache rules.
5. **3D ribbon tab.**
   - Contextual like `FORMAT_TAB` (Ribbon.tsx:250/640/1307), shown only when a model tab is active.
   - Groups:
     - Navigate: Orbit, First person, Plan, Persp/Ortho, Fit all/selection.
     - Views: storey plans via `Views.createFromIfcStoreys`, elevations.
     - Section: Clipper and ClipStyler.
     - Show: grids, outlines/postproduction.
     - Measure: length, area, angle, volume, with vertex/edge/face snapping (built in).
   - Section group also has a **section box**: 6 linked Clipper planes with drag handles, sized from BoundingBoxer around the selection.
   - Show group also has **Ghost/X-ray**: Hider plus opacity overrides, so isolating fades the rest instead of removing it.
   - **Civil readout** in the status bar and a pick tool. Raycast gives the MGA E/N/RL at the cursor, plus chainage/offset against the nearest IfcAlignment via CivilNavigators. This reuses the `geoAt` status-bar slot (StatusBar.tsx:112).
   - Groups spread horizontally and never scroll.
   - `model3d.*` commands in `appCommands.ts`, enabled only on model tabs. Own `ViewCube.tsx`.
6. **3D sidebar.**
   - Rail tab "3D" (LeftTab/LEFT_TITLES in MenuBar.tsx, RAIL and `sidePanel` in App.tsx, PanelId) with sections: Models (federation, visibility), Spatial tree, Classifier (isolate/hide/show all), Overlays and Issues.
   - Properties (ItemsData) is a separate `model3dProps` panel, docked right by default via `rightPanels`.
   - Selection is driven by Highlighter, Hoverer and Outliner.
   - **Views** section: a list of saved viewpoints, each storing camera, section box/planes, visibility and colour profile. Uses the Viewpoints component (BCF-compatible) and lives in the sidecar.
   - **Sets & colours** section:
     - Search sets: saved ItemsFinder property queries, with import/export (JSON).
     - Colour profiles: colour, hide or ghost by property value or by set, for example status or material by chainage. Built on Fragments material overrides, and a profile can be attached to a viewpoint.
7. **Model on drawing.**
   - Sheets with `/GEO` place the model's linework automatically through `placementFromGeoRegion` in `geospatial/align.ts`. Manual nudge (`GeospatialPanel.tsx` drag, rotate, 2-point fit) stays.
   - Linework comes from the existing three-free `parseIfc`, so a PDF tab never loads 3D.
   - Optional "section at RL" linework comes from the 3D session's EdgeProjector when a session is open.
   - Drawn by the existing `drawGeoOverlay` (MarkupTools.ts:2833).
8. **Drawing in model: plane and drape.**
   - Overlays list: sheet, mode (plane/drape), elevation (storey or RL), opacity and visibility.
   - Plane mode:
     - `PdfDocument.renderTile(..., {transparent, copy})` (pdf-core/engine.ts:390) renders the GEO bbox, capped at 4096².
     - Markups from `store.forPage()` are drawn onto the same canvas.
     - The quad corners go through `pageToGrid` into the world frame.
     - Re-render on `store.subscribe()`, debounced to 250 ms.
   - Drape mode: densify markup polylines, raycast down onto fragments, draw as Line2 with polygonOffset.
9. **Element ↔ drawing links.**
   - Model → drawing: a selected element's bbox centre goes to `findSheetsAt(E,N)` over the indexed GEO regions (filter by storey/discipline). A popover offers to open the sheet and jump to a temporary highlight ring.
   - Drawing → model: a "Find in 3D" context-menu action takes page → grid → a vertical raycast, then highlights and fits the hit element.
10. **BCF issues mirrored as PDF markups.**
    - BCFTopics and Viewpoints live in the sidecar store, with `.bcfzip` import/export.
    - Each topic becomes a plain cloud and callout markup, subject "BCF", on every aligned sheet whose GEO region contains the topic point. These are ordinary annotations, so other PDF apps keep them.
    - Linking: the markup's `custom.bcfGuid` points to the topic, and the topic stores `{fileHash, markupId}[]`.
    - A sync service copies title, status and position both ways, with loop prevention. Deleting asks: markup only, or the whole issue.
    - **Workflow fields:** assignee, status, priority, due date, labels/stamps and a comments thread, all native BCF topic fields, with filters in the Issues list. They map to the PDF markup's status and comments so the existing comment register Excel export and import (#343–#360) covers 3D issues too.
    - **Redline on viewpoint:** Marker pins, plus freehand/arrow/text on a frozen view, saved as the BCF snapshot image.
11. **Review tools.**
    - **Version compare:** load two revisions of one IFC and diff them by GlobalId plus a geometry/property hash. Added green, removed red, changed yellow, with a list. Computed in a worker.
    - **Quantities table:** group elements by any property, totalling count, length, area and volume from Fragments properties and the measure tools. Export to Excel with the existing xlsx path.
    - **Mini-map:** small plan inset with a camera marker, from a second ortho camera on the same scene, or the active sheet when one is GEO-linked.
    - **Walk mode:** first person with gravity (raycast down) and simple collision (raycast forward).
12. **Point clouds and checks.**
    - PointCloudLoader (LAS/E57/Potree) placed in the same MGA world frame, for survey and as-built overlay. Lazy-loaded inside model3d.
    - Optional IDS checking (IDSSpecifications) with a results list.
13. **View sync and wrap-up.**
    - "Sync view" toggle for a model in pane B next to a PDF in pane A: the plan camera ↔ the sheet's GEO region.
    - Help pages and screenshots in `scripts/help`.
    - Leak pass. Update `docs/ROADMAP.md:24`, which still says 3D is not practical in a browser.
    - MCP 3D tools are left for a later issue.

**Deferred (separate issues later):**
- Clash detection: hard; needs mesh intersection in a worker. Start bbox plus clearance.
- Min-distance between elements.
- 4D schedule sequencing.
- Animations/walkthrough recording.
- Sun/shadow rendering presets (ShadowedScene is easy whenever wanted).
- VR/WebXR.

Gap review against mainstream coordination viewers (done 2026-11-22): this plan now covers saved views, section box, search sets, colour profiles, civil coordinate/chainage readout, issue workflow, ghosting, snapping, version compare, quantities, mini-map, walk and point clouds. Drawing-in-model drape is a differentiator.

## Verification
- **Every PR:** `pnpm verify` (typecheck, unit tests, build, `check:bundle`, e2e web+desktop), using a distinct `E2E_PORT` when run in parallel.
- **Perf guard:**
  - `check:bundle` passes.
  - e2e asserts there are no `/model3d/` requests when only PDFs are opened.
  - `scripts/render-bench.mjs` / `bench-compare.mjs` stay within threshold against master.
- **Unit tests:**
  - `ifcGridTransform` against hand-computed MapConversion (plain and Scaled).
  - grid↔page round trip within 1 mm.
  - `placementFromGeoRegion` within 1 px.
  - `findSheetsAt`.
  - BCF↔markup sync with two Y.Docs.
  - `.bcfzip` round trip.
  - Section box from bbox.
  - Search-set query evaluation.
  - Version diff by GlobalId/hash on two fixture revisions (the generator emits rev A and rev B).
  - Chainage/offset against the fixture alignment within 1 mm.
- **e2e (Kestrel fixture):**
  - Open the IFC; the canvas is not blank.
  - Ribbon camera modes work.
  - Selection shows properties.
  - Overlays: plane and drape toggles, plus opacity.
  - Links work in both directions.
  - A 3D issue shows up as a sheet markup.
  - 20 open/close cycles show no WebGL context growth.
- **Desktop:** packaged smoke test via CDP (unit tests once missed a blank-window bug). Check the `.ifc` file association.
- **Manual (user):** a real exported IFC; the BCF markup round trip through another PDF markup app.
