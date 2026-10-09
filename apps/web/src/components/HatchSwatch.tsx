import { useEffect, useRef } from 'react';
import { hatchDraw, paintHatchCell, type StoredHatch } from '@nb/markup';

/** Names of hatch ids saved before the Standard set. */
export const LEGACY_HATCH_LABELS: Record<string, string> = {
  diagonal: 'Diagonal',
  backDiagonal: 'Back diagonal',
  cross: 'Cross',
  diagonalCross: 'Diagonal cross',
};

/** A few repeats of a hatch, so a pattern can be recognized before it is applied. */
export function HatchSwatch({ pattern, color, width = 72, height = 32 }: { pattern: StoredHatch; color: string; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    const draw = hatchDraw(pattern, 100);
    if (!canvas || !ctx || !draw) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const fit = w / (draw.metrics.cellW * 2.4);
    ctx.save();
    ctx.scale(fit, fit);
    ctx.beginPath();
    ctx.rect(0, 0, w / fit, h / fit);
    ctx.clip();
    const nx = Math.ceil(w / fit / draw.metrics.cellW) + 1;
    const ny = Math.ceil(h / fit / draw.metrics.cellH) + 1;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        ctx.save();
        ctx.translate(i * draw.metrics.cellW, j * draw.metrics.cellH);
        paintHatchCell(ctx, draw, color);
        ctx.restore();
      }
    }
    ctx.restore();
  }, [pattern, color, width, height]);
  return <canvas ref={ref} className="hatch-swatch" width={width} height={height} style={{ width, height }} aria-hidden />;
}
