# Interface text and translation

Every word the user can read goes through `@nb/i18n`. The design is in
[docs/i18n-plan.md](../../docs/i18n-plan.md); catalogs are described in [catalogs/README.md](catalogs/README.md).

## Writing text

- `msg('Save changes?')`, `msgc('verb', 'Count')` for English with two meanings, `msgParts(...)` when a
  value is a React element. Placeholders are ICU: `msg('{count, plural, one {# page} other {# pages}}', { count })`.
- The first argument must be a **string literal**. `pnpm i18n:extract --check` (part of
  `pnpm i18n:check`) fails on a variable or template with substitutions, because the extractor
  reads the literal from the source.
- Never build a sentence from pieces (`msg('Delete') + ' ' + name`): word order differs between
  languages. Put the whole sentence in one message with a placeholder.
- Build text when rendering, not at module top level. A `msg()` that runs before the language is
  chosen stays English (the dev build warns: `messagesBeforeActivation` in `src/runtime.ts`).
- Add a `// translators: ...` comment on the line above when the English is ambiguous.

## What `pnpm i18n:check` fails on

- `scripts/extract.ts --check`: non-literal messages, ICU syntax errors, a translation whose
  `{placeholders}` differ from the English.
- `scripts/no-literals.ts`: English text in JSX, interface props (`title`, `aria-label`,
  `placeholder`, `label`, ...), notice and error setters, and Electron dialog options in
  `apps/desktop/src`. Intentional English (a file format name, say) takes an
  `// i18n-ignore: <reason>` comment or an entry with a reason in `scripts/no-literals-allowlist.json`.
- `scripts/logical-css.ts`: physical `left`/`right` CSS in `apps/web/src` (use `margin-inline-start`,
  `inset-inline-end`, `text-align: start`, ...). Old ones are in `scripts/logical-css-baseline.json`;
  do not add to it. `/* logical-css-ignore: <reason> */` for a real exception (a PDF canvas).

## Catalogs

After adding or changing messages, run `pnpm i18n:extract` and commit the updated `catalogs/*.po`.
Do not machine-translate into the catalogs without saying so in the PR; translations use the
glossary in `glossary/<code>.csv`. e2e tests select by English accessible names, so they run in English.
