import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { readPdfExtras } from '@nb/markup/pdfExtras';
import { importViewports } from '../../../../packages/markup/src/bluebeam';
import { convertCad } from './convert';
import { CadReadError, readDxf } from './dxf';
import { num, type Groups } from './drawing';
import { arcCmds, arcInterval, type Cmd } from './geom';
import { writePdf } from './pdf';
import { readHatch } from './render';
import { planSheets } from './sheets';
import { mtextHeightRuns } from './text';

// Original synthetic regression data; no externally licensed CAD files required.
const fonts = Object.fromEntries(['sans', 'serif', 'mono'].map((key, i) => [key,
  new Uint8Array(readFileSync(new URL(`../../public/fonts/Liberation${['Sans', 'Serif', 'Mono'][i]}-Regular.ttf`, import.meta.url))),
])) as Record<'sans' | 'serif' | 'mono', Uint8Array>;
const dxf = (entities: (string | number)[], tables: (string | number)[] = []) => new TextEncoder().encode([
  0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC',
  0, 'SECTION', 2, 'TABLES', ...tables, 0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES', ...entities, 0, 'ENDSEC', 0, 'EOF', '',
].join('\n'));
const frame = [0, 'LINE', 10, 0, 20, 0, 11, 100, 21, 100];
const opts = { colorMode: 'color' as const, lineweights: true };

test('horizontal and vertical model lines have valid sheets with stroke clearance', async () => {
  for (const [x, y] of [[100, 0], [0, 100]]) {
    const { pdf, report } = await convertCad('line.dxf', dxf([0, 'LINE', 10, 0, 20, 0, 11, x!, 21, y!]), { fonts });
    const page = (await PDFDocument.load(pdf)).getPage(0);
    assert.ok(page.getWidth() > 2 && page.getHeight() > 2);
    assert.equal(report.pages[0]!.scale, '1:1');
    assert.ok(!report.warnings.some(w => w.kind === 'unsupported'));
  }
});

test('DXF rejects non-finite numbers but keeps numeric-looking TEXT and color names', () => {
  for (const bad of ['Infinity', '-Infinity', 'NaN'])
    assert.throws(() => readDxf(dxf([0, 'ARC', 10, 0, 20, 0, 40, 10, 50, bad, 51, 90])), CadReadError);
  const d = readDxf(dxf([0, 'TEXT', 1, 'Infinity', 430, 'Color book name', 40, 3, 10, 0, 20, 0]));
  assert.equal(d.modelSpace[0]!.g.find(([c]) => c === 1)?.[1], 'Infinity');
});

test('directed arc intervals are bounded for huge finite angles and reject invalid geometry', () => {
  for (const ccw of [true, false]) for (const [a, b] of [[1e300, -1e300], [-1e300, 1e300], [0, 0]]) {
    const [start, end] = arcInterval(a!, b!, ccw);
    assert.ok(Number.isFinite(start) && Math.abs(end - start) <= 2 * Math.PI + 1e-12);
    assert.ok(ccw ? end > start : end < start);
    assert.ok(arcCmds([1, 0, 0, 1, 0, 0], start, end, true).length <= 5);
  }
  assert.throws(() => arcInterval(Infinity, 0), /angle/);
  assert.throws(() => arcCmds([1, 0, 0, 1, 0, 0], 0, Infinity, true), /geometry/);
});

const hatch = (style: number): Groups => {
  const groups: Groups = [[70, '1'], [91, '3']];
  for (const [flag, a, b] of [[3, 0, 100], [18, 20, 80], [2, 40, 60]]) {
    groups.push([92, String(flag)], [72, '0'], [73, '1'], [93, '4']);
    for (const [x, y] of [[a, a], [b, a], [b, b], [a, b]]) groups.push([10, String(x)], [20, String(y)]);
  }
  groups.push([75, String(style)]); return groups;
};
const inside = (loops: Cmd[][], x: number, y: number) => {
  let result = false;
  for (const loop of loops) {
    const p = loop.filter(c => c[0] === 'M' || c[0] === 'L') as ['M' | 'L', number, number][];
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[i]!, b = p[j]!;
      if ((a[2] > y) !== (b[2] > y) && x < (b[1] - a[1]) * (y - a[2]) / (b[2] - a[2]) + a[1]) result = !result;
    }
  }
  return result;
};
test('hatch island styles select the correct paths before solid fill or pattern clipping', () => {
  for (const [style, count, center, hole] of [[0, 3, true, false], [1, 2, false, false], [2, 1, true, true]] as const) {
    const data = readHatch(hatch(style));
    assert.equal(data.loops.length, count);
    assert.equal(inside(data.loops, 50, 50), center);
    assert.equal(inside(data.loops, 30, 30), hole);
    assert.equal(inside(data.loops, 10, 10), true);
  }
});

