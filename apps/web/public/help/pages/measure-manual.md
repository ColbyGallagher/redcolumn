# Manual Quantity

Some quantities are known before anything is drawn: a door count from a schedule, a slab area from a spec. **Manual Quantity** lets you type the number and place it on the page. It behaves like any other measurement in the Markups list, totals, assemblies and the Excel sync.

## Place one

1. Choose **Takeoff > Manual** on the ribbon, or **Tools > Takeoff > Manual Quantity**.
2. Pick the **Kind**: Length, Area, Volume or Count.
3. Type the **Value** and pick its **Unit**. The units offered are the page's own first.
4. Set the **Subject** (it starts as "Manual"), optionally an **Assembly** and a **Note**.
5. Click **OK**, then click the page where the tag should go. Press **Esc** to cancel.

The quantity shows as a tag with a dashed border, such as "Manual · 24.00 m²", so it is clear the number was typed rather than measured. The tag is shown in the page's display units.

## Change one

Select the tag and use the **Manual Quantity** section of the Properties panel to change its kind, value, unit or note. Changing the unit keeps the quantity and shows it in the new unit.

## In formulas

An assembly sees a manual length as **[Length]** and **[Quantity]**, an area as **[Area]** and **[Quantity]**, a volume as **[Volume]** and **[Quantity]**, and a count as **[Count]** and **[Quantity]**. See [Assemblies](#assemblies).

## Good to know

- A typed quantity does not depend on the page's scale, and slope and cutouts do not apply to it.
- Other PDF viewers show the tag as a text box. RedColumn opens it again as a manual quantity.
