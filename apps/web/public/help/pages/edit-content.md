# Erase, cut and edit PDF content

These tools change the **drawing itself**, not markups. Use them with care.

All three are in {{Edit > PDF Content}}:

![Edit, PDF Content](img/menu-pdf-content.png)

## Erase Content

Removes part of the drawing (lines, text and pictures) under a box.

1. Choose {{Edit > PDF Content > Erase Content}}.
2. Drag a box over what to remove. Let go and it is gone.

   ![Dragging an erase box over a line of notes](img/erase-content.png)

## Erase Across Pages

Removes what is inside the same boxes on many pages at once, such as a header, footer or note along the side that repeats on every page.

1. Choose {{Edit > PDF Content > Erase Across Pages…}} (or {{Document > Erase Headers & Footers…}}).
2. The panel looks for text that repeats at the same place near the edges of most pages and adds a box for each: **Header**, **Footer**, **Left side** or **Right side**. Each box shows its text on the current page and how many of the chosen pages have text in it.
3. Remove any box you want to keep with **×**, or add your own with **+ Draw box**. Boxes are outlined on every page, so scroll through to check them. **Find repeated text** looks again (for example after changing the pages).
4. Choose what to **Remove**:
   - **Text only** (the default) leaves lines, shapes and pictures in the boxes as they are.
   - **Everything** also removes lines and shapes wholly inside a box and paints over the parts of pictures inside.
5. Choose **Leave blank**, or **Cover with** a coloured box.
6. Tick **Also delete markups inside the boxes** to delete markups there too.
7. Choose the **Pages**: all, odd, even, or a range such as `2-10, 15`.
8. Click **Erase on N pages**.

On pages of another size, each box keeps its distance from the nearest edge, so a footer stays at the bottom.

## Cut Content

Like Erase, but first copies what was there to the clipboard as a picture, so you can paste it somewhere else (as an [Image](#tool-image)).

1. Choose {{Edit > PDF Content > Cut Content}}.
2. Drag a box over the area.
3. Click where you want it and press [[Ctrl+V]].

## Edit Text

Changes the words of text in the PDF, or adds new text.

1. Choose {{Edit > PDF Content > Edit Text}}.
2. Click on the text to change. It flashes, and a box shows its words.

   ![Editing a line of text](img/edit-text.png)
3. Change the words and click **Replace**.

Click where there is no text to **add** new text to the page (in Helvetica, 10 pt).

> **Note:** If the PDF's own font doesn't have a letter you typed, the text is set in Helvetica instead.

> **Warning:** These change the PDF content for everyone who opens the saved file. Press [[Ctrl+Z]] to undo straight away. For removing private information safely, use [Redaction](#tool-redaction).
