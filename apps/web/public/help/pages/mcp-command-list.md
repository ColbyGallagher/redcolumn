# Every command

`run_command` runs any command listed here, by its **ID**. `list_commands` shows the same commands with whether each can run right now. There are **326** commands. They match the menus and the command palette (see [Find any tool or command](#find-tools)).

This page lists every command that exists. Which are **available** depends on the screen: Save needs an open document, Join needs markups selected, and so on. The client can ask `list_commands` with `available` on to see only the ones that can run right now. A command that is not available is refused with "*name* is not available."

The **Notes** column says what happens when the client runs it:

- **Allow** — redcolumn asks you first, because it deletes, saves, imports or changes pages. Every Bulk command asks.
- **Dialog** — it opens a window or file picker and waits for you. The client is told "started, needs you" straight away and cannot fill in the window.
- **on/off** — it switches something on or off, or between two states.
- Nothing — it runs at once. A tool command only *arms* the tool: the drawing still needs a click or drag on the page. To draw from numbers instead, use [Draw markups](#mcp-draw).

## File

New, open, save, close, import, export, print, preferences. (28 commands)

| ID | Command | Notes |
|---|---|---|
| `file.newPdf` | New PDF… | Dialog |
| `file.fromCamera` | From Camera… | Dialog |
| `file.newFromTemplate` | New PDF from Template… | Dialog |
| `file.open` | Open… | Dialog |
| `file.combine` | Combine… | Dialog |
| `file.close` | Close | Allow |
| `file.closeAll` | Close All | Allow |
| `file.save` | Save | Allow |
| `file.saveAs` | Save As… | Dialog |
| `file.saveAll` | Save All | Allow |
| `file.revert` | Revert | Allow |
| `file.publish` | Publish… | Dialog |
| `file.share` | Share / Email… | Dialog |
| `file.exportImages` | Page Images… | Dialog |
| `file.exportXfdf` | Markups as XFDF… | Dialog |
| `file.importXfdf` | Import Markups from XFDF… | Allow, Dialog |
| `file.exportFdf` | Markups as FDF… | Dialog |
| `file.importFdf` | Import Markups from FDF… | Allow, Dialog |
| `file.exportBax` | Markups as Bluebeam BAX… | Dialog |
| `file.importBax` | Import Markups from Bluebeam BAX… | Allow, Dialog |
| `file.importPdfMarkups` | Import Markups from PDF… | Allow, Dialog |
| `file.exportCsv` | Export Markups CSV |  |
| `file.exportSummary` | Markup Summary… | Dialog |
| `file.print` | Print… | Dialog |
| `file.preferences` | Preferences… | Dialog |
| `file.manageProfiles` | Manage Profiles… | Dialog |
| `file.shortcuts` | Keyboard Shortcuts… | Dialog |
| `file.about` | About redcolumn |  |

## Edit

Undo, clipboard, selection, align, arrange, and the Modify tools. (73 commands)

| ID | Command | Notes |
|---|---|---|
| `edit.undo` | Undo |  |
| `edit.redo` | Redo |  |
| `edit.undoHistory` | Undo History… | Dialog |
| `edit.cut` | Cut | Allow |
| `edit.copy` | Copy |  |
| `edit.paste` | Paste |  |
| `edit.pasteInPlace` | Paste in Place |  |
| `edit.offset` | Offset |  |
| `edit.multiply` | Multiply… | Dialog |
| `edit.join` | Join |  |
| `edit.explode` | Explode |  |
| `edit.reverse` | Reverse |  |
| `edit.toCloud` | Convert to Cloud |  |
| `edit.selectSimilar` | Select Similar |  |
| `edit.delete` | Delete | Allow |
| `edit.hide` | Hide | on/off |
| `edit.showHidden` | Show Hidden Markups |  |
| `edit.selectAll` | Select All |  |
| `edit.formatPainter` | Format Painter |  |
| `edit.group` | Group |  |
| `edit.ungroup` | Ungroup |  |
| `edit.nudgeLeft` | Nudge Left |  |
| `edit.nudgeRight` | Nudge Right |  |
| `edit.nudgeUp` | Nudge Up |  |
| `edit.nudgeDown` | Nudge Down |  |
| `edit.nudgeLeftLarge` | Nudge Left (Large) |  |
| `edit.nudgeRightLarge` | Nudge Right (Large) |  |
| `edit.nudgeUpLarge` | Nudge Up (Large) |  |
| `edit.nudgeDownLarge` | Nudge Down (Large) |  |
| `edit.alignLeft` | Align Left |  |
| `edit.alignCenter` | Align Center |  |
| `edit.alignRight` | Align Right |  |
| `edit.alignTop` | Align Top |  |
| `edit.alignMiddle` | Align Middle |  |
| `edit.alignBottom` | Align Bottom |  |
| `edit.centerInDocument` | Center in Document |  |
| `edit.sameWidth` | Same Width |  |
| `edit.sameHeight` | Same Height |  |
| `edit.sameSize` | Same Size |  |
| `edit.distributeHorizontal` | Distribute Horizontally |  |
| `edit.distributeVertical` | Distribute Vertically |  |
| `edit.flipHorizontal` | Flip Horizontal |  |
| `edit.flipVertical` | Flip Vertical |  |
| `edit.scaleToLength` | Scale to Length… | Dialog |
| `edit.bringToFront` | Bring to Front |  |
| `edit.bringForward` | Bring Forward |  |
| `edit.sendBackward` | Send Backward |  |
| `edit.sendToBack` | Send to Back |  |
| `edit.autoSize` | Auto-size Text Box |  |
| `edit.editAction` | Edit Action… | Dialog |
| `edit.find` | Find Text |  |
| `edit.checkSpelling` | Check Spelling… | Dialog |
| `edit.eraseContent` | Erase Content |  |
| `edit.cutContent` | Cut Content |  |
| `edit.editText` | Edit Text |  |
| `edit.selectText` | Select Text |  |
| `edit.move` | Move |  |
| `edit.copyBase` | Copy by Base Point |  |
| `edit.scale` | Scale |  |
| `edit.trim` | Trim |  |
| `edit.extend` | Extend |  |
| `edit.break` | Break |  |
| `edit.lengthen` | Lengthen |  |
| `edit.fillet` | Fillet |  |
| `edit.chamfer` | Chamfer |  |
| `edit.mirror` | Mirror |  |
| `edit.rotate` | Rotate |  |
| `edit.alignPoints` | Align to Points |  |
| `edit.stretch` | Stretch |  |
| `edit.arrayPolar` | Polar Array |  |
| `edit.arrayPath` | Path Array |  |
| `edit.divide` | Divide / Measure |  |
| `edit.lock` | Lock / Unlock | on/off |

## View

Zoom, page layout, split, snapping, rulers and display aids. (44 commands)

| ID | Command | Notes |
|---|---|---|
| `view.fitPage` | Fit Page |  |
| `view.fitWidth` | Fit Width |  |
| `view.actualSize` | Actual Size |  |
| `view.zoomIn` | Zoom In |  |
| `view.zoomOut` | Zoom Out |  |
| `view.singlePage` | Single Page |  |
| `view.continuous` | Continuous Pages |  |
| `view.sideBySide` | Side-by-Side |  |
| `view.continuousSideBySide` | Continuous Side-by-Side |  |
| `view.coverPage` | Show Cover Page in Side-by-Side | on/off |
| `view.rotateClockwise` | Rotate View Clockwise |  |
| `view.rotateCounterclockwise` | Rotate View Counterclockwise |  |
| `view.split` | Split Vertical | on/off |
| `view.splitHorizontal` | Split Horizontal | on/off |
| `view.syncDocument` | Synchronise Document |  |
| `view.syncPage` | Synchronise Page |  |
| `view.switchPanes` | Switch Split Panes |  |
| `view.balance` | Balance Split |  |
| `view.unsplit` | Unsplit |  |
| `view.stitched` | Stitched View | on/off |
| `view.rulers` | Rulers | on/off |
| `view.crosshair` | Full-Screen Crosshair | on/off |
| `view.grid` | Show Grid | on/off |
| `view.snapGrid` | Snap to Grid | on/off |
| `view.snapContent` | Snap to Content | on/off |
| `view.snapMarkup` | Snap to Markup | on/off |
| `view.polarTracking` | Polar Tracking | on/off |
| `view.objectSnapTracking` | Object Snap Tracking | on/off |
| `view.showLinks` | Show Links | on/off |
| `view.darkPages` | Dark Mode (Pages) | on/off |
| `view.dimmer` | Dimmer | on/off |
| `view.thinLines` | Disable Line Weights | on/off |
| `view.magnifier` | Magnifier | on/off |
| `view.fullScreen` | Full Screen | on/off |
| `view.replyIndicators` | Always Show Reply Indicators | on/off |
| `view.reuse` | Reuse Tool | on/off |
| `view.back` | Previous View |  |
| `view.forward` | Next View |  |
| `view.nextPage` | Next Page |  |
| `view.prevPage` | Previous Page |  |
| `view.firstPage` | First Page |  |
| `view.lastPage` | Last Page |  |
| `view.nextDocument` | Next Document |  |
| `view.prevDocument` | Previous Document |  |

## Document

Page and whole-file work. (38 commands)

| ID | Command | Notes |
|---|---|---|
| `document.properties` | Document Properties… | Dialog |
| `document.addBookmark` | Add Bookmark |  |
| `document.rotatePages` | Rotate Pages | Allow |
| `document.rotateCounterclockwise` | Rotate Pages Counterclockwise | Allow |
| `document.insertPages` | Insert Pages from PDF… | Allow, Dialog |
| `document.bulkInsertPages` | Bulk Insert PDFs… | Allow, Dialog |
| `document.insertBlank` | Insert Blank Pages… | Allow, Dialog |
| `document.extractPages` | Extract Pages… | Dialog |
| `document.copyPageSnapshot` | Copy Page to Snapshot |  |
| `document.deletePages` | Delete Pages… | Allow, Dialog |
| `document.splitDocument` | Split Document… | Dialog |
| `document.replacePages` | Replace Pages… | Allow, Dialog |
| `document.cropPages` | Crop Pages… | Allow, Dialog |
| `document.pageSetup` | Page Setup… | Allow, Dialog |
| `document.headerFooter` | Headers & Footers… | Allow, Dialog |
| `document.numberPages` | Number Pages… | Allow, Dialog |
| `document.flatten` | Flatten… | Allow, Dialog |
| `document.unflatten` | Unflatten | Allow |
| `document.reduceSize` | Reduce File Size… | Allow, Dialog |
| `document.repair` | Repair PDF | Allow |
| `document.colour` | Colour Processing… | Allow, Dialog |
| `document.ocr` | OCR… | Allow, Dialog |
| `document.slipSheet` | Slip Sheet… | Allow, Dialog |
| `document.revisions` | Revisions… | Dialog |
| `document.security` | Security… | Allow, Dialog |
| `document.pdfa` | Archive as PDF/A… | Allow, Dialog |
| `document.compare` | Compare Documents… | Dialog |
| `document.semanticCompare` | AI Compare Documents… | Dialog |
| `document.overlay` | Overlay Pages… | Dialog |
| `document.stitching` | Stitching… (Experimental) |  |
| `document.geospatial` | Geospatial… | Dialog |
| `document.stitchToPage` | Stitch to New Page (Experimental) |  |
| `document.labelRegions` | Page Labels from Region… | Allow, Dialog |
| `document.scaleRegions` | Bulk Apply Page Scale… | Allow, Dialog |
| `document.scaleReview` | Review Sheet Scales… | Dialog |
| `document.drawingStandards` | Drawing Standards… | Dialog |
| `document.setUpDrawingStandard` | Set Up Drawing Standard… | Dialog |
| `document.thumbnails` | Edit Page Labels in Thumbnails |  |
| `document.teachMark` | Teach Sheet Links… | Dialog |

## Bulk

The same job on many files. (18 commands)

| ID | Command | Notes |
|---|---|---|
| `tools.bulkRedact` | Bulk Redact… | Dialog |
| `batch.flatten` | Flatten… | Allow, Dialog |
| `batch.unflatten` | Unflatten… | Allow, Dialog |
| `batch.reduce` | Reduce File Size… | Allow, Dialog |
| `batch.repair` | Repair… | Allow, Dialog |
| `batch.colour` | Colour Processing… | Allow, Dialog |
| `batch.ocr` | OCR… | Allow, Dialog |
| `batch.removeHeaderFooter` | Remove Headers & Footers… | Allow, Dialog |
| `batch.summary` | Markup Summary… | Allow, Dialog |
| `batch.print` | Print… | Allow, Dialog |
| `batch.link` | Auto-Link Sheets… | Allow, Dialog |
| `batch.stamp` | Apply Stamp… | Allow, Dialog |
| `batch.headerFooter` | Headers & Footers… | Allow, Dialog |
| `batch.crop` | Crop Pages… | Allow, Dialog |
| `batch.pageSetup` | Page Setup… | Allow, Dialog |
| `batch.split` | Split… | Allow, Dialog |
| `batch.sign` | Sign & Seal… | Allow, Dialog |
| `batch.pageLabels` | Page Labels (AutoMark)… | Allow, Dialog |

## Tools

Markup tools, measuring tools, flowchart shapes and takeoff commands. (92 commands)

| ID | Command | Notes |
|---|---|---|
| `tool.pan` | Pan |  |
| `tool.zoomBox` | Zoom |  |
| `tool.dynamicZoom` | Dynamic Zoom |  |
| `tools.sound` | Sound… | Dialog |
| `tools.video` | Video… | Dialog |
| `tools.eraserSmall` | Eraser Size: Small |  |
| `tools.eraserMedium` | Eraser Size: Medium |  |
| `tools.eraserLarge` | Eraser Size: Large |  |
| `tools.eraserWhole` | Annotation Eraser (Whole Markups) |  |
| `tools.sketchToScale` | Draw to Scale | on/off |
| `tools.stamps` | Manage Stamps… | Dialog |
| `tools.lineStyles` | Line Styles… | Dialog |
| `tools.nextMeasure` | Next Measure Tool |  |
| `tools.applyRedactions` | Apply Redactions… | Allow, Dialog |
| `tools.sign` | Sign with Digital ID… | Allow, Dialog |
| `tools.digitalIds` | Digital IDs… | Dialog |
| `tools.formField` | Form Field |  |
| `tools.forms` | Forms Panel |  |
| `tools.autoFields` | Auto-Create Fields… | Allow, Dialog |
| `tools.columns` | Markup Columns & Statuses… | Dialog |
| `tools.assemblies` | Assemblies… | Dialog |
| `tools.quantities` | Takeoff Quantities… | Dialog |
| `tools.scripts` | Scripts… | Dialog |
| `tools.takeoffReview` | Review AI Proposals… | Dialog |
| `tools.signatures` | Sign… | Dialog |
| `tool.connector` | Connector |  |
| `diagram.addBelow` | Add Step Below |  |
| `diagram.addRight` | Add Step Right |  |
| `diagram.addAbove` | Add Step Above |  |
| `diagram.addLeft` | Add Step Left |  |
| `diagram.connect` | Connect Shapes |  |
| `diagram.elbow` | Elbow Connectors | on/off |
| `diagram.straight` | Straight Connectors | on/off |
| `tool.select` | Select |  |
| `tool.lasso` | Lasso |  |
| `tool.line` | Line |  |
| `tool.arrow` | Arrow |  |
| `tool.dimension` | Dimension |  |
| `tool.polyline` | Polyline |  |
| `tool.arc` | Arc |  |
| `tool.ellipticalArc` | Elliptical Arc |  |
| `tool.rect` | Rectangle |  |
| `tool.ellipse` | Ellipse |  |
| `tool.polygon` | Polygon |  |
| `tool.cloud` | Cloud |  |
| `tool.polygonCloud` | Polygon Cloud |  |
| `tool.cloudPlus` | Cloud+ |  |
| `tool.pen` | Pen |  |
| `tool.highlighter` | Highlight |  |
| `tool.eraser` | Eraser |  |
| `tool.textHighlight` | Text Highlight |  |
| `tool.underline` | Underline |  |
| `tool.strikeout` | Strikethrough |  |
| `tool.squiggly` | Squiggly |  |
| `tool.replaceText` | Replace Text |  |
| `tool.text` | Text Box |  |
| `tool.callout` | Callout |  |
| `tool.typewriter` | Typewriter |  |
| `tool.flagLabel` | Flag Label |  |
| `tool.note` | Note |  |
| `tool.image` | Image |  |
| `tool.stamp` | Stamp |  |
| `tool.attachment` | File Attachment |  |
| `tool.hyperlink` | Hyperlink |  |
| `tool.snapshot` | Snapshot |  |
| `tool.legend` | Legend |  |
| `tool.table` | Table |  |
| `tool.space` | Space |  |
| `tool.redaction` | Redaction |  |
| `tool.calibrate` | Calibrate |  |
| `tool.length` | Length |  |
| `tool.polylength` | Polylength |  |
| `tool.perimeter` | Perimeter |  |
| `tool.arcLength` | Arc Length |  |
| `tool.diameter` | Diameter |  |
| `tool.radius` | Radius |  |
| `tool.angle` | Angle |  |
| `tool.area` | Area |  |
| `tool.volume` | Volume |  |
| `tool.dynamicFill` | Smart Fill |  |
| `tool.count` | Count |  |
| `tool.visualSearch` | Symbol Search |  |
| `diagram.process` | Process |  |
| `diagram.decision` | Decision |  |
| `diagram.terminator` | Start / End |  |
| `diagram.data` | Data |  |
| `diagram.document` | Document |  |
| `diagram.predefined` | Subprocess |  |
| `diagram.preparation` | Preparation |  |
| `diagram.manualInput` | Manual Input |  |
| `diagram.database` | Database |  |
| `diagram.circle` | On-page Reference |  |

## Window

Toolbar, panels and layout. (24 commands)

| ID | Command | Notes |
|---|---|---|
| `window.toolbar` | Tools Toolbar | on/off |
| `window.ribbon` | Ribbon | on/off |
| `window.ribbonTabs` | Ribbon Tabs Only | on/off |
| `window.simplifiedToolbar` | Simplified Toolbar | on/off |
| `window.leftPanel` | Left Panel | on/off |
| `window.rightPanel` | Right Panel | on/off |
| `window.bottomPanel` | Bottom Panel | on/off |
| `window.panels` | Toggle Panels |  |
| `window.files` | File Access |  |
| `window.pages` | Thumbnails |  |
| `window.bookmarks` | Bookmarks |  |
| `window.toolchest` | Tool Library |  |
| `window.properties` | Properties |  |
| `window.layers` | Layers |  |
| `window.measurements` | Measurements |  |
| `window.spaces` | Spaces |  |
| `window.signatures` | Signatures |  |
| `window.search` | Search |  |
| `window.forms` | Forms |  |
| `window.sets` | Sets |  |
| `window.sessions` | Sessions |  |
| `window.markups` | Markups List |  |
| `window.links` | Hyperlinks |  |
| `window.collapseRibbon` | Collapse / Expand the Ribbon | on/off |

## Help

Help menu. (9 commands)

| ID | Command | Notes |
|---|---|---|
| `help.commands` | Find Tools + Commands… | Dialog |
| `help.docs` | Help |  |
| `help.updates` | Check for Updates |  |
| `help.install` | Install App… | Dialog |
| `help.support` | Technical Support |  |
| `help.suggest` | Make a Suggestion |  |
| `help.community` | redcolumn Community |  |
| `help.logs` | Send Log Files |  |
| `help.whatsNew` | Learn What's New |  |

## Good to know

- **Lock / Unlock** and **Collapse / Expand the Ribbon** show whichever applies at the time.
- **Install App…** (`help.install`) is in the web version only, not the desktop app.
- If a host program embedding redcolumn refuses a command (for example Flatten or Reduce File Size when linked records depend on the file), it shows as not available.
- Some commands need state the client sets first, such as markups selected. The client can use [select_markups](#mcp-edit) and then `run_command`.

Back to [Run commands](#mcp-commands).
