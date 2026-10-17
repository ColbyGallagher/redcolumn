import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Style for a panel floating over the top right of the view: it starts just under the ribbon, whatever
 * height that is (tabs only, collapsed or full), rather than at a fixed offset the ribbon can cover.
 * Undefined when there is no ribbon, so the panel keeps its stylesheet position.
 */
export function useBelowRibbon(): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const ribbon = document.querySelector('.ribbon');
    if (!ribbon) return;
    const place = () => setStyle({ top: Math.round(ribbon.getBoundingClientRect().bottom) + 8 });
    place();
    const observer = new ResizeObserver(place);
    observer.observe(ribbon);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, []);
  return style;
}

/**
 * Where to put a dropdown so it floats over the page instead of inside its scrolling parent: the ribbon
 * body scrolls horizontally, so an absolutely positioned list would be clipped and add a scrollbar.
 * Render the list in a portal with the returned style (position: fixed, just under the anchor); it is
 * recomputed when the page scrolls or resizes while `open`.
 */
export function useFloatingPopup(anchor: RefObject<HTMLElement | null>, open: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined);
      return;
    }
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setStyle({ position: 'fixed', top: r.bottom + 4, left: r.left, minWidth: r.width, zIndex: 1000 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, open]);
  return style;
}
