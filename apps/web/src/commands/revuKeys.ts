import { DEFAULT_KEYS, type KeyOverrides } from './keys';

/**
 * Bluebeam Revu's keyboard shortcuts: its KeyboardShortcuts.xml read into redcolumn's shortcut
 * overrides, and the "Revu 21" preset.
 *
 * Revu stores each shortcut as a .NET `Keys` value: the virtual-key code in the low 16 bits, with
 * Shift (0x10000), Ctrl (0x20000) and Alt (0x40000) above it, against a feature name such as
 * `Markup.Cloud`. redcolumn's defaults already follow Revu 21 (keys.ts); this reads a person's own
 * file, with whatever they changed in Revu, and maps it onto redcolumn's commands.
 */

/** Revu feature name → redcolumn command id. Features with no redcolumn command are not listed. */
export const REVU_FEATURES: Readonly<Record<string, string>> = {
  'File.CreatePDF': 'file.newPdf',
  'File.Open': 'file.open',
  'File.CloseDocument': 'file.close',
  'View.CloseAll': 'file.closeAll',
  'Document.Save': 'file.save',
  'Document.SaveAs': 'file.saveAs',
  'Document.SaveAll': 'file.saveAll',
  'Document.Print': 'file.print',
  'Document.Email': 'file.share',
  'Edit.Preferences': 'file.preferences',
  'Markup.Export': 'file.exportXfdf',
  'Markup.Import': 'file.importXfdf',
  'Markup.ImageFromCamera': 'file.fromCamera',
  'Edit.Undo': 'edit.undo',
  'Edit.Redo': 'edit.redo',
  'Edit.Cut': 'edit.cut',
  'Edit.Copy': 'edit.copy',
  'Edit.Paste': 'edit.paste',
  'Edit.PasteInPlace': 'edit.pasteInPlace',
  'Edit.Multiply': 'edit.multiply',
  Delete: 'edit.delete',
  SelectAll: 'edit.selectAll',
  'Markup.FormatPainter': 'edit.formatPainter',
  'Markup.Group': 'edit.group',
  'Markup.UnGroup': 'edit.ungroup',
  'Markup.ToggleLock': 'edit.lock',
  AutosizeTextBox: 'edit.autoSize',
  'Markup.EditAction': 'edit.editAction',
  Search: 'edit.find',
  SpellCheck: 'edit.checkSpelling',
  'Edit.SelectText': 'edit.selectText',
  'Align.Left': 'edit.alignLeft',
  'Align.Center': 'edit.alignCenter',
  'Align.Right': 'edit.alignRight',
  'Align.Top': 'edit.alignTop',
  'Align.Middle': 'edit.alignMiddle',
  'Align.Bottom': 'edit.alignBottom',
  'Align.FlipHorizontal': 'edit.flipHorizontal',
  'Align.FlipVertical': 'edit.flipVertical',
  'Markup.BringForward': 'edit.bringForward',
  'Markup.BringToFront': 'edit.bringToFront',
  'Markup.SendBackward': 'edit.sendBackward',
  'Markup.SendToBack': 'edit.sendToBack',
  'View.FitPage': 'view.fitPage',
  'View.FitWidth': 'view.fitWidth',
  'View.ActualSize': 'view.actualSize',
  'Zoom.In': 'view.zoomIn',
  'Zoom.Out': 'view.zoomOut',
  'View.Single': 'view.singlePage',
  'View.Continuous': 'view.continuous',
  'View.SideBySide': 'view.sideBySide',
  'View.SideBySideContinuous': 'view.continuousSideBySide',
  'View.Split': 'view.split',
  'View.SplitHorizontal': 'view.splitHorizontal',
  'View.UnSplit': 'view.unsplit',
  'View.Switch': 'view.switchPanes',
  'View.Balance': 'view.balance',
  'Toggle.FullScreen': 'view.fullScreen',
  'View.RotateClockwise': 'view.rotateClockwise',
  'View.RotateCounterclockwise': 'view.rotateCounterclockwise',
  'Toggle.Rulers': 'view.rulers',
  'Toggle.Grid': 'view.grid',
  'Toggle.GridSnap': 'view.snapGrid',
  'Toggle.ContentSnap': 'view.snapContent',
  'Toggle.MarkupSnap': 'view.snapMarkup',
  'Toggle.Dimmer': 'view.dimmer',
  'View.PreviousView': 'view.back',
  'View.NextView': 'view.forward',
  'View.PageDown': 'view.nextPage',
  'View.PageNext': 'view.nextPage',
  'View.PageUp': 'view.prevPage',
  'View.PagePrevious': 'view.prevPage',
  'View.PageFirst': 'view.firstPage',
  'View.PageLast': 'view.lastPage',
  'View.DocumentNext': 'view.nextDocument',
  'View.DocumentPrevious': 'view.prevDocument',
  'Arrow.Left': 'edit.nudgeLeft',
  'Arrow.Right': 'edit.nudgeRight',
  'Arrow.Up': 'edit.nudgeUp',
  'Arrow.Down': 'edit.nudgeDown',
  'Document.Properties': 'document.properties',
  'Document.Security': 'document.security',
  AddBookmark: 'document.addBookmark',
  'Document.RotatePages': 'document.rotatePages',
  'Document.RotateClockwise': 'document.rotatePages',
  'Document.RotateCounterclockwise': 'document.rotateCounterclockwise',
  'Document.ReplacePages': 'document.replacePages',
  'Document.CropPages': 'document.cropPages',
  'Document.Flatten': 'document.flatten',
  'Document.OCR': 'document.ocr',
  'Document.UnFlatten': 'document.unflatten',
  'Document.ExtractPages': 'document.extractPages',
  'Document.DeletePages': 'document.deletePages',
  'Document.InsertPages': 'document.insertPages',
  'Document.InsertBlankPage': 'document.insertBlank',
  'Document.CopyPageToSnapShot': 'document.copyPageSnapshot',
  'Document.PublishCompressed': 'document.reduceSize',
  Select: 'tool.select',
  Pan: 'tool.pan',
  Zoom: 'tool.zoomBox',
  'Toggle.Zoom': 'tool.dynamicZoom',
  Lasso: 'tool.lasso',
  Snapshot: 'tool.snapshot',
  'Markup.Line': 'tool.line',
  'Markup.Arrow': 'tool.arrow',
  'Markup.Dimension': 'tool.dimension',
  'Markup.Polyline': 'tool.polyline',
  'Markup.Arc': 'tool.arc',
  'Markup.Rectangle': 'tool.rect',
  'Markup.Ellipse': 'tool.ellipse',
  'Markup.Polygon': 'tool.polygon',
  'Markup.Cloud': 'tool.cloud',
  'Markup.Cloud9': 'tool.cloudPlus',
  'Markup.Pen': 'tool.pen',
  'Markup.Highlight': 'tool.textHighlight',
  Eraser: 'tool.eraser',
  'Markup.Underline': 'tool.underline',
  'Markup.Strikethrough': 'tool.strikeout',
  'Markup.Squiggly': 'tool.squiggly',
  'Markup.TextBox': 'tool.text',
  'Markup.Callout': 'tool.callout',
  'Markup.Typewriter': 'tool.typewriter',
  'Markup.Note': 'tool.note',
  'Markup.Image': 'tool.image',
  'Markup.FileAttachment': 'tool.attachment',
  'Markup.Stamp': 'tool.stamp',
  'Markup.Hyperlink': 'tool.hyperlink',
  'Markup.Redaction': 'tool.redaction',
  'Measure.Tool': 'tool.length',
  'Measure.Length': 'tool.length',
  'Measure.Polylength': 'tool.polylength',
  'Measure.Area': 'tool.area',
  'Measure.Perimeter': 'tool.perimeter',
  'Measure.Count': 'tool.count',
  'Measure.Diameter': 'tool.diameter',
  'Measure.Angle': 'tool.angle',
  'Measure.Radius': 'tool.radius',
  'Measure.Volume': 'tool.volume',
  'Measure.DynamicFill': 'tool.dynamicFill',
  'Measure.Next': 'tools.nextMeasure',
  'Document.ApplyRedactions': 'tools.applyRedactions',
  'Markup.DigitalSignature': 'tools.sign',
  'Form.Editor': 'tools.forms',
  'Toggle.Panels': 'window.panels',
  'Tab.File Manager': 'window.files',
  'Tab.Thumbnails': 'window.pages',
  'Tab.Bookmarks': 'window.bookmarks',
  'Tab.Tool Chest': 'window.toolchest',
  'Tab.Properties': 'window.properties',
  'Tab.Layers': 'window.layers',
  'Tab.Measurements': 'window.measurements',
  'Tab.Spaces': 'window.spaces',
  'Tab.Signatures': 'window.signatures',
  'Tab.Search': 'window.search',
  'Tab.Acroforms': 'window.forms',
  'Tab.Sets': 'window.sets',
  'Tab.Studio': 'window.sessions',
  'Tab.Markups': 'window.markups',
  'Tab.Hyperlinks': 'window.links',
  Help: 'help.docs',
};

