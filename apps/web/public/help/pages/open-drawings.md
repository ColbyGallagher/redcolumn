# Open a DWG or DXF drawing

redcolumn opens CAD drawings (DWG and DXF) by turning them into a PDF. You can then mark up, measure and do takeoffs on it like any other PDF. You don't need a separate converter, and the drawing never leaves your computer.

> **Note:** This is **Experimental**. Check a known length before you rely on measurements from a converted drawing.

## Open a drawing

Open it the same way as a PDF:

- Choose {{File > Open…}} (or press [[Ctrl+O]]) and pick the `.dwg` or `.dxf` file, **or**
- Drag the drawing from your file manager and drop it on the drawing area.

While it converts, the **Jobs** bar shows **Convert · *name*.dwg**. Click **Cancel** there to stop.

When it's done, the PDF opens in a new tab with the same name (for example `Site plan.dwg` opens as `Site plan.pdf`):

- Each **layout** in the drawing becomes a page, at its own paper size, named after the layout.
- A drawing with no layouts gets one page of its model space.
- **Viewports** keep their scale, so measurements inside a viewport use it. Hover over a viewport to see its scale.
- Each **CAD layer** becomes a PDF layer you can turn on and off in the **Layers** panel.
- Text is real text, so [Find Text](#find-text) works.
- If the drawing doesn't say what units it's drawn in, you're asked to pick them from a list before it's converted. The suggested unit is a guess based on the drawing. Scales and measurements depend on your choice, and **Convert Again** lets you change it.

> **Note:** The DWG or DXF itself is never changed. {{File > Save}} saves the PDF as a new file.

## Check the conversion report

A bar at the bottom of the page says how the conversion went. Click **Details** to see anything worth checking.

![The conversion report with its details](img/drawing-report.png)

You might see:

- **Reference … was not found.** The drawing uses another drawing (an *xref*) that wasn't supplied. Add it with **Convert Again** (below).
- **Font … is drawn in Liberation Sans.** CAD fonts are replaced with similar ones, so text may run a little longer or shorter.
- **Picture … was not found.** The picture isn't inside the drawing file. A frame shows where it goes. Add it with **Convert Again** (PNG or JPEG).
- **… not drawn.** A few kinds of object aren't drawn yet, mostly 3D ones (solids, regions, surfaces).
- **Plot style table … was not supplied.** The drawing's page setup uses a plot style table (a `.ctb` file) that sets each colour's printed colour and line thickness. Without it, lines print in their drawn colours and weights. Add it with **Convert Again**.
- **… not a standard scale** or **a dimension … measures …** The viewport's scale may not be what it looks like. [Calibrate](#calibrate) before measuring.

Click **Close** to hide the bar.

## Convert again with other options

1. Click **Convert Again…** on the bar, or choose {{Document > Convert Drawing Again… (Experimental)}}.

   ![The Convert Again dialog](img/drawing-convert-again.png)
2. Choose what you want:
   - **Pages**: tick the layouts to include. Tick **Model space** to add a page of the whole model.
   - **Lines**: **As plotted** (black or grey when the drawing's page setup plots that way, otherwise in colour), **Colour**, **Greyscale** or **Black**, and whether to use the drawing's lineweights.
   - **Reference drawings, pictures and plot styles**: click **Add Reference Files…** and pick the drawings (DWG or DXF), pictures (PNG or JPEG) and plot style table (`.ctb`) it uses. They're matched by file name.
3. Click **Convert**. The result opens as a new PDF.

redcolumn remembers your **Lines** choices for the next drawing you open.

> **Tip:** Convert Again works until you reload or close redcolumn. After that, the converted PDF is an ordinary PDF. Open the drawing again to convert it with other options.

## What can be opened

- DWG files saved from **AutoCAD 2000 to 2018 and later** (the 2018 format is still current). Older drawings need to be saved again in a newer version first.
- DXF files saved as text (ASCII). Binary DXF isn't supported.

> **Tip:** In the [desktop app](#install) you can also right-click a drawing in your file manager and choose **Open with** › **redcolumn**.
