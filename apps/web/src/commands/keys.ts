/**
 * Keyboard shortcuts as combo strings such as `Ctrl+Shift+V`, `Shift+F9`, `Plus` or `L`:
 * modifiers in the order Ctrl, Alt, Shift, then one key name. Cmd on a Mac counts as Ctrl.
 */

/** Modifier keys alone do not make a shortcut. */
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS']);

const NAMED: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ' ': 'Space',
  Esc: 'Escape',
  Del: 'Delete',
};

interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The key's name in a combo, or null for a modifier on its own. */
function keyName(e: KeyLike): string | null {
  if (MODIFIERS.has(e.key)) return null;
  // Plus and minus by physical key, so Shift+= and the keypad's + are both "Plus".
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=') return 'Plus';
  if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-' || e.key === '_') return 'Minus';
  // Digits by physical key, so Shift+1 is still "1" rather than "!".
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code ?? '');
  if (digit) return digit[1]!;
  // Brackets by physical key, so Ctrl+Shift+] stays "]" rather than "}".
  if (e.code === 'BracketLeft') return '[';
  if (e.code === 'BracketRight') return ']';
  // Letters by the character typed, so shortcuts follow the keyboard layout.
  if (e.key.length === 1 && /[a-z]/i.test(e.key)) return e.key.toUpperCase();
  const letter = /^Key([A-Z])$/.exec(e.code ?? '');
  if (letter) return letter[1]!;
  if (NAMED[e.key]) return NAMED[e.key]!;
  if (e.key.length === 1) return e.key;
  return e.key;
}

