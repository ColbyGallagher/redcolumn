# Snapshot

Copies part of the page, with its markups, as a picture. Paste it into an email, a report, or back onto another page.

![Snapshot: drag a box round the area to copy as a picture](gif/tool-snapshot.gif)

## Take a snapshot

1. Choose {{Edit > Snapshot}} (or press [[G]]).

   ![Edit menu with Snapshot highlighted](img/pick-snapshot.png)
2. Drag a box around the area to copy (or click its corners, below).

   ![Dragging a snapshot box around the kitchen](img/draw-snapshot.png)
3. Let go. A message says **Snapshot copied to the clipboard**.
4. Paste it where you want it with [[Ctrl+V]]: in another program, or on any page in redcolumn (it becomes an [Image](#tool-image) markup the same size as the area you captured, whatever the zoom).

## A box snapshot stays vector

Pasted back into redcolumn, a box snapshot keeps the drawing's lines as lines, the way Bluebeam Revu's snapshots do:

- It stays sharp however far you zoom in.
- Drawing and measuring tools snap to its lines, ends, corners and crossings, just as they snap to the drawing (when **Snap Content** is on in the status bar). Smart Fill sees its lines too.
- Saved or flattened into a PDF, it is written as vector content, so other PDF readers show it sharp as well.

Markups that were inside the box come along as a picture laid over the lines. Pasted into another program, a snapshot is a picture, as before. If you **Change Colours…** on a snapshot, it becomes a plain picture. Snapshots of a shape (below) are always pictures. To copy pictures only, turn off **Keep Snapshots Vector** in [Preferences](#preferences) › **Tools** › **Markup**.

## Snapshot a shape instead of a box

To copy an area that is not a rectangle, choose {{Edit > Snapshot}} and, instead of dragging, click the corners of the area one by one. Click the first corner again (or double-click, or press [[Enter]]) to finish. The picture is the smallest box round the outline, and everything outside the outline is see-through. Press [[Esc]] to cancel.

Corners, and the corners of a dragged box, snap to the drawing the way other drawing tools do. Use the snap settings in the status bar to choose what they snap to, and hold [[Alt]] to place a corner without snapping.

## Change a snapshot's colours

Right-click a snapshot (or any [Image](#tool-image) markup) and choose **Change Colours…**. The window lists the colours the picture mostly uses, with the picture as it is (**Current**) beside how it will look (**Preview**). Pick a new colour for each one you want to change, or tick **See-through** to remove it (handy for a white background), then click **Change**. Soft edges follow the colour they sit next to.

> **Tip:** For a sharper picture (a shape snapshot, or one pasted into another program), raise the **Snapshot Resolution** in [Preferences](#preferences) › **Tools** › **Markup**.