/**
 * Revu 21's own shortcuts for the features above, as shipped (from its KeyboardShortcuts.xml).
 * The "Revu 21" preset gives each command exactly these keys and nothing else.
 */
export const REVU_21_KEYS: Readonly<Record<string, readonly string[]>> = {
  'File.CreatePDF': ['Ctrl+N'],
  'File.Open': ['Ctrl+O'],
  'File.CloseDocument': ['Ctrl+F4', 'Ctrl+W'],
  'View.CloseAll': ['Ctrl+Shift+W'],
  'Document.Save': ['Ctrl+S'],
  'Document.SaveAs': ['Ctrl+Shift+S'],
  'Document.SaveAll': ['Shift+F2'],
  'Document.Print': ['Ctrl+P'],
  'Document.Email': ['Ctrl+E'],
  'Edit.Preferences': ['Ctrl+K'],
  'Markup.Export': ['Ctrl+F2'],
  'Markup.Import': ['Ctrl+F3'],
  'Markup.ImageFromCamera': ['Ctrl+Alt+I'],
  'Edit.Undo': ['Ctrl+Z'],
  'Edit.Redo': ['Ctrl+Y', 'Ctrl+Shift+Z'],
  'Edit.Cut': ['Ctrl+X', 'Shift+Delete'],
  'Edit.Copy': ['Ctrl+C', 'Ctrl+Insert'],
  'Edit.Paste': ['Ctrl+V', 'Shift+Insert'],
  'Edit.PasteInPlace': ['Ctrl+Shift+V'],
  'Edit.Multiply': ['Ctrl+M'],
  Delete: ['Delete'],
  SelectAll: ['Ctrl+A'],
  'Markup.FormatPainter': ['Ctrl+Shift+C'],
  'Markup.Group': ['Ctrl+G'],
  'Markup.UnGroup': ['Ctrl+Shift+G'],
  'Markup.ToggleLock': ['Ctrl+Shift+L'],
  AutosizeTextBox: ['Alt+Z'],
  'Markup.EditAction': ['Ctrl+Shift+E'],
  Search: ['Ctrl+F'],
  SpellCheck: ['F7'],
  'Edit.SelectText': ['Shift+T'],
  'Align.Left': ['Ctrl+Alt+L'],
  'Align.Center': ['Ctrl+Alt+E'],
  'Align.Right': ['Ctrl+Alt+R'],
  'Align.Top': ['Ctrl+Alt+T'],
  'Align.Middle': ['Ctrl+Alt+M'],
  'Align.Bottom': ['Ctrl+Alt+B'],
  'Align.FlipHorizontal': ['Ctrl+Alt+H'],
  'Align.FlipVertical': ['Ctrl+Alt+V'],
  'Markup.BringForward': ['Ctrl+]'],
  'Markup.BringToFront': ['Ctrl+Shift+]'],
  'Markup.SendBackward': ['Ctrl+['],
  'Markup.SendToBack': ['Ctrl+Shift+['],
  'View.FitPage': ['Ctrl+9'],
  'View.FitWidth': ['Ctrl+0'],
  'View.ActualSize': ['Ctrl+8'],
  'Zoom.In': ['Plus', 'Shift+Plus', 'Ctrl+Plus'],
  'Zoom.Out': ['Minus', 'Shift+Minus', 'Ctrl+Minus'],
  'View.Single': ['Ctrl+4'],
  'View.Continuous': ['Ctrl+5'],
  'View.SideBySide': ['Ctrl+6'],
  'View.SideBySideContinuous': ['Ctrl+7'],
  'View.Split': ['Ctrl+2'],
  'View.SplitHorizontal': ['Ctrl+H'],
  'View.UnSplit': ['Ctrl+Shift+2'],
  'View.Switch': ['Ctrl+1'],
  'View.Balance': ['Shift+F12'],
  'Toggle.FullScreen': ['F11'],
  'View.RotateClockwise': ['Ctrl+Shift+Plus'],
  'View.RotateCounterclockwise': ['Ctrl+Shift+Minus'],
  'Toggle.Rulers': ['Ctrl+R'],
  'Toggle.Grid': ['Shift+F9'],
  'Toggle.GridSnap': ['Ctrl+Shift+F9'],
  'Toggle.ContentSnap': ['Ctrl+Shift+F8'],
  'Toggle.MarkupSnap': ['Ctrl+Shift+F7'],
  'Toggle.Dimmer': ['Ctrl+F5'],
  'View.PreviousView': ['Alt+Left'],
  'View.NextView': ['Alt+Right'],
  'View.PageDown': ['PageDown'],
  'View.PageNext': ['Ctrl+Right'],
  'View.PageUp': ['PageUp'],
  'View.PagePrevious': ['Ctrl+Left'],
  'View.PageFirst': ['Home', 'Ctrl+Home'],
  'View.PageLast': ['End', 'Ctrl+End'],
  'View.DocumentNext': ['Ctrl+Tab', 'Ctrl+F6'],
  'View.DocumentPrevious': ['Ctrl+Shift+Tab', 'Ctrl+Shift+F6'],
  'Arrow.Left': ['Left', 'Shift+Left'],
  'Arrow.Right': ['Right', 'Shift+Right'],
  'Arrow.Up': ['Up', 'Shift+Up'],
  'Arrow.Down': ['Down', 'Shift+Down'],
  'Document.Properties': ['Ctrl+D'],
  'Document.Security': ['Ctrl+L'],
  AddBookmark: ['Ctrl+B'],
  'Document.RotatePages': ['Ctrl+Shift+R'],
  'Document.RotateClockwise': ['Alt+Shift+Plus'],
  'Document.RotateCounterclockwise': ['Alt+Shift+Minus'],
  'Document.ReplacePages': ['Ctrl+Shift+Y'],
  'Document.CropPages': ['Alt+Shift+O'],
  'Document.Flatten': ['Ctrl+Shift+M'],
  'Document.OCR': ['Ctrl+Shift+O'],
  'Document.UnFlatten': ['Ctrl+Shift+U'],
  'Document.ExtractPages': ['Ctrl+Shift+X'],
  'Document.DeletePages': ['Ctrl+Shift+D'],
  'Document.InsertPages': ['Ctrl+Shift+I'],
  'Document.InsertBlankPage': ['Ctrl+Shift+N'],
  'Document.CopyPageToSnapShot': ['Ctrl+Alt+C'],
  'Document.PublishCompressed': ['Ctrl+Shift+P'],
  Select: ['V'],
  Pan: ['Shift+V'],
  Zoom: ['Z'],
  'Toggle.Zoom': ['Shift+Z'],
  Lasso: ['Shift+O'],
  Snapshot: ['G'],
  'Markup.Line': ['L'],
  'Markup.Arrow': ['A'],
  'Markup.Dimension': ['Shift+L'],
  'Markup.Polyline': ['Shift+N'],
  'Markup.Arc': ['Shift+C'],
  'Markup.Rectangle': ['R'],
  'Markup.Ellipse': ['E'],
  'Markup.Polygon': ['Shift+P'],
  'Markup.Cloud': ['C'],
  'Markup.Cloud9': ['K'],
  'Markup.Pen': ['P'],
  'Markup.Highlight': ['H'],
  Eraser: ['Shift+E'],
  'Markup.Underline': ['U'],
  'Markup.Strikethrough': ['D'],
  'Markup.Squiggly': ['Shift+U'],
  'Markup.TextBox': ['T'],
  'Markup.Callout': ['Q'],
  'Markup.Typewriter': ['W'],
  'Markup.Note': ['N'],
  'Markup.Image': ['I'],
  'Markup.FileAttachment': ['F'],
  'Markup.Stamp': ['S'],
  'Markup.Hyperlink': ['Shift+H'],
  'Markup.Redaction': ['Shift+R'],
  'Measure.Tool': ['M'],
  'Measure.Length': ['Alt+Shift+L'],
  'Measure.Polylength': ['Alt+Shift+Q'],
  'Measure.Area': ['Alt+Shift+A'],
  'Measure.Perimeter': ['Alt+Shift+P'],
  'Measure.Count': ['Alt+Shift+C'],
  'Measure.Diameter': ['Alt+Shift+D'],
  'Measure.Angle': ['Alt+Shift+G'],
  'Measure.Radius': ['Alt+Shift+U'],
  'Measure.Volume': ['Alt+Shift+V'],
  'Measure.DynamicFill': ['J'],
  'Measure.Next': ['Shift+M'],
  'Document.ApplyRedactions': ['Shift+A'],
  'Markup.DigitalSignature': ['X'],
  'Form.Editor': ['Ctrl+Shift+F'],
  'Toggle.Panels': ['Shift+F4'],
  'Tab.File Manager': ['Alt+A'],
  'Tab.Thumbnails': ['Alt+T'],
  'Tab.Bookmarks': ['Alt+B'],
  'Tab.Tool Chest': ['Alt+X'],
  'Tab.Properties': ['Alt+P'],
  'Tab.Layers': ['Alt+Y'],
  'Tab.Measurements': ['Alt+U'],
  'Tab.Spaces': ['Alt+S'],
  'Tab.Signatures': ['Alt+4'],
  'Tab.Search': ['Alt+1'],
  'Tab.Acroforms': ['Alt+Q'],
  'Tab.Sets': ['Alt+2'],
  'Tab.Studio': ['Alt+C'],
  'Tab.Markups': ['Alt+L'],
  'Tab.Hyperlinks': ['Alt+N'],
  Help: ['F1'],
};

