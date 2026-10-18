import { DEFAULT_SCALE, labelAnchor, measureLabel, polygonCentroid, type Scale } from '@nb/measure';
import { spaceName } from './spaces';
import { layoutParagraphs } from './textLists';
import { markupShape, TEXT_LINE_HEIGHT, TEXT_PADDING, type PathCmd } from './geometry';
import { boundsOf, contentBox, dimensionLine, isImageType, isMeasureKind, isTextType, markupBounds, measureProps, rotatePoint, rotationCentre, ROTATABLE, type Markup, type Point } from './model';
import { TYPE_INFO } from './types';
import { legendLayout, legendRows, legendSymbol } from './legend';
import { tableCells, tableCellText } from './table';
import { stampLayout, stampTick } from './stamp';
import { hatchDraw, paintHatchCell, type HatchDraw, type HatchSpec } from './hatches';
import { cssFont, dashPattern, FONT_FAMILIES, labelStyle, textColor } from './style';
import { styledParts, type ArtText, type LineArt, type TextMeasure } from './lineStyle';

export const TEXT_FONT_FAMILY = 'Helvetica, Arial, sans-serif';

/** Decoded markup images by data URL; drawing is synchronous, so images load once and redraw. */
const images = new Map<string, HTMLImageElement>();
const imageListeners = new Set<() => void>();

/** Calls `listener` whenever a markup image finishes loading (so the view can redraw). */
export function onImageLoad(listener: () => void): () => void {
  imageListeners.add(listener);
  return () => imageListeners.delete(listener);
}

