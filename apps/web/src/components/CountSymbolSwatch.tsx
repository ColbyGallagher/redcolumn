import { useEffect, useRef } from 'react';
import { DEFAULT_STYLES, drawMarkup, onImageLoad, type CountShape, type CountSymbol, type Markup, type MarkupStyle } from '@nb/markup';

interface Props {
  shape?: CountShape;
  symbol?: CountSymbol;
  /** Style colors to draw standard shapes with (defaults to Count default style). */
  style?: Pick<MarkupStyle, 'stroke' | 'fill' | 'fillOpacity' | 'width'>;
  size?: number;
  className?: string;
}

/** Small crisp canvas preview of a standard count shape or a custom saved count symbol. */
export function CountSymbolSwatch({ shape = 'circle', symbol, style, size = 18, className = 'ls-swatch' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const r = size * 0.38;
      const base = style ?? DEFAULT_STYLES.count;
      const m: Markup = {
        id: 'swatch',
        type: 'count',
        pageIndex: 0,
        points: [[size / 2, size / 2]],
        style: {
          ...DEFAULT_STYLES.count,
          stroke: base.stroke,
          fill: base.fill,
          fillOpacity: base.fillOpacity ?? 0.5,
          width: Math.min(Math.max(base.width || 1, 1), 2),
          opacity: 1,
          arcRadius: r,
          showLabel: false,
          countShape: shape,
          ...(symbol ? { countSymbol: symbol } : {}),
        },
        status: 'none',
        author: '',
        createdAt: 0,
        modifiedAt: 0,
      };
      drawMarkup(ctx, m, 2);
    };
    draw();
    return onImageLoad(draw);
  }, [shape, symbol, style?.stroke, style?.fill, style?.fillOpacity, style?.width, size]);

  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />;
}
