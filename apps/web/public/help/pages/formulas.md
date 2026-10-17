# Formulas

[Calculation columns](#list-columns) and [assembly](#assemblies) items work their values out with formulas. They are written like spreadsheet formulas, but name values instead of cells.

## Names

Put a value's name in square brackets: `[Length]`, `[Unit Cost]`, `[Wall Height]`. Capitals don't matter, and names can have spaces.

| In | You can name |
|---|---|
| A calculation column | any column of the Markups list: `[Length]`, `[Area]`, `[Page]`, `[Status]` and your own columns |
| An assembly item | the measurement's `[Quantity]`, `[Length]`, `[Perimeter]`, `[Area]`, `[Volume]`, `[Wall Area]`, `[Depth]` and `[Count]`; any number or calculation column; and the assembly's variables |

Lengths, areas and volumes are in the page's units: feet and square feet on a feet scale, metres and square metres on a metric one.

## Numbers, text and arithmetic

| Write | Means | Example |
|---|---|---|
| `12`, `0.5`, `1.333` | a number | `[Length] / 1.333` |
| `+` `-` `*` `/` | add, subtract, multiply, divide | `[Area] * 1.1` |
| `^` | to the power of | `[Diameter] ^ 2` |
| `( )` | do this part first | `([Length] + 2) * 3` |
| `"text"` | text, in double quotes | `IF([Status] = "Accepted", 1, 0)` |
| `&` | join text | `[Page] & " / " & [Author]` |

Multiplication and division happen before addition and subtraction, as on a calculator: `2 + 3 * 4` is 14, `(2 + 3) * 4` is 20. Spaces and line breaks don't matter.

## Comparisons

`=` equal, `<>` not equal, `<` less than, `>` more than, `<=` at most, `>=` at least. A comparison gives 1 when true and 0 when false, so it can be used in `IF` or multiplied: `[Count] * ([Status] = "Accepted")`.

## Functions

| Function | Gives | Example |
|---|---|---|
| `IF(test, then, else)` | `then` when the test is true, else `else` | `IF([Depth] > 0, [Depth], [Wall Height])` |
| `ROUND(x, places)` | `x` rounded to so many decimal places | `ROUND([Area] * 1.1, 2)` |
| `CEILING(x)` | `x` rounded up to a whole number | `CEILING([Length] / 12)` |
| `FLOOR(x)` | `x` rounded down to a whole number | `FLOOR([Length] / 12)` |
| `MIN(a, b, …)`, `MAX(a, b, …)` | the smallest, the largest | `MAX([Count], 1)` |
| `SUM(a, b, …)`, `AVG(a, b, …)` | the total, the average | `SUM([Area], [Wall Area])` |
| `ABS(x)`, `SQRT(x)` | `x` without its sign, the square root | `SQRT([Area])` |
| `AND(a, b, …)`, `OR(a, b, …)`, `NOT(x)` | 1 or 0 | `IF(AND([Depth] > 0, [Count] > 1), …)` |
| `CONCAT(a, b, …)`, `UPPER`, `LOWER`, `LEN`, `ISBLANK` | text functions | `ISBLANK([Comments])` |

## Reading a formula

`[Length] * IF([Depth] > 0, [Depth], [Wall Height]) * 2 / [Board Area]` reads as:

1. `[Length]`: how long the wall is,
2. `* IF([Depth] > 0, [Depth], [Wall Height])`: times its height, which is the measurement's own depth if it has one, otherwise the assembly's Wall Height,
3. `* 2`: times two sides,
4. `/ [Board Area]`: divided by the area of one board, giving the number of boards.

## When something is wrong

The box turns red and says why under it, for example *No measured value, column or variable named [Hieght]* (a typo) or *Expected ")"* (a bracket left open). A value that can't be worked out, such as a division by zero, shows **#DIV/0** in a column and ⚠ in an assembly's quantities.
