import { useEffect, useRef, useState } from 'react';
import type { SheetInfo } from '@nb/sheets';
import type { PreviewDrawing, PreviewView } from '../LinkPreview';

interface Props {
  pages: readonly { width: number; height: number }[];
  sheets: readonly (SheetInfo | null | undefined)[];
  current: number;
  render: (pageIndex: number, width: number, height: number, view: PreviewView) => Promise<PreviewDrawing | null>;
  onGoTo: (pageIndex: number) => void;
  /** Pages to mark, such as the sheets a box reads nothing on. */
  flagged?: ReadonlySet<number>;
}

const WIDTH = 118;

/** The end of a long drawing number, where sheets differ (`…DRG-000031`): the start is the same on every sheet. */
function tail(number: string | null | undefined): string {
  if (!number) return '';
  return number.length > 14 ? `…${number.slice(-12)}` : number;
}

/**
 * Thumbnails of every sheet beside the setup's sheet, to flick through a set: each is drawn when
 * it scrolls into view, the current one is kept in view, and sheets the current box reads nothing
 * on are marked.
 */
export function ThumbStrip({ pages, sheets, current, render, onGoTo, flagged }: Props) {
  const list = useRef<HTMLOListElement>(null);
  // Keep the current sheet in view as it changes from elsewhere (the strip under the sheet, a sample row).
  useEffect(() => {
    list.current?.querySelector(`[data-page="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <ol ref={list} className="sw-thumbs" aria-label="Sheets">
      {pages.map((p, i) => (
        <Thumb key={i} index={i} page={p} sheet={sheets[i]} current={i === current} flagged={!!flagged?.has(i)} render={render} onGoTo={onGoTo} root={list} />
      ))}
    </ol>
  );
}

function Thumb({
  index,
  page,
  sheet,
  current,
  flagged,
  render,
  onGoTo,
  root,
}: {
  index: number;
  page: { width: number; height: number };
  sheet: SheetInfo | null | undefined;
  current: boolean;
  flagged: boolean;
  render: Props['render'];
  onGoTo: (i: number) => void;
  root: React.RefObject<HTMLOListElement | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const h = Math.round((WIDTH * page.height) / page.width);

  // Drawn once it first scrolls into view, with its own window's observer (the strip can be in a pop-out).
  useEffect(() => {
    const el = host.current;
    if (!el || seen) return;
    const IO = el.ownerDocument.defaultView?.IntersectionObserver ?? IntersectionObserver;
    const io = new IO((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { root: root.current, rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, root]);
  useEffect(() => {
    if (!seen) return;
    let cancelled = false;
    const zoom = WIDTH / page.width;
    void render(index, WIDTH, h, { cx: page.width / 2, cy: page.height / 2, zoom }).then((d) => {
      const el = host.current;
      if (cancelled || !d || !el) return;
      d.canvas.className = 'sw-thumb-canvas';
      el.replaceChildren(el.ownerDocument.adoptNode(d.canvas));
    });
    return () => {
      cancelled = true;
    };
  }, [seen, render, index, page.width, page.height, h]);

  const label = sheet?.number ?? `Page ${index + 1}`;
  return (
    <li data-page={index} className={`${current ? 'current' : ''}${flagged ? ' flagged' : ''}`}>
      <button type="button" onClick={() => onGoTo(index)} aria-current={current ? 'page' : undefined} aria-label={`Sheet ${index + 1}${sheet?.number ? `, ${sheet.number}` : ''}`} title={[label, sheet?.title].filter(Boolean).join(' — ')}>
        <div ref={host} className="sw-thumb-page" style={{ width: WIDTH, height: h }} />
        <span className="sw-thumb-label">
          <b>{index + 1}</b> {tail(sheet?.number)}
        </span>
      </button>
    </li>
  );
}
