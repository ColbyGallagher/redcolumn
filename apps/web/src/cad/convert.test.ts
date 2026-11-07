import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { importViewports } from '../../../../packages/markup/src/bluebeam';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { readPdfExtras } from '@nb/markup/pdfExtras';
import { CadReadError, convertCad, readDrawing } from './convert';
import { readDxf } from './dxf';
import { apply, bulgeCmds, ocs } from './geom';
import type { Prim } from './render';
import { planSheets, snapRatio } from './sheets';
import { decodeSpecial, mtextParagraphs } from './text';

const fixtures = new URL('../../test/fixtures/cad/', import.meta.url);
const fontDir = new URL('../../public/fonts/', import.meta.url);
const font = (n: string) => new Uint8Array(readFileSync(new URL(`Liberation${n}-Regular.ttf`, fontDir)));
const fonts = { sans: font('Sans'), serif: font('Serif'), mono: font('Mono') };
const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtures), 'utf8')) as {
  fixtures: Record<
    string,
    {
      units: string;
      pages: { name: string; widthPt: number; heightPt: number; viewports: { ratio: string; twistDeg?: number; frozen?: string[] }[] }[];
      nonPlotLayers?: string[];
      dimensions?: { measurement: number }[];
      warnings?: Record<string, string>[];
      text?: string[];
    }
  >;
};
const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`${name}.dxf`, fixtures)));
const fileBytes = (file: string) => new Uint8Array(readFileSync(new URL(file, fixtures)));
/** DWG copies of every fixture (written by ODA File Converter; see the fixtures README). */
const DWG_VERSIONS = ['R2000', 'R2004', 'R2007', 'R2010', 'R2013', 'R2018'];

const texts = (prims: readonly Prim[]): string[] => prims.flatMap((p) => (p.k === 'clip' ? texts(p.prims) : p.k === 'text' ? p.lines : []));

const cases = Object.keys(manifest.fixtures).flatMap((name) => [`${name}.dxf`, ...DWG_VERSIONS.map((v) => `dwg/${name}.${v}.dwg`)]);
for (const file of cases) {
  const name = file.replace(/^dwg\//, '').replace(/\..*$/, '');
  const exp = manifest.fixtures[name]!;
  test(`${file}: pages, scales, layers, warnings and text match the manifest`, async () => {
    const input = fileBytes(file);
    const { pdf, report } = await convertCad(file, input, { fonts });
    assert.ok(!report.warnings.some((w) => w.kind === 'unsupported' && w.type.includes('could not be read')), JSON.stringify(report.warnings));
    assert.deepEqual(
      report.pages.map((p) => p.name),
      exp.pages.map((p) => p.name),
    );
    exp.pages.forEach((ep, i) => {
      const p = report.pages[i]!;
      assert.ok(Math.abs(p.widthPt - ep.widthPt) < 1.5 && Math.abs(p.heightPt - ep.heightPt) < 1.5, `${ep.name}: ${p.widthPt} x ${p.heightPt}, expected ${ep.widthPt} x ${ep.heightPt}`);
      assert.equal(p.viewports.length, ep.viewports.length, `${ep.name}: viewports`);
      ep.viewports.forEach((ev, j) => {
        const v = p.viewports[j]!;
        assert.equal(v.ratio, Number(ev.ratio.split(':')[1]), `${ep.name} viewport ${j + 1} ratio`);
        assert.ok(Math.abs(v.twistDeg - (ev.twistDeg ?? 0)) < 1e-9, `twist ${v.twistDeg}`);
        assert.deepEqual([...v.frozen].sort(), [...(ev.frozen ?? [])].sort());
      });
    });
    for (const layer of exp.nonPlotLayers ?? []) assert.ok(!report.layers.includes(layer), `${layer} does not plot`);
    for (const w of exp.warnings ?? []) {
      assert.ok(
        report.warnings.some((r) => Object.entries(w).every(([k, v]) => (r as Record<string, unknown>)[k] === v)),
        `warning ${JSON.stringify(w)} in ${JSON.stringify(report.warnings)}`,
      );
    }
    assert.ok(!report.warnings.some((w) => w.kind === 'scale-check'), JSON.stringify(report.warnings));

    // The viewer reads the scales back from /VP exactly as it reads its own.
    const extras = await readPdfExtras(pdf);
    assert.ok(extras);
    extras.pages.forEach((page, i) => {
      const { scale, viewports } = importViewports(i, page);
      const ep = exp.pages[i]!;
      if (ep.viewports.length) {
        assert.deepEqual(
          viewports.map((v) => v.scale.metersPerPoint / ((0.0254 / 72) * Number(ep.viewports[viewports.indexOf(v)]!.ratio.split(':')[1]))).map((r) => Math.round(r * 1e6) / 1e6),
          ep.viewports.map(() => 1),
        );
      } else {
        assert.ok(scale, `${ep.name}: page scale`);
      }
    });

    // Text reaches the page (as real text: subset fonts carry a ToUnicode map).
    const { drawing } = readDrawing(file, input);
    const planned = planSheets(drawing, { colorMode: 'color', lineweights: true });
    const all = planned.sheets.flatMap((s) => texts(s.prims)).join('\n');
    for (const t of exp.text ?? []) assert.ok(all.includes(t), `text "${t}"`);
    if (exp.text?.length) {
      const doc = await PDFDocument.load(pdf);
      const fontsOf = doc.getPages().flatMap((pg) => {
        const f = pg.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
        return f ? f.values().map((v) => doc.context.lookup(v, PDFDict)) : [];
      });
      assert.ok(fontsOf.length && fontsOf.every((f) => f.has(PDFName.of('ToUnicode'))), 'fonts map glyphs back to text');
    }

    // Dimensions seen through their viewport's scale measure the lengths they were drawn at.
    if (exp.dimensions?.length && planned.sheets.some((s) => s.viewports.length)) {
      const measured = planned.sheets.flatMap((s) => s.scaleChecks.map((c) => c.measured));
      for (const dim of exp.dimensions) assert.ok(measured.some((m) => Math.abs(m / dim.measurement - 1) < 1e-6), `${dim.measurement} in ${measured}`);
      for (const c of planned.sheets.flatMap((s) => s.scaleChecks)) if (c.stated) assert.ok(Math.abs(c.measured / c.stated - 1) < 0.001);
    }
  });
}

test('layouts come in tab order and only the chosen ones are converted', async () => {
  const d = readDxf(bytes('kestrel-plan'));
  assert.deepEqual(
    d.layouts.map((l) => l.name),
    ['Model', 'C-101 PLAN', 'C-501 DETAIL'],
  );
  const { report } = await convertCad('kestrel-plan.dxf', bytes('kestrel-plan'), { fonts, layouts: ['C-501 DETAIL'], includeModel: true });
  assert.deepEqual(
    report.pages.map((p) => p.name),
    ['C-501 DETAIL', 'Model'],
  );
});

test('undeclared layers get defaults instead of failing', () => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'NOWHERE', '10', '0', '20', '0', '11', '10', '21', '0', '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
  const d = readDxf(dxf);
  assert.equal(d.layers.get('NOWHERE')?.plot, true);
  assert.equal(planSheets(d, { colorMode: 'color', lineweights: true }).sheets[0]!.prims.length, 1);
});

