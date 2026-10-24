# Sheet links (auto-linking)

When you open a drawing set, redcolumn finds references to other sheets (for example *SEE A-201*, or detail callouts) and turns them into links. They are outlined in blue.

![Sheet references outlined as links](img/links-on-page.png)

## Follow a link

Click it. The sheet or detail it points to opens in a **preview** beside the plan, so you can read it without losing your place:

- Drag the preview's title bar to move it, and its bottom-right corner to resize it.
- Click **📌** to pin it. A pinned preview stays when you click another link, so you can compare two details; an unpinned one is replaced by the next link.
- Click **Open** (or double-click the preview) to go to the sheet. Press [[Alt+Left]] to come back.
- Press [[Esc]] or click **×** to close it.

To jump straight to the sheet instead, choose **Clicking a Sheet Link › Jumps to the sheet** in {{File > Preferences…}} (Display).

## Show or hide the outlines

Choose {{View > Show Links}}, or untick **Show links** in the Links tab. The links still work when the outlines are hidden.

## Check the links (the Links tab)

Click the **Links** tab at the bottom of the screen.

![The Links tab](img/links-panel.png)

| Section | Lists |
|---|---|
| **Needs review** | links redcolumn is not sure about. Click **✓** (keep) or **×** (not a link). |
| **On this sheet** | the links on the current sheet and where they go. |
| **Links to this sheet** | links on other sheets that point here. |

Click a row to see that callout. **Re-detect** finds links again, for example after you change [page labels](#page-labels).

> **Tip:** To link a whole folder of files at once, use [Bulk Auto-Link Sheets](#batch-link).
