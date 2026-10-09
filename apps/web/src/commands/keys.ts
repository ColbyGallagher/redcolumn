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

/** Default shortcuts by command id (the customary ones where they exist). Several keys can run one command. */
export const DEFAULT_KEYS: Readonly<Record<string, readonly string[]>> = {
  // File
  'file.open': ['Ctrl+O'],
  'file.close': ['Ctrl+F4'],
  'file.save': ['Ctrl+S'],
  'file.print': ['Ctrl+P'],
  'file.saveAs': ['Ctrl+Shift+S'],
  'file.preferences': ['Ctrl+K'],
  // Edit
  'edit.undo': ['Ctrl+Z'],
  'edit.redo': ['Ctrl+Y', 'Ctrl+Shift+Z'],
  'edit.cut': ['Ctrl+X'],
  'edit.copy': ['Ctrl+C'],
  'edit.paste': ['Ctrl+V'],
  'edit.pasteInPlace': ['Ctrl+Shift+V'],
  'edit.multiply': ['Ctrl+M'],
  'edit.offset': ['O'],
  'edit.delete': ['Delete', 'Backspace'],
  'edit.selectAll': ['Ctrl+A'],
  'edit.formatPainter': ['Ctrl+Shift+C'],
  'edit.group': ['Ctrl+G'],
  'edit.ungroup': ['Ctrl+Shift+G'],
  'edit.autoSize': ['Alt+Z'],
  'edit.editAction': ['Ctrl+Shift+E'],
  'edit.find': ['Ctrl+F'],
  'edit.checkSpelling': ['F7'],
  'help.docs': ['F1'],
  // View
  'view.fitPage': ['Ctrl+9'],
  'view.fitWidth': ['Ctrl+0'],
  'view.actualSize': ['Ctrl+8'],
  'view.zoomIn': ['Plus', 'Shift+Plus'],
  'view.zoomOut': ['Minus'],
  'view.singlePage': ['Ctrl+4'],
  'view.continuous': ['Ctrl+5'],
  'view.sideBySide': ['Ctrl+6'],
  'view.continuousSideBySide': ['Ctrl+7'],
  'view.splitHorizontal': ['Ctrl+H'],
  'view.fullScreen': ['Ctrl+Shift+L'],
  'file.closeAll': ['Ctrl+Shift+W'],
  'file.saveAll': ['Shift+F2'],
  'file.share': ['Ctrl+E'],
  'tool.zoomBox': ['Z'],
  'tool.pan': ['Shift+V'],
  'tool.attachment': ['F'],
  'tool.dynamicZoom': ['Shift+Z'],
  'view.split': ['Ctrl+2'],
  'view.switchPanes': ['Ctrl+1'],
  'view.balance': ['Shift+F12'],
  'view.rotateClockwise': ['Ctrl+Shift+Plus'],
  'view.rotateCounterclockwise': ['Ctrl+Shift+Minus'],
  'view.rulers': ['Ctrl+R'],
  'view.grid': ['Shift+F9'],
  'view.snapGrid': ['Ctrl+Shift+F9'],
  'view.snapContent': ['Ctrl+Shift+F8'],
  'view.snapMarkup': ['Ctrl+Shift+F7'],
  'view.back': ['Alt+Left'],
  'view.forward': ['Alt+Right'],
  'view.nextPage': ['PageDown'],
  'view.prevPage': ['PageUp'],
  'view.firstPage': ['Home'],
  'view.lastPage': ['End'],
  // Document
  'document.properties': ['Ctrl+D'],
  'document.security': ['Ctrl+L'],
  'document.rotatePages': ['Ctrl+Shift+R'],
  'document.replacePages': ['Ctrl+Shift+Y'],
  'document.cropPages': ['Shift+Alt+O'],
  'document.flatten': ['Ctrl+Shift+M'],
  'document.ocr': ['Ctrl+Shift+O'],
  'document.unflatten': ['Ctrl+Shift+U'],
  'document.extractPages': ['Ctrl+Shift+X'],
  'document.deletePages': ['Ctrl+Shift+D'],
  // Tools
  'tool.select': ['V'],
  'tool.lasso': ['Shift+O'],
  'tool.line': ['L'],
  'tool.arrow': ['A'],
  'tool.polyline': ['Shift+N'],
  'tool.arc': ['Shift+C'],
  'tool.rect': ['R'],
  'tool.ellipse': ['E'],
  'tool.polygon': ['Shift+P'],
  'tool.cloud': ['C'],
  'tool.pen': ['P'],
  'tool.highlighter': ['H'],
  'tool.eraser': ['Shift+E'],
  'tool.underline': ['Shift+U'],
  'tool.strikeout': ['Shift+D'],
  'tool.text': ['T'],
  'tool.callout': ['Q'],
  'tool.typewriter': ['W'],
  'tool.image': ['I'],
  'tool.calibrate': ['K'],
  'tool.length': ['M'],
  'tool.polylength': ['N'],
  'tool.area': ['G'],
  'tool.perimeter': ['U'],
  'tool.count': ['X'],
  'tool.angle': ['J'],
  'tool.hyperlink': ['Shift+H'],
  'edit.selectText': ['Alt+6'],
  // Help
  'help.commands': ['Ctrl+Shift+P'],
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
