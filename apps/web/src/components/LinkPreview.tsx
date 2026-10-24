import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** A floating preview of the sheet or detail a link points to. */
export interface LinkPreviewWindow {
  id: string;
  /** `3/A-501 → A-501 Details`. */
  title: string;
  /** A pinned preview stays when another link is clicked; an unpinned one is replaced. */
  pinned: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  windows: readonly LinkPreviewWindow[];
  /** Draws a window's target at about `width` × `height` CSS pixels; null when it cannot be drawn. */
  render: (id: string, width: number, height: number) => Promise<HTMLCanvasElement | null>;
  onChange: (w: LinkPreviewWindow) => void;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  /** Changes when the markups may have changed, so the previews draw again. */
  revision?: unknown;
}

const MIN_W = 220;
const MIN_H = 160;

/** Previews of linked sections and details beside the plan: moved by the title bar, resized from a corner, closed with Esc. */
export function LinkPreviews({ windows, render, onChange, onOpen, onClose, revision }: Props) {
  // Esc closes the preview being used, or else the newest one (not from a dialog or a field being typed in).
  useEffect(() => {
    if (!windows.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-backdrop')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const inside = t?.closest?.('.link-preview')?.getAttribute('data-preview');
      if (inside) {
        // Esc in a preview is for it alone.
        e.stopPropagation();
        onClose(inside);
        return;
      }
      // Elsewhere the page still gets Esc too (to cancel a markup being drawn, say).
      onClose(windows[windows.length - 1]!.id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [windows, onClose]);
  return (
    <>
      {windows.map((w) => (
        <PreviewWindow key={w.id} win={w} render={render} onChange={onChange} onOpen={onOpen} onClose={onClose} revision={revision} />
      ))}
    </>
  );
}

function PreviewWindow({ win, render, onChange, onOpen, onClose, revision }: { win: LinkPreviewWindow } & Omit<Props, 'windows'>) {
  const body = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const drag = useRef<{ kind: 'move' | 'size'; x: number; y: number; from: LinkPreviewWindow } | null>(null);
  const [live, setLive] = useState(win);
  useEffect(() => setLive(win), [win]);

  // Draw the target to fit the body, again (shortly) after a resize.
  useEffect(() => {
    let cancelled = false;
    const el = body.current;
    const into = host.current;
    if (!el || !into) return;
    const timer = setTimeout(() => {
      const { clientWidth, clientHeight } = el;
      void render(win.id, clientWidth, clientHeight)
        .then((canvas) => {
          if (cancelled) return;
          if (!canvas) return setState('failed');
          canvas.className = 'link-preview-canvas';
          into.replaceChildren(canvas);
          setState('ready');
        })
        .catch(() => !cancelled && setState('failed'));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [win.id, win.w, win.h, render, revision]);

  const start = (kind: 'move' | 'size') => (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, from: live };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const maxX = window.innerWidth - 60;
    const maxY = window.innerHeight - 40;
    setLive(
      d.kind === 'move'
        ? { ...d.from, x: Math.min(maxX, Math.max(0, d.from.x + dx)), y: Math.min(maxY, Math.max(0, d.from.y + dy)) }
        : { ...d.from, w: Math.max(MIN_W, d.from.w + dx), h: Math.max(MIN_H, d.from.h + dy) },
    );
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onChange(live);
  };

  return (
    <div className={`link-preview${win.pinned ? ' pinned' : ''}`} data-preview={win.id} role="dialog" aria-label={`Preview of ${win.title}`} style={{ left: live.x, top: live.y, width: live.w, height: live.h }}>
      <div className="link-preview-head" onPointerDown={start('move')} onPointerMove={onMove} onPointerUp={onUp}>
        <span className="link-preview-title" title={win.title}>
          {win.title}
        </span>
        <button type="button" className={`link-preview-btn${win.pinned ? ' on' : ''}`} aria-pressed={win.pinned} title={win.pinned ? 'Unpin: the next link replaces this preview' : 'Pin: keep this preview when another link is clicked'} onClick={() => onChange({ ...live, pinned: !win.pinned })}>
          📌
        </button>
        <button type="button" className="link-preview-btn" title="Open the sheet" onClick={() => onOpen(win.id)}>
          Open
        </button>
        <button type="button" className="link-preview-btn" aria-label="Close preview" title="Close (Esc)" onClick={() => onClose(win.id)}>
          ×
        </button>
      </div>
      <div className="link-preview-body" ref={body} title="Double-click to open the sheet" onDoubleClick={() => onOpen(win.id)}>
        <div className="link-preview-host" ref={host} />
        {state === 'loading' && <span className="link-preview-status">Loading…</span>}
        {state === 'failed' && <span className="link-preview-status">This sheet could not be drawn.</span>}
      </div>
      <div className="link-preview-grip" aria-hidden="true" onPointerDown={start('size')} onPointerMove={onMove} onPointerUp={onUp} />
    </div>
  );
}