/** Commands redcolumn binds as Revu shows the same key on two commands: arrows nudge, and Shift+arrows nudge further. */
const SPLIT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'edit.nudgeLeft': { 'Shift+Left': 'edit.nudgeLeftLarge' },
  'edit.nudgeRight': { 'Shift+Right': 'edit.nudgeRightLarge' },
  'edit.nudgeUp': { 'Shift+Up': 'edit.nudgeUpLarge' },
  'edit.nudgeDown': { 'Shift+Down': 'edit.nudgeDownLarge' },
};

const VK_NAMES: Readonly<Record<number, string>> = {
  8: 'Backspace',
  9: 'Tab',
  13: 'Enter',
  27: 'Escape',
  32: 'Space',
  33: 'PageUp',
  34: 'PageDown',
  35: 'End',
  36: 'Home',
  37: 'Left',
  38: 'Up',
  39: 'Right',
  40: 'Down',
  45: 'Insert',
  46: 'Delete',
  106: '*',
  107: 'Plus',
  109: 'Minus',
  110: '.',
  111: '/',
  186: ';',
  187: 'Plus',
  188: ',',
  189: 'Minus',
  190: '.',
  191: '/',
  192: '`',
  219: '[',
  220: '\\',
  221: ']',
  222: "'",
};

/** A Revu `Keys` value as a combo of ours (`Ctrl+Alt+Shift+K` order is Ctrl, Alt, Shift); null for a key we cannot name. */
export function revuCombo(keys: number): string | null {
  if (!Number.isInteger(keys) || keys <= 0) return null;
  const vk = keys & 0xffff;
  let name: string | undefined;
  if ((vk >= 48 && vk <= 57) || (vk >= 65 && vk <= 90)) name = String.fromCharCode(vk);
  // The keypad's digits share the main keys' names (keys.ts).
  else if (vk >= 96 && vk <= 105) name = String(vk - 96);
  else if (vk >= 112 && vk <= 135) name = `F${vk - 111}`;
  else name = VK_NAMES[vk];
  if (!name) return null;
  const parts: string[] = [];
  if (keys & 0x20000) parts.push('Ctrl');
  if (keys & 0x40000) parts.push('Alt');
  if (keys & 0x10000) parts.push('Shift');
  parts.push(name);
  return parts.join('+');
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

/** The shortcuts in a Revu KeyboardShortcuts.xml, by feature. Throws when the file is not one. */
export function readRevuShortcuts(xml: string): Map<string, string[]> {
  if (!/<KeyboardShortcuts\b/.test(xml)) throw new Error('not a Revu keyboard shortcuts file');
  const out = new Map<string, string[]>();
  for (const m of xml.matchAll(/<Shortcut>([\s\S]*?)<\/Shortcut>/g)) {
    const body = m[1]!;
    const keys = /<Keys>\s*(\d+)\s*<\/Keys>/.exec(body);
    const feature = /<Feature>([^<]*)<\/Feature>/.exec(body);
    if (!keys || !feature) continue;
    const combo = revuCombo(Number(keys[1]));
    const name = unescape(feature[1]!);
    if (!combo || !name) continue;
    const list = out.get(name) ?? [];
    if (!list.includes(combo)) list.push(combo);
    out.set(name, list);
  }
  if (!out.size) throw new Error('no shortcuts in it');
  return out;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k) => b.includes(k));

