# Find and show parts of a 3D model

## Select and read properties

1. Click **Select Elements** on the **3D** ribbon tab, then click a part of the model. It turns blue.
2. Open the **3D Properties** panel ({{Window > 3D Properties}}) to see what it is: its class, name, IFC GlobalId, and every property and quantity set.

![The 3D Properties panel for a selected road pavement](img/model-properties.png)

Type in **Filter properties** to find one property quickly.

With something selected:

- **Isolate** shows only the selection.
- **Hide** hides it.
- **Show All** brings everything back.
- **Ghost Hidden** shows hidden parts faintly instead of not at all, so you keep your bearings.

## The 3D Model panel

Open the **3D Model** panel ({{Window > 3D Model}}) to see what the model holds.

![The 3D Model panel: models, the spatial tree and classes](img/model-panel.png)

| Section | What it does |
|---|---|
| **Models** | Every open model. Untick one to hide it. |
| **Spatial tree** | The model's site, building or road, storeys and spaces. Click a name to select it. |
| **Classes** | Every kind of element (walls, kerbs, pavement) and how many. Click one to select them all. **Colour by class** gives each class its own colour; **Show all** puts the colours back. |
| **Search sets** | Saved searches by class, property or both, such as every wall whose status is "New". |
| **Colour profiles** | Colour, hide or ghost the elements of search sets: for example, new work green and demolition red. |
| **Saved views** | Keep the camera, section box, hidden elements and colour profile under a name, and go back to them later. |

The **Quantities**, **Compare**, **Sheets in the model** and **Issues** sections are covered in [Compare revisions and total quantities](#model-review), [3D models and sheets on the map](#model-sheets) and [Issues in 3D models](#model-issues).

## Cut the model open

- **Section Box** puts a box around the selection (or the whole model) and hides everything outside it. To resize it, choose **Clipping Plane** and drag the arrows on its sides. Click **Section Box** again to remove it.
- **Clipping Plane**: double-click a surface to cut the model there. Drag the plane's arrow to move the cut. Press [[Delete]] with the pointer over the plane to remove it.

![A section box around a selected pavement](img/model-section-box.png)

## Measure

Click **Length**, **Area**, **Angle** or **Volume** in the **Measure** group.

- Double-click points on the model to measure between them.
- Press [[Enter]] to finish an area, [[Esc]] to cancel, and [[Delete]] to remove a measurement under the pointer.
- **Clear** removes every measurement.

Points snap to corners and edges.
