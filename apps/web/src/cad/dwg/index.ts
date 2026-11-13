import { CadReadError } from '../dxf';
import type { Block, Drawing, Entity, Groups, Layer, Layout } from '../drawing';
import { BitReader, R2004, R2007, R2010, R2013, stringStream } from './bits';
import { openDwg, SECTION } from './container';
import { readHeader } from './header';
import { readObject, type EntRec, type ObjRec, type Rec } from './objects';

/** Reads a DWG (R2000–R2018) into the same Drawing model the DXF reader makes. */

const hex = (h: number) => h.toString(16).toUpperCase();
const MAX_OBJECTS = 20_000_000;

function readClasses(data: Uint8Array | null, version: number, maintenance: number, decoder: TextDecoder): Map<number, string> {
  const out = new Map<number, string>();
  if (!data) return out;
  const r = new BitReader(data, version, decoder);
  r.sentinel();
  const size = r.RL();
  let end = r.pos + size * 8;
  if ((version >= R2010 && maintenance > 3) || version > R2013) r.RL();
  let t: BitReader = r;
  // The highest class number: entries stop there (the section's size leaves padding after them).
  let max = Infinity;
  if (version >= R2007) {
    const flagPos = r.pos + r.RL() - 1;
    const s = stringStream(r, flagPos);
    end = s?.pos ?? flagPos;
    t = s ?? r.clone(r.end);
    max = r.BL();
    r.B();
  }
  if (version === R2004) {
    max = r.BS();
    r.RC();
    r.RC();
    r.B();
  }
  const TV = () => (version >= R2007 ? (t.pos >= t.end ? '' : t.TV()) : r.TV());
  for (let i = 0; r.pos < end && i < 100_000; i++) {
    const num = r.BS();
    r.BS();
    TV();
    TV();
    const dxfName = TV();
    r.B();
    r.BS();
    if (version >= R2004) {
      r.BL();
      r.BL();
      r.BL();
      r.BL();
      r.BL();
    }
    out.set(num, dxfName);
    if (num >= max) break;
  }
  return out;
}

/** Handle -> byte offset of each object, from AcDb:Handles. */
function readHandleMap(data: Uint8Array | null, version: number): Map<number, number> {
  if (!data) throw new CadReadError('This DWG file is damaged (no object map).');
  const map = new Map<number, number>();
  const r = new BitReader(data, version);
  for (;;) {
    if (r.bytePos + 2 > data.length) break;
    const size = (data[r.bytePos]! << 8) | data[r.bytePos + 1]!;
    r.bytePos += 2;
    if (size <= 2) break;
    // Entries start while within 2032 bytes; the last one can run past that, and the CRC follows
    // wherever it ends (a section of size 2035 holds 2033 bytes of entries).
    const end = r.bytePos + Math.min(size - 2, 2032);
    let handle = 0;
    let loc = 0;
    while (r.bytePos < end) {
      const dh = r.MC();
      handle += dh;
      loc += r.MCs();
      if (dh > 0) map.set(handle, loc);
      if (map.size > MAX_OBJECTS) throw new CadReadError('This drawing is too large to convert.');
    }
    r.bytePos += 2;
  }
  return map;
}

export interface DwgReadResult {
  drawing: Drawing;
  /** Objects that could not be read, by type. */
  failed: Map<string, number>;
}

