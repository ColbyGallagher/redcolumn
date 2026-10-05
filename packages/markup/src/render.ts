import { DEFAULT_SCALE, labelAnchor, measureLabel, polygonCentroid, type Scale } from '@nb/measure';
import { spaceName } from './spaces';
import { dimensionNormal, layoutText, markupShape, TEXT_LINE_HEIGHT, TEXT_PADDING, type PathCmd } from './geometry';
import { boundsOf, contentBox, isImageType, isMeasureKind, isTextType, markupBounds, measureProps, rotatePoint, rotationCentre, ROTATABLE, type Markup } from './model';
import { TYPE_INFO } from './types';
import { legendLayout, legendRows, legendSymbol } from './legend';
import { stampLayout } from './stamp';
import { cssFont, dashPattern, labelStyle, textColor } from './style';

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

/** Text and position of a measurement's value label, or null for other markups or hidden labels. */
export function measurementLabel(m: Markup, scale: Scale = DEFAULT_SCALE): { text: string; at: [number, number] } | null {
  if (!isMeasureKind(m.type) || m.points.length === 0 || m.style.showLabel === false) return null;
  let at = labelAnchor(m.type, m.points);
  if (m.type === 'length' && m.style.leader && m.points.length >= 2) {
    const [nx, ny] = dimensionNormal(m.points[0]!, m.points[m.points.length - 1]!);
    at = [at[0] + nx * m.style.leader, at[1] + ny * m.style.leader];
  }
  return { text: measureLabel(m.type, m.points, scale, measureProps(m)), at };
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
  // On the dimension line, moved off its points by any leader offset.
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const lead = m.style.leader ?? 0;
  const mx = (a[0] + b[0]) / 2 - ((b[1] - a[1]) / d) * lead;
  const my = (a[1] + b[1]) / 2 + ((b[0] - a[0]) / d) * lead;
  // Above the line: the left-hand normal of the reading direction.
  const off = size * 0.35 + m.style.width;
  return { text: m.text, at: [mx + Math.sin(angle) * off, my - Math.cos(angle) * off], angle, size };
}

/**
 * Where each line of a text box goes: `x` is the line's left edge, `y` its top, both in page
 * space, for the box's alignment. `measure` gives a string's width at the box's font size.
 */
export function textBoxLines(m: Markup, measure: (s: string) => number): { text: string; x: number; y: number; width: number }[] {
  const b = contentBox(m);
  const size = m.style.fontSize ?? 12;
  const inner = b.w - TEXT_PADDING * 2;
  const lines = layoutText(m.text ?? '', inner, measure);
  const lineH = size * TEXT_LINE_HEIGHT;
  const total = lines.length * lineH;
  const valign = m.style.verticalAlign ?? 'top';
  const top =
    valign === 'middle' ? b.y + (b.h - total) / 2 : valign === 'bottom' ? b.y + b.h - TEXT_PADDING - total : b.y + TEXT_PADDING;
  return lines.map((text, i) => {
    const width = measure(text);
    const align = m.style.textAlign ?? 'left';
    const x = align === 'center' ? b.x + (b.w - width) / 2 : align === 'right' ? b.x + b.w - TEXT_PADDING - width : b.x + TEXT_PADDING;
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
  const dash = dashPattern(style.dash, lineWidth);
  // Highlighter multiplies so drawing detail stays visible underneath.
  if (TYPE_INFO[m.type].multiply) ctx.globalCompositeOperation = 'multiply';
  for (const part of markupShape(m)) {
    if (part.clip) {
      ctx.save();
      tracePath(ctx, part.clip);
      ctx.clip(part.evenOdd ? 'evenodd' : 'nonzero');
      ctx.lineWidth = lineWidth / 2;
      tracePath(ctx, part.path);
      ctx.stroke();
      ctx.restore();
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
    const [x, y] = label.at;
    if (background) {
      ctx.globalAlpha = 0.85 * style.opacity;
      ctx.fillStyle = background;
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
    }
    ctx.globalAlpha = style.opacity;
    ctx.fillStyle = textColor(style);
    ctx.fillText(label.text, x, y);
    if (style.underline) underline(ctx, x - w / 2 + size * 0.3, y + size * 0.45, w - size * 0.6, size);
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
  if (isImageType(m.type) && m.image) {
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
  if (m.type === 'space' && m.points.length > 2) {
    const [x, y] = polygonCentroid(m.points);
    ctx.font = cssFont(style, style.fontSize ?? 14, true);
    ctx.fillStyle = style.stroke;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spaceName(m), x, y);
  }
  if (m.type === 'stamp' && m.stamp) {
    const b = boundsOf(m.points);
    const measure = (text: string, bold: boolean) => {
      ctx.font = `${bold ? 'bold ' : ''}100px ${TEXT_FONT_FAMILY}`;
      return ctx.measureText(text).width / 100;
    };
    ctx.fillStyle = style.stroke;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const line of stampLayout(b, m.stamp, measure)) {
      ctx.font = `${line.bold ? 'bold ' : ''}${line.size}px ${TEXT_FONT_FAMILY}`;
      ctx.fillText(line.text, line.x, line.y);
    }
  }
  ctx.restore();
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
  for (const [x, y] of handlePositions({ ...m, rotation: 0 })) {
    ctx.fillRect(x - h / 2, y - h / 2, h, h);
    ctx.strokeRect(x - h / 2, y - h / 2, h, h);
  }
  ctx.restore();
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
 * Draggable handles. Two-point shapes expose their defining points, measurements and click-drawn
 * shapes every vertex; pen strokes and notes are move-only. Index i corresponds to `m.points[i]`.
 */
export function handlePositions(m: Markup): [number, number][] {
  const handles = TYPE_INFO[m.type].handles;
  const pts = handles === 'none' ? [] : handles === 'vertices' ? m.points : m.points.slice(0, 2);
  if (!m.rotation) return pts;
  const c = rotationCentre(m);
  return pts.map((p) => rotatePoint(p, c, m.rotation!));
}
