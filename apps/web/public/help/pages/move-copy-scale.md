# Move, Copy, Scale, Reverse and Convert to Cloud

More AutoCAD-style edits, under {{Edit > Modify}}. Snapping applies to every point you pick. Move, Copy and Scale work on the selection; if nothing is selected, the first click picks a markup (with its group).

## Move

![Selecting a rectangle, choosing Move, then clicking a base point and where it goes](gif/move.gif)

1. Select the markups and choose {{Edit > Modify > Move}}.
2. Click a base point, then the point to move it to. Hold [[Shift]] to keep the move straight across or up and down.

To move an exact distance, type a **Distance** in the bar (in the page's units). After the base point, point the way to go and click.

## Copy by Base Point

![Copy by base point: a copy at each click, then Esc](gif/copy.gif)

Works like Move but leaves the originals where they are and places a copy at each click, all from the same base point. Press [[Esc]] to finish. A typed **Distance** works here too.

## Scale

![Typing a factor of 1.5 and clicking the base point](gif/scale.gif)

1. Select the markups and choose {{Edit > Modify > Scale}}.
2. Type a **Factor** (for example `2` to double, `0.5` to halve) and click the base point, the point that stays put.
3. Or leave the factor empty to scale by reference: click the base point, a point at the current size, then where that point should go.

Text grows with the markup. To scale so a known length becomes a typed one, use [Scale to Length](#scale-to-length).

## Reverse

Runs the selected lines, arrows, polylines, arcs, lengths and dimensions the other way. Their line endings swap ends, so an arrowhead moves to the other end. Choose {{Edit > Modify > Reverse}}.

## Convert to Cloud

![A rectangle becoming a revision cloud](gif/convert-to-cloud.gif)

Turns the selected polygons and rectangles into revision clouds with the same outline, look and comments. Choose {{Edit > Modify > Convert to Cloud}}.
