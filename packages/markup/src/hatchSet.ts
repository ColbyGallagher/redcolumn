import { builtInHatchFor, customHatchId, type HatchElement, type HatchSpec, type StoredHatch } from './hatches';
import type { Dropped } from './diagnostics';
import { setTitle } from './lineSet';
import { parseXml, type XmlElement } from './xml';

/** A Revu hatch set (.bhx): a titled list of hatch patterns. */
export interface HatchSet {
  title: string;
  hatches: { name: string; id: StoredHatch; spec: HatchSpec; /** The built-in hatch with this same pattern, when the set repeats one. */ builtIn: StoredHatch | null }[];
}

/** Points in one tile edge for Revu's named tile sizes (the set's <Size>). */
const TILE_POINTS: Record<string, number> = {
  quarterinch: 18,
  halfinch: 36,
  oneinch: 72,
  inch: 72,
  centimeter: 72 / 2.54,
  millimeter: 72 / 25.4,
};

const num = (v: string | undefined, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const field = (e: XmlElement, tag: string) => e.children.find((c) => c.tagName === tag)?.textContent.trim();

function element(e: XmlElement): HatchElement | null {
  if (e.attrs.Type === 'Line') return { type: 'line', x1: num(e.attrs.X1), y1: num(e.attrs.Y1), x2: num(e.attrs.X2), y2: num(e.attrs.Y2) };
  if (e.attrs.Type === 'Dot') return { type: 'dot', x: num(e.attrs.X), y: num(e.attrs.Y), size: /^large$/i.test(e.attrs.Size ?? '') ? 'large' : 'small' };
  return null;
}

/**
 * Reads a .bhx file. Throws when it is not one. Hatches it cannot keep, and elements it cannot
 * draw, are listed in `dropped`.
 */
export async function parseBhx(xml: string, fallbackTitle = 'Imported hatches', dropped: Dropped[] = []): Promise<HatchSet> {
  let root: XmlElement;
  try {
    root = parseXml(xml.replace(/^﻿/, ''));
  } catch {
    throw new Error('This is not a Bluebeam hatch set (.bhx).');
  }
  if (root.tagName !== 'BluebeamRevuHatchSet') throw new Error('This is not a Bluebeam hatch set (.bhx).');
  const title = await setTitle(root.children.find((c) => c.tagName === 'Title')?.textContent, fallbackTitle);
  const hatches: HatchSet['hatches'] = [];
  let n = 0;
  for (const h of root.children) {
    if (h.tagName !== 'Hatch') continue;
    const item = `${++n}. ${h.attrs.Name || '(unnamed)'}`;
    if (!h.attrs.Name) {
      dropped.push({ item, reason: 'the hatch has no name' });
      continue;
    }
    const elements = h.children.flatMap((e) => {
      if (e.tagName !== 'Element') return [];
      const el = element(e);
      if (!el) dropped.push({ item, reason: `element type "${e.attrs.Type ?? 'unknown'}" is not supported yet` });
      return el ? [el] : [];
    });
    if (!elements.length) {
      dropped.push({ item, reason: 'the hatch has no elements this app can draw' });
      continue;
    }
    const size = (field(h, 'Size') ?? '').toLowerCase();
    if (size && TILE_POINTS[size] === undefined) dropped.push({ item, reason: `tile size "${field(h, 'Size')}" is not known, so the default is used` });
    const spec: HatchSpec = {
      scaleX: num(field(h, 'ScaleX'), 1),
      scaleY: num(field(h, 'ScaleY'), 1),
      size: TILE_POINTS[size] ?? 18,
      lineWidth: num(field(h, 'LineWidth'), 1),
      elements,
    };
    hatches.push({ name: h.attrs.Name, id: customHatchId(title, h.attrs.Name), spec, builtIn: builtInHatchFor(spec) });
  }
  return { title, hatches };
}
