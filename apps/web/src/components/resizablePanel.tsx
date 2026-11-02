import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN = { width: 240, height: 160 };

function load(key: string): Box | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Box | null;
    return v && [v.left, v.top, v.width, v.height].every((n) => typeof n === 'number' && Number.isFinite(n)) ? v : null;
  } catch {
    return null;
  }
}

function save(key: string, box: Box) {
  try {
    localStorage.setItem(key, JSON.stringify(box));
  } catch {
    // Not kept: the panel opens where the stylesheet puts it next time.
  }
}

/** A box kept inside its container, no smaller than MIN. */
function clamp(b: Box, pw: number, ph: number): Box {
  const width = Math.max(MIN.width, Math.min(b.width, pw));
  const height = Math.max(MIN.height, Math.min(b.height, ph));
  return { width, height, left: Math.max(0, Math.min(b.left, pw - width)), top: Math.max(0, Math.min(b.top, ph - height)) };
}

/**
 * A floating panel people can resize from any edge or corner, and move by its heading. Where they
 * leave it is kept on this device under `key`; until then it sits where the stylesheet puts it.
 * Spread `style` on the panel, render `handles` inside it and give its heading `onMoveStart`.
 */
export function useResizablePanel(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(() => load(key));

  const begin = (edge: Edge | 'move') => (e: ReactPointerEvent<HTMLElement>) => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent || e.button !== 0) return;
    // Buttons and fields in the heading keep their clicks.
    if (edge === 'move' && (e.target as HTMLElement).closest('button, select, input, a')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    const from: Box = { left: r.left - p.left, top: r.top - p.top, width: r.width, height: r.height };
    const [x0, y0] = [e.clientX, e.clientY];
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let last = from;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      const b = { ...from };
      if (edge === 'move') {
        b.left += dx;
        b.top += dy;
      } else {
        // Dragging the left or top edge keeps the opposite edge where it was.
        if (edge.includes('e')) b.width = Math.max(MIN.width, from.width + dx);
        if (edge.includes('s')) b.height = Math.max(MIN.height, from.height + dy);
        if (edge.includes('w')) {
          b.width = Math.max(MIN.width, Math.min(from.width - dx, from.left + from.width));
          b.left = from.left + from.width - b.width;
        }
        if (edge.includes('n')) {
          b.height = Math.max(MIN.height, Math.min(from.height - dy, from.top + from.height));
          b.top = from.top + from.height - b.height;
        }
      }
      last = clamp(b, p.width, p.height);
      setBox(last);
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      save(key, last);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  const style: CSSProperties | undefined = box ? { left: box.left, top: box.top, width: box.width, height: box.height, right: 'auto', maxHeight: 'none' } : undefined;
  const handles = EDGES.map((edge) => <div key={edge} className={`rp-handle rp-${edge}`} aria-hidden="true" onPointerDown={begin(edge)} />);
  return { ref, style, handles, onMoveStart: begin('move') };
}
