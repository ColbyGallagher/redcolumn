import { useLayoutEffect, useState } from 'react';
import { useSettings } from '../settings/settings';

/** The part of the menu bar's row after the redcolumn menu, where the toolbar (ribbon tabs or simplified row) goes. */
export const MENUBAR_SLOT_ID = 'rc-menubar-slot';

/** Where the ribbon's tab strip leaves room for the search box, just before its option buttons. */
export const SEARCH_SLOT_ID = 'rc-search-slot';

/** The menu bar's slot, once it is in the page; null when the classic menu bar is shown, or before mount. */
export function useMenubarSlot(): HTMLElement | null {
  const { showMenuBar } = useSettings();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setSlot(showMenuBar ? null : document.getElementById(MENUBAR_SLOT_ID));
  }, [showMenuBar]);
  return showMenuBar ? null : slot;
}

/** The ribbon's search slot while the ribbon's tabs share the top bar; null with the classic menu bar or simplified toolbar. */
export function useSearchSlot(): HTMLElement | null {
  const { showMenuBar } = useSettings();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (showMenuBar) {
      setSlot(null);
      return;
    }
    const find = () => setSlot(document.getElementById(SEARCH_SLOT_ID));
    find();
    const bar = document.getElementById(MENUBAR_SLOT_ID);
    if (!bar) return;
    const observer = new MutationObserver(find);
    observer.observe(bar, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [showMenuBar]);
  return showMenuBar ? null : slot;
}
