import { useLayoutEffect, useState } from 'react';

/** The part of the menu bar's row after the redcolumn menu, where the toolbar (ribbon tabs or simplified row) goes. */
export const MENUBAR_SLOT_ID = 'rc-menubar-slot';

/** The menu bar's slot, once it is in the page; null before then, or with no menu bar. */
export function useMenubarSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById(MENUBAR_SLOT_ID)), []);
  return slot;
}
