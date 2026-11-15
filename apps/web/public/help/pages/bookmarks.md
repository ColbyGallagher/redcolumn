# Bookmarks

Bookmarks are a clickable table of contents for the PDF. **Places** are named views (a page at a certain zoom) that links can jump to.

## Open the panel

Click **Bookmarks** on the panel rail, or press [[Alt+B]].

![The Bookmarks panel](img/bookmarks-panel.png)

## Make a bookmark for every sheet

Click **From labels**. A bookmark is made for each page, named from its [page label](#page-labels) and title.

![Bookmarks made from page labels](img/bookmarks-made.png)

## Name bookmarks from the title block

When the sheet number and title are not what redcolumn read, or you want the bookmark to say something else (the title only, or number, title and revision), show it where to read:

1. Click **From regions…**. The [Page Labels from Regions](#page-labels) panel opens with **Set as** on **Bookmark**.
2. Drag a box around the sheet number in the title block, and another around the sheet title. Add more boxes for anything else you want in the name.
3. Use **↑** and **↓** to put the boxes in the order the name should read, and choose what to **Join with**.
4. Check the preview (*Page 1: A-101 - FLOOR PLAN*), choose the **Pages**, and click **Apply to *n* pages**.

Each page's bookmark is named by the text found in the same boxes on that page. A page that already has a bookmark keeps it where it is, in its folder, with the new name; a page with none gets a new one. Folders, bookmarks for a zoomed view and bookmarks that open a web page, a Place or another document are left alone. A page with no text in the boxes is left as it was, and a note says how many.

Page labels are not changed. To set those from boxes too, choose **Page label** or **Sheet title** under **Set as**.

> **Tip:** On a scanned set, run [OCR](#ocr) first so there is text in the boxes to read.

## Add a bookmark yourself

1. Go to the page, and zoom to the view you want the bookmark to open.
2. Click **+ Add**, or press [[Ctrl+B]] to add one for the view you are on. Type a name and press [[Enter]].

**+ Child** adds a bookmark under the selected one (for example sheets under *Architectural*).

## Change bookmarks

Select a bookmark, then use the small buttons:

| Button | Does |
|---|---|
| ✎ | Rename |
| × | Delete it (and the ones under it) |
| ↑ / ↓ | Move up or down |
| ← / → | Move out of its parent / nest under the one above |
| 🔗 | Change where it goes: a page, a Place, a web page or another document |
| ⌖ | Point it at the current view |

Click a bookmark to go to it.

## File sheets under a template

For a drawing set, choose a **Template** (the list at the end of the buttons) and **Apply Construction Documents**. Each page becomes a bookmark in the folder for its discipline, in the slot for its hundred of sheet numbers: *A-101* goes in *Architectural › A-100*, *C-205* in *Civil › C-200*. Sheets the template has no slot for go in *Other*; empty folders are left out. Applying replaces the current bookmarks, after asking.

The pages are filed by the sheet number redcolumn read from each page, so sheets named like *A-101* or *A101* work best. A note under the buttons says how many pages were filed and which were not.

To use a template from Bluebeam® Revu®, choose **Import template…** and pick its `.xml` file (Revu keeps them in its settings folder, e.g. `Construction.xml`). A Revu categories file (`Categories\*.xml`) can be imported the same way: it becomes a Sets category template, in Preferences › Sets › Categories, where **Load…** and **Export for Revu** also read and write it.

## Places

A Place is a saved view with a name, such as *Kitchen detail*. [Links](#actions) can jump to a Place. If the drawing changes, move the Place and every link to it follows.

- **+ Add Place** — name the current view as a Place.
- Use the buttons beside a Place to rename it, move it to the current view, or delete it.

> **Note:** Bookmarks are saved in the PDF, so other PDF programs show them too.
