import { useEffect, useRef, useState } from 'react';
import { toolPreview, type ToolPreview } from '../help/toolPreviews';
import { useSettings } from '../settings/settings';

/** How long the pointer rests on a tool before its preview shows. */
const DELAY_MS = 1500;
const TARGET = '[data-toolbar-tool], [data-ribbon-command]';
const CARD_WIDTH = 440;

interface Shown {
  id: string;
  preview: ToolPreview;
  /** The tool's name and shortcut (its button's own tooltip text). */
  title: string;
  left: number;
  top: number;
  above: boolean;
}

const previewId = (el: HTMLElement) => el.dataset.toolbarTool ?? el.dataset.ribbonCommand ?? '';

/**
 * Hover preview for the markup and Modify tools: after the pointer rests on one for a moment, a
 * card shows a short animation of using it and a sentence on how. One listener for the whole
 * page, so the toolbar, ribbon and tool menus need no change; a tool with no recording gets the
 * sentence alone. The button's own tooltip is held back while the card is up, so there is only one.
 */
export function ToolPreviewCard() {
  const on = useSettings().toolPreviews;
  const [shown, setShown] = useState<Shown | null>(null);
  const [loaded, setLoaded] = useState(false);
  const stash = useRef<{ el: HTMLElement; title: string; label: boolean } | null>(null);

  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The tool the pointer is over, and whether a press, key or scroll has switched the card off until it leaves.
    let over: HTMLElement | null = null;
    let quiet = false;

    // The button's own tooltip would show beside the card; hold it back while the pointer is over it.
    const holdTitle = (el: HTMLElement) => {
      const title = el.getAttribute('title');
      if (!title) return;
      // A button named only by its tooltip keeps its accessible name.
      const label = !el.hasAttribute('aria-label');
      if (label) el.setAttribute('aria-label', title);
      el.removeAttribute('title');
      stash.current = { el, title, label };
    };
    const restoreTitle = () => {
      const s = stash.current;
      stash.current = null;
      if (!s) return;
      if (!s.el.hasAttribute('title')) s.el.setAttribute('title', s.title);
      if (s.label) s.el.removeAttribute('aria-label');
    };
    const hide = () => {
      clearTimeout(timer);
      setShown(null);
      setLoaded(false);
    };
    const leave = () => {
      hide();
      restoreTitle();
      over = null;
      quiet = false;
    };

    const show = (el: HTMLElement, title: string) => {
      const id = previewId(el);
      const preview = toolPreview(id);
      if (!preview) return;
      const r = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - CARD_WIDTH - 8));
      // Below the button, or above it when the card would run off the bottom of the window.
      const above = r.bottom + 300 > window.innerHeight && r.top > 300;
      setLoaded(false);
      setShown({ id, preview, title, left, top: above ? r.top - 8 : r.bottom + 8, above });
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(TARGET) ?? null;
      if (el === over) return;
      leave();
      if (!el || !toolPreview(previewId(el))) return;
      over = el;
      holdTitle(el);
      const title = (stash.current?.title ?? el.getAttribute('aria-label') ?? el.textContent ?? '').split(' — ')[0]!.trim();
      timer = setTimeout(() => {
        if (over === el && !quiet && document.body.contains(el)) show(el, title);
      }, DELAY_MS);
    };
    const onOut = (e: PointerEvent) => {
      if (!over) return;
      const to = e.relatedTarget as Node | null;
      if (to && over.contains(to)) return;
      leave();
    };
    // Pressing the button, typing or scrolling means the user is past reading about it.
    const off = () => {
      quiet = true;
      hide();
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', off, true);
    document.addEventListener('keydown', off, true);
    document.addEventListener('wheel', off, true);
    window.addEventListener('blur', leave);
    return () => {
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', off, true);
      document.removeEventListener('keydown', off, true);
      document.removeEventListener('wheel', off, true);
      window.removeEventListener('blur', leave);
      leave();
    };
  }, [on]);

  if (!on || !shown) return null;
  // A user who asks for less motion gets the sentence without the animation.
  const animate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && !!shown.preview.gif;
  return (
    <div className={`tool-hint-card${shown.above ? ' above' : ''}`} role="tooltip" style={{ left: shown.left, top: shown.top, width: CARD_WIDTH }}>
      {animate && (
        <div className={`thc-frame${loaded ? ' loaded' : ''}`}>
          <img key={shown.id} src={`${import.meta.env.BASE_URL}help/gif/${shown.preview.gif}.gif`} alt="" decoding="async" onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} />
        </div>
      )}
      <div className="thc-text">
        {shown.title && <strong>{shown.title}</strong>}
        <span>{shown.preview.hint}</span>
      </div>
    </div>
  );
}
