# Portals: mirror takeoff across typical floors (Experimental)

A **portal** is an area that is the same on several sheets, such as the typical part of a floor plan that repeats on levels 2 to 8. Anything you measure or mark up inside the portal on one of those sheets also appears on the others, and stays in step when you change it. The parts of each sheet outside the portal are traced as usual.

## Define a portal

1. Open the sheet with the typical area and choose **Tools › Takeoff › Define Portal (Experimental)**.
2. Click the corners of the area that is the same on every typical floor. Press **Enter** or click the first corner to close the outline.
3. In **Define Portal**, name it and tick the **linked pages**. The page you outlined it on is always included.
4. Click **Create Portal**.

The portal sits at the same page coordinates on every linked page and is outlined on each of them. Version 1 does not align sheets, so use it on sheets that are registered the same way.

If a linked page has a different scale from the page you outlined it on, the dialog warns you. Mirrored measurements on that page would not match the others.

## What gets mirrored

- A markup or measurement you **draw wholly inside** the portal on any linked page is copied to every other linked page.
- A markup that **crosses the edge** of the portal stays on its own page.
- **Moving, reshaping, deleting** or changing the **style, subject, label, layer, assembly or custom columns** of any copy changes every copy. One **Undo** takes the change back on every page.
- Each copy keeps its own **status, replies, checkmark and flag**, so you can review each floor separately.
- Connectors, grouped markups, signatures and file attachments are not mirrored.

## Quantities

Each copy is a real markup on its page, so it counts once per page. Totals by page and by assembly stay correct, and each copy is saved as an ordinary PDF annotation on its page that other PDF tools can read.

## Break a link

To make one floor different, select the copy and choose **Tools › Takeoff › Break Portal Link (Experimental)**. It becomes an ordinary markup on that page. The other copies stay linked to each other.

## Change or remove a portal

**Tools › Takeoff › Portals… (Experimental)** lists the document's portals. Pick one to rename it, change its linked pages, or **Remove Portal**. Removing a portal keeps its copies, as ordinary markups on each page.

Portals and their links are saved in the PDF.

## Not in this version

- Aligning sheets that are offset (two-point align)
- Clipping markups at the portal's edge
- Carrying portals over to slip-sheeted revisions
- Portals across several documents