function markupImage(src: string): HTMLImageElement | null {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => imageListeners.forEach((l) => l());
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

function tracePath(ctx: CanvasRenderingContext2D, path: PathCmd[]) {
  ctx.beginPath();
  for (const c of path) {
    if (c[0] === 'M') ctx.moveTo(c[1], c[2]);
    else if (c[0] === 'L') ctx.lineTo(c[1], c[2]);
    else if (c[0] === 'C') ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else ctx.closePath();
  }
}

/** CSS font for a line style's text. */
function artFont(t: Pick<ArtText, 'font' | 'bold' | 'italic' | 'size'>): string {
  const family = FONT_FAMILIES.find((f) => f.value === t.font) ?? FONT_FAMILIES[0]!;
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${family.css}`;
}

const canvasMeasure = (ctx: CanvasRenderingContext2D): TextMeasure => (text, font, bold, italic, size) => {
  ctx.save();
  ctx.font = artFont({ font, bold, italic, size });
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
};

/** A custom line style's laid out strokes, fills and text, in the stroke color. */
function paintArt(ctx: CanvasRenderingContext2D, art: LineArt) {
  ctx.setLineDash([]);
  if (art.fill.length) {
    tracePath(ctx, art.fill);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }
  if (art.stroke.length) {
    tracePath(ctx, art.stroke);
    ctx.stroke();
  }
  if (art.texts.length) {
    ctx.fillStyle = ctx.strokeStyle;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of art.texts) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle);
      ctx.font = artFont(t);
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
  }
}

const hatchTiles = new Map<string, CanvasImageSource>();

/** A repeating bitmap of one tile, or null where no canvas can be built (unit tests). */
function hatchTile(draw: HatchDraw, color: string, zoom: number): CanvasImageSource | null {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const pxW = Math.max(1, Math.min(512, Math.round(draw.metrics.cellW * z)));
  const pxH = Math.max(1, Math.min(512, Math.round(draw.metrics.cellH * z)));
  // An imported hatch can change under the same id (the set imported again), so its geometry is in the key.
  const shape = draw.id.startsWith('set:') ? `|${draw.lines.length}.${draw.dots.length}.${draw.lines.reduce((n, l) => n + l.x1 + 3 * l.y1 + 5 * l.x2 + 7 * l.y2, 0).toFixed(3)}.${draw.dots.reduce((n, d) => n + d.x + 3 * d.y, 0).toFixed(3)}` : '';
  const key = `${draw.id}${shape}|${color}|${pxW}x${pxH}|${draw.metrics.lineWidth.toFixed(3)}`;
  const cached = hatchTiles.get(key);
  if (cached) return cached;
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const tile = canvas.getContext('2d');
    if (!tile) return null;
    tile.scale(pxW / draw.metrics.cellW, pxH / draw.metrics.cellH);
    tile.beginPath();
    tile.rect(0, 0, draw.metrics.cellW, draw.metrics.cellH);
    tile.clip();
    paintHatchCell(tile, draw, color);
    hatchTiles.set(key, canvas);
    if (hatchTiles.size > 48) {
      const first = hatchTiles.keys().next().value;
      if (first) hatchTiles.delete(first);
    }
    return canvas;
  } catch {
    return null;
  }
}

function pathBounds(path: PathCmd[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of path) {
    for (let i = 1; i + 1 < c.length; i += 2) {
      const x = c[i] as number;
      const y = c[i + 1] as number;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Fills `clip` with a hatch. A bitmap pattern when a canvas exists; otherwise the tiles that cover the clip. */
function paintHatch(ctx: CanvasRenderingContext2D, clip: PathCmd[], evenOdd: boolean | undefined, hatch: { id: string; scale: number; color: string; spec?: HatchSpec }, alpha: number, zoom: number) {
  const draw = hatchDraw(hatch.id, hatch.scale, hatch.spec);
  if (!draw) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.setLineDash([]);
  tracePath(ctx, clip);
  ctx.clip(evenOdd ? 'evenodd' : 'nonzero');
  const tile = hatchTile(draw, hatch.color, zoom);
  const pattern = tile ? ctx.createPattern(tile, 'repeat') : null;
  if (pattern) {
    const source = tile as { width?: number; height?: number };
    const sx = draw.metrics.cellW / (source.width || draw.metrics.cellW);
    const sy = draw.metrics.cellH / (source.height || draw.metrics.cellH);
    try {
      pattern.setTransform(new DOMMatrix([sx, 0, 0, sy, 0, 0]));
    } catch {
      /* Pattern still repeats; a missing matrix leaves it in pixel space. */
    }
    ctx.fillStyle = pattern;
    tracePath(ctx, clip);
    ctx.fill(evenOdd ? 'evenodd' : 'nonzero');
  } else {
    const b = pathBounds(clip);
    const { cellW, cellH } = draw.metrics;
    if (cellW > 0 && cellH > 0) {
      const i0 = Math.floor(b.x / cellW) - 1;
      const i1 = Math.ceil((b.x + b.w) / cellW) + 1;
      const j0 = Math.floor(b.y / cellH) - 1;
      const j1 = Math.ceil((b.y + b.h) / cellH) + 1;
      const maxTiles = 2000;
      let tiles = 0;
      for (let i = i0; i <= i1 && tiles < maxTiles; i++) {
        for (let j = j0; j <= j1 && tiles < maxTiles; j++) {
          tiles++;
          ctx.save();
          ctx.translate(i * cellW, j * cellH);
          paintHatchCell(ctx, draw, hatch.color);
          ctx.restore();
        }
      }
    }
  }
  ctx.restore();
}

/**
 * Text and position of a measurement's value label, or null for other markups or hidden labels.
 * `angle` is its turn in radians, clockwise in page space (a Length's text can be turned).
 */
export function measurementLabel(m: Markup, scale: Scale = DEFAULT_SCALE): { text: string; at: [number, number]; angle: number } | null {
  if (!isMeasureKind(m.type) || m.points.length === 0 || m.style.showLabel === false) return null;
  const line = dimensionLine(m);
  const at: [number, number] = line ? [line.text[0], line.text[1]] : labelAnchor(m.type, m.points);
  const value = measureLabel(m.type, m.points, scale, measureProps(m));
  const caption = m.text?.trim();
  return { text: caption ? `${caption} ${value}` : value, at, angle: line ? ((m.style.labelRotation ?? 0) * Math.PI) / 180 : 0 };
}

/**
 * A dimension's text: centred on its line, just above it, turned to run along it (kept reading
 * left to right). `angle` is in radians, clockwise in page space.
 */
export function dimensionText(m: Markup): { text: string; at: [number, number]; angle: number; size: number } | null {
  if (m.type !== 'dimension' || !m.text || m.points.length < 2) return null;
  const [a, b] = [m.points[0]!, m.points[1]!];
  let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (angle > Math.PI / 2) angle -= Math.PI;
  else if (angle < -Math.PI / 2) angle += Math.PI;
  const size = m.style.fontSize ?? 10;
  // On the dimension line (moved off its points by any leader offset, slid along by any label offset).
  const [mx, my] = dimensionLine(m)!.text;
  // Above the line: the left-hand normal of the reading direction. A turned text turns about there.
  const off = size * 0.35 + m.style.width;
  return { text: m.text, at: [mx + Math.sin(angle) * off, my - Math.cos(angle) * off], angle: angle + ((m.style.labelRotation ?? 0) * Math.PI) / 180, size };
}

/**
 * Where each line of a text box goes: `x` is the line's left edge, `y` its top, both in page
 * space, for the box's alignment. `measure` gives a string's width at the box's font size.
 */
export function textBoxLines(m: Markup, measure: (s: string) => number): { text: string; x: number; y: number; width: number }[] {
  const b = contentBox(m);
  const size = m.style.fontSize ?? 12;
  const inner = b.w - TEXT_PADDING * 2;
  const lines = layoutParagraphs(m.text ?? '', inner, measure);
  const lineH = size * TEXT_LINE_HEIGHT;
  const total = lines.length * lineH;
  const valign = m.style.verticalAlign ?? 'top';
  const top =
    valign === 'middle' ? b.y + (b.h - total) / 2 : valign === 'bottom' ? b.y + b.h - TEXT_PADDING - total : b.y + TEXT_PADDING;
  return lines.map(({ text, indent }, i) => {
    const width = measure(text);
    // A wrapped list line hangs in from its first line; aligned text treats the indent as part of the line.
    const full = indent + width;
    const align = m.style.textAlign ?? 'left';
    const x = (align === 'center' ? b.x + (b.w - full) / 2 : align === 'right' ? b.x + b.w - TEXT_PADDING - full : b.x + TEXT_PADDING) + indent;
    return { text, x, y: top + i * lineH, width };
  });
}

/**
 * Draws a markup. `ctx` must already map page space (points) to the canvas. `zoom` (CSS px per
 * point) keeps strokes at least one pixel wide so thin markups stay visible when zoomed out.
 * `scale` is the page's drawing scale, used for measurement labels.
 */
/** What drawing a legend needs besides the legend itself: the markups it lists and their scales. */
export interface LegendSource {
  all: () => readonly Markup[];
  scaleFor: (pageIndex: number) => Scale;
  /** The scale each markup is measured at (its viewport's); its page's when unset. */
  scaleOf?: (m: Markup) => Scale;
}

export function drawMarkup(ctx: CanvasRenderingContext2D, m: Markup, zoom = Infinity, scale?: Scale, legends?: LegendSource) {
  if (m.hidden) return;
  const { style } = m;
  ctx.save();
  if (m.rotation) {
    const [cx, cy] = rotationCentre(m);
    ctx.translate(cx, cy);
    ctx.rotate((m.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  ctx.globalAlpha = style.opacity;
  const lineWidth = Math.max(style.width, 1 / zoom);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = style.stroke;
  ctx.lineJoin = 'round';
  ctx.lineCap = m.type === 'highlighter' ? 'butt' : 'round';
  const dash = style.dashArray ?? dashPattern(style.dash, lineWidth);
  // Highlighter multiplies so drawing detail stays visible underneath.
  if (TYPE_INFO[m.type].multiply) ctx.globalCompositeOperation = 'multiply';
  for (const part of styledParts(markupShape(m), style.lineStyle, style.width, style.lineStyle ? canvasMeasure(ctx) : () => 0)) {
    if (part.art) {
      paintArt(ctx, part.art);
      continue;
    }
    if (part.hatch && part.clip) {
      paintHatch(ctx, part.clip, part.evenOdd, part.hatch, style.opacity * (style.fillOpacity ?? 1), zoom);
      continue;
    }
    tracePath(ctx, part.path);
    if (part.fill) {
      ctx.save();
      ctx.globalAlpha = style.opacity * (part.decoration ? 1 : (style.fillOpacity ?? 1));
      ctx.fillStyle = part.fill;
      ctx.fill(part.evenOdd ? 'evenodd' : 'nonzero');
      ctx.restore();
    }
    if (part.stroke) {
      ctx.setLineDash(part.decoration ? [] : dash);
      // An exact dash pattern is drawn with flat ends, as other viewers do; presets use round ones for dots.
      if (style.dashArray) ctx.lineCap = part.decoration ? 'round' : 'butt';
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  const label = measurementLabel(m, scale);
  if (label) {
    const { size, background } = labelStyle(m);
    ctx.font = cssFont(style, size, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label.text).width + size * 0.6;
    const h = size * 1.4;
    let [x, y] = label.at;
    ctx.save();
    if (label.angle) {
      ctx.translate(x, y);
      ctx.rotate(label.angle);
      x = y = 0;
    }
    if (background) {
      ctx.globalAlpha = 0.85 * style.opacity;
      ctx.fillStyle = background;
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
    }
    ctx.globalAlpha = style.opacity;
    ctx.fillStyle = textColor(style);
    ctx.fillText(label.text, x, y);
    if (style.underline) underline(ctx, x - w / 2 + size * 0.3, y + size * 0.45, w - size * 0.6, size);
    ctx.restore();
  }
  const dim = dimensionText(m);
  if (dim) {
    ctx.save();
    ctx.translate(dim.at[0], dim.at[1]);
    ctx.rotate(dim.angle);
    ctx.font = cssFont(style, dim.size);
    ctx.fillStyle = textColor(style);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(dim.text, 0, 0);
    ctx.restore();
  }
  if ((isImageType(m.type) || m.type === 'attachment') && m.image) {
    const b = boundsOf(m.points);
    const img = markupImage(m.image);
    if (img) ctx.drawImage(img, b.x, b.y, b.w, b.h);
  }
  if (isTextType(m.type) && m.text) {
    const b = contentBox(m);
    const size = style.fontSize ?? 12;
    ctx.font = cssFont(style, size);
    ctx.fillStyle = textColor(style);
    ctx.strokeStyle = textColor(style);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    for (const line of textBoxLines(m, (s) => ctx.measureText(s).width)) {
      ctx.fillText(line.text, line.x, line.y);
      if (style.underline && line.text) underline(ctx, line.x, line.y + size * 0.98, line.width, size);
    }
  }
  if (m.type === 'legend') drawLegend(ctx, m, zoom, legends);
  if (m.type === 'table') drawTable(ctx, m);
  if (m.type === 'space' && m.points.length > 2) {
    const [x, y] = polygonCentroid(m.points);
    ctx.font = cssFont(style, style.fontSize ?? 14, true);
    ctx.fillStyle = style.stroke;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spaceName(m), x, y);
  }
  if (m.type === 'stamp' && m.stamp?.art) {
    // A picture with its text over it, the text placed by fractions of the box.
    const b = boundsOf(m.points);
    const img = markupImage(m.stamp.art.image);
    if (img) ctx.drawImage(img, b.x, b.y, b.w, b.h);
    for (const t of m.stamp.art.texts) {
      ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size * b.h}px ${TEXT_FONT_FAMILY}`;
      ctx.fillStyle = t.color;
      ctx.textBaseline = 'middle';
      ctx.textAlign = t.align;
      const x = b.x + (t.align === 'left' ? t.x : t.align === 'right' ? t.x + t.w : t.x + t.w / 2) * b.w;
      ctx.fillText(t.text, x, b.y + (t.y + t.h / 2) * b.h, Math.max(1, t.w * b.w));
    }
  } else if (m.type === 'stamp' && m.stamp) {
    const b = boundsOf(m.points);
    const measure = (text: string, bold: boolean) => {
      ctx.font = `${bold ? 'bold ' : ''}100px ${TEXT_FONT_FAMILY}`;
      return ctx.measureText(text).width / 100;
    };
    ctx.fillStyle = style.stroke;
    ctx.strokeStyle = style.stroke;
    ctx.textBaseline = 'middle';
    for (const line of stampLayout(b, m.stamp, measure)) {
      ctx.font = `${line.bold ? 'bold ' : ''}${line.size}px ${TEXT_FONT_FAMILY}`;
      ctx.textAlign = line.align;
      ctx.fillText(line.text, line.x, line.y);
      if (line.box) {
        const { x, y, size, ticked } = line.box;
        ctx.setLineDash([]);
        ctx.lineWidth = size * 0.1;
        ctx.strokeRect(x, y, size, size);
        if (ticked) {
          ctx.lineWidth = size * 0.16;
          ctx.beginPath();
          for (const [i, [px, py]] of stampTick(line.box).entries()) i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

/** A table's cell text, each cell's lines laid out and clipped like a text box. */
function drawTable(ctx: CanvasRenderingContext2D, m: Markup) {
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (const cell of tableCells(m)) {
    if (!cell.text) continue;
    // Each cell has the table's text style, with what it sets of its own.
    const size = cell.style.fontSize ?? 12;
    ctx.font = cssFont(cell.style, size);
    ctx.fillStyle = textColor(cell.style);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cell.rect.x, cell.rect.y, cell.rect.w, cell.rect.h);
    ctx.clip();
    for (const line of textBoxLines(tableCellText(m, cell), (s) => ctx.measureText(s).width)) {
      ctx.fillText(line.text, line.x, line.y);
      if (cell.style.underline && line.text) underline(ctx, line.x, line.y + size * 0.98, line.width, size);
    }
    ctx.restore();
  }
}

/** A legend's title and rows: symbol, description, quantity and measurement total. */
function drawLegend(ctx: CanvasRenderingContext2D, m: Markup, zoom: number, source?: LegendSource) {
  const rows = source ? legendRows(m, source.all(), source.scaleFor, source.scaleOf) : [];
  const L = legendLayout(m, Math.max(rows.length, 1));
  const size = L.fontSize;
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.box.x, L.box.y, L.box.w, L.box.h);
  ctx.clip();
  ctx.fillStyle = textColor(m.style);
  ctx.textBaseline = 'middle';
  ctx.font = cssFont(m.style, size * 1.1, true);
  ctx.textAlign = 'left';
  ctx.fillText('Legend', L.title.x, L.title.y);
  ctx.font = cssFont(m.style, size);
  if (!rows.length) {
    ctx.globalAlpha *= 0.6;
    ctx.fillText('No markups yet', L.rows[0]!.labelX, L.rows[0]!.y + L.rows[0]!.h / 2);
  }
  rows.forEach((row, i) => {
    const r = L.rows[i]!;
    // Band separators, then the symbol drawn as a small copy of the markup.
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = m.style.stroke;
    ctx.lineWidth = Math.max(0.5, 1 / zoom);
    ctx.beginPath();
    ctx.moveTo(L.box.x, r.y);
    ctx.lineTo(L.box.x + L.box.w, r.y);
    ctx.stroke();
    ctx.restore();
    drawMarkup(ctx, legendSymbol(row.sample, r.symbol), zoom);
    const cy = r.y + r.h / 2;
    ctx.fillStyle = textColor(m.style);
    ctx.textAlign = 'left';
    ctx.fillText(row.label, r.labelX, cy);
    ctx.textAlign = 'right';
    ctx.fillText(String(row.count), r.countX, cy);
    if (row.measure) ctx.fillText(row.measure, r.measureX, cy);
  });
  ctx.restore();
}

function underline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, size: number) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = Math.max(size * 0.06, 0.25);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  ctx.restore();
}

