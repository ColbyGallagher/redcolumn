# Plan: GitHub issues #241–#251

Reviewed 2026-11-07. Open issues in range: #241, #242, #243, #244, #247, #251 (the others are PRs).
Each item lists what the code does today, the fix, the files involved, the tests, and a size (S/M/L/XL).

## Order of work

| Wave | Items | Why first |
|---|---|---|
| 1 – quick fixes | #251 ribbon, #247.3 "Don't Save" keeps markups, #247.1 vertical align, #244.10 Thumbnails auto-open, #244.3 Space/right-click finish | Small, clear root causes; can run in parallel |
| 2 – takeoff accuracy and stability | #244.1 separate X/Y scale, #247.2 stuck "Loading page…", #244.2 crossing selection, #244.5 count on first click, #244.6 drag rectangle area | P1 bugs and daily-speed items |
| 3 – workflow features | #244.4 Resume, #244.9 Search → Count, #244.7/8 properties bar + Subject/Label/Layer, #242 blend modes | Medium features on existing infra |
| 4 – large features | #241 system fonts, #244.11 arcs in measurements, #243 decision | Model changes and PDF/Bluebeam compatibility work |

## Delegation: one Sonnet subagent per task

Each task below goes to one subagent (`Agent`, `model: "sonnet"`, `isolation: "worktree"`, `subagent_type: "general-purpose"`). The main session (the orchestrator) stays on Opus. It writes each brief, reviews the diff the agent returns, runs the checks again, and opens the PR. Large items are split into phases, so each agent gets a task it can finish and verify on its own.

### Rules every brief includes

- **Scope:** only this task's files (listed per task). Don't refactor unrelated code. If the fix needs files outside the list, stop and report back instead of widening the change.
- **Branch:** `claude/issue-<id>-<slug>` in the agent's own worktree. Commit there and **don't push or open a PR**; the orchestrator does that.
- **Tests first** where the task has acceptance criteria: write failing tests from the criteria in this plan, then fix.
- **Checks before reporting:** `pnpm typecheck` and `pnpm test` (the touched package at least). Add `pnpm e2e:web` with a unique `E2E_PORT` (port column below) when the task changes UI. Desktop-only tasks need the packaged desktop smoke test.
- **Commit messages:** describe the behaviour. Don't name competitor products. End with the Co-Authored-By trailer.
- **Report back:** branch, commit SHAs, files changed, what was tested and how, anything not verified, and any doubts about the cause.
- **Never:** comment on the GitHub issue, `git stash`, touch `reference_data/` PDFs, or change unrelated settings.

### Brief template

```
You are fixing GitHub issue #<n> (<part>) in the redcolumn repo (pnpm monorepo: apps/web, apps/desktop, packages/*).
Read docs/issues-241-251-plan.md, section "<section>", for the cause and fix. That is your spec.
Files you may change: <list>. Files you must not change: anything else (report back if you need to).
Acceptance criteria: <copied from the plan>.
Work on branch claude/issue-<n>-<slug>; commit, don't push. Run pnpm typecheck, pnpm test<, E2E_PORT=<port> pnpm e2e:web>.
Report: branch, SHAs, files changed, tests added and results, anything not verified.
```

### Task list

