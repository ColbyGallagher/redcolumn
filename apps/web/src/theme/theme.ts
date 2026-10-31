import { desktop } from '../desktop/host';
import { settings } from '../settings/settings';
import { applyTheme, resetDeskColour, resolveTheme } from './themes';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Keeps the page in the theme chosen in Preferences, switching without a reload when the choice
 * changes or, for "Match the system", when the system's setting does.
 */
export function installTheme() {
  const media = window.matchMedia?.(DARK_QUERY);
  let shown = '';
  const sync = () => {
    const theme = resolveTheme(settings.get().theme, media?.matches ?? true);
    if (theme.id === shown) return;
    shown = theme.id;
    applyTheme(theme);
    resetDeskColour();
    desktop()?.setTitleBarSymbols?.(theme.symbolColor);
    window.dispatchEvent(new CustomEvent('nb-theme', { detail: theme }));
  };
  sync();
  settings.subscribe(sync);
  media?.addEventListener('change', sync);
}
