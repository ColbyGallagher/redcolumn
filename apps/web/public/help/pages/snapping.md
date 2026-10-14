# Snapping

When snapping is on, the point you are placing jumps to a nearby corner, end, centre or crossing, so your markups and measurements line up exactly with the drawing. It works like object snaps in AutoCAD.

A small marker shows where the point will snap, with the snap's name beside it:

![A snap marker on the corner of a wall](img/snap-marker.png)

## Turn snapping on and off

Use the switches in the status bar:

![The snap switches in the status bar](img/status-snap.png)

1. **Snap Grid** — to the dots of the [grid](#view-aids) ([[Ctrl+Shift+F9]]).
2. **Snap Content** — to lines, ends, midpoints, centres and crossings in the PDF drawing ([[Ctrl+Shift+F8]]).
3. **Snap Markup** — to your other markups ([[Ctrl+Shift+F7]]): every corner and the middle of each side of a rectangle, the centre and the top, bottom and sides of a circle or ellipse, the ends and middles of lines, and anywhere along their outlines.
4. **Polar** — Polar Tracking ([[Ctrl+Shift+F10]]).
5. **Track** — Object Snap Tracking ([[Ctrl+Shift+F11]]).

## What snaps

| Marker | Snap | Snaps to |
|---|---|---|
| Square | Endpoint | The end of a line, or a corner |
| Triangle | Midpoint | The middle of a line or side |
| Circle with a cross | Centre | The centre of a circle, arc or ellipse |
| Circle with a star | Geometric Centre | The middle of a rectangle, polygon or area markup |
| Diamond around a dot | Quadrant | The top, bottom, left or right of a circle, arc or ellipse |
| X | Intersection | Where two lines cross |
| X in a box | Apparent Intersection | Where two lines would cross if they were extended |
| Right angle | Perpendicular | Square off a line or circle from the point you are drawing from |
| Circle under a line | Tangent | Just touching a circle or arc from the point you are drawing from |
| Diamond | Nearest | Anywhere along a line |

Perpendicular and Tangent need a point to be drawn from, so they work for the second point of a line or measurement and later.

## Line up with a point (Object Snap Tracking)

1. Rest the pointer on a snap point for a moment, without clicking. A small **+** marks it as picked up.
2. Move away straight across or up and down from it. A dotted line runs from the point and the pointer locks onto it, showing the distance and angle.
3. Click to place your point in line with it.

Pick up two points and move to where their lines cross to place a point in line with both. Rest on a picked-up point again to drop it. Picked-up points are dropped when you place a point, finish a markup or press [[Escape]].

**Extension:** rest on the end of a line, then move on past the end. The pointer follows the line on beyond its end. Where a dotted line meets a line in the drawing, it snaps to that crossing.

**Parallel:** while drawing, rest on another line (a // marks it), then move roughly parallel to it. The pointer follows that direction from your last point.

## Polar Tracking

With **Polar** on, the line you are drawing locks onto multiples of the polar angle (45° unless you change it) from your last point. A dotted line and the length and angle show while it is locked.

## Skip snapping for one point

Hold [[Alt]] while you click.

> **Tip:** Snapping to content needs a PDF made from CAD (vector lines). A scanned drawing has no lines to snap to.

Snapping when a document opens is set in [Preferences](#preferences) › **General** › **Grid & Snap**, along with:

- which points snap (ends, midpoints, intersections, lines, centres, quadrants, geometric centres, perpendicular, tangent and apparent intersections),
- tracking: Object Snap Tracking, Extension, Parallel, Polar Tracking, the polar angle, and whether picked-up points track at polar angles too,
- the snap **Sensitivity** and the marker colour.
