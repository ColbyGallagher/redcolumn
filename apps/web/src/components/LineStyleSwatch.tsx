import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { drawMarkup, lineStyleReach } from '@nb/markup';
import { SWATCH_HEIGHT, SWATCH_LINE_WIDTH, SWATCH_WIDTH, swatchMarkup, swatchScale, type SwatchSpec } from './swatchGeometry';

/** Rendered swatches, per style, colour and pixel ratio: a long list of styles draws each once. */
const cache = new Map<string, HTMLCanvasElement>();

function render(spec: SwatchSpec, key: string, color: string, dpr: number): HTMLCanvasElement {
  const cacheKey = `${color}|${dpr}|${key}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(SWATCH_WIDTH * dpr);
  canvas.height = Math.round(SWATCH_HEIGHT * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    try {
      // A style taller than the swatch is drawn smaller as a whole, so the preview shows all of it.
      const s = spec.line ? swatchScale(lineStyleReach(spec.line, SWATCH_LINE_WIDTH)) : 1;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
      drawMarkup(ctx, swatchMarkup(spec, SWATCH_WIDTH / s, SWATCH_HEIGHT / s, color, SWATCH_LINE_WIDTH), 1);
    } catch {
      // A style that cannot be laid out leaves its swatch blank.
    }
  }
  if (cache.size > 300) cache.clear();
  cache.set(cacheKey, canvas);
  return canvas;
}

/** Bumps when the theme or the pixel ratio changes, so swatches drawn in the old colour or size redraw. */
let envVersion = 0;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
function start() {
  const bump = () => {
    envVersion++;
    listeners.forEach((l) => l());
  };
  const mo = new MutationObserver(bump);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  let mq: MediaQueryList | undefined;
  const watchDpr = () => {
    mq?.removeEventListener('change', onDpr);
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', onDpr);
  };
  const onDpr = () => {
    watchDpr();
    bump();
  };
  watchDpr();
  stop = () => {
    mo.disconnect();
    mq?.removeEventListener('change', onDpr);
  };
}
function subscribe(l: () => void) {
  if (listeners.size === 0) start();
  listeners.add(l);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) {
      stop?.();
      stop = undefined;
    }
  };
}

/**
 * A line style drawn as a markup in it would be, in the text colour of where it sits (so any theme
 * reads). `id` is the style's key (see `swatchKey`), made once by the caller. It draws when it first
 * scrolls into view, so a long list only paints the rows seen.
 */
export const LineStyleSwatch = memo(function LineStyleSwatch({ spec, id }: { spec: SwatchSpec; id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const env = useSyncExternalStore(subscribe, () => envVersion);
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || seen) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true));
    io.observe(canvas);
    return () => io.disconnect();
  }, [seen]);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !seen) return;
    const dpr = window.devicePixelRatio || 1;
    const color = getComputedStyle(canvas).color || '#000';
    canvas.width = Math.round(SWATCH_WIDTH * dpr);
    canvas.height = Math.round(SWATCH_HEIGHT * dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(render(spec, id, color, dpr), 0, 0);
    // The spec is named by `id`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, env, seen]);
  return <canvas ref={ref} className="ls-swatch" style={{ width: SWATCH_WIDTH, height: SWATCH_HEIGHT }} aria-hidden="true" />;
});