/** The combo for a key event, e.g. `Ctrl+Shift+V`; null for a modifier pressed on its own. */
export function comboOf(e: KeyLike): string | null {
  const key = keyName(e);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** A combo as shown in menus and tooltips: `Ctrl+Shift+Plus` → `Ctrl+Shift++`. */
export function formatCombo(combo: string): string {
  return combo.replace(/Plus$/, '+').replace(/Minus$/, '−');
}

/**
 * Default shortcuts by command id. These follow Bluebeam Revu 21's KeyboardShortcuts.xml
 * (modifiers stored here as Ctrl, then Alt, then Shift, so Revu's Shift+Alt+O is Alt+Shift+O).
 * Several keys can run one command. Numpad digits and plus or minus share the main key's name.
 */
export const DEFAULT_KEYS: Readonly<Record<string, readonly string[]>> = {
  // File
  'file.newPdf': ['Ctrl+N'],
  'file.open': ['Ctrl+O'],
  'file.close': ['Ctrl+F4', 'Ctrl+W'],
  'file.closeAll': ['Ctrl+Shift+W'],
  'file.save': ['Ctrl+S'],
  'file.saveAs': ['Ctrl+Shift+S'],
  'file.saveAll': ['Shift+F2'],
  'file.print': ['Ctrl+P'],
  'file.preferences': ['Ctrl+K'],
  'file.share': ['Ctrl+E'],
  'file.exportXfdf': ['Ctrl+F2'],
  'file.importXfdf': ['Ctrl+F3'],
  'file.fromCamera': ['Ctrl+Alt+I'],
  // Edit
  'edit.undo': ['Ctrl+Z'],
  'edit.redo': ['Ctrl+Y', 'Ctrl+Shift+Z'],
  'edit.cut': ['Ctrl+X', 'Shift+Delete'],
  'edit.copy': ['Ctrl+C', 'Ctrl+Insert'],
  'edit.paste': ['Ctrl+V', 'Shift+Insert'],
  'edit.pasteInPlace': ['Ctrl+Shift+V'],
  'edit.multiply': ['Ctrl+M'],
  'edit.offset': ['O'],
  'edit.delete': ['Delete'],
  'edit.selectAll': ['Ctrl+A'],
  'edit.formatPainter': ['Ctrl+Shift+C'],
  'edit.group': ['Ctrl+G'],
  'edit.ungroup': ['Ctrl+Shift+G'],
  'edit.lock': ['Ctrl+Shift+L'],
  'edit.autoSize': ['Alt+Z'],
  'edit.editAction': ['Ctrl+Shift+E'],
  'edit.find': ['Ctrl+F'],
  'edit.checkSpelling': ['F7'],
  'edit.selectText': ['Shift+T'],
  'edit.alignLeft': ['Ctrl+Alt+L'],
  'edit.alignCenter': ['Ctrl+Alt+E'],
  'edit.alignRight': ['Ctrl+Alt+R'],
  'edit.alignTop': ['Ctrl+Alt+T'],
  'edit.alignMiddle': ['Ctrl+Alt+M'],
  'edit.alignBottom': ['Ctrl+Alt+B'],
  'edit.flipHorizontal': ['Ctrl+Alt+H'],
  'edit.flipVertical': ['Ctrl+Alt+V'],
  'edit.bringForward': ['Ctrl+]'],
  'edit.bringToFront': ['Ctrl+Shift+]'],
  'edit.sendBackward': ['Ctrl+['],
  'edit.sendToBack': ['Ctrl+Shift+['],
  // View
  'view.fitPage': ['Ctrl+9'],
  'view.fitWidth': ['Ctrl+0'],
  'view.actualSize': ['Ctrl+8'],
  'view.zoomIn': ['Plus', 'Shift+Plus', 'Ctrl+Plus'],
  'view.zoomOut': ['Minus', 'Shift+Minus', 'Ctrl+Minus'],
  'view.singlePage': ['Ctrl+4'],
  'view.continuous': ['Ctrl+5'],
  'view.sideBySide': ['Ctrl+6'],
  'view.continuousSideBySide': ['Ctrl+7'],
  'view.split': ['Ctrl+2'],
  'view.splitHorizontal': ['Ctrl+H'],
  'view.unsplit': ['Ctrl+Shift+2'],
  'view.switchPanes': ['Ctrl+1'],
  'view.balance': ['Shift+F12'],
  'view.fullScreen': ['F11'],
  'view.rotateClockwise': ['Ctrl+Shift+Plus'],
  'view.rotateCounterclockwise': ['Ctrl+Shift+Minus'],
  'view.rulers': ['Ctrl+R'],
  'view.grid': ['Shift+F9'],
  'view.snapGrid': ['Ctrl+Shift+F9'],
  'view.snapContent': ['Ctrl+Shift+F8'],
  'view.snapMarkup': ['Ctrl+Shift+F7'],
  'view.dimmer': ['Ctrl+F5'],
  'view.back': ['Alt+Left'],
  'view.forward': ['Alt+Right'],
  'view.nextPage': ['PageDown', 'Ctrl+Right'],
  'view.prevPage': ['PageUp', 'Ctrl+Left'],
  'view.firstPage': ['Home', 'Ctrl+Home'],
  'view.lastPage': ['End', 'Ctrl+End'],
  'view.nextDocument': ['Ctrl+Tab', 'Ctrl+F6'],
  'view.prevDocument': ['Ctrl+Shift+Tab', 'Ctrl+Shift+F6'],
  // Document
  'document.properties': ['Ctrl+D'],
  'document.security': ['Ctrl+L'],
  'document.addBookmark': ['Ctrl+B'],
  'document.rotatePages': ['Ctrl+Shift+R', 'Alt+Shift+Plus'],
  'document.rotateCounterclockwise': ['Alt+Shift+Minus'],
  'document.replacePages': ['Ctrl+Shift+Y'],
  'document.cropPages': ['Alt+Shift+O'],
  'document.flatten': ['Ctrl+Shift+M'],
  'document.ocr': ['Ctrl+Shift+O'],
  'document.unflatten': ['Ctrl+Shift+U'],
  'document.extractPages': ['Ctrl+Shift+X'],
  'document.deletePages': ['Ctrl+Shift+D'],
  'document.insertPages': ['Ctrl+Shift+I'],
  'document.insertBlank': ['Ctrl+Shift+N'],
  'document.reduceSize': ['Ctrl+Shift+P'],
  // Tools — letters match Revu: H is text highlight, M is length, G is snapshot.
  'tool.select': ['V'],
  'tool.pan': ['Shift+V'],
  'tool.zoomBox': ['Z'],
  'tool.dynamicZoom': ['Shift+Z'],
  'tool.lasso': ['Shift+O'],
  'tool.snapshot': ['G'],
  'tool.line': ['L'],
  'tool.arrow': ['A'],
  'tool.dimension': ['Shift+L'],
  'tool.polyline': ['Shift+N'],
  'tool.arc': ['Shift+C'],
  'tool.rect': ['R'],
  'tool.ellipse': ['E'],
  'tool.polygon': ['Shift+P'],
  'tool.cloud': ['C'],
  'tool.cloudPlus': ['K'],
  'tool.pen': ['P'],
  'tool.textHighlight': ['H'],
  'tool.eraser': ['Shift+E'],
  'tool.underline': ['U'],
  'tool.strikeout': ['D'],
  'tool.squiggly': ['Shift+U'],
  'tool.text': ['T'],
  'tool.callout': ['Q'],
  'tool.typewriter': ['W'],
  'tool.note': ['N'],
  'tool.image': ['I'],
  'tool.attachment': ['F'],
  'tool.flag': ['Shift+F'],
  'tool.stamp': ['S'],
  'tool.hyperlink': ['Shift+H'],
  'tool.redaction': ['Shift+R'],
  'tool.length': ['M', 'Alt+Shift+L'],
  'tool.polylength': ['Alt+Shift+Q'],
  'tool.area': ['Alt+Shift+A'],
  'tool.perimeter': ['Alt+Shift+P'],
  'tool.count': ['Alt+Shift+C'],
  'tool.diameter': ['Alt+Shift+D'],
  'tool.angle': ['Alt+Shift+G'],
  'tool.radius': ['Alt+Shift+U'],
  'tool.volume': ['Alt+Shift+V'],
  'tool.dynamicFill': ['J'],
  'tools.nextMeasure': ['Shift+M'],
  'tools.applyRedactions': ['Shift+A'],
  'tools.sign': ['X'],
  'tools.forms': ['Ctrl+Shift+F'],
  // Panels — Revu's Alt+ tab keys. Alt+L is the markups list, Alt+N is hyperlinks.
  'window.panels': ['Shift+F4'],
  'window.files': ['Alt+A'],
  'window.pages': ['Alt+T'],
  'window.bookmarks': ['Alt+B'],
  'window.toolchest': ['Alt+X'],
  'window.properties': ['Alt+P'],
  'window.layers': ['Alt+Y'],
  'window.measurements': ['Alt+U'],
  'window.spaces': ['Alt+S'],
  'window.signatures': ['Alt+4'],
  'window.search': ['Alt+1'],
  'window.forms': ['Alt+Q'],
  'window.sets': ['Alt+2'],
  'window.sessions': ['Alt+C'],
  'window.markups': ['Alt+L'],
  'window.links': ['Alt+N'],
  // Help. Revu uses Ctrl+Shift+P for Reduce File Size, so Find Commands is Ctrl+Shift+K.
  'help.docs': ['F1'],
  'help.commands': ['Ctrl+Shift+K'],
};

/** Changed shortcuts by command id (an empty list removes a command's shortcuts). */
export type KeyOverrides = Readonly<Record<string, readonly string[]>>;

/** A command's shortcuts: the user's own if changed, else the defaults. */
export function keysFor(id: string, overrides: KeyOverrides): readonly string[] {
  return overrides[id] ?? DEFAULT_KEYS[id] ?? [];
}

/** Which command each combo runs. When two commands share a combo, the first listed wins. */
export function keyMap(ids: readonly string[], overrides: KeyOverrides): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of ids) for (const combo of keysFor(id, overrides)) if (!map.has(combo)) map.set(combo, id);
  return map;
}

/**
 * Overrides that give `id` the shortcut `combo`, taking it away from any other command that had
 * it (so one key never runs two commands).
 */
export function assignKey(ids: readonly string[], overrides: KeyOverrides, id: string, combo: string): Record<string, readonly string[]> {
  const next: Record<string, readonly string[]> = { ...overrides };
  for (const other of ids) {
    if (other === id) continue;
    const keys = keysFor(other, next);
    if (keys.includes(combo)) next[other] = keys.filter((k) => k !== combo);
  }
  const own = keysFor(id, next);
  next[id] = own.includes(combo) ? own : [...own, combo];
  return next;
}

/** Overrides with one shortcut removed from a command. */
export function removeKey(overrides: KeyOverrides, id: string, combo: string): Record<string, readonly string[]> {
  return { ...overrides, [id]: keysFor(id, overrides).filter((k) => k !== combo) };
}

/** Overrides with a command back on its default shortcuts. */
export function resetKeys(overrides: KeyOverrides, id: string): Record<string, readonly string[]> {
  const next: Record<string, readonly string[]> = { ...overrides };
  delete next[id];
  return next;
}
