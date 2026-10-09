# Apply a scale to many pages

In a big set, sheets are drawn at different scales. Instead of setting each page by hand, redcolumn can read the scale note from each sheet's title block.

1. Go to a page that shows the scale note, for example *SCALE 1/4" = 1'-0"*.
2. Choose {{Document > Bulk Apply Page Scale…}}.

   ![The Bulk Apply Page Scale panel](img/scale-regions.png)
3. Drag a box around the scale note in the title block. The scale it reads is shown under the box.
4. Choose the **Pages**: **All**, **Current**, or a range like `1-5, 8`.
5. Click **Apply to *n* pages**.

Each page gets the scale read from the same box on that page. Pages where no scale is found are left as they were.

> **Tip:** If one box doesn't catch every sheet (title blocks differ), draw another box. Each box is tried in turn.

For a single scale on every page, it is quicker to set it once and click **All pages** in the navigation bar. See [Set the scale](#scale).
