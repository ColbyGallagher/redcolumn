# Area

Measures the area inside an outline: floors, ceilings, paving, roofs.

1. Choose {{Tools > Measure > Area}} (or press [[Alt+Shift+A]]).

   ![Tools, Measure, Area](img/pick-area.png)
2. Click each corner of the area, going around it.
3. Click the **first** corner again (or double-click, or press [[Enter]]) to close it.

   ![The kitchen floor area](img/measure-area.png)

The area is shown in the middle, for example *887.50 sf*.

## More options (Properties panel)

Select the area and open the [Properties panel](#properties):

![Area measurement properties](img/properties-area.png)

- **Perimeter** and **Area** are both shown.
- **Depth** turns it into a volume (see [Volume](#measure-volume)).
- **Slope** gives the true area of a sloping surface, such as a roof, from its plan area.
- **Add cutout** subtracts a hole, such as a stair or lift. See [Cut a hole out of an area](#cutouts).

> **Tip:** To outline a room in one click, use [Smart Fill](#smart-fill).

## Tracing curves

Kerb returns, curved walls and road edges can be traced as you draw, two ways:

- **Arc (3-point)**: press [[Shift+B]] (or choose {{Takeoff > Measure > Arc (3-point)}}, or right-click while drawing). Click a point anywhere on the curve, then click the end of the arc. The section from the last corner to the end follows the circle through all three points; after it, clicks are straight again. Arm it again for the next arc. You can arm it before the first click, too: the arc then starts at that click. The status bar says which click comes next, and [[Esc]] or [[Backspace]] drops an arc you have not finished without losing the rest.
- **Ctrl+drag**: hold [[Ctrl]], press where the end of the curved section goes and drag away from it. The section bends through the pointer; release to set it. This suits a quick bend by eye, where the 3-point arc suits tracing a curve printed on the drawing.

Snapping works for both clicks of an arc as it does for corners (hold [[Alt]] to place a point without snapping). Three points nearly in a line make a straight section.

The closing side, back to the first corner, stays straight unless you end an arc on the first corner: that click closes the area along the arc. [[Backspace]] removes a curved corner with its curve, and the length and area follow the curves. Perimeter and Volume trace curves the same way.

## Edit the corners and curves

Select the area, then:

| To | Do this |
|---|---|
| Move a corner | Drag its handle. |
| Add a corner | Hold [[Shift]] and click on a side. A curved side splits into two, still on the same curve. |
| Remove a corner | Hold [[Shift]] (or [[Alt]]) and click its handle. |
| Make a corner smooth, or sharp again | Hold [[Ctrl]] and click its handle. |
| Curve a side | Right-click it › **Convert to Arc** (**Convert to Line** straightens it), or hold [[Alt]] and drag the knob in the middle of the side. |

Cutouts keep their own corners; edit those by dragging their handles.
