import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { edgeScroll, placeBlock } from './listSelection';

/** How far the pointer moves before a press becomes a drag, so a slightly shaky click still just selects. */
const THRESHOLD = 4;
const SLIDE = { duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

/** What the floating copy of the dragged row shows. */
export interface DragPreview {
  /** The row under the pointer. */
  id: number;
  /** Every row being dragged. */
  ids: ReadonlySet<number>;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Options<T> {
  list: RefObject<HTMLElement | null>;
  rows: T[];
  setRows: (rows: T[]) => void;
  /** The rows that travel with a row picked up by the pointer; selects it first if it is not selected. */
  pickUp: (id: number) => ReadonlySet<number>;
}

/** Where each row is drawn within the list's content, including any slide still under way. */
function positions(list: HTMLElement) {
  const origin = list.getBoundingClientRect().top - list.scrollTop;
  return new Map([...list.querySelectorAll<HTMLElement>('[data-row]')].map((li) => [li, li.getBoundingClientRect().top - origin]));
}

/**
 * Drag and drop reordering for a list of equal-height rows marked with `data-row`. The list reorders
 * as the pointer moves, rows slide to their new places, and Escape puts everything back.
 */
export function useListDrag<T extends { id: number }>({ list, rows, setRows, pickUp }: Options<T>) {
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const stop = useRef<(() => void) | null>(null);
  const dragged = useRef(false);
  const before = useRef<Map<HTMLElement, number> | null>(null);

  /** Call just before changing the order, so the rows slide from where they are now. */
  const slide = () => {
    if (list.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) before.current = positions(list.current);
  };

  /** Run after any scrolling the new order calls for, so the slide ends where the rows really are. */
  const finishSlide = () => {
    const from = before.current;
    before.current = null;
    if (!from || !list.current) return;
    for (const li of from.keys()) li.getAnimations().forEach((a) => a.cancel());
    for (const [li, top] of positions(list.current)) {
      const was = from.get(li);
      if (was !== undefined && Math.abs(was - top) > 0.5) li.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], SLIDE);
    }
  };

  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, id: number) => {
    dragged.current = false;
    if (e.button !== 0 || stop.current) return;
    // A finger on the row scrolls the list; only the grip drags.
    if (e.pointerType === 'touch' && !(e.target as HTMLElement).closest('.grip')) return;
    const el = list.current;
    if (!el) return;
    const { pointerId, clientX: startX, clientY: startY } = e;
    const row = e.currentTarget.getBoundingClientRect();
    const original = rows;
    let point = { x: startX, y: startY };
    let drag: { ids: ReadonlySet<number>; offset: number; left: number; order: T[] } | null = null;
    let frame = 0;

    const reorder = () => {
      if (!drag) return;
      const y = point.y - (el.getBoundingClientRect().top + el.clientTop) + el.scrollTop;
      const under = Math.floor(y / row.height);
      const next = placeBlock(original, (r) => drag!.ids.has(r.id), under - drag.offset);
      if (next.every((r, i) => r === drag!.order[i])) return;
      drag.order = next;
      slide();
      setRows(next);
    };
    const follow = () => {
      if (drag && ghost.current) ghost.current.style.translate = `${drag.left + point.x - startX}px ${row.top + point.y - startY}px`;
    };
    // Scrolls while the pointer is near, or past, the top or bottom of the list.
    const tick = () => {
      const box = el.getBoundingClientRect();
      const by = edgeScroll(point.y, box.top, box.bottom);
      if (by) {
        const from = el.scrollTop;
        el.scrollTop += by;
        if (el.scrollTop !== from) reorder();
      }
      frame = requestAnimationFrame(tick);
    };

    const end = (keep: boolean) => {
      stop.current = null;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      el.removeEventListener('scroll', reorder);
      document.documentElement.classList.remove('list-dragging');
      if (!drag) return;
      if (!keep) {
        slide();
        setRows(original);
      }
      setPreview(null);
    };
    const move = (m: PointerEvent) => {
      if (m.pointerId !== pointerId) return;
      // The button came up somewhere that sent no pointerup.
      if (m.buttons === 0) return end(true);
      point = { x: m.clientX, y: m.clientY };
      if (!drag) {
        if (Math.hypot(point.x - startX, point.y - startY) < THRESHOLD) return;
        const ids = pickUp(id);
        const offset = original.filter((r) => ids.has(r.id)).findIndex((r) => r.id === id);
        const box = el.getBoundingClientRect();
        drag = { ids, offset, left: box.left + el.clientLeft, order: original };
        dragged.current = true;
        document.documentElement.classList.add('list-dragging');
        el.addEventListener('scroll', reorder);
        setPreview({ id, ids, left: drag.left + point.x - startX, top: row.top + point.y - startY, width: el.clientWidth, height: row.height });
        frame = requestAnimationFrame(tick);
      }
      follow();
      reorder();
    };
    const up = (u: PointerEvent) => u.pointerId === pointerId && end(true);
    const cancel = (c: PointerEvent) => c.pointerId === pointerId && end(false);
    const key = (k: KeyboardEvent) => {
      if (k.key !== 'Escape' || !drag) return;
      // Escape drops the drag only; it must not also close the dialog.
      k.preventDefault();
      k.stopPropagation();
      end(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    stop.current = () => end(true);
  };

  /** True for the click that ends a drag, which must not change the selection. */
  const wasDrag = () => dragged.current;

  return { preview, ghost, onPointerDown, wasDrag, slide, finishSlide };
}