export function readDwg(bytes: Uint8Array): DwgReadResult {
  const file = openDwg(bytes);
  const { version, maintenance, decoder } = file;
  const headerData = file.section(SECTION.header);
  if (!headerData) throw new CadReadError('This DWG file is damaged (no header).');
  const header = readHeader(headerData, version, maintenance, decoder);
  const classes = readClasses(file.section(SECTION.classes), version, maintenance, decoder);
  const map = readHandleMap(file.section(SECTION.handles), version);
  const objects = file.objects();

  const recs = new Map<number, Rec>();
  const failed = new Map<string, number>();
  // Objects may not overlap much: a file whose map points many handles into one big object would
  // otherwise read it again and again. Real files read each bit about once.
  const budget = { bits: objects.length * 8 * 4 + 1_000_000 };
  const ctx = { version, classes, decoder, budget };
  const seen = new Set<number>();
  for (const [handle, offset] of map) {
    if (offset < 0 || offset >= objects.length || seen.has(offset)) continue;
    seen.add(offset);
    if (budget.bits < 0) throw new CadReadError('This DWG file is damaged.');
    try {
      const rec = readObject(objects, offset, ctx);
      if (rec && rec.kind === 'entity' && !rec.handle) rec.handle = handle;
      if (rec) recs.set(rec.handle || handle, rec);
    } catch (err) {
      if (!(err instanceof CadReadError) && !(err instanceof RangeError)) throw err;
      failed.set('object', (failed.get('object') ?? 0) + 1);
    }
  }
  return { drawing: assemble(recs, version, header), failed };
}