export interface RevuShortcutImport {
  /** The new overrides for the active profile. */
  overrides: Record<string, readonly string[]>;
  /** Commands whose shortcuts now differ from redcolumn's defaults. */
  changed: number;
  /** Revu features that have a shortcut but no redcolumn command. */
  unmapped: string[];
}

/**
 * Overrides that give redcolumn's commands the shortcuts in `byFeature`, Revu's own (or a person's
 * KeyboardShortcuts.xml read by `readRevuShortcuts`).
 *
 * - `strict`: every other command loses its shortcut too, so only Revu's keys do anything.
 * - otherwise a redcolumn-only shortcut (`O` for Offset, say) stays unless Revu gave its key to a
 *   command, so one key never runs two commands.
 *
 * Commands left on their defaults are not written, so the profile keeps following later defaults.
 */
export function revuOverrides(byFeature: ReadonlyMap<string, readonly string[]> | Readonly<Record<string, readonly string[]>>, strict = false): RevuShortcutImport {
  const entries = byFeature instanceof Map ? [...byFeature.entries()] : Object.entries(byFeature);
  const keys = new Map<string, string[]>();
  const unmapped: string[] = [];
  for (const [feature, combos] of entries) {
    const id = REVU_FEATURES[feature];
    if (!id) {
      if (combos.length) unmapped.push(feature);
      continue;
    }
    for (const combo of combos) {
      const target = SPLIT[id]?.[combo] ?? id;
      const list = keys.get(target) ?? [];
      if (!list.includes(combo)) list.push(combo);
      keys.set(target, list);
    }
    // A mapped feature with no keys left in the file was cleared in Revu: so it is here.
    if (!keys.has(id)) keys.set(id, []);
  }
  const taken = new Set([...keys.values()].flat());
  const overrides: Record<string, readonly string[]> = {};
  for (const id of new Set([...Object.keys(DEFAULT_KEYS), ...keys.keys()])) {
    const defaults = DEFAULT_KEYS[id] ?? [];
    const next = keys.get(id) ?? (strict ? [] : defaults.filter((k) => !taken.has(k)));
    if (!same(next, defaults)) overrides[id] = next;
  }
  return { overrides, changed: Object.keys(overrides).length, unmapped: unmapped.sort() };
}

/** The "Revu 21" preset: Revu 21's shipped shortcuts and nothing else. */
export function revu21Preset(): KeyOverrides {
  return revuOverrides(REVU_21_KEYS, true).overrides;
}

/** A person's Revu KeyboardShortcuts.xml as overrides (see `revuOverrides`). */
export function importRevuShortcuts(xml: string): RevuShortcutImport {
  return revuOverrides(readRevuShortcuts(xml));
}

/** What a Revu KeyboardShortcuts.xml import did. */
export function revuNote(changed: number, unmapped: string[]): string {
  const head = changed ? `Imported Revu shortcuts: ${changed} command${changed === 1 ? '' : 's'} changed from redcolumn's defaults.` : "Imported Revu shortcuts: they match redcolumn's defaults.";
  return unmapped.length ? `${head} No redcolumn command for ${unmapped.length}: ${unmapped.slice(0, 8).join(', ')}${unmapped.length > 8 ? '…' : ''}.` : head;
}
