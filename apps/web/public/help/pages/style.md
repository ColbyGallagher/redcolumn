# Change colour, line and fill

The style controls are on the toolbar, to the right of the tools.

- With a **tool** picked, they set the look of the **next** markups you draw with it.
- With **markups selected**, they change those markups.

![The style controls on the toolbar](img/toolbar-style.png)

1. **Colour** — click the swatch and pick a colour.
2. **Fill** — tick to fill the shape with colour.
3. **Line width** — pick a thickness, or type one in points (pt).
4. **Line style** — Solid, dashed, dotted and more.
5. **Opacity** — how see-through the markup is. 100% is solid.
6. **Bubbles** (clouds only) — the size of the cloud's bumps.

Text tools also show font controls. See [Format text](#text-formatting).

## More options

The [Properties panel](#properties) has everything: fill colour and fill opacity, hatch patterns, arrowheads and more.

## Make your own line styles

A line style can be dashes and gaps, text (such as *G* for gas), small symbols, or several lines side by side.

1. Open {{Tools > Line Styles…}}, or pick **Manage line styles…** at the bottom of the **Line style** list.
2. Click **New…**. Built-in styles can't be changed: pick one and click **Copy and Edit…** to start from it.
3. Give it a **Name**.
4. Under **Line 1**, add **components** in the order they repeat along the line:
   - **Dash** and **Gap**: how long each is.
   - **Text**: the letters, font and size. **Keep upright** stops it reading upside down.
   - **Symbol**: click the grid to draw its outline. Shift-click starts a new stroke. **Left** and **Right** set how much line it takes.
5. **Add line** draws another line beside the first. **Offset** moves it to one side (minus for the other side).
6. Watch the preview, then click **Save**.

**Scale with line width** makes the pattern grow with thicker lines. Untick it to keep sizes in points.

Your styles are in sets, listed on the left. **New set**, **Rename** and **Remove** organise them. **Export…** saves a set as a `.blx` file to share; **Import…** reads one back. Markups keep their style even if you delete it, because the pattern is saved with the markup.

## Make a look the default

Right-click a markup you like and choose **Set as Default**. New markups of that type are drawn that way.

## Swap a colour everywhere

1. Select the markups (or press [[Ctrl+A]] for all).
2. Right-click › **Change Colours…**.

   ![The Change Colours window](img/change-colours.png)
3. Click the new colour beside each old one, then click **Change**.

> **Tip:** To copy the look of one markup onto others, use the [Format Painter](#format-painter).
