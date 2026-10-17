// What the hover preview shows for a markup or Modify tool: a short animation (recorded by
// scripts/help/gifs.cjs into public/help/gif) and one sentence on how to use it. Keys are a
// toolbar tool id (data-toolbar-tool) or a ribbon command id (data-ribbon-command).

export interface ToolPreview {
  /** File in public/help/gif, without the extension; none for a tool that has no recording. */
  gif?: string;
  /** One short sentence on how to use the tool. */
  hint: string;
}

const TOOLS: Record<string, ToolPreview> = {
  // Markup tab.
  line: { gif: 'tool-line', hint: 'Drag from where the line starts to where it ends.' },
  arrow: { gif: 'tool-arrow', hint: 'Drag from the tail to the thing you are pointing at.' },
  dimension: { gif: 'tool-dimension', hint: 'Drag across what you are dimensioning, then type its text.' },
  polyline: { gif: 'tool-polyline', hint: 'Click each corner, then press Enter to finish.' },
  arc: { gif: 'tool-arc', hint: 'Click the start, a point on the curve, then the end.' },
  ellipticalArc: { gif: 'tool-elliptical-arc', hint: 'Drag the box the oval fits in; set its angles in Properties.' },
  rect: { gif: 'tool-rect', hint: 'Drag from one corner to the opposite corner.' },
  ellipse: { gif: 'tool-ellipse', hint: 'Drag the box the oval fills. Hold Shift for a circle.' },
  polygon: { gif: 'tool-polygon', hint: 'Click each corner, then the first corner again to close it.' },
  cloud: { gif: 'tool-cloud', hint: 'Drag from one corner to the opposite corner.' },
  polygonCloud: { gif: 'tool-polygon-cloud', hint: 'Click each corner, then the first corner again to close it.' },
  cloudPlus: { gif: 'tool-cloud-plus', hint: 'Drag a cloud, then type the note that comes with it.' },
  pen: { gif: 'tool-pen', hint: 'Draw freehand with the mouse or a stylus.' },
  highlighter: { gif: 'tool-highlighter', hint: 'Drag across words to highlight them.' },
  eraser: { gif: 'tool-eraser', hint: 'Drag over a pen or highlighter stroke to rub it out.' },
  textHighlight: { gif: 'tool-text-highlight', hint: 'Drag across words in the PDF to highlight them.' },
  underline: { gif: 'tool-underline', hint: 'Drag across words in the PDF to underline them.' },
  strikeout: { gif: 'tool-underline', hint: 'Drag across words in the PDF to strike them through.' },
  squiggly: { gif: 'tool-underline', hint: 'Drag across words in the PDF to mark them with a wavy line.' },
  replaceText: { gif: 'tool-replace-text', hint: 'Drag across the words, then type what replaces them.' },
  text: { gif: 'tool-text', hint: 'Drag a box, type, then press Ctrl+Enter.' },
  callout: { gif: 'tool-callout', hint: 'Press on the thing, drag to where the text goes, then type.' },
  typewriter: { gif: 'tool-typewriter', hint: 'Click where the text starts and type.' },
  flagLabel: { gif: 'tool-flag-label', hint: 'Drag a box for the flag, then type its label.' },
  note: { gif: 'tool-note', hint: 'Click where the note goes, then type your comment.' },
  image: { gif: 'tool-image', hint: 'Choose a picture, then drag a box to place it.' },
  stamp: { gif: 'tool-stamp', hint: 'Choose a stamp, then click or drag to place it.' },
  attachment: { gif: 'tool-attachment', hint: 'Choose a file, then click where the paperclip goes.' },
  hyperlink: { gif: 'tool-hyperlink', hint: 'Drag a box, then choose where the link goes.' },
  snapshot: { gif: 'tool-snapshot', hint: 'Drag a box round the area to copy it as a picture.' },
  legend: { gif: 'tool-legend', hint: 'Drag a box; it lists the markups on the page.' },
  redaction: { gif: 'tool-redaction', hint: 'Drag over what to remove, then apply it from Tools › Redaction.' },

  // Modify tab: Transform.
  'edit.move': { gif: 'move', hint: 'Select markups, click a base point, then where it goes.' },
  'edit.copyBase': { gif: 'copy', hint: 'Select markups, click a base point, then each place to copy to.' },
  'edit.rotate': { gif: 'rotate', hint: 'Type an angle, then click the base point.' },
  'edit.scale': { gif: 'scale', hint: 'Type a factor, then click the base point that stays put.' },
  'edit.mirror': { gif: 'mirror', hint: 'Click two points on the mirror line.' },
  'edit.stretch': { gif: 'stretch', hint: 'Window the edge to move, then pick a base point and a target.' },
  'edit.alignPoints': { gif: 'align-to-points', hint: 'Click two points on the shape and where each should land.' },
  'edit.scaleToLength': { gif: 'scale-to-length', hint: 'Click two points a known distance apart, then type the new length.' },
  'edit.flipHorizontal': { gif: 'flip', hint: 'Turns the selection over, left to right.' },
  'edit.flipVertical': { gif: 'flip', hint: 'Turns the selection over, top to bottom.' },
  // Modify tab: Edit Geometry.
  'edit.offset': { gif: 'offset', hint: 'Pick a line or shape, then click the side for the copies.' },
  'edit.trim': { gif: 'trim', hint: 'Click the part of a line you want cut away.' },
  'edit.extend': { gif: 'extend', hint: 'Click near the end of a line to carry it on to the next markup.' },
  'edit.break': { gif: 'break', hint: 'Click where the gap starts, then where it ends.' },
  'edit.lengthen': { gif: 'lengthen', hint: 'Type a length, then click the end of a line.' },
  'edit.fillet': { gif: 'fillet', hint: 'Type a radius, then click the two lines to round.' },
  'edit.chamfer': { gif: 'chamfer', hint: 'Type a distance, then click the two lines to cut the corner.' },
  // Modify tab: Convert.
  'edit.join': { gif: 'join', hint: 'Select lines whose ends meet to make one polyline.' },
  'edit.explode': { gif: 'explode', hint: 'Splits a polyline or rectangle into separate lines.' },
  'edit.reverse': { hint: 'Runs a line, arrow or polyline the other way.' },
  'edit.toCloud': { gif: 'convert-to-cloud', hint: 'Turns a selected rectangle or polygon into a revision cloud.' },
  'edit.autoSize': { gif: 'auto-size-text', hint: 'Shrinks a text box to fit its text.' },
  // Modify tab: Pattern.
  'edit.arrayPolar': { gif: 'polar-array', hint: 'Select markups, set the items, then click the centre.' },
  'edit.arrayPath': { gif: 'path-array', hint: 'Select markups, set the items, then click the path.' },
  'edit.divide': { gif: 'divide', hint: 'Set the parts, then click a line to mark it in equal parts.' },
  'edit.multiply': { gif: 'multiply', hint: 'Fill in rows and columns to make a grid of copies.' },
  // Modify tab: Arrange and Align.
  'edit.bringToFront': { gif: 'arrange', hint: 'Puts the selection on top of everything else.' },
  'edit.bringForward': { gif: 'arrange', hint: 'Moves the selection up one level.' },
  'edit.sendBackward': { gif: 'arrange', hint: 'Moves the selection down one level.' },
  'edit.sendToBack': { gif: 'arrange', hint: 'Puts the selection under everything else.' },
  'edit.alignLeft': { gif: 'align-left', hint: 'Lines up the left edges of the selected markups.' },
  'edit.alignCenter': { hint: 'Lines up the centres of the selected markups, left to right.' },
  'edit.alignRight': { hint: 'Lines up the right edges of the selected markups.' },
  'edit.alignTop': { hint: 'Lines up the top edges of the selected markups.' },
  'edit.alignMiddle': { gif: 'align-middle', hint: 'Lines up the centres of the selected markups, top to bottom.' },
  'edit.alignBottom': { hint: 'Lines up the bottom edges of the selected markups.' },
};

/** The preview for a toolbar tool or ribbon command id, if it has one. */
export function toolPreview(id: string): ToolPreview | undefined {
  return Object.hasOwn(TOOLS, id) ? TOOLS[id] : undefined;
}

/** Every id with a preview, for tests. */
export const PREVIEW_IDS: readonly string[] = Object.keys(TOOLS);
