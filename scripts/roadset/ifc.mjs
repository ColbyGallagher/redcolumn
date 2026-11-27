#!/usr/bin/env node
// A synthetic IFC4X3 model of the fictional Kestrel Road demo set (scripts/roadset), for the 3D
// viewer and its tests. Everything here is made up: the road, its names and its levels.
//
//   node scripts/roadset/ifc.mjs [out-dir]     writes kestrel-road-revA.ifc and kestrel-road-revB.ifc
//                                              (default docs/demo-sets)
//
// The geometry is geom.py's, ported: the MC00 and MC01 control lines (tangents and circular arcs),
// MC00's vertical alignment and crossfall. It is georeferenced the way the sheets are: model x and
// y are the set's world metres (x east, y north), and an IfcMapConversion puts the world origin at
// MGA zone 56 E 318 250, N 6 246 900 (GDA2020). Model z is height above 10 m AHD, so the
// conversion's OrthogonalHeight is 10.
//
// Revision B changes a few elements of revision A (see CHANGES) for version-compare tests.
// Element GlobalIds come from their names, so an element keeps its id across revisions.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const E0 = 318250;
export const N0 = 6246900;
/** Model z = 0 is this level (m AHD). */
export const DATUM = 10;
export const EPSG = 7856;

// ---- Horizontal alignments (geom.py's Alignment) ---------------------------------------------

/** Tangents ("S", length) and circular arcs ("C", radius, turn +1 right / -1 left, delta in degrees). */
class Alignment {
  constructor(name, start, bearingDeg, elems) {
    this.name = name;
    this.els = [];
    let [x, y] = start;
    let b = (bearingDeg * Math.PI) / 180;
    let s = 0;
    for (const e of elems) {
      const el = { kind: e[0], s0: s, x0: x, y0: y, b0: b, R: 0, k: 0, turn: 0 };
      let length;
      if (e[0] === 'S') {
        length = e[1];
        x += length * Math.sin(b);
        y += length * Math.cos(b);
      } else {
        const [, R, turn, delta] = e;
        length = R * ((delta * Math.PI) / 180);
        const k = turn / R;
        const b1 = b + turn * ((delta * Math.PI) / 180);
        x += (Math.cos(b) - Math.cos(b1)) / k;
        y += (Math.sin(b1) - Math.sin(b)) / k;
        b = b1;
        Object.assign(el, { R, k, turn });
      }
      s += length;
      Object.assign(el, { s1: s, length });
      this.els.push(el);
    }
    this.length = s;
  }

  /** Point and bearing (radians clockwise from north) at chainage s. */
  at(s) {
    s = Math.max(0, Math.min(this.length, s));
    const e = this.els.findLast((el) => el.s0 <= s) ?? this.els[0];
    const d = s - e.s0;
    if (e.kind === 'S') return [e.x0 + d * Math.sin(e.b0), e.y0 + d * Math.cos(e.b0), e.b0];
    const b = e.b0 + e.k * d;
    return [e.x0 + (Math.cos(e.b0) - Math.cos(b)) / e.k, e.y0 + (Math.sin(b) - Math.sin(e.b0)) / e.k, b];
  }

  /** The point `off` metres right of the line at chainage s. */
  pt(s, off = 0) {
    const [x, y, b] = this.at(s);
    return [x + off * Math.cos(b), y - off * Math.sin(b)];
  }
}

const ARC = (140 * Math.PI) / 2;
export const MC00 = new Alignment('MC00', [60, 445], 90, [
  ['S', 330],
  ['C', 140, +1, 90],
  ['S', 35],
  ['C', 140, -1, 90],
  ['S', 1040 - (330 + 35 + 2 * ARC)],
]);
const JUNCTION_CH = 110;
const [jx, jy] = MC00.at(JUNCTION_CH);
export const MC01 = new Alignment('MC01', [jx, jy], 180, [
  ['S', 60],
  ['C', 120, -1, 35],
  ['S', 20],
]);

// ---- Vertical alignments (geom.py's Vertical) ------------------------------------------------

class Vertical {
  /** pvis: [chainage, RL, vertical curve length]. */
  constructor(pvis) {
    this.pvis = pvis;
    this.grades = pvis.slice(1).map((p, i) => (p[1] - pvis[i][1]) / (p[0] - pvis[i][0]));
    this.curves = [];
    for (let i = 1; i < pvis.length - 1; i++) {
      const [s, rl, L] = pvis[i];
      if (L > 0) this.curves.push({ rl, L, g1: this.grades[i - 1], g2: this.grades[i], vs: s - L / 2, ve: s + L / 2 });
    }
  }

