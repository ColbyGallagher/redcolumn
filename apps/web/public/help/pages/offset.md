# Offset

Makes parallel copies of a line, polyline or shape at a set distance, like the Offset command in CAD. Handy for wall thicknesses, kerbs, setbacks and evenly spaced lines.

![Selecting a polyline, choosing Edit > Offset, typing a distance and three copies, then clicking the side to place them](gif/offset.gif)

1. Choose {{Edit > Offset}} (or press [[O]]). If one line, polyline, polygon or rectangle is selected, Offset starts from it.
2. Otherwise, click the line or shape to offset.
3. In the Offset bar at the bottom of the view, type a **Distance** in the page's units, or leave it empty to place the copy through the point you click. Typing a number while offsetting jumps to the field.
4. Set **Copies** to make several at once: each one is the distance further out than the last.
5. Move the pointer to the side you want the copies. A faded preview follows the pointer.

   ![The dashed offset preview beside a polyline](img/offset-preview.png)
6. Click to place them.

Offset stays on: click another line or shape (or one of the new copies) to offset again. Press [[Esc]] to finish. With **Reuse** turned off in the status bar, Offset ends after each placement instead.

The distance and copies are remembered for next time. On a calibrated page the distance is in real units (for example `600` on a page in mm, or `2'-6"` on a page in feet); closed shapes grow outward or shrink inward depending on which side you click.
