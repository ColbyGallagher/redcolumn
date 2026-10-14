# Preferences

Preferences change how redcolumn behaves on this device.

Open them with {{File > Preferences…}} (or press [[Ctrl+K]]). Pick a category on the left, then a tab along the top. Type in **Search** to find a setting: only the categories and tabs that have it are left, and the matching words are highlighted.

Click **OK** to keep your changes, or **Close** to forget them. **Defaults** puts every setting back as it came (press **OK** to keep that too). **Export** saves your preferences, name and custom words to a file; **Import** reads such a file back, for example on another computer.

Settings marked with a small circle (○) are saved, imported and exported with the rest, but redcolumn does not use them yet.

## General

![Preferences: General › Options](img/prefs-general-options.png)

- **Options** — **User** (the name on every markup you make; also the **Author** box in the {{Edit}} menu), **Tab Truncation** (which part of a long document name its tab cuts short), **Show Full-Screen Crosshair**, **Open PDF on Startup** (a Library document that opens in front every time; **Browse…** adds one from disk), and **Reopen Files from Last Session on Startup**.
- **Document** — **Enable Document Recovery** (changes not yet saved to a document's file stay marked unsaved after you close it or restart, and a notice says so; off, **Don't Save** undoes them), **Page Layout** (how a document is laid out when you first open it: **Auto-Detect** shows drawings larger than tabloid a page at a time and scrolls smaller pages), and **Maximum Zoom**, the furthest you can zoom in.
- **Units** — **Metric** (the default) or **Imperial**, and the default **Length**, **Area** and **Volume** units within it (metric: mm, cm, m or km; mm², cm², m² or km²; mm³, cm³ or m³). Scale and unit lists only offer this system's scales and units; preset scales and pages with no scale show measurements in the default units, and new scales show areas and volumes in them. Switching between metric and imperial converts the grid spacing.
- **Navigation** — what the plain mouse wheel does in single page and in continuous view (**Zoom** or **Scroll**), **Reverse Mouse Wheel when Zooming**, **Sensitivity** (how far a wheel notch scrolls and how fast a trackpad zooms), and under **Zoom Steps** how far each wheel notch, [[Ctrl]]+wheel notch and **+** / **−** press zooms.
- **Grid & Snap** — **Grid Spacing** (on the paper, in millimetres or inches as set by **Units**), **Show Grid** and **Snap to Grid**; **Snap to Content** and **Snap to Markup**, which kinds of points snap (**Lines**, **Curves**, **Mid-Points**, **End-Points**, **Intersections**), the snap **Sensitivity** in screen pixels and the **Snap Colour**. See [Snapping](#snapping).
- **Spelling** — **Enable Spell Check** underlines misspelt words as you type markup text and comments. **Include Upper Case Words** makes [Check Spelling](#spelling) check words in capitals too (off, it skips them: on drawings they are mostly abbreviations). **Active Dictionary** is the English Check Spelling uses (Australian, British or US). **Custom Words** are the words you added: **+** adds one, **×** removes the selected one.

![Preferences: General › Grid & Snap](img/prefs-general-grid-snap.png)

## Interface

- **File Access** — how many documents {{File > Open Recent}} lists, and how far back.
- **Markups List** — **Zoom Fit Markups when selected** (off, clicking a markup in the list only goes to its page), **Wrap Comment Text** (the list's own wrap setting), **Exclude Filtered Markups on Export** (CSV and Markup Summary exports leave out what the list's filters hide; off, they export every markup), what the page does with **Filtered Markups** (show, dim or hide them), and how faint dimmed ones are.
- **Layers** — **Hide Child Layers when Hiding Parent Layers**, **Show Layers On Page Only** (the Layers panel lists only the layers the current page uses), and the **Dial**: **Isolate** shows one layer at a time, **Fade** draws the other markup layers faintly instead (a PDF's own layers can only be hidden).
- **Display** — **Page Colours** (**As printed**, **Dark Mode** or **Dimmer**; see [Dark pages](#display)), **Disable Line Weights**, **Show Rulers**, **Show Spaces** and **Show Hyperlink Areas** (outlines [sheet links](#links)).

![Preferences: Interface › Markups List](img/prefs-interface-markups-list.png)

## Tools

![Preferences: Tools › Markup](img/prefs-tools-markup.png)

- **Markup** — **Reuse Tools** (see [Reuse a tool](#reuse)), **Auto-size Text Box and Call-out Markups** (fitted to their text after each edit), **Retain Layer Information when copying Markups**, **Always Show Reply Indicators**, **Embed Fonts** (saved documents carry the fonts markup text uses), comment pop-ups (rest the pointer on a markup with a comment: **Show Author and Date in Pop-Ups**, **Pop-Up Opacity**), **Copy Highlighted Text into Markup Comment**, **Default Image Encoding** for placed pictures, **Snapshot Resolution** (of the pictures [Snapshot](#tool-snapshot) copies), **Confirm before Deleting Markups**, and **Drag on the Page to Select Markups** (with Select, dragging on an empty part of the page draws a selection box instead of panning).
- **Sketch** — **Rotation Input** (typed angles from east, or **Relative** to the segment before), **Ellipse Mode** and **Draw to Scale**. See [Draw to Scale](#draw-to-scale).
- **Forms** — the **Highlight Colour** and **Opacity** of fillable fields, and **Enable Single Key Shortcuts**: with the Forms panel open, **T**, **C**, **R**, **D**, **L**, **B** and **S** start drawing a text field, check box, radio button, drop-down, list box, button or signature field.
- **Signature** — **Password Time-out** (minutes a Digital ID stays unlocked after you type its password; 0 asks every time), **Back Up…** and **Restore…** for your Digital IDs and the certificates you trust, the digest **Algorithm** new signatures use, and **Restrict changes that invalidate digital signatures** (changes that would rewrite a signed document are refused).
- **Eraser** — its size, and **Erase Whole Markups**. See [Eraser](#tool-eraser).
- **Tool Library** — how clicking a saved tool works. See [Use the Tool Library](#tool-library).

## Sets

How drawing [Sets](#sets) list their sheets.

- **Set Options** — whether a sheet of the same set opens in place of the document in front or in a new tab (and, separately, when that document has unsaved changes), what each row shows, **Show preview of PDF** (a picture of the sheet when you rest the pointer on it), whether **Categories** come from the set's template (**Auto**), are set by hand, or are not used, the **Default Template**, and **Always Prompt for Template Selection** when you make a set.
- **Sorting** — **Sort By**, **Sort Tagged Pages By Sheet Number**, the **Sort Order**, **Stack Multi-Page Documents**, and revisions: sheets with the same sheet number (or, with **Wildcard**, file names matching the **Wildcard Syntax**, e.g. `*_Rev#`) are revisions of one another. **Previous Revisions** are crossed out or hidden, and **Current Revisions** can stack them. When a new revision joins a set, **Copy markups from Previous to Current** copies the earlier sheet's markups to it (recovering flattened ones first, and flattening them after, if asked), and **Stamp previous revisions as 'Superseded'** stamps the earlier sheet.
- **Categories** — each template's categories and the start of the sheet number that puts a sheet in each: **+** and **×** add and remove rows, **New** starts an empty template, **Save As…** copies the template under a new name, and **Save** and **Load…** write a template to a file and read it back.
- **Tags** — the tags you can type on each sheet (in the Sets panel, right-click a sheet or click **#**). Sheet numbers and names are read off the pages unless **AutoMark** is off. Revision numbers, disciplines and sheet types can be tagged automatically from the sheet number.

![Preferences: Sets › Categories](img/prefs-sets-categories.png)

## Import/Export

**Images** — the camera's **Photo Resolution** and **Camera Portrait Orientation** for {{File > Create > From Camera…}} (and **Scanned Colour Images as JPEG**, else they are kept losslessly), the **Video Resolution** of video notes ({{Tools > Video…}}), **Import Image Resolution** for pictures placed on a page, what **Image Drag/Drop Behaviour** does with pictures dropped on a page (attach the photo, place an image markup, or add a page), the colourspace and resolution of pictures made into PDFs, and for {{File > Export > Page Images…}} the starting colourspace and resolution, **TIFF Compression** (CCITT Group 4 is black and white), **Create Multi-Page TIFFs** and the **Page Number** pattern image files are named with (e.g. `Page 001`).

## Advanced

![Preferences: Advanced › Offline](img/prefs-advanced-offline.png)

**Offline**:

- Whether the app is saved for offline use on this device.
- **Storage** — how much space your documents use, and **Keep on This Device**, which asks the browser not to clear your documents when space runs low (the desktop app is already kept).
- **OCR languages** — download them now so [OCR](#ocr) works offline.

> **Tip:** Settings for *what the screen shows* (toolbar, panels, tool library, list columns) are kept in [Profiles](#profiles) instead, so you can switch them all at once.
