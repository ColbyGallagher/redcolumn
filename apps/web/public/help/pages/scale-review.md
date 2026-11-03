# Check sheet scales against the sheet size

A title block's scale is only right at the sheet size it was written for. A drawing marked *1:100 @ A1* but saved or printed at A3 is half size, so it really measures at 1:200. **Review Sheet Scales** reads every sheet's scale and checks it against the size the page actually is.

1. Open the set and wait a moment while redcolumn reads the title blocks.
2. Choose {{Document > Review Sheet Scales…}}. On the ribbon it is **Measure > Review Scales**.

   ![The Review Sheet Scales panel](img/scale-review.png)
3. Check each row. **Sheet** shows the size the scale was written for and the size the page is (*A1 → A3*). **Proposed** is the scale to measure with, already corrected for the size.
4. Tick the pages to set. Pages that need no checking are ticked for you.
5. Click **Apply to *n* pages**. Undo takes it back.

What each status means:

- **Ready**: the page is the size its scale was written for.
- **Resized**: the page is a different size, so the proposed scale is corrected for it.
- **Check**: the page is cropped or padded. Measure a known dimension before trusting the scale. See [Calibrate from a known length](#calibrate).
- **Matches**: the page scale is set and agrees with the title block.
- **Differs**: the page scale is set and disagrees with the title block. Find out which is right before measuring.
- **Not to scale**: the title block says NTS. Don't measure this sheet.
- **No scale**: no scale was found. Set it by hand. See [Set the scale](#scale).

redcolumn finds the sheet size in the scale itself (*1:100 @ A1*, *1:500 (A1)*, *1:100 AT A1 / 1:200 AT A3*) or in a separate *SHEET SIZE* box. If your title block is not read, add a **Sheet size** box to its [drawing standard](#drawing-standards).

> **Tip:** Click a page name to go to that page and check the sheet while the panel stays open.
