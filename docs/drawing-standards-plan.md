# Drawing standards: plan

Credit: builds on Miche-pup's work in #166 (title-block numbers), #167 (link kinds) and #168 (station links). Every commit in this feature carries
`Co-authored-by: Miche-pup <179415829+Miche-pup@users.noreply.github.com>`, and the PRs and the help page say where the ideas came from.

## Why

The heuristics in #166–#168 work on the set they were tuned on and go wrong on others. Clients don't change their drawings much: the same title block, the same drawing-number scheme, the same section marks and titles, the same alignments. A person can describe that once. After that, any set from that client is read with known rules instead of guesses.

The heuristics stay as the fallback when no standard is chosen. With a standard chosen, the standard's rules come first and the heuristics fill in whatever it doesn't cover.

## What a standard holds

One `DrawingStandard`, saved in the profile next to `taughtMarks` (`apps/web/src/workspace/profiles.ts`), and exportable as a file so a team can share it.

| Group | Fields | Fixes |
|---|---|---|
| **Identity** | name, notes, fingerprint (text found on most sheets: client name, a fixed drawing-number prefix like `HLD1BDD-WSPAU-`, title-block position) | lets the app suggest the standard |
| **Title block** | boxes for sheet number, sheet title, revision and scale, plus **ignore** boxes (file no., contract no., CAD ref). Stored as fractions of the page, measured from a chosen corner, so A1 and A3 prints both work. Reuses `Region` and `textInRegion` from `apps/web/src/sheets/regions.ts`. | #166's file-number vs sheet-number problem, with no score-based guess |
| **Drawing number** | pattern worked out from one example (`HLD1BDD-WSPAU-0508-BR-DRG-300082` → fixed prefix + `{disc:2}` + `DRG` + `{n:6}`), which part is the discipline plus a map of codes to names, and the short form callouts use (last segment) | sheet numbers in any scheme, not only NCS. Disciplines for non-NCS sets. |
| **Marks** | taught section marks, section titles, detail callouts and detail titles, now owned by the standard. Marks taught outside a standard stay global ("Any set"). | taught marks only searched for in that client's sets, so fewer false matches |
| **Identifiers** | which section and detail ids the client uses: `A`, `AA`, `A-A`, `1`, `S1`… One shared pattern, used by both `links.ts` and `marks.ts`. | the `AA` / `A-A` mismatch found in #167 |
| **Title wording → link kind** | `SECTION`, `CROSS SECTION`, `ELEVATION`, `ENLARGED`, `LONG SECTION`, plus the client's own words. Defaults come from #167. | link kinds in the client's own language |
| **Match lines** | the wording (`MATCH LINE`, `MATCHLINE`, `CONTINUED ON`) | |
| **Linear work** (optional) | chainage format (`k+mmm.mmm`, `CH 1250.000`, imperial `NNN+NN`); alignment names as printed (`MC01`, `LINE A`, `RAMP B`); which sheets cover a stretch (title words like `PLAN AND LONGITUDINAL SECTION`, or a sheet-number range); which sheets are cross sections (title words, or a chainage table) | all five failure cases found in #168 |
| **Confidence** | whether links found through the standard are kept straight away or go to review | |

## How it plugs in

The core logic is pure, testable code in `packages/sheets`. A new type, `SetHints`, is built from a standard and passed into the existing entry points. Each one is an optional argument, so nothing breaks when no standard is chosen.

- `detectSheets(pages, hints?)`. When regions are given, read the number, title and revision from them, check the number against the pattern, and only fall back to the current heuristic when a page doesn't fit. Disciplines come from the standard's map. Ignore boxes remove those numbers from the candidates.
- `SheetLookup`: the short form comes from the standard rather than the generic "last segment, 3 characters or more" rule.
- `detectLinks(pages, numbers, hints?)`: uses the standard's id pattern, title wording, match-line wording, and the shared `DETAIL_ID`.
- `findMarks` / `linkFromMarks` (`apps/web/src/sheets/indexer.ts`): search for the standard's marks plus the global ones.
- New `packages/sheets/src/chainage.ts`, a rework of #168's `stations.ts`:
  - Each mention is read as **alignment + chainage**. The alignment comes from the nearest alignment name from the standard on the same line or in the same table.
  - Coverage sheets are the ones the standard names (by title words or number range), not any page with four even ticks.
  - **Plan ↔ cross section**: a chainage on a plan or long section links to the cross-section sheet showing that chainage on the same alignment, and a cross section's chainage links back to the plan at that spot.
  - With no standard: the conservative mode only. One alignment, links go to review, and #168's narrowest-sheet rule.
- Scale: when the standard has a scale box, apply page scales the way **Bulk Apply Page Scale** already does.
- Sheet sources: add `'standard'` to `SheetSource` (`packages/sheets/src/types.ts`), ranked `text < pdf < ai < standard < manual`. Manual edits still win.

## Per document

- `store.meta` records `standardId` and a hash of the standard's contents. When either changes, the document runs Re-detect again: sheets, links, marks, then chainage. Detection already uses the same "searched for these marks" bookkeeping (`marksSearched`), so this is the same idea.
- Choosing **None** goes back to the heuristics and removes links that came from the standard. Links someone accepted or rejected stay as they are.

## UI

