# Trim, Extend, Break and Lengthen

CAD-style tools for cutting and growing lines, like the AutoCAD commands of the same names. They work on lines, arrows, polylines and Length and Polylength measurements (with straight segments). Find them under {{Edit > Modify}}.

Each tool stays on after a click, so you can work through a drawing. A bar at the bottom of the view says what the next click does. Press [[Esc]] to step back, and again to finish.

## Trim

![Clicking the parts of a line between two crossing lines to trim them away](gif/trim.gif)

Cuts away the part of a line between the lines that cross it.

1. Choose {{Edit > Modify > Trim}}.
2. Click the part of a line you want to remove. Every other markup on the page counts as a cutting edge. The preview shows what is left.

If only one line crosses it, the piece from there to the end you clicked goes. If nothing crosses it, nothing changes. Hold [[Shift]] to extend instead.

## Extend

![Clicking near the end of a line to extend it to the next line](gif/extend.gif)

Carries a line on in a straight line until it meets the next markup.

1. Choose {{Edit > Modify > Extend}}.
2. Click near the end you want to extend.

Hold [[Shift]] to trim instead.

## Break

![Clicking where a gap starts and ends on a line](gif/break.gif)

Takes a piece out of a line between two points, or splits it in two.

1. Choose {{Edit > Modify > Break}}.
2. Click the line where the gap starts.
3. Click where the gap ends. Click the same point again to split the line there without a gap.

## Lengthen

![Typing a length and clicking the end of a line to lengthen it](gif/lengthen.gif)

Makes a line longer or shorter at one end.

1. Choose {{Edit > Modify > Lengthen}}.
2. In the bar, pick **Change by** (type `-` for shorter), **Total length**, or **Percent**, and type the value. Lengths are in the page's units.
3. Click near the end to change. A longer line carries its last segment straight on.
