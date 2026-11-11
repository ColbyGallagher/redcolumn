import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { convertCad } from './convert';
import { readDxf } from './dxf';
import { writePdf } from './pdf';
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
    assert.ok(!report.warnings.some((w) => w.kind === 'unsupported'));
  }
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
  const fill = planned.sheets[0]!.prims.find((p) => p.k === 'fill');
  assert.ok(fill && fill.k === 'fill');
  const points = fill.d.filter((c) => c[0] === 'M' || c[0] === 'L') as ['M' | 'L', number, number][];
  const pt = 72 / 25.4;
  assert.ok(Math.abs(points[0]![1] - 10 * pt) < 1e-9 && Math.abs(points[1]![1] - 16 * pt) < 1e-9);
  assert.ok(Math.abs(points[1]![2] - 11 * pt) < 1e-9 && Math.abs(points[2]![2] - 9 * pt) < 1e-9);
  assert.equal(planSheets(readDxf(dxf([...frame, ...leader, 71, 0], style)), opts).sheets[0]!.prims.filter((p) => p.k === 'fill').length, 0);
  const missing = planSheets(readDxf(dxf([...frame, ...leader])), opts);
  assert.equal(missing.stats.skipped.get('LEADER arrowhead (style unavailable)'), 1);
});

test('custom DIMLDRBLK is reported, never replaced with a guessed triangle', () => {
  const leader = [0, 'LEADER', 3, 'CUSTOM', 10, 10, 20, 10, 10, 20, 20, 10];
  const style = [0, 'DIMSTYLE', 2, 'CUSTOM', 40, 1, 41, 3, 341, 'ABC'];
  const result = planSheets(readDxf(dxf([...frame, ...leader], style)), opts);
  assert.equal(result.sheets[0]!.prims.filter((p) => p.k === 'fill').length, 0);
  assert.equal(result.stats.skipped.get('LEADER arrowhead (style unavailable)'), 1);
});

test('MTEXT tolerance heights restore after braces and reach the actual PDF text matrices', async () => {
  assert.deepEqual(mtextHeightRuns('A{\\H0.7x;B}C{\\H2.5;D}', 5)[0], [
    { text: 'A', scale: 1 }, { text: 'B', scale: 0.7 }, { text: 'C', scale: 1 }, { text: 'D', scale: 0.5 },
  ]);
  const raw = '\\A0;100{\\H0.70x;%%p0.1} mm';
  const { pdf } = await convertCad('tolerance.dxf', dxf([...frame, 0, 'MTEXT', 10, 10, 20, 50, 40, 5, 71, 1, 1, raw]), { fonts });
  const doc = await PDFDocument.load(pdf);
  const contents = doc.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const streams = refs.map((ref) => {
    const stream = doc.context.lookup(ref);
    assert.ok(stream instanceof PDFRawStream);
    return stream;
  });
  const ops = streams.map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n');
  const sizes = [...ops.matchAll(/^([\d.-]+) [^\n]+ Tm$/gm)].map((m) => Number(m[1]));
  assert.equal(sizes.length, 3);
  assert.ok(Math.abs(sizes[1]! / sizes[0]! - 0.7) < 1e-6);
  assert.equal(sizes[2], sizes[0]);
});

test('styled MTEXT crop validation includes the same oblique shear as its PDF matrix', async () => {
  const prim = {
    k: 'text' as const, layer: '0', rgb: [0, 0, 0] as [number, number, number], font: 'sans' as const,
    lines: ['II'], runs: [[{ text: 'I', scale: 1 }, { text: 'I', scale: 0.7 }]], origin: [90, 50] as [number, number],
    u: [1, 0] as [number, number], v: [0, 1] as [number, number], h: 10, widthFactor: 1, oblique: Math.PI / 4,
    halign: 0 as const, valign: 0 as const, block: true, wrap: null, spacing: 15, fit: null, fitHeight: false,
  };
  const scale = { label: '1:1', ratio: 1, standard: true, unit: 'mm' as const, feetInches: false, unitsPerPoint: 25.4 / 72 };
  const sheet = { name: 'Model', width: 100, height: 100, prims: [prim], viewports: [], pageScale: scale, scaleChecks: [] };
  await assert.rejects(writePdf([sheet], fonts, { title: 'Oblique bounds', source: 'synthetic' }), /Model-space MTEXT exceeds/);
});
