# Slopes, pitches, hips and valleys

Drawings show roofs, ramps and embankments on plan, so a length or area measured on them is the flat, plan size. Give the measurement a **slope** and its value becomes the true, sloped size: a roof's real area, or a ramp's real length.

Set the slope in the **Properties** panel (the **Slope** row of a selected measurement), or in **Takeoff › Slope** for the selection and the next measurements you draw ([The Takeoff tab](#takeoff-tab)). Slopes apply to lengths and areas. Volumes, counts and angles are not changed.

## Ways to enter a slope

- **Pitch**: rise per 12 of run, as roofers give it. *6* means 6:12, which is 6 up for every 12 across.
- **Rise:Run**: any rise over any run, in any units, such as *1:4* for a ramp or *6:12* for a roof.
- **Degrees**: the angle from level, such as *30°*.
- **Grade %**: rise per 100 of run, such as *8%* for a road or a drive.
- **Elevations**: the level at the start (**From**) and the end (**To**), in metres.
  - A length or polylength becomes exactly √(plan length² + rise²), with the plan length of the whole path.
  - An area also needs the **Run**: the horizontal distance the rise happens over. Without one the area stays flat, and the panel says so.

Each of the first four makes a plan value longer by the same factor, 1 ÷ cos(angle). At 6:12 that is 1.118, so 100 sf on plan is 111.8 sf of roof.

## Hips and valleys

A hip (an outside corner) or a valley (an inside corner) is the line where two roof planes meet. On plan it runs at an angle between them, and it climbs more gently than either plane. To measure one, click **Takeoff › Hip** or **Valley** and trace the line on plan with Polylength. In Properties, a hip or valley takes two pitches, one for each plane. Leave the second empty when both planes have the same pitch.

The length along the hip is the plan length times

√(1 + t1² × t2² ÷ (t1² + t2²))

where t1 and t2 are the two planes' rise per unit run (6:12 is 0.5). With equal pitches this is √(1 + t² ÷ 2): 1.061 for two 6:12 planes. A 6:12 plane meeting a 12:12 plane gives √1.2 = 1.095.

> **Note:** This assumes the eaves meet at a square (90°) corner on plan, as on most roofs. On a corner at another angle the result is approximate.

Hips and valleys are for lines (Length and Polylength). Areas do not use them.

## The perimeter of a sloped area

A sloped area's **Perimeter** (the Length column) stays the plan perimeter. Level eaves keep their plan length, but rakes get longer, and the app cannot tell which edge is which. Measure rakes separately as sloped lines.

## Using slopes in formulas

The Markups list has numeric columns for slopes, and assembly formulas and calculation columns can use them by name:

| Name | Value |
| --- | --- |
| `[Plan Length]` | The length on plan, before the slope |
| `[Plan Area]` | The area on plan, before the slope |
| `[Slope Factor]` | True size divided by plan size: 1 when flat |
| `[Pitch]` | The slope as rise per 12 |
| `[Slope Angle]` | The slope in degrees |
| `[Slope %]` | The slope as a percent grade |

For a hip or valley, the pitch, angle and grade are those of the hip line itself. For a line with elevations they are its average slope over the plan length. For example, roof sheeting with 10% laps could be `[Plan Area] * [Slope Factor] * 1.1`.

The **Slope** column shows the slope as entered: `6:12`, `30°`, `8%`, `1:4`, `Δ1.20 m`, `Hip 6:12` or `Hip 6:12/8:12`.
