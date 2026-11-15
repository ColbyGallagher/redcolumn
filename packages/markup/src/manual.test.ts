import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { SCALE_PRESETS } from '@nb/measure';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { hitTest } from './geometry.ts';
import { DEFAULT_STYLES, manualBox, markupBounds, measureKindOf, measureProps, type Markup } from './model.ts';
import { TYPE_INFO } from './types.ts';
import { legendRows } from './legend.ts';
import { measurementLabel } from './render.ts';

const METRIC = { ...SCALE_PRESETS.find((p) => p.group === 'Metric')!.scale, unit: 'm' as const, precision: 2 };

const manual = (extra: Partial<Markup> = {}): Markup => ({
  id: 'man1',
  type: 'manual',
  pageIndex: 0,
  points: [[200, 150]],
  style: { ...DEFAULT_STYLES.manual },
  manual: { kind: 'area', value: 24, unit: 'm', note: 'Per finishes schedule' },
  subject: 'Slab',
  status: 'none',
  author: 'Tester',
  createdAt: 1,
  modifiedAt: 1,
  ...extra,
});

test('a manual quantity is a one-point measurement that counts as the kind it was typed as', () => {
  assert.equal(TYPE_INFO.manual.measure, true);
  assert.deepEqual(TYPE_INFO.manual.click, { min: 1, fixed: 1 });
  assert.deepEqual(measureProps(manual()).manual, manual().manual);
  assert.equal(measureKindOf(manual()), 'area');
  assert.equal(measureKindOf(manual({ manual: { kind: 'count', value: 4 } })), 'count');
});

test('its tag shows the subject and the quantity in display units, boxed', () => {
  const label = measurementLabel(manual(), METRIC)!;
  assert.equal(label.text, 'Slab · 24.00 m²');
  assert.equal(label.boxed, true);
  assert.deepEqual(label.at, [200, 150]);
  assert.equal(measurementLabel(manual({ subject: undefined }), METRIC)!.text, 'Manual · 24.00 m²');
  assert.deepEqual(measurementLabel(manual({ text: 'Bay 3' }), METRIC)!.lines, ['Bay 3', 'Slab · 24.00 m²']);
  assert.equal(measurementLabel(manual({ style: { ...DEFAULT_STYLES.manual, showLabel: false } }), METRIC), null);
});

test('its bounds and hit area are the tag around the point', () => {
  const box = manualBox(manual());
  assert.ok(box.w > 40 && box.h > 8);
  assert.ok(Math.abs(box.x + box.w / 2 - 200) < 1e-9 && Math.abs(box.y + box.h / 2 - 150) < 1e-9);
  const b = markupBounds(manual());
  assert.ok(b.x <= box.x && b.x + b.w >= box.x + box.w);
  assert.equal(hitTest(manual(), [200 + box.w / 2 - 2, 150], 2), true);
  assert.equal(hitTest(manual(), [200 + box.w, 150], 2), false);
});

test('a legend row totals manual quantities by kind', () => {
  const rows = legendRows(
    { ...manual({ id: 'l', type: 'legend', points: [[0, 0], [10, 10]] }), legend: { scope: 'document' } } as Markup,
    [manual(), manual({ id: 'man2', manual: { kind: 'area', value: 6 } }), manual({ id: 'man3', manual: { kind: 'length', value: 5 } })],
    () => METRIC,
  );
  assert.deepEqual(rows.map((r) => [r.count, r.measure]), [[2, '30.00 m²'], [1, '5.00 m']]);
});

async function exported(m: Markup) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m], { scaleFor: () => METRIC }));
  return out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict));
}
const text = (d: PDFDict, k: string) => {
  const v = d.lookup(PDFName.of(k), PDFString, PDFHexString);
  return v.decodeText();
};

test('exported, it is a text box other viewers can read, carrying the quantity for this app', async () => {
  const dicts = await exported(manual());
  assert.equal(dicts.length, 1);
  const d = dicts[0]!;
  assert.equal(d.get(PDFName.of('Subtype'))?.toString(), '/FreeText');
  assert.match(text(d, 'Contents'), /Slab · 24\.00 m²/);
  assert.ok(d.has(PDFName.of('AP')), 'has an appearance');
  const data = JSON.parse(text(d, 'NBData')) as Markup;
  assert.equal(data.type, 'manual');
});

test('a manual quantity round trips through export and import', async () => {
  const original = manual();
  const [d] = await exported(original);
  const ann: ImportableAnnotation = {
    index: 0,
    subtype: 'FreeText',
    rect: { x: 100, y: 100, w: 80, h: 14 },
    color: '#0f766e',
    interior: null,
    opacity: 1,
    borderWidth: 1,
    contents: text(d!, 'Contents'),
    author: 'Tester',
    intent: '',
    cloudy: false,
    da: '',
    appData: text(d!, 'NBData'),
    flags: 4,
    vertices: [],
    ink: [],
    line: null,
    link: null,
  };
  const [back] = importAnnotations(0, [ann]).markups;
  assert.ok(back);
  assert.equal(back.type, 'manual');
  assert.deepEqual(back.manual, original.manual);
  assert.deepEqual(back.points, original.points);
  assert.equal(back.subject, 'Slab');
  assert.equal(back.id, 'man1');
});