| Task | Section | Wave | Files (ownership) | Depends on | E2E_PORT |
|---|---|---|---|---|---|
| T1 ribbon grid | #251 | 1 | `styles.css` (ribbon rules), `Ribbon.tsx`, new e2e spec | – | 5181 |
| T2 Don't Save discards | #247.3 | 1 | `App.tsx` (`settleUnsaved`, recovery), new `RecoveredMarkupsBar`, `storage/fileStore.ts` | – | 5182 |
| T3 vertical align | #247.1 | 1 | `packages/markup/src/render.ts`, `export.ts` (text layout only), text editor overlay | – | 5183 |
| T4 Thumbnails on open | #244.10 | 1 | `App.tsx` (`revealPanel` call), `settings.ts`, `PreferencesDialog.tsx` | after T2 (both edit `App.tsx`) | 5184 |
| T5 finish keys | #244.3 | 1 | `MarkupTools.ts` (key/pointer finish), `settings.ts`, `PreferencesDialog.tsx` | – | 5185 |
| T6 X/Y scale | #244.1 | 2 | `packages/measure/*`, `MarkupTools.ts` (readouts only), `export.ts` (`/Measure`), `bluebeam.ts` (scale import), status bar | – | 5186 |
| T7 engine restart | #247.2 | 2 | `packages/pdf-core/src/engine.ts`, new supervisor in `apps/web/src/viewer`, `TileViewer.ts` (loading/error pill), desktop log | – | 5187 |
| T8 crossing selection | #244.2 | 2 | `MarkupTools.ts` (box/lasso gesture), `packages/markup/src/arrange.ts` (hit tests) | after T5 (`MarkupTools.ts`) | 5188 |
| T9 count first click | #244.5 | 2 | `MarkupTools.ts` (count gesture), `settings.ts` | **blocked: needs repro steps from the reporter** | 5189 |
| T10 drag rectangle | #244.6 | 2 | `MarkupTools.ts` (area/volume/perimeter gesture) | after T9, T6 | 5190 |
| T11 Resume | #244.4 | 3 | `MarkupTools.ts`, context menu in `App.tsx` | after T10 | 5191 |
| T12 Search → Count | #244.9 | 3 | `SearchPanel.tsx`, shared apply code from `VisualSearchPanel.tsx` | – | 5192 |
| T13a Markup Format tab on selection | #244.7 | 3 | `Ribbon.tsx` (`FORMAT_TAB`, auto-switch and return), shared/mixed style fields | after T14 (`PropertiesPanel.tsx`) | 5193 |
| T13b Subject/Label/Layer for selection + active tool | #244.8 | 3 | Format tab fields, `ToolBar.tsx`, `toolchest.ts` save-back | after T13a | 5194 |
| T14 blend modes | #242 | 3 | `style.ts`, `types.ts`, `render.ts`, `export.ts` (ExtGState), `import.ts`, `fdf.ts`, `bluebeam.ts`/`bsiLegend.ts`, `PropertiesPanel.tsx` | after T3 (`render.ts`/`export.ts`) | 5195 |
| T15a fonts: model + list + UI | #241 steps 1–3, 6 | 4 | `style.ts`, desktop font IPC (`apps/desktop/src`, allowlist), `ToolBar.tsx`, `PropertiesPanel.tsx` | after T13b, T14 | 5196 |
| T15b fonts: PDF embedding | #241 steps 4–5 | 4 | `export.ts` fonts, `archiveFonts.ts`, `revuWrite.ts`, `bluebeam.ts` font names | after T15a | 5197 |
| T16a arcs: X/Y measure | #244.11 step 2 | 2 | folded into T6 (PR #258) | – | – |
| T16b arcs: Ctrl+drag while drawing | #244.11 step 3 | 4 | `MarkupTools.ts` (multi-point gesture) | after T8, T11 | 5198 |
| T16c arcs: Ctrl+click smooth, Shift+click add/remove, help + changelog | #244.11 step 4 | 4 | `MarkupTools.ts` (vertex editing), context menu, help pages | after T16b | 5199 |
| T16d arcs: export + compat | #244.11 step 5 | 4 | `export.ts`, `revuWrite.ts`, `bluebeam.ts`, compat harness | after T16c | – |

**Owner decisions (2026-11-07):** properties go in the existing contextual Markup Format ribbon tab (no new panel or top bar), which comes to the front on selection and returns to the previous tab when it clears; arc keys follow the other tool (Ctrl+drag curve, Ctrl+click smooth/corner, Shift+click add/remove point) with Alt kept as an alias; no A/L arc keys; no Bluebeam MCP, so checks against it are manual for the owner and automated checks use the compat harness.

**Not delegated:** #243, and all GitHub issue replies (#244 intro, #247 log request, #243 previewer question). These are posted on the user's behalf, so the orchestrator drafts them and the user approves each before it's posted.

