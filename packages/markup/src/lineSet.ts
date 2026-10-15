import type { Dropped } from './diagnostics';
import { decodeRaw } from './toolchest';
import type { CustomLine } from './lineStyle';
import type { Markup } from './model';
import { parseXml, type XmlElement } from './xml';

/** A Revu line style set (.blx): a titled list of custom line styles. */
export interface LineSet {
  title: string;
  styles: CustomLine[];
}

const isTrue = (v: string | undefined) => /^true$/i.test((v ?? '').trim());
const num = (v: string | undefined, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const child = (e: XmlElement, tag: string) => e.children.find((c) => c.tagName === tag);

/** Revu stores a set's title as hex of zlib-compressed text; a plain title is kept as it is. */
export async function setTitle(raw: string | undefined, fallback: string): Promise<string> {
  const text = (raw ?? '').trim();
  if (!text) return fallback;
  if (!/^78(01|5e|9c|da)[0-9a-f]*$/i.test(text) || text.length % 2) return text;
  try {
    return (await decodeRaw(text)).trim() || fallback;
  } catch {
    return text;
  }
}

/**
 * One <Component> as it sits in a PDF's /LineStyle: a dash is its width, a space its negative
 * width, text `[text, font, size, bold, italic, upright]`, a symbol `[left, right, scale, fill,
 * type, x, y, ...]` with type 0 for a start, 1 a line and 2 a curve point.
 */
function component(c: XmlElement): unknown | null {
  switch (c.attrs.Type) {
    case 'Dash': {
      const w = num(c.attrs.Width);
      return w > 0 ? w : null;
    }
    case 'Space': {
      const w = num(c.attrs.Width);
      return w > 0 ? -w : null;
    }
    case 'Text': {
      const field = (tag: string) => child(c, tag)?.textContent.trim();
      return [c.attrs.Text ?? '', field('Font') || 'Helvetica', num(field('Size'), 6), isTrue(field('Bold')), isTrue(field('Italic')), field('Upright') === undefined ? true : isTrue(field('Upright'))];
    }
    case 'Vector': {
      const out: unknown[] = [num(c.attrs.Left), num(c.attrs.Right), num(c.attrs.Scale, 1), isTrue(c.attrs.Fill)];
      for (const p of c.children) {
        if (p.tagName !== 'Point') continue;
        const type = p.attrs.Type === 'Start' ? 0 : p.attrs.Type === 'Curve' ? 2 : 1;
        out.push(type, num(p.attrs.X), num(p.attrs.Y));
      }
      return out.length > 4 ? out : null;
    }
    default:
      return null;
  }
}

const COMPONENT_TYPES = new Set(['Dash', 'Space', 'Text', 'Vector']);

/**
 * Reads a .blx file into line styles the markup engine draws as they are. Throws when it is not one.
 * Components it cannot keep are listed in `dropped`, one entry per line style they were in.
 */
export async function parseBlx(xml: string, fallbackTitle = 'Imported line styles', dropped: Dropped[] = []): Promise<LineSet> {
  let root: XmlElement;
  try {
    root = parseXml(xml.replace(/^﻿/, ''));
  } catch {
    throw new Error('This is not a Bluebeam line style set (.blx).');
  }
  if (root.tagName !== 'BluebeamRevuLineStyleSet') throw new Error('This is not a Bluebeam line style set (.blx).');
  const styles: CustomLine[] = [];
  let n = 0;
  for (const s of root.children) {
    if (s.tagName !== 'LineStyle') continue;
    const item = `${++n}. ${s.attrs.Name || '(unnamed)'}`;
    if (!s.attrs.Name) {
      dropped.push({ item, reason: 'the line style has no name' });
      continue;
    }
    const lines = s.children
      .filter((l) => l.tagName === 'Line')
      .map((l) => [
        num(l.attrs.Offset),
        ...l.children
          .filter((c) => c.tagName === 'Component')
          .flatMap((c) => {
            const part = component(c);
            if (part !== null) return [part];
            const reason = COMPONENT_TYPES.has(c.attrs.Type ?? '') ? 'a component has no usable size' : `component type "${c.attrs.Type ?? 'unknown'}" is not supported yet`;
            dropped.push({ item, reason });
            return [];
          }),
      ]);
    styles.push({ name: s.attrs.Name, spec: [s.attrs.ScaleWithLineWidth === undefined ? true : isTrue(s.attrs.ScaleWithLineWidth), ...lines] });
  }
  return { title: await setTitle(child(root, 'Title')?.textContent, fallbackTitle), styles };
}

/**
 * The custom line styles drawn on `markups` that none of `known` already has: what a document that
 * came from Revu brings with it, to offer in the pickers beside the sets.
 */
export function documentLineStyles(markups: readonly Markup[], known: readonly CustomLine[] = []): CustomLine[] {
  const key = (l: CustomLine) => `${l.name}\u0000${JSON.stringify(l.spec)}`;
  const seen = new Set(known.map(key));
  const out: CustomLine[] = [];
  for (const m of markups) {
    const l = m.style.lineStyle;
    if (!l || seen.has(key(l))) continue;
    seen.add(key(l));
    out.push(l);
  }
  return out;
}