test('old and unknown DWG versions are refused with a clear message', () => {
  assert.throws(() => readDrawing('a.dwg', new TextEncoder().encode('AC1014\0\0\0')), /older than AutoCAD 2000/);
  assert.throws(() => readDrawing('a.dwg', new TextEncoder().encode('AC1040\0\0\0')), /newer than the converter knows/);
});

test('a truncated or corrupted DWG fails cleanly, never hangs', () => {
  for (const file of ['dwg/kestrel-plan.R2018.dwg', 'dwg/kestrel-plan.R2007.dwg', 'dwg/kestrel-plan.R2004.dwg', 'dwg/kestrel-plan.R2000.dwg']) {
    const src = fileBytes(file);
    for (const cut of [0x20, 0x100, 0x400, src.length >> 2, src.length >> 1]) {
      try {
        readDrawing('cut.dwg', src.slice(0, cut));
      } catch (err) {
        assert.ok(err instanceof CadReadError, `${file} cut at ${cut}: ${String(err)}`);
      }
    }
    // Flipped bytes past the file header: it either reads (counting objects it cannot) or refuses.
    let seed = 7;
    for (let k = 0; k < 8; k++) {
      const bad = src.slice();
      for (let i = 0; i < 64; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        const at = 0x200 + (seed % (bad.length - 0x200));
        bad[at] = bad[at]! ^ 0xff;
      }
      try {
        readDrawing('bad.dwg', bad);
      } catch (err) {
        assert.ok(err instanceof CadReadError, `${file} corrupted: ${String(err)}`);
      }
    }
  }
});

test('bulges are arcs through both ends', () => {
  const d = bulgeCmds([0, 0], [10, 0], 1); // a half circle
  const last = d[d.length - 1]!;
  assert.equal(last[0], 'C');
  assert.ok(Math.abs((last as number[])[5]! - 10) < 1e-9 && Math.abs((last as number[])[6]!) < 1e-9);
});

test('an extrusion pointing down mirrors x', () => {
  assert.deepEqual(apply(ocs([0, 0, -1]), [3, 4]), [-3, 4]);
  assert.deepEqual(apply(ocs([0, 0, 1]), [3, 4]), [3, 4]);
});

test('text codes', () => {
  assert.equal(decodeSpecial('%%c25 %%p0.5 45%%d %%u'), 'Ø25 ±0.5 45° ');
  assert.equal(decodeSpecial('\\U+00B2'), '²');
  assert.deepEqual(mtextParagraphs('{\\fArial|b1;Bold}\\Pnext \\S1/2; \\H2.5x;big'), ['Bold', 'next 1/2 big']);
});

test('scales snap to standard ratios', () => {
  assert.deepEqual(snapRatio(499.2, false), { ratio: 500, label: '1:500', standard: true });
  assert.deepEqual(snapRatio(96.2, true), { ratio: 96, label: '1/8" = 1\'-0"', standard: true });
  assert.equal(snapRatio(333.3, false).standard, false);
});

