# Edit the list in Excel and bring it back

Export the Markups list to an Excel workbook, change it there (or send it to someone who will), then import it. Statuses, comments and column values that changed come back onto the markups, and answers typed in the **New reply** column become replies.

This works in the web version and the desktop app.

## Export

1. Arrange the list: show the columns you want in the workbook ([Columns](#list-columns)).
2. Choose {{File > Export > Markups for Excel}}. A workbook named after the document, ending in **markups.xlsx**, is saved to your computer.

In the workbook:

- **Status**, **Checkmark** and dropdown columns have a dropdown with the document's values. Date and number columns only accept a date or a number.
- **New reply** is blank. Type an answer there to reply to that row's markup.
- Rows can be sorted and filtered.

These columns can be changed: **Subject**, **Label**, **Layer**, **Status**, **Checkmark**, **Comments**, and your own columns except calculations. Changes to anything else (ID, page, measurements, author, dates) are ignored.

> **Note:** The workbook has a hidden first column and a hidden sheet named **_redcolumn**. They record which row belongs to which markup and what was exported. Leave them in place: they are how the import knows what changed.

## Import

1. Open the same document.
2. Choose {{File > Import > Markups from Excel…}} and pick the workbook.
3. Check the preview. It lists every change: the markup's ID and sheet, the column, the value in the document and the value in the workbook.
4. Untick any change you do not want.
5. If replies are being added, check the name in **Replies are from**.
6. Click **Apply**.

The whole import is one step: [[Ctrl+Z]] takes all of it back.

## What the preview tells you

- **Changed in both** — the cell was changed in Excel, and the same markup was changed in redcolumn since the export. It is unticked: tick it to take the workbook's value.
- **Unknown value** — a status or dropdown value the document does not have, or text in a date or number column. Choose **Map to** to say which value was meant, or leave those cells alone.
- **Rows skipped** — rows typed into the workbook that have no markup. Importing never adds markups.
- **Rows no longer in the sheet** — rows that were deleted in Excel. Importing never deletes markups.
- **Row matched by its text** — the row had lost its key and its ID, and was found by its sheet number and comment. It is unticked: check it is the right markup before you tick it.
- **Not your markup** — in a Live Session you can set the status and checkmark of someone else's markup and reply to it, but not change its other values.

Importing the same workbook twice is safe: the second time there is nothing left to change.

> **Tip:** If someone copies the rows into a new workbook, the hidden column and sheet are lost. The import then finds rows by the **ID** column, so keep that column in the list when you export.

> **Warning:** A workbook exported from another document is stopped with a message. Choose **Import anyway** only when you know the markups are the same, for example a copy of the same PDF.

See also [Export the list (CSV, summary)](#list-export) and [Keep the list in a spreadsheet](#sheet-sync).
