# Compare two drawings

Compare finds every difference between an old and a new revision of a drawing and clouds them for you.

## Compare

1. Open both revisions (or have them in [File Access](#file-access)).
2. Choose {{Document > Compare Documents…}}.

   ![The Compare Documents window](img/compare-dialog.png)
3. Choose the **Old revision** and the **New revision**.
4. Choose the **Pages**:
   - **All pages, matched by sheet number** — best for drawing sets.
   - **All pages, in page order**.
   - **Old page *n* with new page *n*** — compare just one sheet.
5. Choose what to **Compare**: **Graphics**, **Text**, or both. Leave **Align pages automatically** ticked.
6. Choose how to **Mark differences**: **Clouds** or **Rectangles**, and a colour. Tick **Mark the old revision too** to cloud both.
7. Click **Compare**.

## See the results

The two revisions open side by side, with the changes clouded, and the **Compare Results** panel lists them:

![Compare results with clouds on both revisions](img/compare-results.png)

![The Compare Results panel](img/compare-results-panel.png)

- Click a difference (*Changed*, *Added*, *Removed*) to zoom both revisions to it.
- Use **‹ Previous** and **Next ›** to step through them.

The clouds are normal markups. Add comments to them, or delete ones that don't matter.

## If the results are noisy

| Setting | Raise it to… |
|---|---|
| **Tolerance** | ignore lines that moved only slightly |
| **Cluster size** | join nearby changes into one cloud |
| **Ignore specks under** | ignore tiny spots |

**Line up** helps when the revisions don't sit the same way:

- **Scale pages of another size to fit** — for a sheet reprinted at another paper size.
- **Align Pages…** — click the same three points on both sheets, for a sheet drawn at a different scale or turned.
- **Select Region…** — compare only part of the sheet.

> **Tip:** To see both revisions on top of each other in colour, use [Overlay](#overlay). To compare whole sets, choose **Two sets (batch)** at the top.

## AI Compare: what changed in the text

Compare marks what changed on the sheet. For a document that is mostly text, such as a specification or a report, it also helps to know what the *words* changed, ignoring paragraphs that were only moved. Choose {{Document > AI Compare Documents…}} (or **AI Compare** in the ribbon).

1. Open both revisions in tabs.
2. Choose the **Old revision** and the **New revision**, then **Compare**.

The **AI** panel (marked Experimental) opens beside the sheet with a list of changes, each one **Added**, **Removed**, **Modified**, **Moved** or **Unchanged**. Each change shows the paragraph from the old revision and the one from the new. A paragraph that only moved, or was lightly reworded, is not an addition plus a removal. For a **Modified** paragraph the changed words are shown (removed in red, added in green). Click a change and both revisions are shown side by side, each zoomed to its paragraph. **Previous** and **Next** step through them.

**Who decided each match.** Every change carries a label:

- **Same text**: redcolumn checked that the two paragraphs read the same. This is a fact.
- **AI judgement**: an AI client matched them by meaning. It is an opinion and can be wrong, so check what matters against the documents.
- **Text match**: no AI was involved; the paragraphs were matched by how many words they share.

**The AI part is your AI client's.** In the desktop app, a client connected through the local MCP server (File › Preferences › MCP) reads the paragraphs that did not match word for word and reports what it judges. Just ask it to compare the two documents in redcolumn: it can start the comparison itself, and you see an Allow prompt first because the text goes to it. Or press **Compare** yourself and use **Copy request for AI** to paste into the client. The client can also add a short summary of what changed, shown above the list. The text of the documents goes only to the client you connected, and only after you press **Compare** or click Allow on its request.

Until the client answers, and if it never does (or cannot), the panel shows a basic text comparison and says so. In the web app there is no AI client, so you always get the basic text comparison.