function assemble(recs: Map<number, Rec>, version: number, header: ReturnType<typeof readHeader>): Drawing {
  const objs = (type: string) => [...recs.values()].filter((r): r is ObjRec => r.kind === 'object' && r.type === type);
  const ents = [...recs.values()].filter((r): r is EntRec => r.kind === 'entity');
  const name = (h: number | undefined, type: string) => {
    const r = h ? recs.get(h) : undefined;
    return r && r.kind === 'object' && r.type === type ? String(r.data.name ?? '') : '';
  };

  const d: Drawing = {
    version: `AC${version}`,
    header: new Map<string, Groups>([
      ['$ACADVER', [[1, `AC${version}`]]],
      ['$INSUNITS', [[70, String(header.insunits)]]],
      ['$LTSCALE', [[40, String(header.ltscale)]]],
      ['$PSLTSCALE', [[70, header.psltscale ? '1' : '0']]],
      ['$TEXTSIZE', [[40, String(header.textsize)]]],
    ]),
    layers: new Map(),
    layerByHandle: new Map(),
    linetypes: new Map(),
    styles: new Map(),
    blocks: new Map(),
    blockByRecord: new Map(),
    layouts: [],
    modelSpace: [],
    byHandle: new Map(),
    imageDefs: new Map(),
    activeView: null,
  };

  for (const l of objs('LAYER')) {
    const c = l.data.color as { aci: number | null; rgb: number | null };
    const layer: Layer = {
      name: String(l.data.name),
      handle: hex(l.handle),
      color: c.aci && c.aci > 0 && c.aci < 256 ? c.aci : 7,
      trueColor: c.rgb ?? null,
      linetype: name(l.data.ltype as number, 'LTYPE') || 'CONTINUOUS',
      lineweight: l.data.lineweight as number,
      plot: !!l.data.plot,
      frozen: !!l.data.frozen,
      off: !!l.data.off,
    };
    d.layers.set(layer.name, layer);
    d.layerByHandle.set(layer.handle, layer.name);
  }
  for (const t of objs('LTYPE')) d.linetypes.set(String(t.data.name).toUpperCase(), { name: String(t.data.name), pattern: t.data.pattern as number[] });
  for (const s of objs('STYLE')) {
    const n = String(s.data.name);
    if (!n) continue;
    d.styles.set(n.toUpperCase(), {
      name: n,
      font: String(s.data.font ?? ''),
      bigFont: String(s.data.bigFont ?? ''),
      family: '',
      height: Number(s.data.height) || 0,
      widthFactor: Number(s.data.width) || 1,
      oblique: ((Number(s.data.oblique) || 0) * 180) / Math.PI,
      generation: Number(s.data.generation) || 0,
    });
  }
  for (const i of objs('IMAGEDEF')) d.imageDefs.set(hex(i.handle), { path: String(i.data.path ?? '') });
  const active = objs('VPORT').find((v) => String(v.data.name).toUpperCase() === '*ACTIVE');
  if (active) {
    const t = (active.data.target as number[]) ?? [0, 0];
    d.activeView = { twist: ((Number(active.data.twist) || 0) * 180) / Math.PI, target: [t[0] ?? 0, t[1] ?? 0] };
  }

  // Entities in the Drawing's form.
  const converted = new Map<number, Entity>();
  const toEntity = (r: EntRec): Entity => {
    let e = converted.get(r.handle);
    if (e) return e;
    const g: Groups = r.g.slice();
    let type = r.type;
    if (type === 'POLYLINE_2D' || type === 'POLYLINE_3D') type = 'POLYLINE';
    else if (type === 'POLYLINE_PFACE' || type === 'POLYLINE_MESH') {
      g.push([70, type === 'POLYLINE_PFACE' ? '64' : '16']);
      type = 'POLYLINE';
    } else if (type.startsWith('VERTEX')) type = 'VERTEX';
    if (r.refs.style !== undefined && ['TEXT', 'ATTRIB', 'ATTDEF', 'MTEXT'].includes(type)) g.push([7, name(r.refs.style, 'STYLE') || 'STANDARD']);
    if (r.refs.block !== undefined) g.push([2, blockName(r.refs.block)]);
    if (r.refs.imageDef) g.push([340, hex(r.refs.imageDef)]);
    if (type === 'VIEWPORT') {
      for (const f of r.refs.frozen ?? []) g.push([331, hex(f)]);
      if (r.refs.boundary) g.push([340, hex(r.refs.boundary)]);
    }
    const layer = d.layerByHandle.get(hex(r.layer)) ?? '0';
    e = {
      type,
      handle: hex(r.handle),
      owner: '',
      layer,
      color: r.color.aci ?? 256,
      trueColor: r.color.aci === null ? r.color.rgb : null,
      linetype: r.ltFlags === 0 ? 'BYLAYER' : r.ltFlags === 1 ? 'BYBLOCK' : r.ltFlags === 2 ? 'CONTINUOUS' : name(r.ltype, 'LTYPE') || 'BYLAYER',
      ltscale: r.ltscale,
      lineweight: r.lineweight,
      paperSpace: r.mode === 1,
      invisible: r.invisible,
      extrusion: r.extrusion,
      g,
      children: [],
    };
    converted.set(r.handle, e);
    d.byHandle.set(e.handle, e);
    const kids = r.refs.owned || r.refs.first || byOwner.has(r.handle) ? ordered(r.refs.owned, r.refs.first, r.refs.last, byOwner.get(r.handle) ?? []) : [];
    e.children = kids.filter((k) => k.type.startsWith('VERTEX') || k.type === 'ATTRIB').map(toEntity);
    return e;
  };

  const byOwner = new Map<number, EntRec[]>();
  const bySpace = new Map<number, EntRec[]>();
  for (const r of ents) {
    if (r.mode !== 0) {
      const list = bySpace.get(r.mode) ?? [];
      list.push(r);
      bySpace.set(r.mode, list);
      continue;
    }
    const list = byOwner.get(r.owner) ?? [];
    list.push(r);
    byOwner.set(r.owner, list);
  }
  /** Entities in drawing order: the owned list (R2004+), the first-to-last chain (R2000), then any others. */
  function ordered(owned: number[] | undefined, first: number | undefined, last: number | undefined, candidates: readonly EntRec[]): EntRec[] {
    const out: EntRec[] = [];
    const seen = new Set<number>();
    const add = (h: number) => {
      const r = recs.get(h);
      if (r && r.kind === 'entity' && !seen.has(h)) {
        seen.add(h);
        out.push(r);
      }
    };
    if (owned) owned.forEach(add);
    else if (first) {
      for (let h = first, i = 0; h && i < MAX_OBJECTS; i++) {
        const r = recs.get(h);
        if (!r || r.kind !== 'entity' || seen.has(h)) break;
        add(h);
        if (h === last) break;
        h = r.next;
      }
    }
    const rest = candidates.filter((r) => !seen.has(r.handle)).sort((a, b) => a.handle - b.handle);
    for (const r of rest) {
      if (!seen.has(r.handle)) {
        seen.add(r.handle);
        out.push(r);
      }
    }
    return out;
  }

  const headers = objs('BLOCK_HEADER');
  const blockEntityName = (h: ObjRec) => {
    const b = recs.get(h.data.block as number);
    return (b && b.kind === 'entity' && b.name) || String(h.data.name ?? '');
  };
  function blockName(h: number): string {
    const r = recs.get(h);
    return r && r.kind === 'object' && r.type === 'BLOCK_HEADER' ? blockEntityName(r) : '';
  }
  const SKIP = new Set(['BLOCK', 'ENDBLK', 'SEQEND', 'ATTRIB', 'VERTEX_2D', 'VERTEX_3D', 'VERTEX_MESH', 'VERTEX_PFACE', 'VERTEX_PFACE_FACE']);
  for (const h of headers) {
    const bname = blockEntityName(h);
    const upper = bname.toUpperCase();
    const space = upper === '*MODEL_SPACE' ? 2 : upper === '*PAPER_SPACE' ? 1 : 0;
    const candidates = [...(byOwner.get(h.handle) ?? []), ...(space ? (bySpace.get(space) ?? []) : [])];
    const list = ordered(h.data.owned as number[] | undefined, h.data.first as number | undefined, h.data.last as number | undefined, candidates).filter((r) => !SKIP.has(r.type));
    const base = (h.data.base as number[] | undefined) ?? [0, 0];
    const block: Block = {
      name: bname,
      record: hex(h.handle),
      base: [base[0] ?? 0, base[1] ?? 0],
      flags: h.data.xref ? 4 : 0,
      xrefPath: String(h.data.xrefPath ?? ''),
      entities: list.map(toEntity),
    };
    for (const e of block.entities) e.owner = block.record;
    d.blocks.set(upper, block);
    d.blockByRecord.set(block.record, block);
    if (space === 2) d.modelSpace = block.entities;
  }

  for (const l of objs('LAYOUT')) {
    const nameOf = String(l.data.name ?? '');
    const margins = (l.data.margins as number[]) ?? [0, 0, 0, 0];
    const origin = (l.data.origin as number[]) ?? [0, 0];
    const num = Number(l.data.numerator) || 1;
    const den = Number(l.data.denominator) || 1;
    const layout: Layout = {
      name: nameOf,
      tabOrder: Number(l.data.tabOrder) || 0,
      record: hex(Number(l.data.block) || 0),
      paperWidth: Number(l.data.paperWidth) || 0,
      paperHeight: Number(l.data.paperHeight) || 0,
      margins: [margins[0] ?? 0, margins[1] ?? 0, margins[2] ?? 0, margins[3] ?? 0],
      origin: [origin[0] ?? 0, origin[1] ?? 0],
      mm: Number(l.data.units) === 1,
      rotation: (Number(l.data.rotation) || 0) & 3,
      printScale: num > 0 && den > 0 ? num / den : 1,
      isModel: nameOf.toUpperCase() === 'MODEL',
      styleSheet: String(l.data.styleSheet ?? ''),
    };
    d.layouts.push(layout);
    // The first viewport of a layout is its overall paper viewport (DXF id 1).
    const block = d.blockByRecord.get(layout.record);
    let id = 0;
    for (const e of block?.entities ?? []) if (e.type === 'VIEWPORT') e.g.push([69, String(++id)]);
  }
  d.layouts.sort((a, b) => a.tabOrder - b.tabOrder);

  const declare = (list: Entity[]) => {
    for (const e of list) {
      for (const x of [e, ...e.children]) if (!d.layers.has(x.layer)) d.layers.set(x.layer, { name: x.layer, handle: '', color: 7, trueColor: null, linetype: 'CONTINUOUS', lineweight: -3, plot: true, frozen: false, off: false });
    }
  };
  for (const b of d.blocks.values()) declare(b.entities);
  if (!d.layers.has('0')) d.layers.set('0', { name: '0', handle: '', color: 7, trueColor: null, linetype: 'CONTINUOUS', lineweight: -3, plot: true, frozen: false, off: false });
  return d;
}
