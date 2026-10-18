/**
 * Any dialog can be moved by dragging its heading. One document-level listener covers every
 * `.modal`, so dialogs need no code of their own. The move is a CSS transform, so it resets
 * when the dialog closes, and it is clamped so the heading stays inside the window.
 */
const HEADING = ':is(h1, h2, h3, h4, header):first-child';

export function installDialogDrag() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || !(e.target instanceof Element)) return;
      const heading = e.target.closest(`.modal > ${HEADING}`) as HTMLElement | null;
      if (!heading || e.target.closest('button, input, select, textarea, a')) return;
      const modal = heading.parentElement as HTMLElement;
      const start = { x: e.clientX, y: e.clientY };
      const from = modal.style.translate.split(' ').map((n) => parseFloat(n) || 0);
      const [x0 = 0, y0 = 0] = from;
      const box = modal.getBoundingClientRect();
      const head = heading.getBoundingClientRect();
      // Limits so at least the heading's strip stays reachable.
      const minX = x0 - box.right + 48;
      const maxX = x0 + window.innerWidth - box.left - 48;
      const minY = y0 - box.top;
      const maxY = y0 + window.innerHeight - head.bottom;
      e.preventDefault();
      heading.setPointerCapture(e.pointerId);
      heading.style.cursor = 'grabbing';
      const move = (m: PointerEvent) => {
        const x = Math.min(maxX, Math.max(minX, x0 + m.clientX - start.x));
        const y = Math.min(maxY, Math.max(minY, y0 + m.clientY - start.y));
        modal.style.translate = `${x}px ${y}px`;
      };
      const end = () => {
        heading.style.cursor = '';
        heading.removeEventListener('pointermove', move);
        heading.removeEventListener('pointerup', end);
        heading.removeEventListener('pointercancel', end);
      };
      heading.addEventListener('pointermove', move);
      heading.addEventListener('pointerup', end);
      heading.addEventListener('pointercancel', end);
    },
    true,
  );
}
