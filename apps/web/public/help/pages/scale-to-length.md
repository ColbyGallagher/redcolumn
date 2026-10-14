# Scale to a length

Scale to Length grows or shrinks markups so that two points on them end up a set distance apart, like AutoCAD's Scale › Reference. Use it to bring a pasted map, aerial photo or sketch to the drawing's scale.

Set the page's [scale](#scale) first, so lengths you type are real-world lengths.

1. Select what you want to scale (for example a pasted map). If nothing is selected, the first click picks the markup under the pointer.
2. Choose {{Edit > Scale to Length…}}, or right-click it and choose **Alignment › Scale to Length…**.
3. Click two points on it whose real distance you know, such as the ends of the map's scale bar, or two corners of a lot. [Snapping](#snapping) helps you hit them exactly. The first point stays where it is; everything else grows or shrinks around it.
4. Say how far apart they should be:
   - **Type it:** enter the real length and unit (for example `50` and `m`) and click **Scale**.
   - **Pick on page:** click **Pick on page…**, then click two points on the drawing that are the right distance apart (a known dimension). The markups are scaled as you move, and the second click sets it.

[[Ctrl+Z]] undoes it in one step. Press [[Escape]] to stop before scaling.

> **Tip:** Afterwards, drag the picture to line its first point up with the drawing. Snapping and [object snap tracking](#snapping) help.

Scaling changes the size of the shapes and of text in text boxes. Line widths stay as they are.
