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

Each row says what the link is, read from the drawing it points at: a **Detail**, **Section**, **Elevation** or **Enlarged plan** bubble, a **Match line**, a **Station**, or a plain sheet reference. The kind is saved with the link, so it is still there when you reopen the file.

### Stations

On linear work (pipelines, roads, rail), a station such as *STA 598+59.00* on a section, in a note or in a table links to the plan sheet whose station ticks cover it, and the preview opens at the nearest tick. redcolumn reads each sheet's coverage from its own ticks, so a sheet that merely lists stations (a sections sheet, a key plan) is not taken for a plan. Where two disciplines both have plans at that station, the mention's own discipline is used.

Click a row to see that callout. **Re-detect** finds links again, for example after you change [page labels](#page-labels).

## Teach redcolumn your marks

Links are found from the text, so marks drawn as shapes, or titles set in an unusual way, can be missed. Show redcolumn one example and it finds the rest:

1. Click **Teach a mark** in the Links tab (or choose {{View > Teach a Sheet Link Mark…}}).
2. Drag a box around one section mark, section title, detail callout or detail title. Include its label: the detail or section number and the sheet number.
3. Choose what kind of mark it is, give it a name if you like, and click **Teach**.

redcolumn finds every mark drawn the same way in this set, reads the label inside it, and lists each match under **Needs review** with how sure it is (for example *87%*). Matches are outlined with dashes on the sheet, so you can click one to check where it goes, but none is saved as a link until you click **✓**. A wrong match never sneaks in.

- **Section marks** and **detail callouts** link to the sheet their label names. Box the bubble without its cut arrow, so the mark is found whichever way the arrow points.
- **Section titles** and **detail titles** show callouts where on the sheet their detail is drawn, so the preview opens on it. A section title that names the sheet it is cut on also links back there.

Taught marks are kept in your [profile](#profiles) on this device (they go with it if you export or back up the profile), and are looked for in every set you open from then on. They are listed under **Taught marks** in the Links tab; click **×** to forget one (links you already kept stay).

> **Tip:** To link a whole folder of files at once, use [Bulk Auto-Link Sheets](#batch-link).
