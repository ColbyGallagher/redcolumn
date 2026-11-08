# Polylength

Measures the total length along a path with several sections: pipe runs, cable routes, skirting.

1. Choose {{Tools > Measure > Polylength}} (or press [[Alt+Shift+Q]]).

   ![Tools, Measure, Polylength](img/pick-polylength.png)
2. Click the start, then each corner along the path.
3. Press [[Enter]] or double-click to finish.

   ![A polylength along a path](img/measure-polylength.png)

The total of all sections is shown.

> **Tip:** Clicked in the wrong place? Press [[Backspace]] to remove the last point.

## Tracing curves

Kerb returns, curved walls and road edges can be traced as you draw, two ways:

- **Arc (3-point)**: press [[Shift+B]] (or choose {{Takeoff > Measure > Arc (3-point)}}, or right-click while drawing). Click a point anywhere on the curve, then click the end of the arc. The section from the last corner to the end follows the circle through all three points; after it, clicks are straight again. Arm it again for the next arc. You can arm it before the first click, too: the arc then starts at that click. The status bar says which click comes next, and [[Esc]] or [[Backspace]] drops an arc you have not finished without losing the rest.
- **Ctrl+drag**: hold [[Ctrl]], press where the end of the curved section goes and drag away from it. The section bends through the pointer; release to set it. This suits a quick bend by eye, where the 3-point arc suits tracing a curve printed on the drawing.

Snapping works for both clicks of an arc as it does for corners (hold [[Alt]] to place a point without snapping). Three points nearly in a line make a straight section.

To curve a section afterwards, select the measurement, hold [[Alt]] and drag the knob in the middle of the section.

## Edit the corners and curves

Select the measurement, then:

| To | Do this |
|---|---|
| Move a corner | Drag its handle. |
| Add a corner | Hold [[Shift]] and click on a section. A curved section splits into two, still on the same curve. |
| Remove a corner | Hold [[Shift]] (or [[Alt]]) and click its handle. |
| Make a corner smooth, or sharp again | Hold [[Ctrl]] and click its handle. A smooth corner curves through the corner from its neighbours; the two ends of a path have only one section, so they stay as they are. |
| Curve a section | Right-click it › **Convert to Arc** (**Convert to Line** straightens it), or hold [[Alt]] and drag the knob in the middle of the section. |
