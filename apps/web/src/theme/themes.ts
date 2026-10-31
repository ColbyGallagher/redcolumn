/**
 * App themes (Preferences › Interface › Display). The colours of each live in themes.css as a block
 * of tokens keyed by the theme's id; this list names them for the picker and gives the browser's
 * `theme-color` (the tint of the address bar and the installed app's title bar).
 */
export interface Theme {
  id: string;
  label: string;
  /** Dark themes are what "Match the system" picks when the system prefers dark. */
  dark: boolean;
  /** `<meta name="theme-color">` while the theme is active. */
  color: string;
  /** Title-bar button symbols in the desktop app need to contrast with the theme. */
  symbolColor: string;
}

export const THEMES = [
  { id: 'navy', label: 'Navy', dark: true, color: '#15213a', symbolColor: '#e7ecf5' },
  { id: 'graphite', label: 'Graphite', dark: true, color: '#1c1c1f', symbolColor: '#e8e8ea' },
  { id: 'light', label: 'Light', dark: false, color: '#e8edf5', symbolColor: '#1b2536' },
] as const satisfies readonly Theme[];

export type ThemeId = (typeof THEMES)[number]['id'];

/** The Preferences choice: one of the themes, or follow the system's light/dark setting. */
export type ThemeChoice = 'system' | ThemeId;

/** Theme used for the system's dark and light preferences. */
const SYSTEM_DARK: ThemeId = 'navy';
const SYSTEM_LIGHT: ThemeId = 'light';

export function resolveTheme(choice: string, systemPrefersDark: boolean): Theme {
  const found = THEMES.find((t) => t.id === choice);
  if (found) return found;
  const id = systemPrefersDark ? SYSTEM_DARK : SYSTEM_LIGHT;
  return THEMES.find((t) => t.id === id)!;
}

/** Marks the document with the theme (the stylesheets key their tokens on it) and tints the browser chrome. */
export function applyTheme(theme: Theme, doc: Document = document) {
  doc.documentElement.dataset.theme = theme.id;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.color);
}

let desk = '';
/** The pasteboard behind the pages, from the active theme (the viewer draws it on a canvas, so CSS cannot). */
export function deskColour(): string {
  if (!desk && typeof document !== 'undefined') desk = getComputedStyle(document.documentElement).getPropertyValue('--viewer-desk').trim();
  return desk || '#1f2d4a';
}
/** Forget the cached desk colour; the next draw reads the new theme's. */
export function resetDeskColour() {
  desk = '';
}
