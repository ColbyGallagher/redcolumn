# Translation catalogs

One gettext PO file per language (`de.po`), named by the code in `src/locales.ts`. The English text
is each entry's `msgid`; plurals and placeholders are ICU MessageFormat inside `msgstr`.

- `pnpm i18n:extract` adds new messages to every catalog and writes `messages.pot` (the template,
  not committed).
- `pnpm i18n:check` fails on ICU syntax errors or a translation whose `{placeholders}` differ from
  the English.

Entries marked `#, fuzzy` or left empty show English.

Each language also has a glossary of its construction and PDF terms in `../glossary/<code>.csv`
(English, translation, note). Translate with the glossary so the same term reads the same way
everywhere, and change the glossary first when a term changes.
