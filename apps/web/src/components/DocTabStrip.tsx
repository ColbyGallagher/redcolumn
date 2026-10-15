import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

/**
 * A pane's row of document tabs. Tabs that do not fit scroll out of sight (no scroll bar), and a
 * dropdown arrow at the right end lists every tab so the hidden ones can be reached.
 */
export function DocTabStrip({
  label,
  activeKey,
  count,
  after,
  onOverflowMenu,
  children,
}: {
  label: string;
  /** Changes when the front tab does, to scroll it into view. */
  activeKey: string | null;
  /** Number of tabs, to re-check for overflow as tabs open and close. */
  count: number;
  /** Fixed controls after the tabs (the + button). */
  after?: ReactNode;
  onOverflowMenu: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);

  useLayoutEffect(() => {
    scroller.current?.querySelector('.doc-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeKey, overflow]);

  return (
    <div className="doc-tabs" role="tablist" aria-label={label}>
      <div
        ref={scroller}
        className="doc-tabs-scroll"
        onWheel={(e) => {
          // A mouse wheel scrolls the tabs sideways.
          if (e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {children}
      </div>
      {after}
      {overflow && (
        <button
          type="button"
          className="doc-tab-more"
          title="All open documents"
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            onOverflowMenu(e);
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
