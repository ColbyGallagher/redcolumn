# Interface translation plan

Issue #431 asks for a German interface. This plan builds the translation framework and ships
German. Other languages are added later, on request, **without changing the framework**: a new
language is a catalog file, a registry entry and a reviewer.

The longer-term reason: in many countries paid PDF tools cost more than local incomes allow, and an
interface in the local language makes redcolumn a real option there.

## Scope

**In:** the framework, the English string sweep, locale-aware numbers, German catalog and glossary,
German spelling, desktop menus and installer, quality gates.

**Out (until requested):** other languages, right-to-left layout, complex-script shaping in PDFs,
translated help pages. Each is listed under [Adding a language later](#adding-a-language-later) with
what it costs, so nobody has to rediscover it.

## Where we are today

- **No translation system.** Every string is an English literal: ~112k lines of non-test source,
  ~2,000 `label`/`title`/`tooltip`/`placeholder` literals plus ~700 JSX text nodes. Estimate
  3,500–5,000 translatable strings once dialogs, errors and toasts are counted.
- Strings live in and out of React: the command table (`apps/web/src/commands/appCommands.ts`),
  tool labels (`markup/MarkupTools.ts`, `markup/cadTools.ts`), `BATCH_LABELS`, the ribbon, panels,
  dialogs, and some in the Electron main process (`apps/desktop/src/main.ts`).
- `index.html` is hard-coded `lang="en"`.
- Spelling: English dictionaries only. OCR already reads German (`deu`).
- E2E selects by English accessible names (~470 `getByRole`, ~230 `getByLabel`), so suites keep
  running in English.

## Framework design

The rule for every decision below: **nothing in it may assume a Latin, left-to-right, two-plural
language**, even though German is the only one shipping.

### Library: our own small runtime (Lingui's model, without its compiler)

Lingui was the first choice, but its `t` macros need a compile step this repo can't give them: unit
tests run the TypeScript as-is under `node --experimental-strip-types`, the Electron main process is
built with plain `tsc`, and Vite 8's React plugin has no Babel. So `packages/i18n` keeps Lingui's
model and file formats with plain functions instead (~400 lines, no new dependencies):

- **Source string is the key.** `msg('Save all')` keeps the sweep mechanical; no invented key names.
  `msgc('noun', 'Count')` separates identical English with different meanings.
- **Works everywhere.** Plain functions run in React, in plain modules, in node tests and in Electron.
- **ICU MessageFormat** (`{n, plural, …}`, `select`, `selectordinal`, `#`) with plural categories from
  `Intl.PluralRules`, so Arabic's six plural forms or Russian's three need no code change later.
  Plural strings are written as ICU from the start, never `n === 1 ? … : …`.
- **PO catalogs**, readable by every translation platform and translator tool.
- **Lazy catalogs.** A Vite plugin compiles each `.po` to a JS module loaded with `import()`. English
  ships in the bundle; other languages cost nothing until chosen.
- **Extraction** (`pnpm i18n:extract`) reads the source with the TypeScript compiler API, rejects
  non-literal messages and bad ICU, and keeps existing translations when it updates the catalogs.
- **Chosen at start-up.** The language is activated before the first render and changes apply after a
  restart (Preferences offers Restart Now). Interface text is built when rendered, never at a
  module's top level; a development warning lists any that is. (Lazy-loading the app after
  activation was tried and broke the release bundle's chunk order.)

### `packages/i18n`

One package shared by the web app and the Electron main process:

- `locales.ts` — **the registry**. One entry per language, the only place a language is declared:
  ```ts
  { code: 'de', name: 'Deutsch', english: 'German', dir: 'ltr', status: 'reviewed',
    spelling: 'dictionary-de', ocr: 'deu', fontScripts: ['Latn'] }
  ```
  `dir`, `fontScripts` and `status` exist now so RTL, script fonts and the "Preview" badge plug in
  later without a schema change.
- `catalogs/<code>.po` + compiled output.
- `activate(code)`, `detect()` (from `navigator.languages` / `app.getLocale()`), `formatNumber`,
  `parseNumber`, `formatDate`, `plural` helpers.
- Fallback chain: `de-AT` → `de` → `en`. A missing translation shows English, never an empty label.

### What is translated and what is not

Translate only what the user **reads**. Never translate what is **stored or exchanged**:

| Translate (display) | Keep English (data / identifiers) |
|---|---|
| Menus, ribbon, tooltips, dialogs, panels, toasts, errors | Command ids, settings keys, MCP tool names and schemas |
| Tool names shown in the UI | Markup `Subject` and other values written into the PDF |
| Column headers shown in tables | Persisted column ids, profile / tool-chest file contents |
| Excel export headers (comment register, takeoff) | Import matching: accept the English **and** localized header |
| Start tips | Changelog, logs, crash reports |

The PDF-written markup subject is the trap: Bluebeam round trips (`reference_data/` harness) depend
on it. Show a translated subject in lists, write the stored one. A harness case saves with the UI in
German and diffs against the English save; they must match apart from user text.

### Settings and picker

- `uiLanguage` (default: detected, else English) and `numberFormat` (default: follow the OS region,
  can be set separately, since many engineers want an English UI with decimal commas or the reverse).
- Preferences → General → Language, listing the registry by native name with its status. Languages
  with `status: 'preview'` show a "Preview: machine translated" badge.
- Changing language applies at the next start (with a Restart Now button): `activate`, set
  `<html lang dir>`, and (PR 11) the desktop main process builds native menus in it.

### Numbers, units, dates

- All number **display** through `formatNumber` on `Intl.NumberFormat` (~95 `toFixed` /
  `toLocaleString` call sites).
- All number **input** (scale, calibration, measurement properties, takeoff quantities, estimating
  formulas) through `parseNumber`, accepting the locale's decimal separator: `1,5 m` parses in German.
  Feet-and-inches syntax unchanged; scale ratios (`1:100`) stay as typed.
- CSV export uses `;` when the decimal separator is a comma; Excel keeps numbers as numbers.
- Dates via `Intl.DateTimeFormat`. Unit symbols (m, ft, m²) unchanged.

### Layout

- German runs ~30% longer than English and the ribbon never scrolls (house rule): groups spread or
  labels wrap to two lines, with a short-label fallback per command where needed.
- **Pseudo-locales**, dev only: `en-XA` (accented, +40% length, bracketed `[[…]]` so truncation and
  missed strings show) and `ar-XB` (mirrored, `dir="rtl"`). `ar-XB` isn't expected to look right yet;
  it exists so the `dir` plumbing is exercised and RTL work later starts from a working switch.
- **New CSS uses logical properties** (`margin-inline-start`, `inset-inline-end`) from now on,
  enforced by a stylelint rule on changed lines. Existing CSS is not converted until an RTL language
  is requested.

### Desktop

- Electron main reads the same compiled catalogs from `packages/i18n` for native menus, dialogs and
  notifications.
- Windows installer (NSIS) and update prompt: German via `electron-builder`'s per-language strings.

### Spelling

Spellcheck dictionary chosen from the registry's `spelling` field, loaded on demand (`dictionary-de`),
with an override in Preferences. Markup text language defaults to the UI language.

## German

- **Glossary first.** ~150 construction and PDF terms (takeoff, markup, callout, cloud, count, legend,
  stamp, sheet, calibrate, scale, layer, matchline, chainage…) agreed with the #431 reporter before the
  bulk translation. Starting points from #431: takeoff → Aufmaß / Mengenermittlung, markup →
  Markierung / Kommentar. Terms should match what German construction staff already use.
  Stored as `packages/i18n/glossary/de.csv` so it carries into review and future tools.
- **Machine draft.** Claude translates the catalog with the glossary, dialog screenshots and
  translator comments (`// translators:` comments, which become `#.` notes in the PO file, on ambiguous strings, e.g. "Count" noun vs verb).
- **Review.** The reporter reviews the glossary and the ~500 most-seen strings (menus, ribbon, main
  panels). Until then the language ships as `status: 'preview'`.
- Formal address (*Sie*), consistent with German business software.

## Quality gates (CI and `pnpm verify`)

- A no-English-literals check (extract script, or a small lint rule): report during the sweep, fail
  after, so new English literals can't land in UI code.
- `pnpm i18n:check` (in `pnpm verify`): fails on non-literal messages, ICU syntax errors, or
  placeholder mismatch (`{count}` missing from a translation).
- Completeness % per language reported on PRs that touch catalogs.
- E2E stays in English. One smoke spec each for `en-XA` and `de` opens every ribbon tab and major
  dialog and asserts no element overflows its box and (for `en-XA`) no unbracketed string remains.
- Bluebeam round-trip harness run with the UI in German; saved PDFs must match the English run.

## PR stack

| # | PR | Notes |
|---|---|---|
| 1 | `packages/i18n`: runtime, ICU, PO, extract/check scripts, registry, Vite plugin, `uiLanguage` setting, picker, `<html lang dir>`, pseudo-locales | No visible change in English |
| 2 | `numberFormat` setting, `formatNumber` / `parseNumber` and locale-aware inputs | Unit tests per locale |
| 3–10 | String sweep by area: commands + menus; ribbon + toolbar; markup / measure / CAD tool labels; panels; dialogs; Preferences; takeoff + estimating + reports; studio, signatures, toasts, errors | Lint `warn`; pseudo-locale smoke grows each PR |
| 11 | Desktop main-process strings + installer | |
| 12 | No-literals check → fail, catalog checks in CI, logical-CSS rule | |
| 13 | German glossary + catalog + `dictionary-de` | `status: 'preview'` |
| 14 | German review fixes, `status: 'reviewed'` | Closes #431 |

Effort: PRs 1–12 are the bulk, roughly 2–3 weeks of agent time, mostly mechanical. German is
hours to draft plus the reviewer's time.

## Adding a language later

Every language, whatever its script:

1. Add a registry entry in `packages/i18n/locales.ts`.
2. Build a glossary with a native-speaking reviewer, then Claude drafts the catalog.
3. Ship as `status: 'preview'`; switch to `reviewed` after sign-off.
4. Add its spelling dictionary and OCR pack if they exist.

No framework change. Some scripts also need a **one-time feature for that script family**, built
the first time a language in it is requested and reused by every later one:

| Script family | Examples | One-time work | Rough cost |
|---|---|---|---|
| Latin, Cyrillic, Greek | es, fr, pt-BR, ru, id, tr, vi, pl, it | None | — |
| CJK | zh-CN, zh-TW, ja, ko | `line-break: strict`, no italics for Han, on-demand Noto CJK for PDF output (system fallback already exists in `documents/archiveFonts.ts`) | ~2 days |
| Right-to-left | ar, fa, ur, he | Convert existing CSS to logical properties, mirror directional icons (not the page canvas, rulers or PDF content), numeric fields `dir="ltr"`, bidi ordering (`bidi-js`) for PDF text, Nastaliq web font for Urdu | ~1 week |
| Complex shaping | ar/fa/ur, hi, mr, bn, ta, te, th | HarfBuzz (`harfbuzzjs`, WASM, loaded on demand) to shape markup text and reports written into PDFs, plus on-demand Noto fonts. Reports (`packages/markup/src/report.ts`) currently use Helvetica only | ~1 week |

Help pages translate per language when demand justifies it: Markdown sources under
`public/help/pages/<lang>/` with English fallback, and a `--lang` flag on `scripts/help/shots.cjs`
for localized screenshots.

When requests start arriving regularly, move review onto hosted Weblate (free for open source) so
reviewers work in a browser without git. The PO catalogs need no change for this.

## Risks

- **Wrong construction terms** look worse than English. Mitigation: glossary review before the bulk,
  "Preview" badge until sign-off.
- **Translated data leaking into files** breaks round trips. Mitigation: the display/data split and
  the harness check.
- **String drift** as features land. Mitigation: lint error, English fallback, catalog checks in CI.
- **Sweep conflicts** with open PR stacks (IFC viewer, text spans). Mitigation: one area per PR,
  mechanical commits, coordinate with stacks touching the same files.
- **Ribbon overflow** in German. Mitigation: `en-XA` smoke before the German catalog lands.
