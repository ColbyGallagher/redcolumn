# Check sheet scales against the sheet size

A title block's scale is only right at the sheet size it was written for. A drawing marked *1:100 @ A1* but saved or printed at A3 is half size, so it really measures at 1:200. **Review Sheet Scales** reads every sheet's scale and checks it against the size the page actually is. It also checks it against the page's own scale bars and dimensions.

1. Open the set and wait a moment while redcolumn reads the title blocks.
2. Choose {{Document > Review Sheet Scales…}}. On the ribbon it is **Measure > Review Scales**.

   ![The Review Sheet Scales panel](img/scale-review.png)
3. Check each row:
   - **Sheet** shows the size the scale was written for and the size the page is (*A1 → A3*).
   - **Proposed** is the scale to measure with, already corrected for the size.
   - **Checked** shows what the page's scale bar or dimensions say. **✓ scale bar** means they agree. **✗ scale bar ×2.00** means they measure twice the proposed scale, so something is wrong.
4. Tick the pages to set. Pages that need no checking are ticked for you.
5. Click **Apply to *n* pages**. Undo takes it back.

What each status means:

- **Ready**: the page is the size its scale was written for.
- **Resized**: the page is a different size, so the proposed scale is corrected for it.
- **Check**: something doesn't add up. The page may be cropped or padded, the scale may be unlikely (such as 1:1), or the page's scale bar or dimensions may disagree. Measure a known dimension before trusting the scale. See [Calibrate from a known length](#calibrate).
- **Matches**: the page scale, or its viewports, are set and agree with the title block.
- **Differs**: the page scale is set and disagrees with the title block. Find out which is right before measuring.
- **Views**: the title block says *AS SHOWN*, so each view has its own scale. See below.
- **Not to scale**: the title block says NTS. Don't measure this sheet.
- **No scale**: no scale was found. Set it by hand. See [Set the scale](#scale).

redcolumn finds the sheet size in the scale itself (*1:100 @ A1*, *1:500 (A1)*, *1:100 AT A1 / 1:200 AT A3*) or in a separate *SHEET SIZE* box. If your title block is not read, add a **Sheet size** box to its [drawing standard](#drawing-standards).

> **Tip:** Click a page name to go to that page and check the sheet while the panel stays open.

## Sheets with views at their own scales

Some sheets have details or sections at different scales, each with its title and scale under it (*DETAIL 3 SCALE 1:20*). A long section may have a horizontal and a vertical scale. For these, redcolumn proposes a [viewport](#viewports) for each view.

1. In the row, click ***n* viewports**. The proposed viewports are outlined on the sheet.
2. Check that each box covers its view.
3. Tick the page and click **Apply**. The viewports are added, and measurements inside each use its scale.

Viewports are never ticked for you.

## Not to scale sheets

If you measure on a sheet whose title block says *NOT TO SCALE*, redcolumn warns you. Its lengths are not real-world lengths, so they shouldn't go into a takeoff. **Cancel** is the default. If part of the sheet is drawn to scale, you can still calibrate from a known dimension in that part.

## Scales an AI client proposes

In the desktop app, an AI client connected through the local MCP server (File › Preferences › MCP) can read each sheet's scale information. If redcolumn misread a title block, the client can propose a scale. A proposal sets nothing. It shows here with an **AI** tag, and hovering over the tag shows where the client read the scale. It is never ticked for you.

An AI client can't measure lengths or areas on a page until it has a scale, or on a sheet marked not to scale.
