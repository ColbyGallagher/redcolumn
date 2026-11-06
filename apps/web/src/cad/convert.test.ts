import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { importViewports } from '../../../../packages/markup/src/bluebeam';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { readPdfExtras } from '@nb/markup/pdfExtras';
import { CadReadError, convertCad, readDrawing } from './convert';
import { parseCtb } from './ctb';
import { readDxf } from './dxf';
import { apply, bulgeCmds, ocs, pathBox } from './geom';
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
      leaders?: number;
      sizeTolerancePt?: number;
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
      const tol = exp.sizeTolerancePt ?? 1.5;
      assert.ok(Math.abs(p.widthPt - ep.widthPt) < tol && Math.abs(p.heightPt - ep.heightPt) < tol, `${ep.name}: ${p.widthPt} x ${p.heightPt}, expected ${ep.widthPt} x ${ep.heightPt}`);
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

    // Each leader ends in a closed arrowhead (a filled triangle).
    if (exp.leaders) {
      const arrows = planned.sheets.flatMap((s) => s.prims).filter((p) => p.k === 'fill' && p.d.length === 4 && p.d[3]![0] === 'Z');
      assert.equal(arrows.length, exp.leaders, file);
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

test('a supplied reference drawing is drawn in place of its xref', async () => {
  const without = await convertCad('missing-refs.dxf', bytes('missing-refs'), { fonts });
  assert.ok(without.report.warnings.some((w) => w.kind === 'missing-xref'));
  // Any drawing will do as the reference: the blocks fixture, under the xref's file name.
  const references = [{ name: 'survey-base.dxf', bytes: bytes('blocks') }];
  const { report } = await convertCad('missing-refs.dxf', bytes('missing-refs'), { fonts, references });
  assert.ok(!report.warnings.some((w) => w.kind === 'missing-xref'), JSON.stringify(report.warnings));
  assert.deepEqual(report.references, ['survey-base.dxf']);
  const { drawing } = readDrawing('missing-refs.dxf', bytes('missing-refs'));
  const refs = new Map([['survey-base', readDrawing('survey-base.dxf', bytes('blocks')).drawing]]);
  const all = planSheets(drawing, { colorMode: 'color', lineweights: true, references: refs }).sheets.flatMap((s) => texts(s.prims));
  assert.ok(all.includes('P1') && all.includes('SHX TEXT'), all.join(','));
});

test('an unreadable reference is reported, not fatal', async () => {
  const { report } = await convertCad('missing-refs.dxf', bytes('missing-refs'), { fonts, references: [{ name: 'survey-base.dwg', bytes: new Uint8Array([1, 2, 3]) }] });
  assert.ok(report.warnings.some((w) => w.kind === 'reference-unreadable' && w.file === 'survey-base.dwg'));
  assert.ok(report.warnings.some((w) => w.kind === 'missing-xref'));
});

test('the report lists every layout, converted or not', async () => {
  const { report } = await convertCad('kestrel-plan.dxf', bytes('kestrel-plan'), { fonts, layouts: ['C-501 DETAIL'] });
  assert.deepEqual(report.layouts, ['C-101 PLAN', 'C-501 DETAIL']);
  assert.deepEqual(
    report.pages.map((p) => p.name),
    ['C-501 DETAIL'],
  );
});

test('wipeouts hide what is under them, in every format', () => {
  const exp = manifest.fixtures.masks as unknown as { pages: { extents: number[] }[]; wipeouts: { box: number[] }[] };
  const [x0, y0] = exp.pages[0]!.extents;
  const ptPerMm = 72 / 25.4;
  for (const file of ['masks.dxf', ...DWG_VERSIONS.map((v) => `dwg/masks.${v}.dwg`)]) {
    const { drawing } = readDrawing(file, fileBytes(file));
    const { sheets } = planSheets(drawing, { colorMode: 'mono', lineweights: true });
    const prims = sheets[0]!.prims;
    const fills = prims.filter((p) => p.k === 'fill' && p.rgb.every((c) => c === 1));
    assert.equal(fills.length, exp.wipeouts.length, file);
    exp.wipeouts.forEach((w, i) => {
      const f = fills[i]!;
      const b = pathBox(f.k === 'fill' ? f.d : []);
      const mm = [b.x0 / ptPerMm + x0!, b.y0 / ptPerMm + y0!, b.x1 / ptPerMm + x0!, b.y1 / ptPerMm + y0!];
      mm.forEach((v, k) => assert.ok(Math.abs(v - w.box[k]!) < 0.01, `${file} wipeout ${i}: ${mm} vs ${w.box}`));
    });
    // Drawn after the lines, so they cover them.
    assert.ok(prims.indexOf(fills[0]!) > prims.findIndex((p) => p.k === 'stroke'), file);
  }
});

test('polyface meshes draw their visible edges, in every format', () => {
  const exp = manifest.fixtures.masks as unknown as { pages: { extents: number[] }[]; meshEdges: { layer: string; count: number; box: number[] } };
  const [x0, y0] = exp.pages[0]!.extents;
  const ptPerMm = 72 / 25.4;
  for (const file of ['masks.dxf', ...DWG_VERSIONS.map((v) => `dwg/masks.${v}.dwg`)]) {
    const { drawing } = readDrawing(file, fileBytes(file));
    const prims = planSheets(drawing, { colorMode: 'color', lineweights: true }).sheets[0]!.prims;
    const mesh = prims.filter((p) => p.k === 'stroke' && p.layer === exp.meshEdges.layer);
    const segments = mesh.flatMap((p) => (p.k === 'stroke' ? p.d.filter((c) => c[0] === 'M') : []));
    assert.equal(segments.length, exp.meshEdges.count, file);
    const b = pathBox(mesh.flatMap((p) => (p.k === 'stroke' ? p.d : [])));
    const mm = [b.x0 / ptPerMm + x0!, b.y0 / ptPerMm + y0!, b.x1 / ptPerMm + x0!, b.y1 / ptPerMm + y0!];
    mm.forEach((v, k) => assert.ok(Math.abs(v - exp.meshEdges.box[k]!) < 0.01, `${file}: ${mm}`));
  }
});

test('a supplied picture is embedded where its image is', async () => {
  const png = new Uint8Array(readFileSync(new URL('../../../../e2e/fixtures/picture.png', import.meta.url)));
  const { pdf, report } = await convertCad('missing-refs.dxf', bytes('missing-refs'), { fonts, references: [{ name: 'aerial-2026.png', bytes: png }] });
  assert.ok(!report.warnings.some((w) => w.kind === 'missing-image'), JSON.stringify(report.warnings));
  assert.ok(report.references.includes('aerial-2026.png'));
  const doc = await PDFDocument.load(pdf);
  const xobjects = doc.getPages()[0]!.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  assert.equal(xobjects?.keys().length, 1);
});

/** A tiny colour-dependent plot style table: ACI 1 plots black at 0.7 mm. */
function testCtb(): Uint8Array {
  const text = ['description="test', 'plot_style{', ' 0{', '  name="Color_1', '  color=-1023410176', '  color_policy=5', '  screen=100', '  lineweight=3', ' }', '}', 'custom_lineweight_table{', ' 3=0.7', '}', ''].join('\n');
  const head = Buffer.alloc(60);
  head.write('PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec', 'latin1');
  return new Uint8Array(Buffer.concat([head, deflateSync(Buffer.from(text, 'latin1'))]));
}

test('a supplied plot style table sets the colour and lineweight of each ACI colour', async () => {
  const table = await parseCtb('test.ctb', testCtb());
  assert.deepEqual(table.byAci.get(1), { rgb: [0, 0, 0], grey: false, screen: 100, lineweightMm: 0.7 });
  const { drawing } = readDrawing('kestrel-plan.dxf', bytes('kestrel-plan'));
  drawing.layouts.find((l) => l.name === 'C-101 PLAN')!.styleSheet = 'Test.ctb';
  // The other page names another table (a page that names none would take the only one supplied).
  drawing.layouts.find((l) => l.name === 'C-501 DETAIL')!.styleSheet = 'other.ctb';
  const { sheets } = planSheets(drawing, { colorMode: 'auto', lineweights: true, plotStyles: new Map([['test.ctb', table]]) });
  const inViewports = (prims: readonly Prim[]): Prim[] => prims.flatMap((p) => (p.k === 'clip' ? inViewports(p.prims) : [p]));
  // C-ROAD-CL is red (ACI 1): black at 0.7 mm through the table, on that page only.
  const cl = (s: number) => inViewports(sheets[s]!.prims).find((p) => p.k === 'stroke' && p.layer === 'C-ROAD-CL');
  const styled = cl(0);
  assert.ok(styled && styled.k === 'stroke');
  assert.deepEqual(styled.rgb, [0, 0, 0]);
  assert.ok(Math.abs(styled.width - (0.7 * 72) / 25.4) < 1e-9);
  const plain = cl(1);
  assert.ok(plain && plain.k === 'stroke' && plain.rgb[0] === 1);
});

test('a plot style table the drawing names but is not supplied is reported', () => {
  const { drawing } = readDrawing('kestrel-plan.dxf', bytes('kestrel-plan'));
  drawing.layouts.find((l) => l.name === 'C-101 PLAN')!.styleSheet = 'Company A1.ctb';
  drawing.layouts.find((l) => l.name === 'C-501 DETAIL')!.styleSheet = 'monochrome.ctb';
  const { notes } = planSheets(drawing, { colorMode: 'auto', lineweights: true });
  assert.deepEqual(
    notes.filter((n) => n.kind === 'plot-style-missing'),
    [{ kind: 'plot-style-missing', name: 'Company A1.ctb' }],
  );
});
