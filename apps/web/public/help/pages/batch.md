# Batch: run a task on many files

The **Batch** menu does the same job to many PDFs in one go: flatten a whole issue, OCR a folder of scans, stamp every sheet, and so on.

![The Batch menu](img/menu-batch.png)

## How every batch command works

1. Open the files once, so they are in [File Access](#file-access).
2. Choose the command from the {{Batch}} menu.

   ![The Batch Flatten window](img/batch-flatten.png)
3. Set the command's options (they are the same as for one file).
4. Under **Files**, tick the files to work on. **Choose…** ticks **All files**, **None**, the files of a [Set](#sets), or a File Access group.
5. Leave **Keep each file as it was as a revision** ticked, so you can go back. See [Revisions](#revisions).
6. Click **Run on *n* files**.

A list shows each file with ✓ (done) or ✗ (failed, with the reason). You can switch the **Command** at the top of the window without closing it.

## The batch commands

| Command | Does to each file | Same as, for one file |
|---|---|---|
| **Combine PDFs…** | Joins them into one PDF. | [Combine](#combine) |
| **Slip Sheet…** | Slips new revisions into sets. | [Slip sheet](#slip-sheet) |
| **Auto-Link Sheets…** | Links sheet references across the files. | [Batch Auto-Link](#batch-link) |
| **Compare Documents… / Overlay Pages…** | Compares two sets. | [Compare](#compare), [Overlay](#overlay) |
| **Flatten… / Unflatten…** | Burns in (or brings back) markups. | [Flatten](#flatten) |
| **OCR…** | Makes scanned pages searchable. | [OCR](#ocr) |
| **Reduce File Size… / Repair…** | Shrinks or repairs. | [Reduce and repair](#reduce-repair) |
| **Colour Processing…** | Turns drawings grey or black. | [Colour processing](#colour) |
| **Headers & Footers… / Remove Headers & Footers…** | Adds or removes headers, footers, page and Bates numbers (numbered on across the files). | [Headers and footers](#header-footer) |
| **Apply Stamp…** | Places a stamp on each file. | [Stamp](#tool-stamp) |
| **Crop Pages… / Page Setup…** | Crops or resizes every page. | [Crop](#page-crop), [Page setup](#page-setup) |
| **Split…** | Splits each file; all parts come in one ZIP. | [Split](#page-split) |
| **Page Labels (AutoMark)…** | Writes sheet numbers into each file. | [Batch Page Labels](#batch-page-labels) |
| **Sign & Seal…** | Signs each file with a Digital ID. | [Batch Sign](#batch-sign) |
| **Markup Summary… / Print…** | One report, or one print run, for all. | [Batch Summary and Print](#batch-summary-print) |

> **Tip:** You can keep working while a batch runs. Progress shows at the bottom of the screen.
