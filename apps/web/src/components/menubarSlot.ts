import { useLayoutEffect, useState } from 'react';

/** The part of the menu bar's row after the redcolumn menu, where the toolbar (ribbon tabs or simplified row) goes. */
export const MENUBAR_SLOT_ID = 'rc-menubar-slot';

/** Where the ribbon's tab strip leaves room for the search box, just before its option buttons. */
export const SEARCH_SLOT_ID = 'rc-search-slot';

/** The menu bar's slot, once it is in the page; null before then, or with no menu bar. */
export function useMenubarSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById(MENUBAR_SLOT_ID)), []);
  return slot;
}

/** The ribbon's search slot while the ribbon's tabs are showing; null otherwise (simplified toolbar). */
export function useSearchSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const find = () => setSlot(document.getElementById(SEARCH_SLOT_ID));
    find();
    const bar = document.getElementById(MENUBAR_SLOT_ID);
    if (!bar) return;
    const observer = new MutationObserver(find);
    observer.observe(bar, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return slot;
}