### Running the waves

- **Parallel rule:** two agents never own the same file at the same time. Within a wave, start every task whose "depends on" tasks have finished, as parallel background agents. Tasks that share a file (most of the `MarkupTools.ts` chain T5 → T8 → T9 → T10 → T11 → T16b/c) run one after another, each branched from the previous task's merged branch.
- **Wave 1 parallel set:** T1, T2, T3, T5 together. Then T4 once T2 is done.
- **After each agent returns**, the orchestrator:
  1. Reads the whole diff and checks it stayed in its files.
  2. Runs typecheck and tests again in that worktree.
  3. For UI changes, checks the change in the browser preview (or the packaged desktop app for desktop work).
  4. If it falls short, sends the agent back with specific notes via `SendMessage`, at most twice; after that the orchestrator finishes the task itself.
  5. Pushes and opens a PR per task (pr-workflow skill), with `Closes #n` only when the task completes that issue.
- **Before merging a wave:** run `pnpm verify` on the combined result.
- **Escalate to Opus instead of Sonnet** if a task's cause turns out different from this plan (likely candidates: T7, the rotated-page part of T6, T16d).

---

## #251 – Modify tab: Align buttons sit behind the group label (S)

**Cause.** `.rb-icon-grid` (`apps/web/src/styles.css:424`) is `grid-template-columns: repeat(3, auto)`. The Modify › Align group (`Ribbon.tsx:736`) has 12 commands, so it wraps to 4 rows and the 4th row overlaps `.rb-group-label`. The Insert tab's Arrange grid has 6, so it is fine.

**Fix.**
- Change the grid so it grows sideways: `grid-auto-flow: column; grid-template-rows: repeat(3, auto);` (the 12 align commands become 3 rows × 4 columns).
- Check every `Stack` and grid in `Ribbon.tsx` for more than 3 children (the `toolGroups` helper already splits into threes).
- Add an e2e check: for each ribbon tab, no `.rb-items` child's bounding box overlaps its group's `.rb-group-label`. That keeps the "three rows max" rule enforced.

## #247 – yihshin: three bugs

### 247.1 Vertical align Middle doesn't really centre callout and text box text (S–M)

**Cause.** `textBoxLines` (`packages/markup/src/render.ts:256`) centres the *line boxes* (`lines × fontSize × lineHeight`). Glyphs are drawn with `textBaseline = 'top'`, so each line box has the descender gap and extra leading below the ink. The result is that text looks high. Bottom alignment also subtracts `pad`, but Middle centres in the full box without padding. That is consistent, but it should be checked against the other tool.

**Fix.**
- Centre the ink block, not the line boxes: offset by the font's ascent/descent (cap height to descender) so Middle puts the visual centre at the box centre. Use the same metrics for canvas (`measureText` `fontBoundingBox*`) and for the PDF appearance stream in `export.ts`, so screen and export match.
- Check the inline text editor overlay for the same offset, so text doesn't jump when editing starts or ends.
- For callouts, confirm `contentBox` is the text box and not the box plus the leader.
- Tests: unit test on `textBoxLines` (1–3 lines, Middle/Bottom), plus a compat-harness round trip of a Middle-aligned callout compared against how the other tool draws it.

### 247.2 All open PDFs stuck on "Loading page…" after a while (M)

**Cause (likely).** `PdfEngine` (`packages/pdf-core/src/engine.ts:28-45`) marks itself dead when the worker crashes (for example, out of memory) and rejects every call. Only the sheet indexer (`apps/web/src/sheets/indexer.ts:27`) creates a new engine. The viewer's engine is never replaced, so every tab shows the `TileViewer.drawLoading` pill forever. A worker that hangs (for example, a OneDrive Files On-Demand read that never returns) gives the same symptom, because no call ever times out.