  level(s) {
    for (const c of this.curves) {
      if (c.vs <= s && s <= c.ve) {
        const x = s - c.vs;
        return c.rl - (c.g1 * c.L) / 2 + c.g1 * x + ((c.g2 - c.g1) * x * x) / (2 * c.L);
      }
    }
    let i = this.grades.findIndex((_, k) => s <= this.pvis[k + 1][0]);
    if (i < 0) i = this.grades.length - 1;
    const [s0, r0] = this.pvis[i];
    return r0 + this.grades[i] * (s - s0);
  }
}

const groundBase = (x, y) => 12.4 + 3 * Math.sin(x / 95 + 0.6) + 1.6 * Math.cos(y / 70 - 0.3) + Math.sin((x + y) / 45) - 0.0028 * (y - 300);
function smoothBase(al, s, half = 30) {
  let sum = 0;
  for (let k = -6; k <= 6; k++) {
    const [x, y] = al.at(Math.max(0, Math.min(al.length, s + (half * k) / 6)));
    sum += groundBase(x, y);
  }
  return sum / 13;
}
const round3 = (v) => Math.round(v * 1000) / 1000;
const V00_ST = [0, 110, 220, 330, 440, 540, 640, 740, 840, 940, 1040];
const V00_L = [0, 70, 80, 90, 90, 90, 90, 90, 90, 80, 0];
const V00_BIAS = [0.15, -0.2, 0.25, -0.1, 0.2, 0.15, -0.15, 0.2, 0.35, 0.1, 0.1];
export const V00 = new Vertical(V00_ST.map((s, i) => [s, round3(smoothBase(MC00, s) + V00_BIAS[i]), V00_L[i]]));
const R01 = V00.level(JUNCTION_CH) - 0.12;
export const V01 = new Vertical([
  [0, R01, 0],
  [45, R01 - 1.1, 40],
  [MC01.length, R01 - 4.2, 0],
]);

const CROSSFALL = [
  [-1e9, -0.03, -0.03],
  [270, -0.03, -0.03],
  [340, 0.04, -0.04],
  [530, 0.04, -0.04],
  [600, -0.04, 0.04],
  [790, -0.04, 0.04],
  [840, -0.03, -0.03],
  [1e9, -0.03, -0.03],
];
/** Left and right crossfall (outward from the crown) at an MC00 chainage. */
function crossfall(s) {
  for (let i = 0; i < CROSSFALL.length - 1; i++) {
    const [s0, l0, r0] = CROSSFALL[i];
    const [s1, l1, r1] = CROSSFALL[i + 1];
    if (s0 <= s && s <= s1) {
      const t = s1 === s0 ? 0 : (s - s0) / (s1 - s0);
      return [l0 + (l1 - l0) * t, r0 + (r1 - r0) * t];
    }
  }
  return [-0.03, -0.03];
}

/** Finished surface level (m AHD) at an offset from a control line. */
function surface(al, s, off) {
  const rl = (al === MC00 ? V00 : V01).level(s);
  const [l, r] = al === MC00 ? crossfall(s) : [-0.03, -0.03];
  return rl + (off < 0 ? l : r) * Math.abs(off);
}

// ---- The road's elements ---------------------------------------------------------------------

const HALF_W = 7;
const KERB_W = 0.45;
const SIDE_HALF = 4.5;
const JB = [97.5, 122.5]; // MC00 chainages the side road's kerb returns cut out of the right kerb
const CHUNK = 40;
const WEARING = 0.05;
const BASE = 0.4;

/** Chainage ranges [a, b] of [s0, s1] split at multiples of CHUNK. */
function chunks(s0, s1) {
  const out = [];
  for (let a = s0; a < s1 - 0.5; ) {
    const b = Math.min(s1, (Math.floor(a / CHUNK + 1e-9) + 1) * CHUNK);
    out.push([a, b]);
    a = b;
  }
  return out;
}

/**
 * A solid swept along a control line: at each station, a cross-section of `top` offsets at
 * surface level plus `lift`, down to `depth` below. Points are world metres and m AHD.
 */
function sweep(al, s0, s1, top, lift, depth, step = 5) {
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  const sections = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const up = top.map((o) => {
      const [x, y] = al.pt(s, o);
      return [x, y, surface(al, s, Math.sign(o) * Math.min(Math.abs(o), al === MC00 ? HALF_W : SIDE_HALF)) + lift];
    });
    sections.push([...up, ...up.map(([x, y, z]) => [x, y, z - depth]).reverse()]);
  }
  return sections;
}

