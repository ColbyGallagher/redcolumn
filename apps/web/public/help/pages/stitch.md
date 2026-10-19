# Stitched view (join sheets)

Long jobs like roads, pipelines and big buildings are often split across several sheets, joined at **match lines** (for example *MATCH LINE — SEE C-102*). redcolumn can join those sheets back together so you can view and measure across them as one drawing.

![Three road sheets stitched together along their match lines](img/stitched.png)

## Turn on the stitched view

1. Open the drawing set. redcolumn reads the sheets and finds the match lines by itself. This takes a few seconds; you can see the progress at the bottom of the screen.
2. Go to one of the sheets that has a match line.
3. Choose {{View > Stitched View}}.

The joined sheets appear as one drawing, each turned and lined up to fit. You can zoom, pan, mark up and measure across the joins.

## Go back to normal

Choose {{View > Stitched View}} again.

> **Note:** **Stitched View** is greyed out when the current page has no match line that redcolumn recognised. The match line needs a label with the words *MATCH LINE* and the number of the sheet it joins. Otherwise, mark the match lines yourself (below).

## Pick the match lines yourself

> **Experimental:** the Stitching panel and Stitch to New Page are new. Check the joins before you rely on measurements across them.

When redcolumn doesn't find a match line by itself (the label is worded differently, the sheets are scanned, or the sheets are at different scales), mark the match lines yourself. Nothing is guessed: two clicks on each sheet fix how the sheets meet.

1. Choose {{Document > Stitching…}}. The **Stitching** panel opens.
2. **Leave out the title block.** On each sheet, choose **Select Region** and drag a box around the drawing, or choose **Polygon** and click the corners of an L-shaped drawing area (click the first corner again to close it). What is outside the region is shaded and left out of the stitch. A sheet with no region uses its largest viewport, or the whole sheet when it has none.
3. **Mark the match line.** Choose **+ Match Line**, then click both ends of the match line on the first sheet. Go to the next sheet and click both ends of the same line there. Snapping helps you land on the line's ends. The tool stays on until you choose it again.
4. **Match the lines.** When only one line is waiting for a partner, a new line on another sheet is matched to it straight away. Otherwise pick the partner in the line's **Match to** list, or give both lines the same name (the station, say *STA 12+00*) and choose **Match by Name**. Matched lines show green, lines still waiting show red.
5. Check the arrow on each line points into the part of the sheet that stays. If it points the wrong way, choose **⇄**.
6. Choose **Stitched View** to see the sheets joined.

The ends of the two lines meet, so a sheet drawn at a different scale is scaled to fit the first sheet. Click the same two ends in either order.

## Adjust a join

If the sheets don't quite meet, you can fix it by hand. Keep {{View > Stitched View}} on to see the result as you go.

- **Move a match line's end:** with the Stitching panel open, drag either end of a line. It snaps like any drawing tool. The join updates when you let go.
- **Slide a sheet:** select a matched line in the panel. Its row shows which sheet moves (the one placed from the other). Then either:
  - use the **◀ ▶** buttons (along the match line) and **▲ ▼** buttons (across it), with the step size next to them. With the row selected, the arrow keys do the same (hold Shift for ten steps).
  - choose **Move Sheet** and drag the sheet in the Stitched View. **Lock along line** keeps the drag sliding along the match line.
- **Reset** puts the sheet back where the line ends place it.

To adjust sheets that redcolumn joined by itself, choose **Edit Detected Lines** in the Stitching panel. The joins it found become match lines you can move, still placed exactly as they were.

Every change can be undone with {{Edit > Undo}}.
## Stitch to a new page

To keep the joined sheets as a page of their own, for takeoffs, markups or sending:

1. Go to one of the stitched sheets.
2. In the Stitching panel, choose whether to **Include markups**, then choose **Stitch to New Page** (also {{Document > Stitch to New Page}}).

redcolumn adds one page at the end of the document. Each sheet is cut at its region and match lines and joined to the next, and the drawing stays sharp (vector). Markups on the kept parts of the sheets are copied onto the new page, so they turn and scale with their sheets. The new page takes the first sheet's scale, so you can measure across the joins.

> **Tip:** **Erase All** removes every match line and region in the document. The new page stays.