**Fix.**
- Engine supervisor: when `alive` turns false, create a new engine, reopen each open document from the bytes already held (or from the library), and redraw. Keep markups, which live in the store and not in the engine.
- Watchdog: time out each render/open call (for example, after 30 s with no progress) and treat it as a failure, then restart.
- Replace the endless pill with "Couldn't draw this page — Retry" and a notice when the engine restarts.
- Log the cause (worker error message, memory in use, number and size of open documents) to the desktop log.
- Check memory growth over a long session (tile cache, page bitmaps, documents never closed) with the heavy-PDF benchmark.
- Ask the reporter for the desktop log, how many PDFs and how large, and whether files were OneDrive placeholders.

### 247.3 Markups come back after closing without saving (S)

**Cause.** In `settleUnsaved` (`App.tsx:4107`), "Don't Save" only rolls back changes when Document Recovery is **off**, and Recovery is on by default (`settings.ts:470`). The on-device library finds files by the SHA-256 of their bytes (`storage/fileStore.ts`), so re-downloading the same file and opening it reattaches the kept markups. That is why it still happened after the user turned Autosave off and replaced the file.

**Fix.**
- "Don't Save" always discards: roll back and mark the document saved, whatever the Recovery setting. Recovery is only for crashes and unexpected quits.
- When a document opens with recovered (unsaved) markups, show a bar: "Unsaved markups from <date> were recovered — Keep / Discard". Don't apply them silently.
- Desktop: if the file on disk has changed since the library entry (different hash, same path), say so rather than mixing the two.
- Tests: unit test for discard with Recovery on; e2e test: add markup → close → Don't Save → reopen the same bytes → no markup.
- Reply on the issue explaining the cause.

## #244 – Yusuf: takeoff feedback (11 items)

Reply first: thank them, link this plan, confirm MCP (desktop) and Preferences exist, and note several "suggested additions" already exist (Markups List with export, cutouts, snapping, viewports, locking, legends, custom shortcuts). Ask for a sample PDF for the X/Y scale bug.

### 244.1 Separate X and Y scale ignored (P1 bug, M)

**State.** The core math supports it: `measureValue`/`measureDetails`/`measureLabel` take `yMetersPerPoint` (`packages/measure/src/measure.ts:271` `applyY`), and the panels and lists pass it. Places that use **X only**:
- Live drawing readouts in `MarkupTools.ts:2057, 2066, 2086, 2103` (length/angle sketch readout, segment sizes, tracking distance).
- Typed-length placement and dimension offset in `MarkupTools.ts:3975, 4228`.
- PDF `/Measure` dictionary on export (`export.ts:285`): Y is not written, so it is lost on reopen and in other tools.
- Bluebeam import (`bluebeam.ts:294`): Y scale is not read.
- `applyY` stretches *page* Y. On a page rotated 90°, the user's "vertical" is page X, so it stretches the wrong axis. This is suspected; check it.

**Fix.** Write the issue's acceptance tests first (1:100 X, 1:50 Y; 10 mm horizontal = 1.00 m, vertical = 0.50 m; 45° line; rectangle area; calibrating Y leaves X unchanged; unticking leaves existing markups alone). Then route every path through one `toReal(scale, rotation)` helper, write and read the Y scale in `/Measure`, and show both values in the status bar.

### 244.2 Crossing selection (P1, M)

**State.** Box select uses containment only (`insideRect` at `MarkupTools.ts:3111`), and lasso uses `insidePolygon` (whole markup inside).
**Fix.** Left→right drag = window (solid outline), right→left = crossing (dashed outline, different tint), lasso = inside *or* touching. Crossing hit-tests real geometry (segment–rectangle intersection and filled interior), not bounding boxes. Check that Shift+click toggles, Ctrl+A selects all, and Esc clears.

### 244.3 Finish with Space / right-click / double-click (P2, S)

**State.** Enter and double-click already finish (`doubleClick` at `MarkupTools.ts:3164`), and Backspace removes the last point (`:1985`).
**Fix.** Add Space (ignored when focus is in an input or contenteditable) and right-click finish, behind the preference "Right-click finishes markup" (off: context menu as now). Drop the duplicate last vertex a double-click leaves. Keep the tool active after finishing.

### 244.4 Resume a count / polylength / perimeter (P1, M)

