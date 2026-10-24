# Revu-produced fixtures to export

The compatibility run (`pnpm --filter @nb/markup compat`) reads every file listed in
`manifest.json` from `REDCOLUMN_COMPAT_DIR` (default: `reference_data/` at the repo root, which is not
committed). A cell of `docs/compatibility.md` reads **Supported** only once a Revu-made file covers it.
These files fill the gaps listed in issue #103. Until they exist, the run lists each as missing.

Make each file in **Bluebeam Revu** (any recent version), starting from a blank or plain one-page
PDF. Save the PDF under the name given, then export its markups as XFDF with **Markups list ›
Markup list menu › Export › XFDF** (or File › Export › Markups › XFDF) under the matching `.xfdf` name.
Put all of them in `reference_data/`.

Vary the styles a little (colours, line widths, opacity, fonts) so a dropped property shows up.
Give every markup a short comment, and set a status on a few, so replies and states are covered too.

| File | What to put on the page |
|---|---|
| `revu-stamps.pdf` / `.xfdf` | Several stamps: a built-in text stamp (*Approved*, *Draft*), a dynamic stamp that shows the date and user, an image stamp, a stamp rotated 90°, and one at 50% opacity. |
| `revu-text-markup.pdf` / `.xfdf` | A line or two of real PDF text (type it with the Typewriter tool and flatten it, or use a PDF with text), then a **Highlight**, **Underline**, **Strikethrough** and **Squiggly** on different words, one spanning two lines. |
| `revu-popups.pdf` / `.xfdf` | Five markups (a cloud, a rectangle, a note, a callout, a line) each with a comment. Open the pop-up of three of them, move one pop-up away from its markup, and resize another. Add a reply to one. |
| `revu-attachments.pdf` / `.xfdf` | Two **File Attachment** markups (a small `.txt` and a small `.pdf`) with different icons (*Paperclip*, *Tag*), and a **Sound** markup if Revu offers it. Also attach a file to the whole document (Attachments tab), to check that it is kept. |
| `revu-forms.pdf` / `.xfdf` | Form fields: a text field (filled in), a multi-line text field, a check box (ticked), two radio buttons in one group, a list box, a combo box with a value chosen, a date field, and a button. For the `.xfdf`, use Forms › Export Form Data › XFDF. |

When the files are in place:

```bash
pnpm --filter @nb/markup compat
```

Then look at **Items that did not come through** in `docs/compatibility.md`. Fix what fails to round
trip, or list it under **Known limits** in `test/compat/matrix.ts`, so nothing is dropped silently.
