import type { ReactNode } from 'react';

/** A 16 × 16 line icon for a menu item, drawn in the text colour. */
function icon(d: string, extra?: ReactNode): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
      {extra}
    </svg>
  );
}

/** Icons for the markup right-click menu, as Bluebeam shows them. */
export const MENU_ICONS = {
  cut: icon('M6 10.5 13 2M10 10.5 3 2', <><circle cx="4.5" cy="12.5" r="2" /><circle cx="11.5" cy="12.5" r="2" /></>),
  copy: icon('M5.5 5.5h7.5v8.5H5.5zM3 11V2.5h7'),
  paste: icon('M5 3H3v11h10V3h-2M6 2h4v2.5H6zM6 8h4M6 10.5h4'),
  multiply: icon('M2.5 3v10M5 3v10M7.5 5.5h6v5h-6z'),
  painter: icon('M3 2.5h8v3H3zM11 4h2v3.5H8v2M7 9.5h2V14H7z'),
  delete: icon('M3.5 3.5l9 9M12.5 3.5l-9 9'),
  flatten: icon('M5.5 6 3 13.5h10L10.5 6zM6.5 6a1.5 1.5 0 0 1 3 0'),
  hide: icon('M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM2.5 13.5l11-11', <circle cx="8" cy="8" r="1.8" />),
  legend: icon('M2 2.5h12v11H2zM4 5.5h2M7.5 5.5H12M4 8h2M7.5 8H12M4 10.5h2M7.5 10.5H12'),
  reply: icon('M3 2.5v5.5a2 2 0 0 0 2 2h8.5M10.5 7l3 3-3 3'),
  properties: icon('M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4', <circle cx="8" cy="8" r="3" />),
};
