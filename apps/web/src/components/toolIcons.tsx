import type { ReactNode } from 'react';

/** A 16 × 16 line icon for a tool button, drawn in the text colour unless a part sets its own. */
function icon(children: ReactNode): ReactNode {
  return (
    <svg className="tool-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Drawn icons for tools whose text glyph did not read as the tool. */
export const TOOL_ICONS = {
  // A chisel-tip marker in highlighter yellow.
  highlighter: icon(
    <>
      <path d="M2 14.5h6" stroke="#facc15" strokeWidth="2.2" />
      <path d="M9.6 2.2 13.8 6.4 8.2 12 4 7.8z" fill="#facc15" stroke="#a16207" />
      <path d="M4 7.8 2.8 11.2l2 2L8.2 12" fill="#fde68a" stroke="#a16207" />
    </>,
  ),
  // Three joined segments with vertex dots.
  polyline: icon(
    <>
      <path d="M1.8 13 5.5 4.5l4 7.5 4.7-9" />
      <circle cx="1.8" cy="13" r="1" fill="currentColor" />
      <circle cx="5.5" cy="4.5" r="1" fill="currentColor" />
      <circle cx="9.5" cy="12" r="1" fill="currentColor" />
      <circle cx="14.2" cy="3" r="1" fill="currentColor" />
    </>,
  ),
  // A rubber stamp: knob, neck, base and the print line.
  stamp: icon(
    <>
      <circle cx="8" cy="3.3" r="2" />
      <path d="M6.8 5.2v2.6M9.2 5.2v2.6M3 7.8h10v2.8H3zM4.2 10.6v1.5h7.6v-1.5M2 14.3h12" />
    </>,
  ),
  // An angled block eraser with a coloured sleeve.
  eraser: icon(
    <>
      <path d="M9.5 2.5 14 7 8.5 12.5 4 8z" fill="#f9a8d4" stroke="#be185d" />
      <path d="M4 8 2.2 9.8a1 1 0 0 0 0 1.4l2.3 2.3h3.2l.8-1" fill="#e2e8f0" stroke="#64748b" />
      <path d="M7.7 13.5H14" />
    </>,
  ),
  // A pennant on a pole, with the text it labels.
  flagLabel: icon(
    <>
      <path d="M3 14.5V1.8" />
      <path d="M3 2.2h10l-2.3 3 2.3 3H3" fill="#ef4444" fillOpacity="0.85" stroke="#b91c1c" />
    </>,
  ),
  // A framed picture with a sun and hills.
  image: icon(
    <>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.2" />
      <circle cx="5.3" cy="6" r="1.2" />
      <path d="M1.8 11.5 6 8l2.7 2.3 2.2-1.8 3.3 2.9" />
    </>,
  ),
};