/** Every element of a revision: name, IFC type, level, sections, properties and quantities. */
function elements(rev) {
  const out = [];
  const name = (kind, al, a, b, side = '') => `${kind} ${al.name}${side} CH${a.toFixed(0)}-${b.toFixed(0)}`;
  for (const al of [MC00, MC01]) {
    const half = al === MC00 ? HALF_W : SIDE_HALF;
    const start = al === MC00 ? 0 : HALF_W;
    for (const [a, b] of chunks(start, al.length)) {
      const props = { Alignment: al.name, ChainageStart: a, ChainageEnd: b };
      out.push({
        name: name('Wearing course', al, a, b),
        type: 'IFCPAVEMENT',
        enumType: '.FLEXIBLE.',
        level: 0,
        sections: sweep(al, a, b, [-half, 0, half], 0, WEARING),
        props: { ...props, Material: 'AC14 asphalt', Thickness: WEARING },
        qty: { length: b - a, width: 2 * half, depth: WEARING },
      });
      // Revision B thickens one stretch of base course.
      const thick = rev === 'B' && al === MC00 && a === 400 ? 0.5 : BASE;
      out.push({
        name: name('Base course', al, a, b),
        type: 'IFCCOURSE',
        enumType: '.PAVEMENT.',
        level: 1,
        sections: sweep(al, a, b, [-half, 0, half], -WEARING, thick),
        props: { ...props, Material: 'DGB20 crushed rock', Thickness: thick },
        qty: { length: b - a, width: 2 * half, depth: thick },
      });
    }
  }
  // Kerbs along MC00, both sides; the right one stops at the side road.
  for (const [side, inner, ranges] of [
    [' left', -HALF_W, [[0, MC00.length]]],
    [' right', HALF_W, [[0, JB[0]], [JB[1], MC00.length]]],
  ]) {
    const off = [inner, inner + Math.sign(inner) * KERB_W].sort((p, q) => p - q);
    for (const [r0, r1] of ranges) {
      for (const [a, b] of chunks(r0, r1)) {
        const nm = name('Kerb', MC00, a, b, side);
        // Revision B removes a stretch for a driveway crossing and one where the bus bay goes.
        if (rev === 'B' && side === ' right' && (a === 360 || a === 600)) continue;
        const kerbType = rev === 'B' && side === ' left' && a === 200 ? 'Semi-mountable' : 'Barrier';
        out.push({
          name: nm,
          type: 'IFCKERB',
          enumType: '.NOTDEFINED.',
          level: 0,
          sections: sweep(MC00, a, b, off, 0.15, 0.45),
          props: { Alignment: 'MC00', ChainageStart: a, ChainageEnd: b, KerbType: kerbType, Height: 0.15 },
          qty: { length: b - a, width: KERB_W, depth: 0.45 },
        });
      }
    }
  }
  if (rev === 'B') {
    // A bus bay on the right of MC00, CH 600-640, with its own kerb further out.
    out.push({
      name: 'Bus bay MC00 right CH600-640',
      type: 'IFCPAVEMENT',
      enumType: '.FLEXIBLE.',
      level: 0,
      sections: sweep(MC00, 600, 640, [HALF_W, HALF_W + 3], 0, WEARING + BASE),
      props: { Alignment: 'MC00', ChainageStart: 600, ChainageEnd: 640, Material: 'AC14 asphalt on DGB20', Thickness: WEARING + BASE },
      qty: { length: 40, width: 3, depth: WEARING + BASE },
    });
    out.push({
      name: 'Kerb MC00 bus bay CH600-640',
      type: 'IFCKERB',
      enumType: '.NOTDEFINED.',
      level: 0,
      sections: sweep(MC00, 600, 640, [HALF_W + 3, HALF_W + 3 + KERB_W], 0.15, 0.45),
      props: { Alignment: 'MC00', ChainageStart: 600, ChainageEnd: 640, KerbType: 'Barrier', Height: 0.15 },
      qty: { length: 40, width: KERB_W, depth: 0.45 },
    });
  }
  return out;
}

/** What revision B changes, by element name. */
export const CHANGES = {
  added: ['Bus bay MC00 right CH600-640', 'Kerb MC00 bus bay CH600-640'],
  removed: ['Kerb MC00 right CH360-400', 'Kerb MC00 right CH600-640'],
  /** Base course thickened (geometry); kerb type changed (properties only). */
  changed: ['Base course MC00 CH400-440', 'Kerb MC00 left CH200-240'],
};

/** The two levels (IfcRoadPart), at these RLs (m AHD): surface course and base course. */
export const LEVELS = [
  { name: 'Surface course', rl: 12 },
  { name: 'Base course', rl: 11.5 },
];

