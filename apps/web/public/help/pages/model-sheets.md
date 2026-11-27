# 3D models and sheets on the map

When a model and a PDF sheet are both placed on the same map, redcolumn can show each in the other and move between them.

- **The model** must say where it is on the map. Civil and site models usually do: the IFC file holds a map conversion.
- **The sheet** must be registered to the map. A geospatial PDF already is, or you can register it yourself in the **Geospatial** panel.

## The model on your sheets

While a model is open, its outline is drawn on every sheet registered to the same map.

![A road model's outline drawn on a registered plan](img/model-on-sheet.png)

To turn this off, click **On Sheets** on the **3D** ribbon tab (or choose {{View > 3D Models on Sheets}}).

## Sheets in the model

The **Sheets in the model** section of the **3D Model** panel lists the open sheets that are registered to the map. Tick one to show it in the model:

- **On a plane**: the sheet, with its markups, as a flat picture at a height you choose.
- **Draped on the model**: the sheet's markups laid over the model's surface.

Use the slider to make it see-through.

## From an element to the sheet that shows it

1. Select an element in the model.
2. In the **3D Properties** panel, the **On drawings** list shows every sheet that covers it.
3. Click a sheet. It opens at that place, with a ring around it.

## From a sheet to the model

Right-click a place on a registered sheet and choose **Find in 3D**. The model comes to the front with the element there selected.

## Sync View with Sheet

See a sheet and the model side by side, moving together.

1. Right-click the model's tab and choose **Open in Split View**. Put the sheet in the other pane.
2. Click **Sync with Sheet** on the **3D** ribbon tab (or **Sync** in the status bar).

The model switches to **Plan View** and shows the same place as the sheet, at the same scale and turned the same way. Pan or zoom either side and the other follows.

![A sheet and the model side by side, in sync](img/model-sync.png)

> **Note:** The model follows the part of the sheet that is registered to the map. If the middle of the sheet's view is outside it (a title block, say), the model waits until you move back.

> **Tip:** Switching the model to **Orbit** stops the sheet following it. Moving the sheet puts the model back in **Plan View**.
