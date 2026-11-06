import type { Block, Drawing, Entity, Groups, Layer, Layout, TextStyle } from './drawing';
import { has, num, nums, str } from './drawing';

/** Raised for files the reader cannot take; the message is for the user. */
export class CadReadError extends Error {}

/** Caps so a hostile or corrupt file cannot run the reader out of memory. */
const MAX_GROUPS = 40_000_000;

/** Bytes of an ASCII DXF as text: UTF-8 from R2007 (AC1021) on, else the Windows code page. */
export function decodeDxf(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 22));
  if (head.startsWith('AutoCAD Binary DXF')) throw new CadReadError('Binary DXF files are not supported yet. Save the drawing as ASCII DXF or DWG.');
  const probe = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(probe)?.[1] ?? '';
  const utf8 = ver >= 'AC1021' || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
  return new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(bytes);
}

/** Group code / value pairs. */
export function tokenize(text: string): Groups {
  const lines = text.split(/\r?\n/);
  if (lines.length / 2 > MAX_GROUPS) throw new CadReadError('This drawing is too large to convert.');
  const out: Groups = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isInteger(code)) throw new CadReadError(`This is not a readable DXF file (bad group code on line ${i + 1}).`);
    const numeric = (code >= 10 && code <= 99) || (code >= 110 && code <= 179) || (code >= 210 && code <= 239)
      || (code >= 270 && code <= 299) || (code >= 370 && code <= 389) || (code >= 400 && code <= 409)
      || (code >= 420 && code <= 429) || (code >= 440 && code <= 469) || (code >= 1010 && code <= 1071);
    if (numeric && !Number.isFinite(Number(lines[i + 1]!.trim()))) throw new CadReadError(`This drawing contains an invalid numeric value on line ${i + 2}.`);
    // Values keep leading spaces (text), but not the trailing ones some writers add.
    out.push([code, lines[i + 1]!.replace(/\s+$/, '')]);
  }
  return out;
}

/** Splits groups into objects: each starts at a code-0 group. */
function objects(groups: Groups, from: number, to: number): { type: string; g: Groups }[] {
  const out: { type: string; g: Groups }[] = [];
  for (let i = from; i < to; i++) {
    const [c, v] = groups[i]!;
    if (c === 0) out.push({ type: v, g: [] });
    else out[out.length - 1]?.g.push([c, v]);
  }
  return out;
}

/** An entity from its groups: common properties pulled out, reactors and dictionaries dropped. */
function entityOf(type: string, raw: Groups): Entity {
  const g: Groups = [];
  let owner = '';
  let inBraces = false;
  // The first 330 outside reactor braces is the owner. Subclass markers carry nothing we need.
  for (const [c, v] of raw) {
    if (c === 102) {
      inBraces = v.startsWith('{');
      continue;
    }
    if (inBraces) continue;
    if (c === 330 && !owner) {
      owner = v;
      continue;
    }
    if (c === 100) continue;
    if (c >= 1000) break; // xdata
    g.push([c, v]);
  }
  const first = (code: number) => {
    const i = g.findIndex(([c]) => c === code);
    return i < 0 ? undefined : g[i]![1];
  };
  // Common properties: entity data never reuses these codes (210-230, where an entity has its
  // own extrusion, mean the same thing).
  const e: Entity = {
    type,
    handle: first(5) ?? '',
    owner,
    layer: first(8) ?? '0',
    color: Number(first(62) ?? 256),
    trueColor: first(420) === undefined ? null : Number(first(420)),
    linetype: first(6) ?? 'BYLAYER',
    ltscale: Number(first(48) ?? 1),
    lineweight: Number(first(370) ?? -1),
    paperSpace: first(67) === '1',
    invisible: first(60) === '1',
    extrusion: [Number(first(210) ?? 0), Number(first(220) ?? 0), Number(first(230) ?? 1)],
    g,
    children: [],
  };
  return e;
}

