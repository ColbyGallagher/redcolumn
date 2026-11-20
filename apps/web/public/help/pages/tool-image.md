# Image

Places a picture (a photo, logo or sketch) on the page.

![Image: pick a picture, then drag a box to place it](gif/tool-image.gif)

## Place a picture

1. Choose {{Tools > Markup > Other > Image}}, or press [[I]].

   ![Tools menu with Image highlighted](img/pick-image.png)
2. Pick the picture file on your computer and click **Open**.
3. Click on the page to place it, **or** drag a box to set its size. The picture keeps its shape.

   ![A photo placed on the plan](img/draw-image.png)

## Paste a picture

Copy a picture in another program (or take a screenshot), then click on the drawing and press [[Ctrl+V]]. It lands where the pointer is.

## Resize it

Select it and drag a corner handle. To bring a map or photo to the drawing's scale, use [Scale to Length](#scale-to-length).

## Crop it

Trim a picture to the part you need, such as the building in an aerial photo.

1. Select the picture and choose {{Edit > Modify > Crop Image}}, or right-click it and choose **Crop Image**.
2. Drag a box around the part to keep. The rest is hidden and the picture's box shrinks to fit.

Crop again to trim further. The whole picture is kept in the file, so {{Edit > Modify > Reset Crop}} (or **Reset Crop** on the right-click menu) shows all of it again, at the same size and place. Saved PDFs show the cropped picture in other PDF readers too.

## Adjust it

Lighten, darken or tone a picture, such as a dull snapshot of a drawing.

1. Select one or more pictures and choose {{Edit > Modify > Adjust Image}}, use the **Picture** group on the **Modify** tab, or right-click and choose **Adjust Image**.
2. Move **Brightness** and **Contrast**, tick **Greyscale** or **Invert**, or raise **Make white see-through** to drop a white background. The preview shows the result.
3. Click **Apply**. All the selected pictures change together, and one Undo puts them back.

**Change Colours** (also {{Edit > Modify > Picture Colours}}) swaps one of the picture's main colours for another. Both change the picture's pixels for good: adjusting again works on the result, so Undo rather than adjusting in the other direction. A picture that came from a JPEG stays a JPEG unless part of it is made see-through. Very large pictures are reduced to 4096 pixels on their longest side.

> **Tip:** To lay a photo under the drawing, set its **Blend mode** to **Multiply** in Properties: the white paper shows the photo and the linework stays on top. [Align to Points](#mirror-rotate) with **Scale to fit** lines it up with two matching corners, and [Lock](#group-lock) keeps it from moving.

> **Tip:** To copy part of the drawing itself as a picture, use [Snapshot](#tool-snapshot).
