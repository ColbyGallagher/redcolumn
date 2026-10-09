# Calibrate from a known length

Calibrating works out the scale from something on the drawing whose real length you know, such as a dimension string or a grid spacing. It is the most reliable way to set a scale.

1. Go to the page and zoom in on a long, known dimension. Longer is more accurate.
2. Choose {{Tools > Measure > Calibrate}}.

   ![Tools, Measure, Calibrate](img/pick-calibrate.png)
3. Click **exactly** on one end of the known length, then on the other end. [Snapping](#snapping) helps you hit the line ends.
4. Type the real length, and choose the unit (for example `30` and `ft`). Feet and inches like `25'-6"` work too.

   ![The Calibrate scale window](img/calibrate-dialog-filled.png)
5. Leave **Apply to all pages** ticked if every page is at the same scale. Untick it to set this page only.
6. Click **Set scale**.

The scale shows in the navigation bar.

## Check it

Measure another dimension you know with [Length](#measure-length). If it is right, the scale is right.

> **Tip:** Calibrating inside a [viewport](#viewports) sets the scale of that viewport only.