test('a near-standard viewport retains exact calibration through the viewer PDF reader', async () => {
  const drawing = readDxf(new Uint8Array(readFileSync(new URL('../../test/fixtures/cad/kestrel-plan.dxf', import.meta.url))));
  const layout = drawing.layouts.find(l => l.name === 'C-101 PLAN')!;
  const viewport = drawing.blockByRecord.get(layout.record)!.entities.find(e => e.type === 'VIEWPORT' && num(e.g, 69) !== 1)!;
  const viewHeight = num(viewport.g, 41) * 499.2 / 1000;
  viewport.g.find(([code]) => code === 45)![1] = String(viewHeight);
  const { sheets } = planSheets(drawing, opts);
  const scale = sheets[0]!.viewports[0]!.scale;
  assert.ok(Math.abs(scale.ratio - 499.2) < 1e-9);
  assert.equal(scale.label, '1:499.2');
  assert.equal(scale.standard, false);
  const pdf = await writePdf(sheets, fonts, { title: 'Exact calibration', source: 'original synthetic viewport edit' });
  const extras = await readPdfExtras(pdf); assert.ok(extras);
  const actual = importViewports(0, extras.pages[0]!).viewports[0]!.scale.metersPerPoint;
  assert.ok(Math.abs(actual - 499.2 * .0254 / 72) < 1e-12);
});

test('model-space wrapping outside estimated bounds fails instead of cropping text', async () => {
  const text = [0, 'MTEXT', 10, 10, 20, 90, 40, 3, 41, 12, 71, 1, 1,
    'This paragraph wraps into several lines and must never be silently cropped by the model page.'];
  await assert.rejects(convertCad('wrapped.dxf', dxf(text), { fonts }), /Model-space MTEXT exceeds/);
  const result = await convertCad('wrapped-in-frame.dxf', dxf([...frame, ...text]), { fonts });
  assert.ok(result.pdf.length > 1000);
});

test('DXF leaders draw scaled closed-filled arrowheads and report unavailable styles', () => {
  const leader = [0, 'LEADER', 3, 'CLOSED', 10, 10, 20, 10, 10, 20, 20, 10];
  const style = [0, 'DIMSTYLE', 2, 'CLOSED', 40, 2, 41, 3];
  const planned = planSheets(readDxf(dxf([...frame, ...leader], style)), opts);
  const fill = planned.sheets[0]!.prims.find(p => p.k === 'fill'); assert.ok(fill && fill.k === 'fill');
  const points = fill.d.filter(c => c[0] === 'M' || c[0] === 'L') as ['M' | 'L', number, number][];
  const pt = 72 / 25.4;
  assert.ok(Math.abs(points[0]![1] - 10 * pt) < 1e-9 && Math.abs(points[1]![1] - 16 * pt) < 1e-9);
  assert.ok(Math.abs(points[1]![2] - 11 * pt) < 1e-9 && Math.abs(points[2]![2] - 9 * pt) < 1e-9);
  assert.equal(planSheets(readDxf(dxf([...frame, ...leader, 71, 0], style)), opts).sheets[0]!.prims.filter(p => p.k === 'fill').length, 0);
  const missing = planSheets(readDxf(dxf([...frame, ...leader])), opts);
  assert.equal(missing.stats.skipped.get('LEADER arrowhead (style unavailable)'), 1);
});