/** Paper-space viewports of a drawing read from a fixture, with their raw groups. */
const viewportsOf = (d: ReturnType<typeof readDxf>) => [...d.blocks.values()].flatMap((b) => b.entities).filter((e) => e.type === 'VIEWPORT');

test('a viewport near a standard scale measures at its own scale and says so', () => {
  const d = readDxf(bytes('kestrel-plan'));
  for (const vp of viewportsOf(d)) {
    const g = vp.g.find(([c]) => c === 45)!;
    g[1] = String(Number(g[1]) * (502 / 500));
  }
  const plan = planSheets(d, { colorMode: 'color', lineweights: true }).sheets[0]!;
  const v = plan.viewports.find((x) => Math.round(x.scale.ratio) === 502)!;
  assert.ok(v, plan.viewports.map((x) => x.scale.label).join());
  assert.equal(v.scale.label, '1:502');
  assert.equal(v.scale.standard, false);
  // 1 pt on the page is 502 pt in metres, not 500.
  assert.ok(Math.abs(v.scale.unitsPerPoint / ((0.0254 / 72) * 502) - 1) < 1e-9, String(v.scale.unitsPerPoint));
});

test('float noise on a standard scale still labels it standard', () => {
  const d = readDxf(bytes('kestrel-plan'));
  for (const vp of viewportsOf(d)) {
    const g = vp.g.find(([c]) => c === 45)!;
    g[1] = String(Number(g[1]) * (1 + 1e-7));
  }
  const labels = planSheets(d, { colorMode: 'color', lineweights: true }).sheets[0]!.viewports.map((v) => [v.scale.label, v.scale.standard]);
  assert.deepEqual(labels, [
    ['1:500', true],
    ['1:2000', true],
  ]);
});

const dxfOf = (blocks: string[][], entities: string[]) =>
  ['0', 'SECTION', '2', 'BLOCKS', ...blocks.flat(), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
const block = (name: string, body: string[]) => ['0', 'BLOCK', '2', name, '70', '0', '10', '0', '20', '0', ...body, '0', 'ENDBLK'];
const insertOf = (name: string, extra: string[] = []) => ['0', 'INSERT', '2', name, '10', '0', '20', '0', ...extra];

test('block fan-out stops with a clear error instead of running for ever', () => {
  // Ten levels of ten inserts each: 10^10 lines.
  const blocks = Array.from({ length: 10 }, (_, k) => block(`B${k}`, k === 9 ? ['0', 'LINE', '10', '0', '20', '0', '11', '1', '21', '0'] : Array.from({ length: 10 }, () => insertOf(`B${k + 1}`)).flat()));
  const t = Date.now();
  assert.throws(() => planSheets(readDxf(dxfOf(blocks, insertOf('B0'))), { colorMode: 'color', lineweights: true }), /too complex to convert/);
  assert.ok(Date.now() - t < 30_000, `${Date.now() - t} ms`);
});

test('a huge MINSERT array is refused up front', () => {
  const blocks = [block('B', ['0', 'LINE', '10', '0', '20', '0', '11', '1', '21', '0'])];
  const t = Date.now();
  assert.throws(() => planSheets(readDxf(dxfOf(blocks, insertOf('B', ['70', '100000', '71', '100000', '44', '1', '45', '1']))), { colorMode: 'color', lineweights: true }), /too complex/);
  assert.ok(Date.now() - t < 2000);
});

test('a hatch pattern of only gaps draws nothing and finishes', () => {
  const edges = ['91', '1', '92', '1', '93', '4', ...[[0, 0, 100, 0], [100, 0, 100, 100], [100, 100, 0, 100], [0, 100, 0, 0]].flatMap(([a, b, x, y]) => ['72', '1', '10', `${a}`, '20', `${b}`, '11', `${x}`, '21', `${y}`]), '97', '0'];
  const pattern = (dashes: string[]) => ['75', '0', '76', '1', '52', '0', '41', '1', '77', '0', '78', '1', '53', '0', '43', '0', '44', '0', '45', '0', '46', '1', '79', `${dashes.length}`, ...dashes.flatMap((x) => ['49', x]), '98', '0'];
  const hatchOf = (dashes: string[]) => ['0', 'HATCH', '10', '0', '20', '0', '30', '0', '2', 'TEST', '70', '0', '71', '0', ...edges, ...pattern(dashes)];
  const t = Date.now();
  const gaps = planSheets(readDxf(dxfOf([], hatchOf(['-1', '-2']))), { colorMode: 'color', lineweights: true }).sheets[0]!;
  assert.deepEqual(gaps.prims.map((p) => (p.k === 'hatch' ? p.lines.length : -1)), [0]);
  // Dashes far finer than the area are not stepped through one by one.
  planSheets(readDxf(dxfOf([], hatchOf(['1e-9', '-1e-9']))), { colorMode: 'color', lineweights: true });
  assert.ok(Date.now() - t < 5000, `${Date.now() - t} ms`);
});
