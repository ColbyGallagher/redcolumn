# Split a document

Splits one PDF into several smaller PDFs.

1. Choose {{Document > Split Document…}}.

   ![The Split Document window](img/split-document.png)
2. Choose how to split it:
   - **Files of *n* page(s)** — a new file every *n* pages. Type `1` for one file per page.
   - **Files of up to *n* MB** — fills each file with pages until the next page would take it over the size, for example to fit an email attachment limit. Pages are never cut, so a page bigger than the limit gets a file of its own.
   - **One file per top-level bookmark** — a file for each main [bookmark](#bookmarks) (for example each discipline).
3. Choose how to name the files. Type a **Number** pattern, where `#` is the part number (for example `Part-#`), and put it **After the file name** (`Drawings Part-1.pdf`) or **Before the file name** (`Part-1 Drawings.pdf`). When splitting at bookmarks you can name the files by **Bookmark titles** instead. Numbers are padded with zeros (`01`, `02`…) when there are ten or more files, so they sort in order.
4. Click **OK**.

The new files are saved to your computer. The original document is not changed.

> **Tip:** To pull out just a few pages, use [Extract Pages](#page-delete-extract) instead.
