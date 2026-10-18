# Fillet, Chamfer, Join and Explode

Tidy up corners and paths like the AutoCAD commands of the same names. Find them under {{Edit > Modify}}.

## Fillet

![Typing a radius and clicking two lines to round their corner](gif/fillet.gif)

Meets two lines at their corner, rounded by an arc when you set a radius.

1. Choose {{Edit > Modify > Fillet}}.
2. Type a **Radius** in the bar, or leave it empty for a sharp corner.
3. Click the first line, then the second, on the parts you want to keep.

The lines are trimmed or extended to meet. With a radius an Arc joins them. Click two segments that meet in one polyline or polygon to round that corner. Area, Perimeter and Polylength measurements get a true curve; polylines and polygons trace it with points.

## Chamfer

![Typing a distance and clicking two lines to cut their corner](gif/chamfer.gif)

Works like Fillet but cuts the corner with a straight edge. Type the **Distance** back from the corner along each line.

## Join

![Selecting three lines and joining them into one polyline](gif/join.gif)

Turns lines and polylines whose ends meet into one polyline, or a polygon when they close a loop.

1. Select the lines to join.
2. Choose {{Edit > Modify > Join}}.

Length measurements join into a Polylength, or a Perimeter when they close.

## Explode

![Exploding a rectangle into four separate lines](gif/explode.gif)

Splits polylines, polygons, rectangles and path measurements into separate lines, one per segment.

1. Select what to explode.
2. Choose {{Edit > Modify > Explode}}.

Curved segments become Arcs, and measurement segments become Lengths.
