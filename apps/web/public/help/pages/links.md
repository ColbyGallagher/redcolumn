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

Each row says what the link is, read from the drawing it points at: a **Detail**, **Section**, **Elevation** or **Enlarged plan** bubble, a **Match line**, or a plain sheet reference. The kind is saved with the link, so it is still there when you reopen the file.

Click a row to see that callout. **Re-detect** finds links again, for example after you change [page labels](#page-labels).

## Teach redcolumn your links

Links are found from the text, so marks drawn as shapes, or titles set in an unusual way, can be missed. Show redcolumn one mark and what it points to, and it finds the rest. Teaching is part of a client's [drawing standard](#drawing-standards), so what you teach is used on every set from that client:

1. Click **Teach links…** in the Links tab (or choose {{Document > Teach Sheet Links…}}). The [drawing standard setup](#drawing-standards) opens at its link steps. Start a standard for the client first, if the set has none.
2. Pick **Sections**, **Elevations**, **Details**, **Match lines** or **Chainages** along the top.
3. Box one mark, such as a section mark, with its label: the section letter and the sheet it points to. Click **Next**: the setup goes to the sheet the mark names. Box the section's title there.
4. Click **Find the rest**. redcolumn checks the pair (the letters must match, and the mark must name the sheet the title is on), says what it learned, and shows how many it found with a few to check.

Links found from taught marks wait under **Needs review** with how sure the match is (for example *87%*), and none is saved as a link until you click **✓**.

- **Section marks** and **detail callouts** link to the sheet their label names. Box the bubble without its cut arrow, so the mark is found whichever way the arrow points.
- **Section titles**, **elevation titles** and **detail titles** show callouts where on the sheet their drawing is, so the preview opens on it. A title that names the sheet it is cut on also links back there.
- A chainage on a cross section links to the plan that covers it, never to another cross section at the same chainage (often on another road). See **Chainages** in [Drawing standards](#drawing-standards).

Marks you taught before standards kept their own are still listed under **Taught marks** in the Links tab, and are looked for in every set; click **×** to forget one (links you already kept stay). The setup's review can move them into a standard.

Links an AI assistant proposes over [MCP](#mcp) also wait under **Needs review**; hover the percentage to see its reasoning.

> **Tip:** To link a whole folder of files at once, use [Bulk Auto-Link Sheets](#batch-link).