test('MTEXT tolerance heights restore after braces and reach the actual PDF text matrices', async () => {
  assert.deepEqual(mtextHeightRuns('A{\\H0.7x;B}C{\\H2.5;D}', 5)[0], [
    { text: 'A', scale: 1 }, { text: 'B', scale: .7 }, { text: 'C', scale: 1 }, { text: 'D', scale: .5 },
  ]);
  const raw = '\\A0;100{\\H0.70x;%%p0.1} mm';
  const { pdf } = await convertCad('tolerance.dxf', dxf([...frame, 0, 'MTEXT', 10, 10, 20, 50, 40, 5, 71, 1, 1, raw]), { fonts });
  const doc = await PDFDocument.load(pdf), contents = doc.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const streams = refs.map(ref => { const stream = doc.context.lookup(ref); assert.ok(stream instanceof PDFRawStream); return stream; });
  const ops = streams.map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n');
  const sizes = [...ops.matchAll(/^([\d.-]+) [^\n]+ Tm$/gm)].map(m => Number(m[1]));
  assert.equal(sizes.length, 3);
  assert.ok(Math.abs(sizes[1]! / sizes[0]! - .7) < 1e-6);
  assert.equal(sizes[2], sizes[0]);
});


test('custom DIMLDRBLK is reported, never replaced with a guessed triangle', () => {
  const leader = [0, 'LEADER', 3, 'CUSTOM', 10, 10, 20, 10, 10, 20, 20, 10];
  const style = [0, 'DIMSTYLE', 2, 'CUSTOM', 40, 1, 41, 3, 341, 'ABC'];
  const result = planSheets(readDxf(dxf([...frame, ...leader], style)), opts);
  assert.equal(result.sheets[0]!.prims.filter(p => p.k === 'fill').length, 0);
  assert.equal(result.stats.skipped.get('LEADER arrowhead (style unavailable)'), 1);
});

test('gap-only tiny hatch patterns finish without scanning billions of invisible dashes', () => {
  const groups = hatch(0).map(([c,v]) => [c, c === 70 ? '0' : v] as [number,string]);
  groups.push([78,'1'],[53,'0'],[43,'0'],[44,'0'],[45,'0'],[46,'1'],[79,'1'],[49,'-0.000000001']);
  const raw = [0, 'HATCH', ...groups.flatMap(([c,v]) => [c,v])];
  const started = performance.now();
  const result = planSheets(readDxf(dxf([...frame, ...raw])), opts);
  assert.ok(performance.now() - started < 1000);
  const pattern = result.sheets[0]!.prims.find(p => p.k === 'hatch');
  assert.ok(pattern && pattern.k === 'hatch' && pattern.lines.length === 0);
});

test('styled MTEXT crop validation includes the same oblique shear as its PDF matrix', async () => {
  const prim = { k: 'text' as const, layer: '0', rgb: [0,0,0] as [number,number,number], font: 'sans' as const,
    lines:['II'], runs:[[{text:'I',scale:1},{text:'I',scale:.7}]], origin:[90,50] as [number,number],
    u:[1,0] as [number,number],v:[0,1] as [number,number],h:10,widthFactor:1,oblique:Math.PI/4,
    halign:0 as const,valign:0 as const,block:true,wrap:null,spacing:15,fit:null,fitHeight:false };
  const scale = {label:'1:1',ratio:1,standard:true,unit:'mm' as const,feetInches:false,unitsPerPoint:25.4/72};
  const sheet = {name:'Model',width:100,height:100,prims:[prim],viewports:[],pageScale:scale,scaleChecks:[]};
  await assert.rejects(writePdf([sheet],fonts,{title:'Oblique bounds',source:'synthetic'}),/Model-space MTEXT exceeds/);
});


test('HATCH declared counts reject huge, negative and truncated input before allocation', () => {
  const boundary: Groups = [[70,'1'],[91,'1'],[92,'2'],[72,'0'],[73,'1'],[93,'1000000000']];
  assert.throws(() => readHatch(boundary), /HATCH item count/);
  for (const code of [91,93,95,96,78,79]) {
    const prefix: Groups = code===91 ? [[70,'1']] : code===93 ? boundary.slice(0,-1)
      : code===78 ? [[70,'0'],[91,'0']] : code===79 ? [[70,'0'],[91,'0'],[78,'1'],[53,'0'],[43,'0'],[44,'0'],[45,'0'],[46,'1']]
      : [[70,'1'],[91,'1'],[92,'0'],[93,'1'],[72,'4'],[94,'3'],[73,'0'],[74,'0'], ...(code===96 ? [[95,'0'] as [number,string]] : [])];
    for (const value of ['1000000000','-1','0.5','2'])
      assert.throws(() => readHatch([...prefix,[code,value]]), /HATCH item count/);
  }
});
