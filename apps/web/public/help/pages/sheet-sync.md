# Keep the list in a spreadsheet

**Sync to Excel** writes the Markups list to an Excel workbook on your computer, and keeps it up to date as markups are added, changed or removed. Measurements go in as numbers, so the sheet can total them.

> **Important:** Sync to Excel only works in the redcolumn **desktop app on Windows**, with Excel installed, and it works locally only. In the web version, **Sync to Excel…** offers the desktop app to download instead.

1. Click **Sync to Excel…** on the list's toolbar, or on the **Takeoff** tab's **Output** group ([The Takeoff tab](#takeoff-tab)).

   ![The Sync Markups to Excel window](img/sheet-sync.png)
2. Type a **Name** for the spreadsheet.
3. Click **Choose Workbook…**, then pick a folder and file name.

The button changes to **Sync to Excel ✓**. The sheet uses the list's visible columns, filter and sort.

Click **Sync to Excel ✓** again to **Sync now** or **Stop syncing**.

If an update fails, the button changes to **Sync to Excel ⚠** and redcolumn keeps trying again by itself. Click it to see why, or to **Retry now**.

## Quantities sheet

Tick **Include a Quantities sheet** (before you choose the workbook, or later in the Sync window) to keep a second sheet, **Quantities**, in the same workbook. It holds the Quantity Summary by Item ([Takeoff reports](#takeoff-reports)) for every measurement in the document, and is replaced by each update just like the Markups sheet. Untick it to stop updating it; the last version stays in the workbook.

> **Note:** While the workbook is open in Excel, updates write the values into both sheets. Number formats and bold totals come from the file as first written, so if the rows move while Excel has the workbook open, the formatting can lag until the next time it is written while closed.

> **Your own work:** each update replaces the Markups sheet. Other sheets you add to the workbook are kept, so put your own formulas there.

> **Tip:** The workbook is written straight into Excel while it is open there, and Excel saves it. If you are typing in a cell, the update waits until you finish. Click the workbook's name in the Sync to Excel window to open it, or **Show in Folder** to find it.