**State.** Not implemented.
**Fix.** Add a "Resume" context-menu command on count, polylength, perimeter and polyline markups. It re-enters the multi-point gesture bound to the existing markup id, appending from the endpoint nearest the right-click. New points keep all properties, one undo step per point, and totals update live.

### 244.5 Count starts on the first click (P2, S)

**State (checked 2026-11-07).** A count stores one point per item and its total label sits at `points[0]` (`packages/measure/src/measure.ts:383`), so the first click should already be #1. The reported caption-first step may be the first marker's total label being taken for a caption, or a tool-chest count tool behaving differently. **Ask the reporter for steps before building this.**
If it reproduces: reproduce the caption-first step reported. Make the first click count #1 by default. Keep the old behaviour behind Preferences › Measurements › "Place count caption before counting". Place any total label next to the first symbol automatically.

### 244.6 Drag a rectangle for area/volume/perimeter (P2, S–M)

Press, drag past about 4 px, and release to create a 4-vertex polygon. Shift makes a square, and snapping applies to both corners. A plain click starts point-by-point as now. The result is an ordinary polygon, so cutouts, Resume and the X/Y scale all work on it.

### 244.7 / 244.8 Properties on selection; Subject/Label/Layer for selections and the active tool (P2, M–L)

**State.** The ribbon already has a Properties group (`Ribbon.tsx:505`, `StyleControls`) and a Properties panel.
**Fix.**
- Selecting a markup brings the contextual **Markup Format** tab to the front (`Ribbon.tsx` `FORMAT_TAB`); clearing the selection returns to the tab the user was on. Show the tab for mixed-type selections too. No new docked panel (owner decision, so item 10 stays true).
- Multi-selection shows a "mixed" state; edits apply to all as one undo step.
- Add Subject, Label and Layer to the bar for the selection *and* the active tool, including tool-chest tools, without ending the command. "Save back to Tool Chest" keeps the new values.
- Layer dropdown includes "New layer…"; Subject autocompletes from subjects already in the document.

### 244.9 Text search → Apply Count from the Tool Chest (P2, M)

**State.** Visual Search already turns results into counts (`VisualSearchPanel.tsx`, `VisualSearchAction 'count'`). Text search (`SearchPanel.tsx`) has no result checkboxes or actions.
**Fix.** Add result checkboxes (All/None, filter by page) and the action "Apply Count to Checked" with a picker of tool-chest count tools plus the default count. Create one count markup per page at the centres of the matched text, carrying the tool's properties. Reuse the Visual Search apply code.

### 244.10 Don't force Thumbnails open on every file (P3, S)

**Cause.** `openPacked` calls `revealPanel('pages', …)` on every open (`App.tsx:1593`).
**Fix.** Remember the side-panel state. Add Preferences "Show Thumbnails when opening a file", default off. Reopen at the last page and zoom.

### 244.11 Arcs inside polylength / perimeter / area / volume (P1, XL)

