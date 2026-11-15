# Formula Builder

The Formula Builder helps you write an assembly item's quantity formula without remembering every name. Open it with the **ƒx** button beside a **Quantity formula** box in {{Tools > Takeoff > Assemblies…}}.

## What it shows

- **The formula**, in a large box. Type in it, or click the buttons below to put things in at the cursor.
- **Checking as you type:** a formula that will not work says why in red, for example a name the assembly does not have, a missing bracket, or a result that is text rather than a number. A quantity must always be a number.
- **The result:** select a measurement before opening the Assemblies window and the builder shows what the formula gives for it, after waste and rounding.
- **Operators:** `+ − × ÷ ^`, brackets, the comma between a function's values, and the tests `= ≠ > < ≥ ≤`.
- **Properties**, by group:
  - **Measured:** the measurement's Quantity, Length, Perimeter, Area, Volume, Wall Area, Depth and Count, and its slope values (Plan Length, Plan Area, Slope Factor, Pitch, Slope Angle, Slope %).
  - **Variables:** the assembly's numbers.
  - **Yes/No switches:** the assembly's switches, which count as 1 for Yes and 0 for No.
  - **Columns:** the document's number, calculation and checkmark columns (a ticked checkmark is 1).
- **Functions**, with how to call each one.

## Functions for estimating

| Function | Gives | Example |
|---|---|---|
| `IF(test, then, else)` | one value or another | `IF([Area] > 100, 2, 1)` |
| `CONVERT(value, "from", "to")` | a length, area or volume in another unit | `CONVERT([Area], "sf", "m2")` |
| `ROUND(x, places)` | rounded to decimal places | `ROUND([Length] / 3, 1)` |
| `CEILING(x)` / `FLOOR(x)` | rounded up / down to a whole number | `CEILING([Length] / 10)` |
| `MIN`, `MAX`, `SUM`, `AVG` | smallest, largest, total, average | `MAX([Count], 1)` |

Function names can be typed in any case: `if`, `If` and `IF` are the same.

**CONVERT** knows lengths (`in`, `ft`, `yd`, `mi`, `mm`, `cm`, `m`, `km`), areas (`sf`, `sq ft`, `ft2`, `m2`, `m²`, `sy`, `ac`, `ha` and the like) and volumes (`cf`, `cy`, `m3`, `l`). Converting between kinds, such as a length into an area, is an error.

## A switch in a formula

A Yes/No switch named `Both Sides` makes board for one or both sides of a wall:

`[Length] * [Wall Height] * IF([Both Sides], 2, 1) / 32`

Each measurement can turn the switch on or off as its own input: see [Assemblies](#assemblies).

See [Formulas](#formulas) for the whole formula language.
