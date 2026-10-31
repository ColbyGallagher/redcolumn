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

Links are found from the text, so marks drawn as shapes, or titles set in an unusual way, can be missed. Show redcolumn one mark and what it points to, and it finds the rest:

1. Click **Teach links…** in the Links tab (or choose {{View > Teach Sheet Links…}}). The **Teach Links** panel opens.
2. Pick what to teach: **Sections**, **Details**, **Elevations** or **Chainage**.
3. Drag a box around one mark, such as a section mark. Include its label: the section letter and the sheet it points to.
4. The panel shows what you boxed. Line work that runs out of the box, such as a road edge behind the mark, is shown in red and left out. Click a line or a word to leave it out or put it back, then click **Next**.
5. Go to the sheet the mark points to (**Go to *sheet*** takes you there) and box the section's title.
6. redcolumn checks the pair: the letters must match, and the mark must name the sheet the title is on. It says what it learned, for example that the client's callouts cite only part of the drawing number. Click **Keep**.

Teach each kind once or twice. A callout that points to a whole sheet, with no title to box, can be kept alone: click **No title to box**.

For **Chainage**, box the chainage on a cross section with the word in front of it (*CHAINAGE 101180*), then the same chainage on the plan. redcolumn learns the word, and the title words of the client's plan and cross-section sheets (see [Alignments and chainage](#drawing-standards)).

When the document is read with a [drawing standard](#drawing-standards), what you teach is kept in the standard, so it is used on every set from that client.

redcolumn finds every mark drawn the same way in this set, reads the label inside it, and lists each match under **Needs review** with how sure it is (for example *87%*). Matches are outlined with dashes on the sheet, so you can click one to check where it goes, but none is saved as a link until you click **✓**. A wrong match never sneaks in.

- **Section marks** and **detail callouts** link to the sheet their label names. Box the bubble without its cut arrow, so the mark is found whichever way the arrow points.
- **Section titles**, **elevation titles** and **detail titles** show callouts where on the sheet their drawing is, so the preview opens on it. A title that names the sheet it is cut on also links back there.

Taught marks are kept in your [profile](#profiles) on this device (they go with it if you export or back up the profile), and are looked for in every set you open from then on. They are listed under **Taught marks** in the Links tab; click **×** to forget one (links you already kept stay).

> **Tip:** To link a whole folder of files at once, use [Bulk Auto-Link Sheets](#batch-link).
