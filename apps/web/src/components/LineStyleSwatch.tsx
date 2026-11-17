import { useEffect, useRef } from 'react';
import { drawMarkup } from '@nb/markup';
import { SWATCH_HEIGHT, SWATCH_WIDTH, swatchMarkup, type SwatchSpec } from './swatchGeometry';

/** Rendered swatches, per style, colour and pixel ratio: a long list of styles draws each once. */
const cache = new Map<string, HTMLCanvasElement>();

function render(spec: SwatchSpec, color: string, dpr: number): HTMLCanvasElement {
  const key = `${color}|${dpr}|${JSON.stringify(spec)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = SWATCH_WIDTH * dpr;
  canvas.height = SWATCH_HEIGHT * dpr;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      drawMarkup(ctx, swatchMarkup(spec, SWATCH_WIDTH, SWATCH_HEIGHT, color), 1);
    } catch {
      // A style that cannot be laid out leaves its swatch blank.
    }
  }
  if (cache.size > 300) cache.clear();
  cache.set(key, canvas);
  return canvas;
}

/** A line style drawn as a markup in it would be, in the text colour of where it sits (so any theme reads). */
export function LineStyleSwatch({ spec }: { spec: SwatchSpec }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(spec);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const color = getComputedStyle(canvas).color || '#000';
    canvas.width = SWATCH_WIDTH * dpr;
    canvas.height = SWATCH_HEIGHT * dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(render(spec, color, dpr), 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} className="ls-swatch" style={{ width: SWATCH_WIDTH, height: SWATCH_HEIGHT }} aria-hidden="true" />;
}