// ---- STEP writing ----------------------------------------------------------------------------

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
/** A stable IFC GlobalId (22 characters) for a name. */
export function guid(name) {
  let n = BigInt('0x' + createHash('sha256').update(`kestrel-road/${name}`).digest('hex').slice(0, 32));
  let out = '';
  for (let i = 0; i < 22; i++) {
    out = B64[Number(n & 63n)] + out;
    n >>= 6n;
  }
  return out;
}

/** A STEP real. */
function r(v) {
  const x = Math.round(v * 1e4) / 1e4;
  const s = String(Object.is(x, -0) ? 0 : x);
  return /[.e]/.test(s) ? s : `${s}.`;
}
const q = (s) => `'${s.replace(/'/g, "''")}'`;

/** The model of a revision, as IFC4X3 STEP text. */
export function kestrelIfc(rev = 'A') {
  const lines = [];
  let next = 1;
  const add = (body) => {
    const id = next++;
    lines.push(`#${id}=${body};`);
    return `#${id}`;
  };
  const point = (p) => add(`IFCCARTESIANPOINT((${p.map(r).join(',')}))`);
  const origin = point([0, 0, 0]);
  const placement3 = (o = origin) => add(`IFCAXIS2PLACEMENT3D(${o},$,$)`);

  const metre = add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const radian = add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const units = add(`IFCUNITASSIGNMENT((${metre},${radian}))`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${placement3()},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const project = add(`IFCPROJECT(${q(guid('project'))},$,'Kestrel Road Upgrade Stage 2',${q(`Synthetic demo model, revision ${rev}`)},$,$,$,(${ctx}),${units})`);
  const crs = add(`IFCPROJECTEDCRS('EPSG:${EPSG}','GDA2020 / MGA zone 56','GDA2020','AHD','MGA','56',${metre})`);
  add(`IFCMAPCONVERSION(${ctx},${crs},${r(E0)},${r(N0)},${r(DATUM)},1.,0.,1.)`);

  const sitePl = add(`IFCLOCALPLACEMENT($,${placement3()})`);
  const site = add(`IFCSITE(${q(guid('site'))},$,'Kestrel Road site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const roadPl = add(`IFCLOCALPLACEMENT(${sitePl},${placement3()})`);
  const road = add(`IFCROAD(${q(guid('road'))},$,'Kestrel Road',$,$,${roadPl},$,'Kestrel Road Upgrade Stage 2',.ELEMENT.,.NOTDEFINED.)`);
  add(`IFCRELAGGREGATES(${q(guid('rel project'))},$,$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES(${q(guid('rel site'))},$,$,$,${site},(${road}))`);

  // Levels: road parts whose placements sit at their RLs; their elements are placed in them.
  const levels = LEVELS.map((lv) => {
    const z = lv.rl - DATUM;
    const pl = add(`IFCLOCALPLACEMENT(${roadPl},${placement3(point([0, 0, z]))})`);
    const id = add(`IFCROADPART(${q(guid(`level ${lv.name}`))},$,${q(lv.name)},${q(`RL ${lv.rl.toFixed(3)}`)},$,${pl},$,$,.ELEMENT.,.LONGITUDINAL.,.CARRIAGEWAY.)`);
    return { ...lv, z, pl, id, members: [] };
  });
  add(`IFCRELAGGREGATES(${q(guid('rel road'))},$,$,$,${road},(${levels.map((l) => l.id).join(',')}))`);

  // Alignments: horizontal segments as design parameters.
  const alignments = [];
  for (const al of [MC00, MC01]) {
    const pl = add(`IFCLOCALPLACEMENT(${roadPl},${placement3()})`);
    const id = add(`IFCALIGNMENT(${q(guid(`alignment ${al.name}`))},$,${q(al.name)},'Control line',$,${pl},$,.NOTDEFINED.)`);
    const horiz = add(`IFCALIGNMENTHORIZONTAL(${q(guid(`alignment ${al.name} horizontal`))},$,$,$,$,$,$)`);
    const segs = al.els.map((el, i) => {
      const start = add(`IFCCARTESIANPOINT((${r(el.x0)},${r(el.y0)}))`);
      // IFC directions run counter-clockwise from x; positive radii turn left.
      const dir = Math.PI / 2 - el.b0;
      const radius = el.kind === 'C' ? -el.turn * el.R : 0;
      const type = el.kind === 'C' ? '.CIRCULARARC.' : '.LINE.';
      const params = add(`IFCALIGNMENTHORIZONTALSEGMENT($,$,${start},${r(dir)},${r(radius)},${r(radius)},${r(el.length)},$,${type})`);
      return add(`IFCALIGNMENTSEGMENT(${q(guid(`alignment ${al.name} segment ${i}`))},$,$,$,$,${pl},$,${params})`);
    });
    add(`IFCRELNESTS(${q(guid(`rel ${al.name}`))},$,$,$,${id},(${horiz}))`);
    add(`IFCRELNESTS(${q(guid(`rel ${al.name} horizontal`))},$,$,$,${horiz},(${segs.join(',')}))`);
    alignments.push(id);
  }
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${q(guid('rel road contents'))},$,$,$,(${alignments.join(',')}),${road})`);

  // Elements: closed triangulated solids, in their level's coordinates.
  for (const el of elements(rev)) {
    const level = levels[el.level];
    const k = el.sections[0].length;
    const pts = el.sections.flatMap((sec) => sec.map(([x, y, z]) => [x, y, z - DATUM - level.z]));
    const tris = [];
    const at = (i, j) => i * k + j + 1;
    for (let i = 0; i < el.sections.length - 1; i++) {
      for (let j = 0; j < k; j++) {
        const j1 = (j + 1) % k;
        tris.push([at(i, j), at(i + 1, j), at(i + 1, j1)], [at(i, j), at(i + 1, j1), at(i, j1)]);
      }
    }
    // End caps: quads between the top and bottom of each section.
    const half = k / 2;
    for (const [i, flip] of [
      [0, true],
      [el.sections.length - 1, false],
    ]) {
      for (let j = 0; j < half - 1; j++) {
        const quad = [at(i, j), at(i, j + 1), at(i, k - 2 - j), at(i, k - 1 - j)];
        const [a, b, c, d] = flip ? quad.reverse() : quad;
        tris.push([a, b, c], [a, c, d]);
      }
    }
    const list = add(`IFCCARTESIANPOINTLIST3D((${pts.map((p) => `(${p.map(r).join(',')})`).join(',')}),$)`);
    const faces = add(`IFCTRIANGULATEDFACESET(${list},$,.T.,(${tris.map((t) => `(${t.join(',')})`).join(',')}),$)`);
    const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${faces}))`);
    const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    const pl = add(`IFCLOCALPLACEMENT(${level.pl},${placement3()})`);
    const id = add(`${el.type}(${q(guid(el.name))},$,${q(el.name)},$,$,${pl},${shape},$,${el.enumType})`);
    level.members.push(id);
    const props = Object.entries(el.props).map(([key, v]) =>
      add(`IFCPROPERTYSINGLEVALUE(${q(key)},$,${typeof v === 'number' ? `IFCLENGTHMEASURE(${r(v)})` : `IFCLABEL(${q(v)})`},$)`),
    );
    const pset = add(`IFCPROPERTYSET(${q(guid(`pset ${el.name}`))},$,'Kestrel_Element',$,(${props.join(',')}))`);
    add(`IFCRELDEFINESBYPROPERTIES(${q(guid(`rel pset ${el.name}`))},$,$,$,(${id}),${pset})`);
    // Quantities: along the control line, plan area and solid volume (for the quantities table).
    const { length, width, depth } = el.qty;
    const qtys = [
      add(`IFCQUANTITYLENGTH('Length',$,$,${r(length)},$)`),
      add(`IFCQUANTITYLENGTH('Width',$,$,${r(width)},$)`),
      add(`IFCQUANTITYAREA('NetArea',$,$,${r(length * width)},$)`),
      add(`IFCQUANTITYVOLUME('NetVolume',$,$,${r(length * width * depth)},$)`),
    ];
    const qto = add(`IFCELEMENTQUANTITY(${q(guid(`qto ${el.name}`))},$,'Qto_KestrelQuantities',$,$,(${qtys.join(',')}))`);
    add(`IFCRELDEFINESBYPROPERTIES(${q(guid(`rel qto ${el.name}`))},$,$,$,(${id}),${qto})`);
  }
  for (const lv of levels) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${q(guid(`rel level ${lv.name}`))},$,$,$,(${lv.members.join(',')}),${lv.id})`);

  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [Reference View]'),'2;1');",
    `FILE_NAME('kestrel-road-rev${rev}.ifc','2026-11-22T00:00:00',(''),(''),'redcolumn roadset generator','redcolumn','');`,
    "FILE_SCHEMA(('IFC4X3_ADD2'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? fileURLToPath(new URL('../../docs/demo-sets', import.meta.url));
  mkdirSync(dir, { recursive: true });
  for (const rev of ['A', 'B']) {
    const file = join(dir, `kestrel-road-rev${rev}.ifc`);
    writeFileSync(file, kestrelIfc(rev));
    console.log(file);
  }
}
