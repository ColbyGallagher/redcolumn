# Compare revisions and total quantities

## Compare with another revision

See what changed between two revisions of the same model.

1. Open the newer revision.
2. In the **3D Model** panel, open **Compare** and click **Compare with revision…**.
3. Pick the older revision's `.ifc` file.

Elements are matched by their IFC GlobalId. In the view:

- **Green**: added. They are only in the model you opened.
- **Amber**: changed. Their shape, position or properties are different.
- **Red**: removed. They are only in the other revision, and are shown where they were.
- Everything else is faded.

![A changed base course in amber, beside a removed kerb in red](img/model-compare.png)

The panel lists each group. Click a name to select that element and zoom to it. For a changed element, the list says whether its **shape**, its **properties** or both changed. Hold the pointer over the name to see each property's old and new values.

![The Compare section's lists](img/model-compare-list.png)

Click **End comparison** to remove the other revision.

## Total quantities

1. In the **3D Model** panel, open **Quantities**.
2. Choose what to group by. **Class** groups by kind of element; or type a property's name, such as **Material**.
3. Choose **All** or **Selection**, then click **Total**.

![Quantities grouped by class](img/model-quantities.png)

The table shows the count, length, area and volume of each group, with a total at the bottom. Values come from the quantity sets in the IFC file.

Where a group has no volume in its quantity sets, redcolumn measures it from the shapes. These values start with **≈**.

Click a row to select those elements. Click **Export to Excel…** to save the table as a spreadsheet.
