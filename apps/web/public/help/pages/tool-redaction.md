# Redaction

Permanently removes private information (names, prices, signatures) from a PDF and covers it with a box. Redaction happens in two steps: **mark**, then **apply**.

![Redaction: mark an area, then apply the redaction from the Tools menu](gif/tool-redaction.gif)

![The Redaction menu](img/menu-redaction.png)

## Step 1: Mark what to remove

1. Choose {{Tools > Redaction > Mark for Redaction}} (or press [[Shift+R]]).
2. Drag a box over each thing to remove. Marked areas show as a dashed red box.

   ![An area marked for redaction](img/draw-redaction.png)

Nothing is removed yet. You can still move, resize or delete the marks.

## Step 2: Apply the redactions

1. Choose {{Tools > Redaction > Apply Redactions…}} (or press [[Shift+A]]).

   ![The Apply Redactions window](img/apply-redactions.png)
2. Choose the **Overlay colour** for the boxes that cover the removed content.
3. Optional: type **Overlay text** to show on each box, such as `REDACTED`.
4. Leave **Also remove the document's metadata** ticked to remove the title, author and other hidden details too.
5. Click **Apply**.

## Redact the same area on many pages

To remove a header, footer or side note from every page in one go, choose {{Tools > Redaction > Bulk Redact…}} (also on the **Bulk** ribbon tab). See [Bulk Redact](#edit-content): check the boxes it finds (or draw your own), choose **Cover with** for a box over each, choose the pages, and click **Redact N pages**.

> **Warning:** Applying redactions removes the text, pictures and lines under the boxes **for good** once you save. It cannot be undone after saving. Keep a copy of the original if you might need it.