1. **Document › Drawing Standard ▸**: None / each standard / New from this document… / Manage…. The Links tab shows the current standard as a dropdown at the top too.
2. **New from this document**: one dialog with steps, each showing a live result across the set (for example "sheet number read on 194 / 197 pages", with the pages that failed listed):
   1. Name.
   2. Title block. Draw boxes, reusing the drawing mode from `LabelRegionsPanel`, and mark each box as number, title, revision, scale or ignore.
   3. Drawing number. Pattern worked out from the boxed numbers; edit the fixed and variable parts; discipline map.
   4. Marks. Teach section mark, section title, detail callout and detail title, reusing `TeachMarkDialog`, all saved into this standard.
   5. Wording. Title words → kinds, and match-line words. Starts from the defaults.
   6. Linear (skippable). Chainage format; alignment names suggested from the text ("MC01 appears on 40 sheets: is it an alignment?"); coverage and cross-section sheets picked by title words, with a preview of the ranges found.
3. **Manage**: rename, duplicate, delete, edit steps, export and import as a `.rcstandard` file (JSON with a version field), and move existing global taught marks into a standard.
4. **Suggestion**: when a set opens with no standard, score the fingerprints; above a set level, show a dismissable banner ("Looks like a WSP / HLD1BDD set. Use that standard?"). The app never applies a standard on its own.
5. Help page `apps/web/public/help/pages/drawing-standards.md`, with screenshots from the `scripts/help` pipeline, crediting Miche-pup's PRs.

## Phases (one PR each, stacked)

| # | PR | Holds | Done when |
|---|---|---|---|
| 0 | Land the general parts of #166 / #167 | 4-digit sheet numbers, PLAN NO., citation tie-break; add the ignore-label list (FILE, CONTRACT, PROJECT, JOB, CAD, REF); link kinds and the kind saved in exported links; one shared `DETAIL_ID` | these improve the heuristics with no standard; current tests stay green |
| 1 | Standard model + title block | `DrawingStandard` type, profile storage and upgrade, export and import, `SetHints`, `detectSheets` reading regions and the pattern, `'standard'` source, per-document `standardId`, menu, steps 1–3 | a standard made on one set reads every sheet number on a second set from the same client |
| 2 | Marks + wording | marks owned by standards, migration of global marks, id pattern, title and match-line wording → `detectLinks` and `marksToLinks`, steps 4–5 | section marks → titles found more often on the client fixture than with global marks; no new false links on other sets |
| 3 | Linear work | `chainage.ts` (alignment + chainage, metric and imperial), coverage and cross-section sheets from the standard, plan ↔ cross-section links, step 6 | all 5 of #168's failure cases pass with a standard; with no standard, links go to review |
| 4 | Suggestion + sharing | fingerprint scoring, banner, default standard per Project folder | opening a second set from the client suggests the right standard |
| 5 | Help + e2e | help page, screenshots, Playwright: make a standard on fixture A, apply it to fixture B, check sheets and links | `pnpm verify` green |

## Tests and measurement

- Unit tests in `packages/sheets` with made-up pages for each hint, including the five #168 cases (road cross sections at even chainages, mainline and ramp with overlapping chainages, chainage tables, `STA30+00` written as one word, metric).
- Profile upgrade test: profiles saved with older fields gain `drawingStandards: []`, and global taught marks stay where they were.
- Real sets: two or more sets from the same client (for example two HLD1BDD packages), plus Miche-pup's SFPUC set if they'll share it. For each, measure sheet numbers read, links found, and wrong links, with no standard and with one. Keep the numbers in the PR bodies.

## Decisions (2026-10-31)

1. **Name:** "Drawing standard" in the app. Code uses `DrawingStandard` / `drawingStandards`; shared files are `.rcstandard`.
2. **Ranking:** a standard ranks above AI-read sheet info: `text < pdf < ai < standard < manual`.
3. **Storage:** in the profile on this device, with export and import as `.rcstandard` files. Project-folder defaults come in phase 4.
4. **#166–#168:** their general parts are folded into these phases. Phase 0 carries #166 and #167 with the fixes, and phase 3 replaces #168. When the replacement PRs open, close each of Miche-pup's PRs with a thank-you comment linking the PR that replaces it. Miche-pup is a co-author on every commit.

## Status (2026-11-01)

| Phase | PR |
|---|---|
| 0 | ColbyGallagher/redcolumn#173 |
| 1 | ColbyGallagher/redcolumn#178 |
| 2 | ColbyGallagher/redcolumn#179 |
| 3 | ColbyGallagher/redcolumn#182 (replaces #168) |
| 4 | ColbyGallagher/redcolumn#183 |
| 5 | ColbyGallagher/redcolumn#184: help screenshots, desktop e2e |
| 6 | feedback from first use, below |

## Phase 6: feedback from first use

- **Resizable panel.** Long drawing numbers and titles were cut off. The Drawing Standards panel (and Teach Links) can be resized from any edge or corner and moved by its heading; box text wraps.
- **Custom fields.** A title-block box can hold a field the person names (Status, Drawn by, Package). Each sheet's value is kept with its sheet info and becomes a tag of the sheet in Sets.
- **Teach Links**, replacing the one-box Teach a Mark dialog. The person boxes a mark, then what it points to, for sections, details, elevations and chainage in turn. Line work joined to lines running out of the box is left out to begin with, and any line or word can be left out by hand. Each pair is checked (identifiers agree, the mark names the title's sheet) and teaches the standard what it can: the part of the number callouts cite, identifier forms, the words in front of section and elevation titles, the word in front of a chainage, and plan and cross-section title words. Elevation marks and titles are new mark kinds.
- **Bare chainage ticks.** Plans often label stations with bare numbers (101140, 101160, ...). On a plan sheet, a run of at least four evenly stepped values, evenly spaced along the sheet, is read as chainage; short runs (scale bars), runs along the sheet's edge or printed twice (grid coordinates) and lone numbers are not. Cross sections still need a prefix or a plus form, so a stray 20 never becomes chainage 20.

Still open: measuring on two or more real sets from one client, and a real OneDrive Project.