/** Attaches VERTEX/ATTRIB runs to their POLYLINE/INSERT and drops SEQEND. */
function nest(list: { type: string; g: Groups }[]): Entity[] {
  const out: Entity[] = [];
  let parent: Entity | null = null;
  for (const o of list) {
    if (o.type === 'SEQEND') {
      parent = null;
      continue;
    }
    const e = entityOf(o.type, o.g);
    if (parent && (o.type === 'VERTEX' || o.type === 'ATTRIB')) {
      parent.children.push(e);
      continue;
    }
    parent = null;
    out.push(e);
    if (o.type === 'POLYLINE' || (o.type === 'INSERT' && num(e.g, 66) === 1)) parent = e;
  }
  return out;
}

const DEFAULT_LAYER = (name: string): Layer => ({ name, handle: '', color: 7, trueColor: null, linetype: 'CONTINUOUS', lineweight: -3, plot: true, frozen: false, off: false });

/** Reads an ASCII DXF into a Drawing. */
export function readDxf(input: string | Uint8Array): Drawing {
  const groups = tokenize(typeof input === 'string' ? input : decodeDxf(input));
  const d: Drawing = {
    version: '',
    header: new Map(),
    layers: new Map(),
    layerByHandle: new Map(),
    linetypes: new Map(),
    styles: new Map(),
    dimstyles: new Map(),
    blocks: new Map(),
    blockByRecord: new Map(),
    layouts: [],
    modelSpace: [],
    byHandle: new Map(),
    imageDefs: new Map(),
  };
  const sections = new Map<string, [number, number]>();
  for (let i = 0; i < groups.length; i++) {
    if (groups[i]![0] === 0 && groups[i]![1] === 'SECTION' && groups[i + 1]?.[0] === 2) {
      const name = groups[i + 1]![1];
      let j = i + 2;
      while (j < groups.length && !(groups[j]![0] === 0 && groups[j]![1] === 'ENDSEC')) j++;
      sections.set(name, [i + 2, j]);
      i = j;
    }
  }
  if (!sections.has('ENTITIES')) throw new CadReadError('This DXF file has no drawing entities.');

  // HEADER: $NAME followed by its values.
  const hdr = sections.get('HEADER');
  if (hdr) {
    let cur: Groups | null = null;
    for (let i = hdr[0]; i < hdr[1]; i++) {
      const [c, v] = groups[i]!;
      if (c === 9) d.header.set(v, (cur = []));
      else cur?.push([c, v]);
    }
  }
  d.version = d.header.get('$ACADVER')?.[0]?.[1] ?? '';

  // TABLES
  const tab = sections.get('TABLES');
  if (tab) {
    for (const o of objects(groups, tab[0], tab[1])) {
      const g = o.g;
      if (o.type === 'LAYER') {
        const color = num(g, 62, 7);
        const flags = num(g, 70);
        const layer: Layer = {
          name: str(g, 2),
          handle: str(g, 5),
          color: Math.abs(color) || 7,
          trueColor: has(g, 420) ? num(g, 420) : null,
          linetype: str(g, 6, 'CONTINUOUS'),
          lineweight: num(g, 370, -3),
          plot: num(g, 290, 1) !== 0,
          frozen: (flags & 1) !== 0,
          off: color < 0,
        };
        d.layers.set(layer.name, layer);
        if (layer.handle) d.layerByHandle.set(layer.handle, layer.name);
      } else if (o.type === 'LTYPE') {
        // Element lengths (49), each possibly followed by shape/text data (74 > 0) we skip.
        d.linetypes.set(str(g, 2).toUpperCase(), { name: str(g, 2), pattern: nums(g, 49) });
      } else if (o.type === 'DIMSTYLE') {
        d.dimstyles!.set(str(g, 2).toUpperCase(), g);
      } else if (o.type === 'STYLE') {
        const xdata = g.findIndex(([c, v]) => c === 1001 && v === 'ACAD');
        const family = xdata >= 0 ? (g.slice(xdata).find(([c]) => c === 1000)?.[1] ?? '') : '';
        const style: TextStyle = {
          name: str(g, 2),
          font: str(g, 3),
          bigFont: str(g, 4),
          family,
          height: num(g, 40),
          widthFactor: num(g, 41, 1) || 1,
          oblique: num(g, 50),
          generation: num(g, 71),
        };
        if (style.name) d.styles.set(style.name.toUpperCase(), style);
      }
    }
  }
  // BLOCKS
  const blk = sections.get('BLOCKS');
  if (blk) {
    let cur: Block | null = null;
    let body: { type: string; g: Groups }[] = [];
    for (const o of objects(groups, blk[0], blk[1])) {
      if (o.type === 'BLOCK') {
        const record = o.g.find(([c]) => c === 330)?.[1] ?? '';
        cur = {
          name: str(o.g, 2),
          record,
          base: [num(o.g, 10), num(o.g, 20)],
          flags: num(o.g, 70),
          xrefPath: str(o.g, 1),
          entities: [],
        };
        body = [];
      } else if (o.type === 'ENDBLK') {
        if (cur) {
          cur.entities = nest(body);
          d.blocks.set(cur.name.toUpperCase(), cur);
          if (cur.record) d.blockByRecord.set(cur.record, cur);
        }
        cur = null;
      } else if (cur) body.push(o);
    }
  }

  // ENTITIES: model space and the active layout's paper space, told apart by owner (or 67).
  const ent = sections.get('ENTITIES')!;
  const model = [...d.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE');
  const paper = [...d.blocks.values()].find((b) => b.name.toUpperCase() === '*PAPER_SPACE');
  for (const e of nest(objects(groups, ent[0], ent[1]))) {
    const owner = e.owner ? d.blockByRecord.get(e.owner) : undefined;
    if (owner && owner !== model) owner.entities.push(e);
    else if (!owner && e.paperSpace && paper) paper.entities.push(e);
    else if (!owner && e.paperSpace) {
      // R12: one paper space with no block for it.
      const ps: Block = { name: '*Paper_Space', record: '', base: [0, 0], flags: 0, xrefPath: '', entities: [e] };
      d.blocks.set('*PAPER_SPACE', ps);
    } else d.modelSpace.push(e);
  }
  if (model) d.modelSpace.unshift(...model.entities.filter((e) => !d.modelSpace.includes(e)));

  const index = (list: Entity[]) => {
    for (const e of list) if (e.handle) d.byHandle.set(e.handle, e);
  };
  index(d.modelSpace);
  for (const b of d.blocks.values()) index(b.entities);

  // OBJECTS: layouts and image definitions.
  const obj = sections.get('OBJECTS');
  if (obj) {
    for (const o of objects(groups, obj[0], obj[1])) {
      if (o.type === 'LAYOUT') d.layouts.push(layoutOf(o.g));
      else if (o.type === 'IMAGEDEF') d.imageDefs.set(str(o.g, 5), { path: str(o.g, 1) });
    }
  }
  d.layouts.sort((a, b) => a.tabOrder - b.tabOrder);

  // Layers used but never declared get defaults (some writers leave them out).
  const declare = (list: Entity[]) => {
    for (const e of list) {
      if (!d.layers.has(e.layer)) d.layers.set(e.layer, DEFAULT_LAYER(e.layer));
      for (const c of e.children) if (!d.layers.has(c.layer)) d.layers.set(c.layer, DEFAULT_LAYER(c.layer));
    }
  };
  declare(d.modelSpace);
  for (const b of d.blocks.values()) declare(b.entities);
  if (!d.layers.has('0')) d.layers.set('0', DEFAULT_LAYER('0'));
  return d;
}

function layoutOf(g: Groups): Layout {
  // AcDbPlotSettings then AcDbLayout share codes (1, 70, 76): split at the subclass marker.
  const split = g.findIndex(([c, v]) => c === 100 && v === 'AcDbLayout');
  const plot = split >= 0 ? g.slice(0, split) : g;
  const lay = split >= 0 ? g.slice(split + 1) : [];
  const owners = lay.filter(([c]) => c === 330).map(([, v]) => v);
  const name = str(lay, 1);
  const num_ = num(plot, 142, 1);
  const den = num(plot, 143, 1);
  return {
    name,
    tabOrder: num(lay, 71),
    record: owners[owners.length - 1] ?? '',
    paperWidth: num(plot, 44),
    paperHeight: num(plot, 45),
    margins: [num(plot, 40), num(plot, 41), num(plot, 42), num(plot, 43)],
    origin: [num(plot, 46), num(plot, 47)],
    mm: num(plot, 72, 1) === 1,
    rotation: num(plot, 73) & 3,
    printScale: num_ > 0 && den > 0 ? num_ / den : 1,
    isModel: name.toUpperCase() === 'MODEL',
  };
}
