# Keep the list in a spreadsheet

**Sync to Excel** writes the Markups list to an Excel workbook, in OneDrive or on your computer, and keeps it up to date as markups are added, changed or removed. Measurements go in as numbers, so the sheet can total them.

1. Click **Sync to Excel…** on the list's toolbar.

   ![The Sync Markups to Excel window](img/sheet-sync.png)
2. Type a **Name** for the spreadsheet.
3. Choose where the workbook goes:
   - **Excel on this computer** (redcolumn desktop app on Windows): choose a folder and file name. The workbook updates even while it is open in Excel.
   - **Excel in OneDrive**: sign in to your Microsoft account when asked, and allow access.

The button changes to **Sync to Excel ✓**. The sheet uses the list's visible columns, filter and sort.

> **Important (Excel in OneDrive):** Close the workbook in Excel to let it update. While it is open in Excel (desktop or the web), Excel may lock the file and the update cannot be saved. The button shows **Sync to Excel ⚠** until you close it, then catches up by itself.

Click **Sync to Excel ✓** again to **Sync now** or **Stop syncing**.

If an update fails, the button changes to **Sync to Excel ⚠** and redcolumn keeps trying again by itself. Click it to see why, or to **Retry now**. If your Microsoft sign-in has expired, click **Reconnect** to sign in again.

> **Note:** Excel in OneDrive needs an internet connection, and the redcolumn site must be set up for Microsoft sign-in. If the button says sign-in is *not set up for this site*, ask whoever runs your redcolumn site (see `docs/CLOUD-SETUP.md`).

> **Your own work:** each update replaces the Markups sheet. In a workbook on this computer, other sheets you add are kept, so put your own formulas there. A OneDrive workbook is replaced whole on each update, so keep your own formulas in a separate workbook that links to it.

> **Tip:** A workbook on this computer is written straight into Excel while it is open there, and Excel saves it. If you are typing in a cell, the update waits until you finish. Click the workbook's name in the Sync to Excel window to open it, or **Show in Folder** to find it.
