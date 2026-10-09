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