**State (corrected 2026-11-07).** Curve storage already exists: `Markup.bulges` (one bulge per segment, the DXF convention) and `holeBulges` (`packages/markup/src/model.ts:329-342`). Arc length and area with arcs are there too (`arcSegment`, `pathLengthArcs`, `polygonAreaArcs` in `packages/measure/src/measure.ts`). Alt-dragging a midpoint knob bends a segment after drawing (`MarkupTools.ts` `bend` gesture), and export flattens arcs to points (`export.ts` `curved`).
**Gaps.** Under a separate Y scale, `applyY` stretches the points but keeps the bulge, so an arc is measured as a circle rather than an ellipse. Segment captions need checking. Nothing curves a segment *while* drawing. Bluebeam gets flattened vertices.
**Fix (phased).**
1. ~~Model~~: done (bulges). No Bézier storage needed; a circular arc per segment covers kerbs, walls and bends.
2. Measure: only the X/Y case is left. Under X≠Y, expand the arc (`expandArcs`) or integrate in real coordinates. This is done in T6. Tests: 14.283 m and 9.571 m².
3. Drawing: Ctrl+drag while placing a point sets that segment's bulge. Backspace, Shift and snapping still work. **No A/L keys:** `A` is Arrow and `L` is Line.
4. Editing (key bindings decided by the owner: the other tool's keys win, Alt stays as an alias). Ctrl+click a vertex makes it smooth or a corner again (today Ctrl/Alt-click deletes it; Alt-click keeps deleting). Shift+click on a segment adds a point; Shift+click on a point removes it. Right-click › Convert to Arc. Update the help and changelog for the key change.
5. Export and compatibility: draw curves in appearance streams; research how the other tool stores curved polylength (likely its own path data) in the compat harness before shipping.

Depends on 244.1.

## #242 – Blend modes for pictures (Multiply etc.) (M)

**State.** Multiply exists only as a fixed per-type flag (`TYPE_INFO.multiply` for highlighters). It is drawn with `globalCompositeOperation` (`render.ts:332`) and exported as `BM /Multiply` (`export.ts:401`). Imports read only Multiply (`import.ts:744`, `fdf.ts:124`). Bluebeam `BlendMode` is hard-coded 0/1 in `bsiLegend.ts`.
**Fix.**
- Add `style.blendMode` (the PDF set: Normal, Multiply, Screen, Overlay, Darken, Lighten, ColorDodge, ColorBurn, HardLight, SoftLight, Difference, Exclusion; these match canvas composite ops). Allow it on images and on filled or stroked shapes.
- The highlighter default becomes `blendMode: 'multiply'` (migrate the flag).
- Add a Blend Mode dropdown in the Properties panel.
- Render with `globalCompositeOperation`; export `BM` in the ExtGState; import any `/BM`; map the Bluebeam BlendMode numbers in both directions (check the numbers with the compat harness).
- Possible phase 2 for "advanced image processing": "Make white transparent" for scanned pictures.

## #241 – Use any installed font (L)

**State.** `FontFamily` is `'sans' | 'serif' | 'mono'` (`packages/markup/src/style.ts:69`), mapped to the PDF standard fonts. Liberation fonts are already embedded through fontkit for PDF/A and Unicode (`documents/archiveFonts.ts`, `export.ts` `embedFont`/`fallbackFont`), so the embedding path exists.
**Fix.**
1. Model: `fontFamily` accepts a font name as well as the three keywords.
2. Font list: desktop main process lists installed fonts (Windows `%WINDIR%\Fonts` + per-user fonts dir/registry; macOS font dirs) and serves bytes over IPC through the allowlist. Web uses `window.queryLocalFonts()` where available, otherwise the three built-ins.
3. Screen: load the chosen font as a `FontFace` so canvas measures and draws it.
4. Export: embed a subset of the TTF/OTF and use it in appearance streams; put the real name in `/DA` and the rich-text `font-family`. Respect the OS/2 `fsType` embedding flags (restricted → fall back to the nearest standard font with a warning).
5. Missing font when reopening elsewhere: keep the name, draw a substitute, and show a notice.
6. UI: searchable font picker with recent fonts, each shown in its own face (`ToolBar.tsx:430`, `PropertiesPanel.tsx:602`). Keep tool-chest and Bluebeam font names on import instead of reducing them to three.

## #243 – Outlook PDF preview isn't centred (decision, S to reply)

**State.** The app registers `.pdf` as a Viewer only (`apps/desktop/electron-builder.yml:42`) and ships **no** Windows preview handler. Outlook's preview pane uses whichever `IPreviewHandler` is registered for `.pdf` (Edge, Acrobat, …), so the off-centre preview is not drawn by this app.
**Plan.** Reply explaining this and ask which previewer Outlook shows (the name in the preview pane, or `HKCR\.pdf\ShellEx\{8895b1c6-b41f-4c1c-a562-0d564250836f}`). Then either close as external, or keep as a feature request for our own preview handler. That would be a native COM DLL plus a renderer, needs code signing (installers are unsigned today), and is XL. Recommendation: don't build it now.
