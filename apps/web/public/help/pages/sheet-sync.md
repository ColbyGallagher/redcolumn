# Keep the list in a spreadsheet

**Sync to Excel** keeps the Markups list and an Excel workbook on your computer in step, both ways. Markups you add, change or remove go to the workbook. What you type in the workbook's editable columns comes back onto the markups. Measurements go in as numbers, so the sheet can total them.

> **Important:** Sync to Excel only works in the redcolumn **desktop app on Windows**, with Excel installed, and it works locally only. In the web version, **Sync to Excel…** offers the desktop app to download instead. To send a workbook to someone else and bring their edits back, in any version, see [Edit the list in Excel and bring it back](#list-excel).

1. Show the columns you want in the workbook ([Columns](#list-columns)).
2. Click **Sync to Excel…** on the list's toolbar, or on the **Takeoff** tab's **Output** group ([The Takeoff tab](#takeoff-tab)).

   ![The Sync Markups to Excel window](img/sheet-sync.png)
3. Type a **Name** for the spreadsheet.
4. Click **Choose Workbook…**, then pick a folder and file name.

The button changes to **Sync to Excel ✓**.

The sheet has every markup in the document, and the columns the list showed when you made the link. Filtering the list or hiding a column later does not change the sheet. To change its columns, arrange the list, open the Sync window and click **Use the list's columns as they are now**.

Click **Sync to Excel ✓** again to **Sync now** or **Stop syncing**.

If an update fails, the button changes to **Sync to Excel ⚠** and redcolumn keeps trying again by itself. Click it to see why, or to **Retry now**.

## Typing in the workbook

You can change these columns in Excel: **Subject**, **Label**, **Layer**, **Status**, **Checkmark**, **Comments**, and your own columns except calculations. Type in the **New reply** column to reply to a markup. Status, Checkmark and dropdown columns have a dropdown.

- The change appears in redcolumn within about 15 seconds while the workbook is open in Excel. You do not need to save it.
- If the workbook is closed, changes saved in it are picked up the next time redcolumn syncs.
- Other columns (ID, page, measurements, author, dates) are written from redcolumn. Typing in them is replaced.
- Sort and filter as you like: rows keep the order they have in Excel.
- Deleting a row in Excel does not delete its markup. The row comes back.
- Rows you add in Excel are not markups. They are removed by the next update.

Each change made from Excel is one step in redcolumn: [[Ctrl+Z]] takes it back.

## When a cell is paused

If the same cell was changed in Excel and in redcolumn before they could sync, redcolumn does not guess. The button changes to **Sync to Excel ⚠**, and the Sync window lists the cell with both values:

- **Use Excel's** takes the workbook's value into the document.
- **Use this document's** writes the document's value over the workbook's.

Until you choose, that cell is left as it is in Excel. Everything else keeps syncing.

A cell is also paused when Excel has a value its column does not take (a status the document does not have, text in a date column), or when the markup cannot be changed here (someone else's markup in a Live Session).

## Quantities sheet

Tick **Include a Quantities sheet** (before you choose the workbook, or later in the Sync window) to keep a second sheet, **Quantities**, in the same workbook. It holds the Quantity Summary by Item ([Takeoff reports](#takeoff-reports)) for every measurement in the document, and is replaced by each update. Untick it to stop updating it; the last version stays in the workbook.

> **Note:** While the workbook is open in Excel, updates write the values into both sheets. Number formats and bold totals come from the file as first written, so if the rows move while Excel has the workbook open, the formatting can lag until the next time it is written while closed.

> **Your own work:** other sheets you add to the workbook are kept, so put your own formulas there. The workbook also has a hidden first column and a hidden sheet named **_redcolumn**; they record which row belongs to which markup. Leave them in place.

> **Workbooks linked before two-way sync** keep working as before: the sheet follows the list's columns, filter and sort, and typing in it is replaced. Open the Sync window and click **Make it two-way** to change that.

> **Tip:** The workbook is written straight into Excel while it is open there, and Excel saves it. If you are typing in a cell, the update waits until you finish. Click the workbook's name in the Sync to Excel window to open it, or **Show in Folder** to find it.
