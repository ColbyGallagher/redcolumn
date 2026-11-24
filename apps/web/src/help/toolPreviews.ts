import { msg } from '@nb/i18n';
// What the hover preview shows for a markup or Modify tool: a short animation (recorded by
// scripts/help/gifs.cjs into public/help/gif) and one sentence on how to use it. Keys are a
// toolbar tool id (data-toolbar-tool) or a ribbon command id (data-ribbon-command).

export interface ToolPreview {
  /** File in public/help/gif, without the extension; none for a tool that has no recording. */
  gif?: string;
  /** One short sentence on how to use the tool. */
  hint: string;
}

const TOOLS = (): Record<string, ToolPreview> => ({
  // Markup tab.
  line: { gif: 'tool-line', hint: msg('Drag from where the line starts to where it ends.') },
  arrow: { gif: 'tool-arrow', hint: msg('Drag from the tail to the thing you are pointing at.') },
  dimension: { gif: 'tool-dimension', hint: msg('Drag across what you are dimensioning, then type its text.') },
  polyline: { gif: 'tool-polyline', hint: msg('Click each corner, then press Enter or Space, or double-click, to finish.') },
  arc: { gif: 'tool-arc', hint: msg('Click the start, a point on the curve, then the end.') },
  ellipticalArc: { gif: 'tool-elliptical-arc', hint: msg('Drag the box the oval fits in; set its angles in Properties.') },
  rect: { gif: 'tool-rect', hint: msg('Drag from one corner to the opposite corner.') },
  ellipse: { gif: 'tool-ellipse', hint: msg('Drag the box the oval fills. Hold Shift for a circle.') },
  polygon: { gif: 'tool-polygon', hint: msg('Click each corner, then the first corner again to close it.') },
  cloud: { gif: 'tool-cloud', hint: msg('Drag from one corner to the opposite corner.') },
  polygonCloud: { gif: 'tool-polygon-cloud', hint: msg('Click each corner, then the first corner again to close it.') },
  cloudPlus: { gif: 'tool-cloud-plus', hint: msg('Drag a cloud, then type the note that comes with it.') },
  pen: { gif: 'tool-pen', hint: msg('Draw freehand with the mouse or a stylus.') },
  highlighter: { gif: 'tool-highlighter', hint: msg('Drag across words to highlight them.') },
  eraser: { gif: 'tool-eraser', hint: msg('Drag over a pen or highlighter stroke to rub it out.') },
  textHighlight: { gif: 'tool-text-highlight', hint: msg('Drag across words in the PDF to highlight them.') },
  underline: { gif: 'tool-underline', hint: msg('Drag across words in the PDF to underline them.') },
  strikeout: { gif: 'tool-underline', hint: msg('Drag across words in the PDF to strike them through.') },
  squiggly: { gif: 'tool-underline', hint: msg('Drag across words in the PDF to mark them with a wavy line.') },
  replaceText: { gif: 'tool-replace-text', hint: msg('Drag across the words, then type what replaces them.') },
  text: { gif: 'tool-text', hint: msg('Drag a box, type, then press Ctrl+Enter.') },
  callout: { gif: 'tool-callout', hint: msg('Press on the thing, drag to where the text goes, then type.') },
  typewriter: { gif: 'tool-typewriter', hint: msg('Click where the text starts and type.') },
  flagLabel: { gif: 'tool-flag-label', hint: msg('Drag a box for the flag, then type its label.') },
  note: { gif: 'tool-note', hint: msg('Click where the note goes, then type your comment.') },
  image: { gif: 'tool-image', hint: msg('Choose a picture, then drag a box to place it.') },
  stamp: { gif: 'tool-stamp', hint: msg('Choose a stamp, then click or drag to place it.') },
  attachment: { gif: 'tool-attachment', hint: msg('Choose a file, then click where the paperclip goes.') },
  hyperlink: { gif: 'tool-hyperlink', hint: msg('Drag a box, then choose where the link goes.') },
  snapshot: { gif: 'tool-snapshot', hint: msg('Drag a box round the area to copy it as a picture.') },
  legend: { gif: 'tool-legend', hint: msg('Drag a box; it lists the markups on the page.') },
  redaction: { gif: 'tool-redaction', hint: msg('Drag over what to remove, then apply it from Tools › Redaction.') },

  // Modify tab: Transform.
  'edit.move': { gif: 'move', hint: msg('Select markups, click a base point, then where it goes.') },
  'edit.copyBase': { gif: 'copy', hint: msg('Select markups, click a base point, then each place to copy to.') },
  'edit.rotate': { gif: 'rotate', hint: msg('Type an angle, then click the base point.') },
  'edit.scale': { gif: 'scale', hint: msg('Type a factor, then click the base point that stays put.') },
  'edit.mirror': { gif: 'mirror', hint: msg('Click two points on the mirror line.') },
  'edit.stretch': { gif: 'stretch', hint: msg('Window the edge to move, then pick a base point and a target.') },
  'edit.alignPoints': { gif: 'align-to-points', hint: msg('Click two points on the shape and where each should land.') },
  'edit.scaleToLength': { gif: 'scale-to-length', hint: msg('Click two points a known distance apart, then type the new length.') },
  'edit.cropImage': { hint: msg('Select a picture, then drag a box around the part to keep.') },
  'edit.resetCrop': { hint: msg('Shows the selected picture whole again.') },
  'edit.flipHorizontal': { gif: 'flip', hint: msg('Turns the selection over, left to right.') },
  'edit.flipVertical': { gif: 'flip', hint: msg('Turns the selection over, top to bottom.') },
  // Modify tab: Edit Geometry.
  'edit.offset': { gif: 'offset', hint: msg('Pick a line or shape, then click the side for the copies.') },
  'edit.trim': { gif: 'trim', hint: msg('Click the part of a line you want cut away.') },
  'edit.extend': { gif: 'extend', hint: msg('Click near the end of a line to carry it on to the next markup.') },
  'edit.break': { gif: 'break', hint: msg('Click where the gap starts, then where it ends.') },
  'edit.lengthen': { gif: 'lengthen', hint: msg('Type a length, then click the end of a line.') },
  'edit.fillet': { gif: 'fillet', hint: msg('Type a radius, then click the two lines to round.') },
  'edit.chamfer': { gif: 'chamfer', hint: msg('Type a distance, then click the two lines to cut the corner.') },
  // Modify tab: Convert.
  'edit.join': { gif: 'join', hint: msg('Select lines whose ends meet to make one polyline.') },
  'edit.explode': { gif: 'explode', hint: msg('Splits a polyline or rectangle into separate lines.') },
  'edit.reverse': { hint: msg('Runs a line, arrow or polyline the other way.') },
  'edit.toCloud': { gif: 'convert-to-cloud', hint: msg('Turns a selected rectangle or polygon into a revision cloud.') },
  'edit.autoSize': { gif: 'auto-size-text', hint: msg('Shrinks a text box to fit its text.') },
  // Modify tab: Pattern.
  'edit.arrayPolar': { gif: 'polar-array', hint: msg('Select markups, set the items, then click the centre.') },
  'edit.arrayPath': { gif: 'path-array', hint: msg('Select markups, set the items, then click the path.') },
  'edit.divide': { gif: 'divide', hint: msg('Set the parts, then click a line to mark it in equal parts.') },
  'edit.multiply': { gif: 'multiply', hint: msg('Fill in rows and columns to make a grid of copies.') },
  // Modify tab: Arrange and Align.
  'edit.bringToFront': { gif: 'arrange', hint: msg('Puts the selection on top of everything else.') },
  'edit.bringForward': { gif: 'arrange', hint: msg('Moves the selection up one level.') },
  'edit.sendBackward': { gif: 'arrange', hint: msg('Moves the selection down one level.') },
  'edit.sendToBack': { gif: 'arrange', hint: msg('Puts the selection under everything else.') },
  'edit.alignLeft': { gif: 'align-left', hint: msg('Lines up the left edges of the selected markups.') },
  'edit.alignCenter': { hint: msg('Lines up the centres of the selected markups, left to right.') },
  'edit.alignRight': { hint: msg('Lines up the right edges of the selected markups.') },
  'edit.alignTop': { hint: msg('Lines up the top edges of the selected markups.') },
  'edit.alignMiddle': { gif: 'align-middle', hint: msg('Lines up the centres of the selected markups, top to bottom.') },
  'edit.alignBottom': { hint: msg('Lines up the bottom edges of the selected markups.') },
  // Diagram tab.
  'diagram.process': { hint: msg('Click to place a step, or drag its size, then type its text.') },
  'diagram.decision': { hint: msg('Click to place a question; connect a line out of it for each answer.') },
  'diagram.terminator': { hint: msg('Click to place where the process starts or ends.') },
  'tool.connector': { hint: msg('Drag from one shape to another. The line follows them when they move.') },
  'diagram.connect': { hint: msg('Joins the selected shapes in order, top to bottom or left to right.') },
  'diagram.addBelow': { hint: msg('Adds the next step under the selected shape, joined to it, ready to type.') },
  'diagram.addRight': { hint: msg('Adds the next step right of the selected shape, joined to it.') },
});

/** The preview for a toolbar tool or ribbon command id, if it has one. */
export function toolPreview(id: string): ToolPreview | undefined {
  const tools = TOOLS();
  return Object.hasOwn(tools, id) ? tools[id] : undefined;
}

/** Every id with a preview, for tests. */
export const previewIds = (): readonly string[] => Object.keys(TOOLS());
