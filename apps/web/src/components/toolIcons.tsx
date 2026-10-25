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

/** Icons that name the style controls on the markup toolbar (fill, width, line style, …). */
export const STYLE_ICONS = {
  // A tipped paint bucket pouring a drop.
  fill: icon(
    <>
      <path d="M2.5 7.5 7.5 2.5l5 5-5 5z" />
      <path d="M2.5 7.5h10" />
      <path d="M13.6 10.2c.7 1 1 1.6 1 2.1a1 1 0 0 1-2 0c0-.5.3-1.1 1-2.1z" fill="currentColor" />
    </>,
  ),
  // A pen drawing an outline.
  line: icon(
    <>
      <path d="m10.8 2.4 2.8 2.8-7.4 7.4-3.4.6.6-3.4z" />
      <path d="m9.2 4 2.8 2.8" />
    </>,
  ),
  // Three strokes, thin to thick.
  width: icon(
    <>
      <path d="M2 3.5h12" strokeWidth="0.8" />
      <path d="M2 7.5h12" strokeWidth="1.8" />
      <path d="M2 12.5h12" strokeWidth="3.2" strokeLinecap="butt" />
    </>,
  ),
  // Solid, dashed and dotted strokes.
  lineStyle: icon(
    <>
      <path d="M2 3.5h12" />
      <path d="M2 8h12" strokeDasharray="3 2" strokeLinecap="butt" />
      <path d="M2.5 12.5h11" strokeDasharray="0 2.75" strokeWidth="1.8" />
    </>,
  ),
  // A circle, one half solid and the other see-through.
  opacity: icon(
    <>
      <path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" fillOpacity="0.3" />
      <circle cx="8" cy="8" r="5.5" />
    </>,
  ),
  // A square filled with diagonal hatching.
  hatch: icon(
    <>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 6.5 6.5 2M2 11 11 2M3.5 14 14 3.5M8 14l6-6" strokeWidth="1" />
    </>,
  ),
  // A serif capital T: the typeface.
  font: icon(
    <>
      <path d="M3 4V2.5h10V4M8 2.5v11M6 13.5h4" />
    </>,
  ),
  // A small and a large A with an up/down size arrow.
  fontSize: icon(
    <>
      <path d="M1.5 14 4 8l2.5 6M2.4 12h3.2" strokeWidth="1.1" />
      <path d="M6.8 14 10.4 4.5 14 14M8.1 11h4.6" />
      <path d="M13.5 1.5v2M12.6 2.4l.9-.9.9.9" strokeWidth="1" />
    </>,
  ),
};
