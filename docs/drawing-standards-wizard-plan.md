# Drawing Standards setup wizard: plan

Status: plan, 2026-11-08. Replaces the Drawing Standards panel (`DrawingStandardPanel.tsx`, 480 lines)
and the Teach Links panel (`TeachLinksPanel.tsx`) with one guided setup window. Builds on the
merged drawing-standards stack (#173–#193). Every commit credits Miche-pup with a co-author trailer.

## 1. Why

The panel puts title-block boxes, number template, disciplines, link word lists, taught marks and
chainage settings into one floating dialog over the drawing. People do not know where to start,
the dialog covers the sheet they need to draw on, and nothing tells them whether what they set up
works. The wizard fixes all three: one question at a time, the drawing beside it, and a measured
"how well is this working" after each step.

## 2. Window and layout

- Opens from the Drawing Standards ribbon button (and the suggestion bar's "Set up a standard").
- **Its own window** via the existing `PopOutWindow` portal. The wizard keeps running in the main
  page, so it shares the already-loaded pdf.js document (no second load of a 500 MB set), the
  store, and the detection worker. Nothing to sync.
- Layout: left pane **1/3** (instructions, GIF, values read, results), right pane **2/3**
  (a viewer on the open document). Splitter is draggable; width remembered per user
  (`localStorage`, try/catch). Narrow window (< 900 px): panes stack, instructions collapse to a
  header strip.
- The right pane is a second viewer instance (same `PDFDocumentProxy`) with its own page, zoom and
  a single box-draw tool. It never touches the main viewer's page or markups.
- Wizard state (current step, boxes drawn, verdicts) saves on every change into a draft standard,
  so closing the window resumes where it stopped.
- **Risk (spike first, PR 3):** the viewer must render and take pointer/keyboard input inside a
  portal window. Check `window`-level listeners, `ResizeObserver`, pointer capture and the canvas
  pool against `ownerDocument.defaultView`. Electron must allow the `about:blank` popup (Markups
  pop-out already does). Fallback if the spike fails: the same wizard component mounted as a
  full-window layer in the main window, with the same 1/3–2/3 split.

```
┌───────────── Set up drawing standard: Northgate Council ────────────────┐
│ ● Title block  ○ Sections  ○ Elevations  ○ Details  ○ Match lines  ○ … │
├────────────────────────┬────────────────────────────────────────────────┤
│ Step 1 of 6 · Revision │                                                │
│                        │                                                │
│ Drag a box around the  │            [ drawing, box-draw tool ]         │
│ revision letter in the │                                                │
│ title block.           │                                                │
│ [ GIF ]                │                                                │
│                        │                                                │
│ Read: "C"              │                                                │
│ Read on 19 of 20 sheets│                                                │
│ [Skip]   [Back] [Next] │                                                │
└────────────────────────┴────────────────────────────────────────────────┘
```

## 3. Wizard steps

Every step has: a one-sentence instruction, a GIF from the Kestrel set, a live read-back of what
the box contains, a check across other sheets with a confidence meter (section 5), and Skip
("This set has none"). Back always works. Steps after Title block can be done in any order from
the step bar once Title block is done (links need sheet numbers).

### 3.0 Start
Pick an existing standard to edit or name a new one. Wizard picks a good first sheet (a plan with
a full title block) and shows it.

### 3.1 Title block, one field at a time
Sub-steps: Drawing number → Revision → Title → Scale → Sheet size → optional (Project, Status,
Drawn by, Date, Sheet x of y) → **Add your own field** (name + box, repeatable) → **Other numbers
to ignore** (file no., contract no.).

For each: draw box → show text read (label stripped, as `fieldText` does) → table of the same box
read on 5 other sheets, picked across the set → "Read on 48 of 50 sheets" + flags (duplicates,
blanks, odd shapes). Drawing number also derives the template (`deriveTemplate`) and asks
which part names the discipline, with codes found listed for naming. Maps 1:1 onto the existing
`TitleBox` / `SheetHints`; no format change.

### 3.2 Sections, 3.3 Elevations, 3.4 Details (one shared step component)
1. **Box the callout** (mark with its letter and sheet reference). GIF shows it on Kestrel.
2. Wizard reads the sheet reference from the callout and offers "Go to sheet 000021" (falls back to
   "Go to the sheet it points to").
3. **Box the title** of that section/elevation/detail. GIF.
4. Learn (`learnLink`, `teachMark`), then **run linking** over the set.
5. **Results:** found N callouts, M linked, K unresolved, ambiguous count; confidence meter.
6. **Spot check:** 8 example links as cards (crop of callout ↔ crop of target, side by side;
   click opens both in the right pane). Person marks each ✓ / ✗. Sample is stratified: lowest
   scores, middle, random. Verdicts feed the estimate (section 5) and become manual
   accept/reject on those links.
7. Poor result → "Teach another example" (a second pair usually fixes id forms / title words) and
   the AI recommendation (section 6).

Note in each of these steps: "Once these basics are set, an AI assistant connected over MCP can
take the examples you gave and find the rest." (once, small, not a nag).

### 3.5 Match lines
1. Box the match-line label on one plan (`MATCH LINE CH 280.000 / ADJOINS DRG …`). GIF.
2. Go to the adjoining sheet; box its matching label. GIF.
3. Learn: match-line words (`LinkHints.matchLine`), whether labels carry a chainage and/or a
   drawing number, where the line is drawn relative to the label (taught mark geometry).
4. Run linking + spot check. Offer "Use these to stitch the plans" (hands the pairs to the
   existing stitching match-line placement).

### 3.6 Alignments and chainages (four boxes)
Problem: many alignments share chainage values, so CH 150 alone is ambiguous. Four boxes, in order,
each with its own GIF:
1. A **chainage on a plan** (tick label or `CH 150`).
2. The **alignment name on that plan** that the chainage belongs to (`MC00`).
3. On a **cross-section sheet** for that alignment, the **alignment name** (often in the title,
   sometimes a label on each section).
4. On that sheet, the **chainage of one section**.

Learns: plan chainage form (bare tick vs prefixed, decimals), alignment name pattern (template
from the name: `MC##`, `LINE @`), where cross-section sheets state their alignment (title box vs
body label vs per-section label), cross-section chainage prefix, plan/XS title words (already
`ChainageHints`). New hint fields (section 7) record where alignment is read from.

Linking becomes the explicit chain: plan chainage → its alignment on plan (nearest alignment
label along the same line, else sheet title) → cross-section sheets of that alignment (by title /
label) → section with that value (also checked against the sheet title's range, `CH 0-150`).
Results show the ambiguous cases explicitly ("CH 100 found on MC00 and MC01 sections; plan
alignment unclear: 6 links"). Spot check as above. Expect this one to need AI most often; the four
boxes are exactly the examples the AI gets.

### 3.7 Review and save
Table of steps with confidence and verdict counts; overall recommendation; Save / Save and export
`.rcstandard` / "Ask AI to finish" (section 6). An "Advanced" disclosure keeps the raw word lists,
id templates and taught marks for power users (what the old panel showed, read-only by default).

## 4. Matching without AI: text + image

Text (already there, to strengthen):
- Ids through `idTest` + taught id templates; sheet refs through `calloutPart` and the number
  template; title phrases by kind.
- **Cross-checks that raise confidence**: target sheet has exactly one title with that id; the
  title cites the callout's sheet back (common "SECTION A / 000031" style); kind words agree.
- Chainage: value inside the XS sheet's title range; alignment agreement on both ends; plan sheet
  coverage continuity (consecutive plan sheets cover consecutive ranges).

Image / vector:
- Taught mark geometry already finds marks by shape (`marks.ts`). Add the symbol-search engine
  (`packages/measure/src/visualSearch.ts`) as a second finder: match the taught callout's line
  segments across pages, then read the words inside each hit. Catches callouts whose text is
  split, rotated or styled oddly.
- **Callouts with no text layer** (outlined text, scanned sets): geometry hit with no readable id
  is reported as "found N marks it cannot read". This is the strongest signal to send the step to
  AI (which can read the crop via `get_page_image`).
- Raster template match for fully scanned sets: later, only if the bench shows need.

## 5. Confidence

Per link: a score from features, hand-weighted, then calibrated on the bench:
- id read cleanly / sheet ref resolves to a real sheet / target title found / single candidate /
  back-reference agrees / geometry similarity to taught mark / kind words agree;
- chainage: alignment known on both ends / value inside XS title range / not ambiguous.
Existing `confidence` on `DetectedLink` (0..1) carries it; features are kept on the link for the
results view ("why 62%").

Per step, shown as a meter with a plain verdict:
- **Coverage**: callouts found that resolved to a target (and sheets read, for title block).
- **Estimated accuracy**: mean calibrated score, replaced by the spot-check result once checked
  (Wilson lower bound on ✓/(✓+✗), so 8/8 reads "at least 68%", not 100%).
- **Warnings**: pages with no text layer, unreadable geometry hits, ambiguous chainages.

Verdict bands (tunable from the bench): ≥ 90 % "Good, links apply"; 70–90 % "Usable, review the
flagged links"; < 70 % or > 10 % pages without text "Recommend AI" (section 6). Links below the
apply threshold go to the existing Needs-review list (`LinksPanel`), as today.

**Bench** (`pnpm standards:bench`): the Kestrel generator writes ground-truth links JSON next to
the PDF; the bench runs detection with a stored standard and reports precision/recall per kind and
calibration (score vs actual). Also runs on any local set with a hand-checked truth file (client
sets stay out of the repo; the client-data guard applies).

## 6. AI via MCP

The wizard never calls AI itself (MCP-only, as in the AI takeoff roadmap). It hands over data:
- `get_drawing_standard`: the standard, every box the person drew (page, rect, text read, step),
  step confidences and spot-check verdicts.
- `list_sheet_links`: links with kind, score, features, status; filter by step/status.
- `propose_sheet_links`: AI adds or corrects links as source `ai`, pending review (ranks below
  `standard` and `manual`, per existing ordering).
- `propose_standard_hints`: AI suggests hint changes (alignment names, id templates, title words);
  shown in the wizard as a diff to accept.
- Crops come from the existing `get_page_image` (region) and words from `get_page_text`.
"Ask AI to finish" copies a ready prompt naming the steps that scored low (and sends it when the
assistant is connected). After AI proposes, the step re-runs its meter and spot check.

## 7. Data model changes

- `DrawingStandard.examples: SetupExample[]` (step, role such as `callout`/`title`/`planChainage`,
  page index, sheet number, rect as page fractions, text read). Text and positions only, no
  images. Exported in `.rcstandard` (it is what makes the file useful to AI on the next set);
  the export dialog says so.
- `DrawingStandard.checks`: per step last confidence + verdict counts (shown when reopening).
- `ChainageHints.alignmentSource: 'title' | 'label' | 'section'` and `alignmentTemplate`.
- `LinkHints.matchLine` gains learned label form (chainage and/or drawing number).
- `.rcstandard` version bump with migration from today's files (`withDefaults`).

## 8. Kestrel sample set: what to add first

The set has plans, typical sections, long sections and MC00 cross sections, but **no section
callouts, detail callouts or elevations**, and cross sections exist for one alignment only. To
record the GIFs and to bench, extend `scripts/roadset` (fictional, all names invented):
- Section marks on plan sheets (bubble: letter over drawing number) pointing to typical section
  sheets; titles `SECTION A-A` with source sheet reference.
- Numbered detail callouts on plans → detail titles on 000022 (trench, shared path, culvert).
- A culvert headwall elevation with elevation marks.
- MC01 cross sections (new sheet) at chainages that overlap MC00 values, to show the ambiguity.
- Ground-truth links JSON emitted by the generator.
Then GIF clips in `scripts/help/gifs/standards-*.cjs` with the existing recorder (`gif.cjs`):
title-block field, section callout, section title, match line pair, the four chainage boxes.
Kept small (< 600 KB each, short loops).

## 9. Delivery (stacked PRs)

1. **Sample set + bench**: Kestrel additions, ground truth, `standards:bench`, baseline numbers.
2. **Confidence engine** (`packages/sheets`): link features, calibrated score, step meter, Wilson
   estimate, verdict bands. Unit tests against bench output. No UI.
3. **Wizard shell**: pop-out window spike + fallback, split layout, second viewer, box tool,
   step bar, draft persistence, Title block step. Ribbon button opens it.
4. **Callout pair step**: sections/elevations/details, linking run, results, spot check.
5. **Match lines step** + stitching hand-off.
6. **Chainage step**: four boxes, new hints, alignment-chain linker, ambiguity reporting.
7. **Image search**: visualSearch finder for taught marks, unreadable-mark reporting.
8. **MCP tools** + "Ask AI to finish".
9. **GIFs, help pages, cleanup**: record clips, rewrite the drawing-standards help page with new
   screenshots, remove `DrawingStandardPanel`/`TeachLinksPanel`, web + desktop e2e for the wizard
   (desktop: build-desktop first; pop-out window path).

PR 1–2 and the wizard shell (3) can run in parallel; 4–6 need 2 and 3; 9 needs the steps done.

### Baseline (PR 1, 2026-11-09)

`pnpm standards:bench` on the 21-sheet Kestrel set (72 key references; text detection only, no
taught marks):

| kind | key | no standard: recall / precision | Kestrel standard: recall / precision |
|---|---|---|---|
| section | 9 | 100% / 100% | 100% / 100% |
| detail | 6 | 100% / 100% | 100% / 100% |
| elevation | 2 | 100% / 100% | 100% / 100% |
| match line | 6 | 100% / 100% (kind right 0%) | 100% / 100% (kind right 0%) |
| chainage | 49 | 0% / 0% | 35% / 96% |

What it shows:
- Callout bubbles in this set are easy for text detection. Kind is often wrong: callouts come
  out as `detail` when they point at a section or elevation, and match-line labels as `sheet`.
- Chainage is the weak spot. With the standard, most plan ticks still do not link, cross-section
  `CHAINAGE 0` labels do not link back to the plan, and MC00's ticks 40 and 140 link to MC01's
  cross sections (the shared-chainage case).
- Confidence is not calibrated: links scored 0.85–1.00 range from all right to half wrong
  depending on kind. That is what PR 2 fixes.

Command for comparison: `pnpm standards:bench --standard docs/demo-sets/kestrel-road.rcstandard`.

### Confidence engine (PR 2)

`packages/sheets/src/confidence.ts`: links keep the keys of the evidence they were found on
(`bubble`, `titleFound`, `cutMarker`, `noTarget`, `alignmentAgrees`, `severalAlignments`,
`inSheetRange`, `outsideSheetRange`, …). Each key adds a hand-set log-odds weight, so the score is
explainable (`explain`). Forms start where detection's fixed numbers were (bubble 0.9, chainage 0.6),
so unchanged cases score as before. Also `wilsonLower`, `spotCheckSample` (least sure + middle +
seeded random) and `stepMeter` (coverage × accuracy; checks blend with scores counted as 4 checks;
bands good ≥ 90%, review ≥ 70%, else AI, or AI when > 10% of pages have no text).

On Kestrel, scoring moves little (Brier 0.098 → 0.097 without a standard, 0.042 → 0.046 with one):
the set has few ambiguous links, and they are right more often than their 0.5 says. The bench now
prints each evidence key's hit rate for tuning, and the wizard meter per step. With the standard,
chainage reads "AI" because 32 of 49 references get no link; every other step reads "good".
One set cannot settle the weights: tune them on a real client set (kept out of the repo).

### Wizard shell (PR 3)

- Window: the `PopOutWindow` portal works for the wizard, so no fallback was needed in Chromium or
  the e2e browser. The wizard's sheet view (`components/standardsWizard/SheetView.tsx`) is its own
  small renderer (regions drawn with `renderRegion`, zoom/pan, box drawing) rather than a second
  `TileViewer`, and listens only on its own element, which is what makes the portal safe. When
  pop-ups are blocked, the same wizard covers the app. On the desktop the window opens 1400 × 900.
- Title block: drawing number (required), revision, title, scale, sheet size, Project, Status,
  Date, then your own fields, other numbers (ignore boxes), and drawing numbers (template and
  discipline part). Each box shows what it reads, the same box on five sheets spread through the
  set, and "read on N of M sheets". The standard is saved on every change; where the person was
  is kept per standard in `localStorage`, so reopening carries on.
- Testing it on Kestrel found a loose revision box catching the next cell's caption: revisions
  are now the last of the box's largest lettering, in `readBox` and `readSheet` alike.
- Sections to chainages point to Teach Sheet Links until their PRs; Review reads the document
  with the standard and opens the old panel for import, export and the rest.

## 10. Open questions

- Pop-out window vs full-window layer, if the spike shows the viewer misbehaves in a portal.
- Spot-check size (8 default; more for big sets?).
- Whether examples in exported `.rcstandard` files are acceptable to share with other consultants
  (they hold title text of the client's sheets), or export should strip them by default.

### Sections, elevations, details (PR 4)

- One step component for the three (`components/standardsWizard/CalloutStep.tsx`): box a mark,
  "Next" jumps to the sheet it names, box its title, "Find the rest". `learnLink` learns from the
  pair (callout part, id forms, title words) and keeps both as taught marks in the standard.
- `sheets/wizardLinks.ts` runs the step over the set: text links of the kind, plus taught-mark
  shape search on the pages whose text could hold one, merged without doubles, with the number
  of references found and linked for the meter.
- Results: the meter (`stepMeter`), up to 8 sample links as callout → target crops with Right /
  Wrong (clicking a crop shows it on the sheet), "Teach another example", and an AI-over-MCP
  recommendation when the band is AI. Answers are applied to those links when the document is
  read with the standard from Review.
- GIF slots load `/help/gif/standards-<kind>-<mark|title>.gif` and hide while the clips do not
  exist (recorded in PR 9).
- Detection: a bubble on the target sheet pointing back took every link for a section. The kind
  now comes from the title beside whichever bubble has one (DETAIL 3, ELEVATION E1). Kestrel
  bench, kind right: detail 83% → 100%, elevation 50% → 100%; section still 67% because two
  callouts take the title block's big revision letter "C" for section C's title. Excluding the
  standard's title-block boxes from title search fixes that; left for a follow-up.

### Match lines (PR 5)

- `components/standardsWizard/MatchLineStep.tsx`: box a match-line label, Next goes to the sheet
  it names, box the matching label, "Find the rest". `learnMatchLine` refuses a pair that does
  not name each other's sheets, adds the client's own words for match lines when the usual
  ones do not read the label (JOIN LINE), and notes whether labels give the chainage and the
  adjoining drawing. Results reuse the meter and sample cards (now in `stepParts.tsx`).
- "Use these to stitch the plans" runs the app's existing stitching from text. That finder
  (`packages/stitch` `findMatchLines`) still only looks for words starting MATCH; teaching it
  the standard's own words is a follow-up.
- Detection: labels of two lines (`MATCH LINE CH 280.000` over `ADJOINS DRG …`), flat or turned
  a quarter to run along the line, now link as match lines: `nearbyText` reads a label along its
  own direction and one line either side. Links on a match-line label also carry the
  `matchLineLabel` evidence (+0.8). Kestrel: match-line kind right 0% → 100%; Brier 0.097 →
  0.091 without a standard, 0.046 → 0.044 with one.

### Chainages (PR 6)

- `components/standardsWizard/ChainageStep.tsx`: four boxes in order (a chainage on a plan, the
  name of its alignment there, where a cross-section sheet of that alignment names it, one
  section's chainage), with a checklist to go back to any box. After the plan's two boxes, Next
  goes to the first cross-section sheet naming the alignment (sheets printing written chainages
  first, so typical sections come last). `learnAlignmentChain` refuses boxes that do not make a
  chain (alignments that differ, the cross-section boxes on the plan, a section chainage with no
  CH/CHAINAGE), then learns prefixes, the alignment name and its form (`MC01` gives `MC##`, so
  the set's other alignments are found without listing them), plan and cross-section title words,
  and where cross sections name their alignment (`alignmentSource`: boxed in the title box is
  `title`; boxed beside the section, or printed over and over on the sheet, `section`; else
  `title` when the title names it, `sheet` otherwise).
- New `ChainageHints` fields `alignmentTemplate` and `alignmentSource`, read and written with
  `.rcstandard` files (older files read as before).
- Linker (`packages/sheets` `chainageReport`, behind `detectChainageLinks`):
  - A plan's run of ticks takes one alignment: the name printed closest to the run, else the
    alignment of a named run with the same values (the long section under the plan). Kestrel
    prints each name once, so before this most ticks had no alignment, no plan coverage was
    built, and cross sections could not link back.
  - Tick labels that turn with a curving alignment are read as one run.
  - A plan and its long section printing the same ticks no longer collapse its coverage.
  - Ranges (`CH 280 TO CH 565`, in titles and typical-section notes) are not references.
  - At a value where two consecutive plans overlap by a tick, the plan with the value inside its
    run wins; one link per chainage word rather than per value on a page.
  - A chainage whose alignment cannot be told, where cross sections at that value exist for more
    than one alignment, is reported (`ambiguous`) and scored lower (`sectionsOnSeveral`, -0.6);
    the step lists them as "Alignment unclear" and recommends AI for them.
  - The report gives the step's references (each cross section's own chainage, and each chainage
    elsewhere that a cross section is drawn at) and how many linked, for the meter.
- Kestrel bench with the standard: chainage recall 35% → 98%, precision 96% → 100%; Brier
  0.044 → 0.021; chainage step band ai → good. Without a standard chainage still finds nothing
  (the default plan titles do not fit Kestrel's), which is what the step is for. Tried on screen
  from a standard with no chainage settings: the four boxes on 000031 and 000301 learned MC##,
  the plan title words and `section`, and linked 54 of 59 references.
- Not done: the remaining miss is a short run of four ticks on a long section (too short to
  count as ticks). Examples (the boxes themselves) are not stored in the standard yet; that
  comes with the MCP tools (PR 8), which need them.

### Shape search (PR 7)

- Taught marks were already found by their line work (`visualSearch` in `marks.ts`); hits whose
  label could not be read were dropped, and pages whose text could not hold a mark were never
  searched. Now:
  - copies drawn up to twice as large or small are found (`scales`), their label read at that size;
  - a sheet number set in pieces (`A-50` `1`) is read by joining the touching words on its row;
  - in the wizard, a hit with the mark's line work (90% of it) and no text inside at all is kept
    as **unreadable** (outlined lettering, a scanned stamp); it is never made into a link, the
    main document reading does not ask for them;
  - pages with fewer than 20 words (no text layer worth the name) are searched by shape too;
  - shape adds what text missed and upgrades a plain sheet reference to a callout, but never
    turns one kind of callout into another (Kestrel's section and detail bubbles look the same);
  - a callout found on its own sheet whose detail title is itself (a larger title bubble) is not a link.
- Callout step results: the meter counts unreadable marks (as places not linked, plus its
  warning) and pages with no text; a "Found, but not read" list goes to each one on the sheet
  and points to AI.
- Kestrel, taught from one example per step: same links as text (9 detail, 6 section), about
  0.1 s for the set. With the lettering of sheet 4's two section marks removed (outlined text
  simulated), both are reported unreadable and nothing is mislinked.
- Not done: rotated copies (`rotations`), raster template matching for scanned sets (only if a
  real set needs it), and the section C title-block mislabel (still open from PR 4).

### MCP tools and Ask AI (PR 8)

- The standard keeps what an AI assistant needs:
  - `examples`: the boxes drawn in the link steps (step, role, page, sheet number, the box as
    page fractions, the text read), the latest 8 per step. Exported in `.rcstandard` files (text
    and place only, no pictures; section 10's question on sharing them stays open).
  - `results`: each link step's last meter (band, score, references and linked, checks, unreadable
    marks, unclear chainages). Profile only.
  - `proposals`: words an AI assistant proposed, waiting for a person. Profile only. The setup
    reads them from the profile copy when it saves, so a proposal made while it is open is kept.
- Four MCP tools (`desktop/assistantStandards.ts`, listed in `apps/desktop` `message.ts`):
  - `get_drawing_standard`: the standard the document is read with (or one named), its title
    block, words, taught marks, examples and step results, and pending proposals.
  - `list_sheet_links`: the set's links with place, target, confidence, why (`explain`), status and
    source (text, taught mark, pdf, ai); filter by kind, status, page; paged.
  - `propose_sheet_links`: links as `ai-` ids, always `review`, with the reasoning as the link's
    `note` and `aiProposed` evidence. Kept across detection runs; a person's decision on one sticks
    when it is proposed again; all items are checked before any is added.
  - `propose_standard_hints`: words to add (title, match-line, chainage prefixes, alignments and
    their form, plan and cross-section titles), stored as a proposal on the standard.
- In the setup: each link step saves its result; where the meter recommends AI (or a step found
  marks it could not read) an **Ask AI to finish** button copies a prompt naming the standard,
  the drawing, the steps and why, and the tools to use; when the clipboard is refused the prompt
  is shown to copy. The Review step lists every step's result, offers one prompt for all steps
  left, and shows AI proposals with **Add these words** / **Dismiss**. AI links show in the Links
  panel's Needs review list, their tooltip giving the AI's reasoning; they are not exported to
  the PDF until kept.
- Tried in the browser pane through the app's own assistant hook: `get_drawing_standard` read the
  Kestrel standard, a proposal sent while the setup was open survived the setup's own saves,
  showed in Review, and Add these words added JOIN LINE and MC00/MC01 to the standard.

### Clips, help, cleanup (PR 9)

- The old panels are gone: `DrawingStandardPanel` and `TeachLinksPanel`, their CSS, the
  `teachMark` box tool and the `standard` kind of label-region boxes. Their commands stay and open
  the setup: Document › Drawing Standards… at the Review step, Teach Sheet Links… (and the Links
  tab's Teach links…) at Sections.
- What the panel did that the setup did not now lives in it:
  - Start screen: **Import…** (.rcstandard).
  - Review (`StandardSettings.tsx`): name, words on this client's sheets, this document's standard
    with **None (read from the text)**, Project standard (Use / Stop), **Advanced: words and
    marks** (callout part, identifier and title words, match-line words, chainage lists and the
    alignment form, the standard's marks with forget, moving marks taught for every set into it),
    **Export…** and **Delete**. "Read this document with it" no longer needs a number box (a
    marks-only client).
- Teaching marks for every set without a standard is no longer offered; marks taught that way
  before still work, are listed in the Links tab and can be moved into a standard.
- Drawing numbers step: the template field showed "box the drawing number first" while the box
  read no number, so a client numbering sheets like *ROOM 101* could not give its template. It
  now shows once the number is boxed (and says when the text is still being read).
- Clips: `scripts/help/standards-gifs.cjs` records the 12 link-step clips on the Kestrel set
  (the setup over the app, zoomed with the sheet's new `data-view` mapping) and, with `shots`,
  the help page's two setup screenshots. Help section 09 makes its standard in the setup.
- Help: `drawing-standards.md` rewritten around the setup (steps, meter, AI, review, sharing);
  the Links page's teaching section points at it.
- e2e: the panel tests now drive the setup's own window (`e2e/support/setup.ts`); the old Teach
  Links tests became one Details-step test; `document.setUpDrawingStandard` has its coverage entry.
