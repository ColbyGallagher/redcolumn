# Takeoff reports (PDF, Excel, CSV)

**Reports** turns your measurements into the lists an estimator hands on: what to order, what it costs, where it is. Open it from the **Takeoff** tab's **Output** group, or **Tools › Takeoff › Takeoff Reports…**.

1. Tick the **reports** you want.
2. Choose what they **cover**: all pages, the current page, the selected markups, or the Markups list as you have filtered it.
3. Choose the **file**: PDF, Excel or CSV. For a PDF, pick A4 or Letter paper (landscape).
4. Click **Export**.

## The reports

- **Quantity Summary by Item** lists each item once, grouped by category: item number, description, unit, net quantity, waste %, gross quantity, the **order quantity** (rounded up as the item says, once on the total), unit cost and extended cost, with a cost total.
- **Quantities by Assembly** shows each assembly's items under its name, with a cost subtotal for the assembly.
- **Quantities by Sheet** shows the items on each sheet (its sheet number, else "Page N"), with a subtotal for the sheet.
- **Measurement Detail** has one row per measurement: page, subject, label, type, plan quantity, unit, slope, slope factor, true quantity, cutouts (count and area taken off), depth, whether the quantity was typed in, and the assembly.
- **Count Schedule** counts by subject and sheet, including typed counts, with totals.

The item reports use your assemblies and the [Items](#estimating-items) catalog, so an item shows its item number, category and cost from there. Measurements without an assembly appear in Measurement Detail and the Count Schedule only.

## Units and scales

Quantities are in each page's display units, the same as the Markups list. Quantities in different units are shown on separate rows and never added together; only costs are added. When the pages you report on have different scales, the PDF says so under its title.

## The files

- **PDF** has the document name, report title, date and what it covers at the top of every page, right-aligned numbers, subtotal and total lines, and "Page x of y".
- **Excel** is one workbook with a sheet per report. Numbers stay numbers, so you can sum and sort them. The header row is bold and frozen.
- **CSV** is one file per report (a zip when you pick more than one). Groups go in a leading **Group** column and subtotals are left out, so a column can be summed. Text that a spreadsheet could read as a formula is kept as text.

> **Tip:** To keep the Quantity Summary in a workbook that updates as you measure, use [Sync to Excel](#sheet-sync) with **Include a Quantities sheet**.