/**
 * Dashed bounds plus corner handles (none for locked markups, drawn with a solid outline);
 * `zoom` (CSS px per point) keeps them constant on screen.
 */
/** `handlePx` is the handles' size on screen (larger for fingers). */
export function drawSelection(ctx: CanvasRenderingContext2D, m: Markup, zoom: number, handlePx = 6) {
  const px = 1 / zoom;
  ctx.save();
  if (m.rotation) {
    // The box and handles turn with the markup; a round handle above it turns it.
    const [cx, cy] = rotationCentre(m);
    ctx.translate(cx, cy);
    ctx.rotate((m.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  const b = markupBounds({ ...m, rotation: 0 });
  ctx.lineWidth = px;
  ctx.strokeStyle = '#3b82f6';
  ctx.setLineDash(m.locked ? [] : [4 * px, 3 * px]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  if (m.locked) {
    ctx.restore();
    return;
  }
  ctx.fillStyle = '#fff';
  const h = handlePx * px;
  const box = TYPE_INFO[m.type].handles === 'box';
  handlePositions({ ...m, rotation: 0 }).forEach(([x, y], i) => {
    // A box's corners are round and the middles of its edges square, as in Bluebeam.
    if (box && BOX_CORNERS.includes(i)) {
      ctx.beginPath();
      ctx.arc(x, y, h / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }
    ctx.fillRect(x - h / 2, y - h / 2, h, h);
    ctx.strokeRect(x - h / 2, y - h / 2, h, h);
  });
  ctx.restore();
  const text = labelHandles(m, zoom);
  if (text) {
    // The text's own knobs: a round one on it to drag it, and one beyond it to turn it.
    ctx.save();
    ctx.lineWidth = px;
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();
    ctx.moveTo(text.rotate.stem[0], text.rotate.stem[1]);
    ctx.lineTo(text.rotate.at[0], text.rotate.at[1]);
    ctx.stroke();
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(text.move[0], text.move[1], h / 2 + px, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(text.rotate.at[0], text.rotate.at[1], 4 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  const knob = rotateHandle(m, zoom);
  if (knob) {
    ctx.save();
    ctx.lineWidth = px;
    ctx.strokeStyle = '#3b82f6';
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(knob.stem[0], knob.stem[1]);
    ctx.lineTo(knob.at[0], knob.at[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(knob.at[0], knob.at[1], 4 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** The rotate handle of a selected, rotatable markup: above the top of its box, turned with it. */
export function rotateHandle(m: Markup, zoom: number): { at: [number, number]; stem: [number, number] } | null {
  if (m.locked || !ROTATABLE.has(m.type)) return null;
  const b = markupBounds({ ...m, rotation: 0 });
  const c = rotationCentre(m);
  const top: [number, number] = [b.x + b.w / 2, b.y];
  const at: [number, number] = [b.x + b.w / 2, b.y - 18 / zoom];
  return { stem: rotatePoint(top, c, m.rotation ?? 0), at: rotatePoint(at, c, m.rotation ?? 0) };
}

/**
 * A selected Length or Dimension's text knobs: `move` on the text (drag it along or off the line)
 * and `rotate` beyond its top (turn it), with the text's current turn in degrees clockwise.
 */
export function labelHandles(m: Markup, zoom: number): { move: Point; rotate: { at: Point; stem: Point }; angle: number } | null {
  if (m.locked) return null;
  const line = dimensionLine(m);
  if (!line || (m.type === 'length' ? m.style.showLabel === false : !m.text)) return null;
  const dim = dimensionText(m);
  const angle = dim ? dim.angle : ((m.style.labelRotation ?? 0) * Math.PI) / 180;
  const size = m.style.fontSize ?? 10;
  // Up the text: its left-hand normal in page space (y down).
  const up: Point = [Math.sin(angle), -Math.cos(angle)];
  const move: Point = dim ? [dim.at[0] + up[0] * size * 0.4, dim.at[1] + up[1] * size * 0.4] : line.text;
  const reach = size * (dim ? 0.8 : 0.7);
  const stem: Point = [move[0] + up[0] * reach, move[1] + up[1] * reach];
  const at: Point = [stem[0] + up[0] * (14 / zoom), stem[1] + up[1] * (14 / zoom)];
  return { move, rotate: { at, stem }, angle: (angle * 180) / Math.PI };
}

/** A box's handles by index: its two defining corners, the other two corners, then the middles of its four edges. */
export const BOX_CORNERS: readonly number[] = [0, 1, 2, 3];

/** The handle across the box from each box handle (the one that stays put while it is dragged). */
export const BOX_OPPOSITE: readonly number[] = [1, 0, 3, 2, 5, 4, 7, 6];

/**
 * Draggable handles. Lines expose their end points, boxes their corners and edge middles (the two
 * points they are defined by first), measurements and click-drawn shapes every vertex; pen strokes
 * and notes are move-only. Index i < 2 corresponds to `m.points[i]`.
 */
export function handlePositions(m: Markup): [number, number][] {
  const handles = TYPE_INFO[m.type].handles;
  const pts = handles === 'none' ? [] : handles === 'vertices' ? m.points : handles === 'box' ? boxHandles(m.points) : m.points.slice(0, 2);
  if (!m.rotation) return pts;
  const c = rotationCentre(m);
  return pts.map((p) => rotatePoint(p, c, m.rotation!));
}

/** Handle positions of a box given by two opposite corners (see `BOX_CORNERS`). */
function boxHandles(points: readonly Point[]): Point[] {
  const [a, b] = [points[0]!, points[1] ?? points[0]!];
  return [a, b, [b[0], a[1]], [a[0], b[1]], [(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]], [a[0], (a[1] + b[1]) / 2], [b[0], (a[1] + b[1]) / 2]];
}
