# Assemblies (materials from measurements)

An assembly turns one measurement into the materials and labour it stands for. Measure a wall run once, and its assembly works out the studs, the track, the sheets of board and the insulation, each with a waste allowance, rounded up to whole units and priced if you like.

## Set up assemblies

1. Choose {{Tools > Takeoff > Assemblies…}}.
2. Click **Examples ▾** to start from a partition wall, slab, floor tile, paint or door assembly, or **+ New** to start from nothing.
3. Fill in the assembly:

   | Box | Means |
   |---|---|
   | **Name** | What it is called in pickers, the Markups list and the totals. |
   | **Notes** | How to measure it, what it includes. |
   | **Variables** | Numbers its formulas use by name, such as `Stud Spacing` = `1.333` or `Wall Height` = `9`. |
   | **Items** | One row per material or task. |

4. For each item, give its **quantity formula**: how much of it one measurement needs. Click the names above the table to put them into the formula.

   | Example formula | Works out |
   |---|---|
   | `[Length] / [Stud Spacing] + 1` | studs along a wall |
   | `[Length] * [Wall Height] * 2 / 32` | 4 × 8 sheets of board, both sides |
   | `[Area] * [Thickness] / 27` | cubic yards of concrete |
   | `[Count] * 3` | three hinges a door |
   | `IF([Depth] > 0, [Depth], [Wall Height])` | the measurement's own height if it has one, else the default |

5. Set **Waste %**, tick **Round up** for things bought whole (sheets, boxes, lengths), and add a **Unit cost** if you want prices.
6. Click **Save**.

A formula can use the measurement's **Quantity**, **Length** (an area's perimeter), **Perimeter**, **Area**, **Volume**, **Wall Area**, **Depth** and **Count** (the items in a count; 1 for anything else), any number or calculation column of the [Markups list](#list-columns), and the assembly's variables. Lengths, areas and volumes are in the page's units: feet and square feet on a feet scale, metres on a metric one.

> **Tip:** Select a measurement before opening the window. The **Selected** column then shows what it comes to as you edit.

## Take off with an assembly

- **Before you measure:** with nothing selected, pick an assembly under **Assembly** in the [Measurements panel](#measurements-panel). Every measurement you draw is taken off as it until you pick another.
- **Afterwards:** select measurements and pick their assembly in the same box. Their quantities are listed under it.

While a measurement's subject is empty (or still the old assembly's name) it is named after its assembly, so the list groups by it. The Markups list also has an **Assembly** column.

## Totals

Choose {{Tools > Takeoff > Takeoff Quantities…}} to add up every measurement's quantities:

- **By Item (for ordering):** the same item, by name and unit, added up across every assembly.
- **By Assembly** or **By Page:** each assembly's items, or each page's.

**Measured** is before waste, **With waste** adds it, and **Total** rounds up where the item rounds. Totals round up once, on the total, as you order: two walls of 3.1 sheets each come to 7 sheets, not 8. **Export CSV** saves the table for a spreadsheet.

## Share assemblies

- Assemblies are saved in the PDF, so they open with it, and everyone in a [Live Session](#sessions) shares them.
- **Save to My Assemblies** keeps a copy in this browser. **My Assemblies ▾** brings it into any document.
- **Export** saves them all as a file; **Import…** adds a file's assemblies to this document (one with the same name is replaced).

> **Note:** Quantities depend on the scale and on your formulas. Check them against the drawings before pricing or ordering.
