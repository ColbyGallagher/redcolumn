import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef, decodePDFRawStream, degrees } from 'pdf-lib';
import { createFields, fillForm, fromCsv, fromXfdf, readForm, removeFields, resetForm, setTabOrder, toCsv, toXfdf, uniqueName, updateField } from './forms.ts';

async function blank(rotate = 0) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([600, 400]);
  if (rotate) p.setRotation(degrees(rotate));
  doc.addPage([600, 400]);
  return doc.save();
}

const box = (x: number, y: number, w = 100, h = 20) => ({ x, y, w, h });

test('fields are created where they were drawn and read back', async () => {
  const bytes = await createFields(await blank(), [
    { type: 'text', name: 'Name', pageIndex: 0, rect: box(50, 40) },
    { type: 'checkbox', name: 'Agree', pageIndex: 0, rect: box(50, 80, 14, 14) },
    { type: 'radio', name: 'Size', pageIndex: 0, rect: box(50, 110, 14, 14), options: ['S'] },
    { type: 'radio', name: 'Size', pageIndex: 0, rect: box(80, 110, 14, 14), options: ['L'] },
    { type: 'dropdown', name: 'Colour', pageIndex: 1, rect: box(50, 40), options: ['Red', 'Blue'] },
    { type: 'list', name: 'Rooms', pageIndex: 1, rect: box(50, 80, 100, 50), options: ['Kitchen', 'Bath'] },
    { type: 'signature', name: 'Sign', pageIndex: 1, rect: box(300, 300, 150, 40) },
  ]);
  const { fields } = await readForm(bytes);
  const by = new Map(fields.map((f) => [f.name, f]));
  assert.deepEqual([...by.keys()].sort(), ['Agree', 'Colour', 'Name', 'Rooms', 'Sign', 'Size']);
  assert.equal(by.get('Name')!.type, 'text');
  assert.deepEqual(by.get('Name')!.widgets, [{ pageIndex: 0, rect: box(50, 40) }]);
  assert.equal(by.get('Size')!.type, 'radio');
  assert.deepEqual(by.get('Size')!.options, ['S', 'L']);
  assert.deepEqual(
    by.get('Size')!.widgets.map((w) => w.onValue),
    ['S', 'L'],
  );
  assert.equal(by.get('Colour')!.widgets[0]!.pageIndex, 1);
  assert.equal(by.get('Sign')!.type, 'signature');
  assert.equal(by.get('Agree')!.value, 'Off');
});

test('widgets on rotated pages come back in page space', async () => {
  const bytes = await createFields(await blank(90), [{ type: 'text', name: 'T', pageIndex: 0, rect: box(30, 50, 80, 20) }]);
  const { fields } = await readForm(bytes);
  assert.deepEqual(fields[0]!.widgets[0]!.rect, box(30, 50, 80, 20));
});

test('filling sets values, calculates totals and formats them', async () => {
  let bytes = await createFields(await blank(), [
    { type: 'text', name: 'Qty', pageIndex: 0, rect: box(50, 40) },
    { type: 'text', name: 'Price', pageIndex: 0, rect: box(50, 70) },
    { type: 'text', name: 'Total', pageIndex: 0, rect: box(50, 100) },
    { type: 'checkbox', name: 'Paid', pageIndex: 0, rect: box(200, 40, 14, 14) },
    { type: 'dropdown', name: 'Colour', pageIndex: 0, rect: box(200, 70), options: ['Red', 'Blue'] },
  ]);
  bytes = await updateField(bytes, 'Total', { calculation: { op: 'PRD', fields: ['Qty', 'Price'] }, format: { kind: 'number', decimals: 2, separator: true, currency: '$', currencyFirst: true, negativeParens: false }, readOnly: true, tooltip: 'Qty × price' });
  const filled = await fillForm(bytes, { Qty: '3', Price: '1250', Paid: 'Yes', Colour: 'Blue' });
  assert.ok(filled.changed.includes('Total'));
  const { fields, calcOrder } = await readForm(filled.bytes);
  const v = Object.fromEntries(fields.map((f) => [f.name, f]));
  assert.equal(v.Total!.value, '3750');
  assert.deepEqual(v.Total!.calculation, { op: 'PRD', fields: ['Qty', 'Price'] });
  assert.equal(v.Total!.format?.kind, 'number');
  assert.equal(v.Total!.readOnly, true);
  assert.equal(v.Total!.tooltip, 'Qty × price');
  assert.deepEqual(calcOrder, ['Total']);
  assert.equal(v.Paid!.value, 'Yes');
  assert.equal(v.Colour!.value, 'Blue');
  // The returned form is the one the new file reads back as.
  assert.deepEqual(filled.model, { fields, calcOrder });
  // The appearance shows the formatted value.
  const doc = await PDFDocument.load(filled.bytes);
  const total = doc.getForm().getTextField('Total');
  const ap = total.acroField.getWidgets()[0]!.getNormalAppearance();
  const stream = doc.context.lookup(ap as PDFRef) as PDFRawStream;
  const text = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
  const hex = [...'$3,750.00'].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  assert.ok(text.toLowerCase().includes(hex), 'the appearance draws $3,750.00');
  // Reset goes back to empty (and the total with it).
  const reset = await readForm(await resetForm(filled.bytes));
  assert.equal(reset.fields.find((f) => f.name === 'Qty')!.value, '');
  assert.equal(reset.fields.find((f) => f.name === 'Paid')!.value, 'Off');
});

test('renaming, options, removal and tab order', async () => {
  let bytes = await createFields(await blank(), [
    { type: 'text', name: 'A', pageIndex: 0, rect: box(50, 40) },
    { type: 'text', name: 'B', pageIndex: 0, rect: box(50, 70) },
    { type: 'dropdown', name: 'C', pageIndex: 0, rect: box(50, 100), options: ['x'] },
  ]);
  bytes = await updateField(bytes, 'A', { name: 'First', multiline: true, maxLength: 5 });
  bytes = await updateField(bytes, 'C', { options: ['one', 'two'] });
  await assert.rejects(updateField(bytes, 'B', { name: 'First' }));
  bytes = await setTabOrder(bytes, ['C', 'B', 'First']);
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots()!;
  const names = annots.asArray().map((r) => doc.getForm().getFields().find((f) => f.acroField.getWidgets().some((w) => doc.context.getObjectRef(w.dict) === r))!.getName());
  assert.deepEqual(names, ['C', 'B', 'First']);
  assert.equal(doc.getPage(0).node.get(PDFName.of('Tabs')), PDFName.of('R'));
  const model = await readForm(bytes);
  assert.deepEqual(model.fields.map((f) => f.name), ['C', 'B', 'First']);
  const first = model.fields.find((f) => f.name === 'First')!;
  assert.equal(first.multiline, true);
  assert.equal(first.maxLength, 5);
  assert.deepEqual(model.fields.find((f) => f.name === 'C')!.options, ['one', 'two']);
  const fewer = await readForm(await removeFields(bytes, ['B']));
  assert.deepEqual(fewer.fields.map((f) => f.name).sort(), ['C', 'First']);
  const after = await PDFDocument.load(await removeFields(bytes, ['B']));
  assert.equal((after.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray) as PDFArray).size(), 2);
  void PDFDict;
});

test('form data as XFDF and CSV', async () => {
  const bytes = (await fillForm(await createFields(await blank(), [{ type: 'text', name: 'Note', pageIndex: 0, rect: box(50, 40) }, { type: 'checkbox', name: 'Ok', pageIndex: 0, rect: box(50, 80, 14, 14) }]), { Note: 'A & B, "C"', Ok: 'Yes' })).bytes;
  const { fields } = await readForm(bytes);
  const xfdf = toXfdf(fields, 'form.pdf');
  assert.deepEqual(fromXfdf(xfdf), { Note: 'A & B, "C"', Ok: 'Yes' });
  assert.deepEqual(fromXfdf('<xfdf><fields><field name="a"><field name="b"><value>1</value></field></field><field name="c"><value/></field></fields></xfdf>'), { 'a.b': '1', c: '' });
  assert.deepEqual(fromCsv(toCsv(fields)), { Note: 'A & B, "C"', Ok: 'Yes' });
});

test('uniqueName numbers new fields', () => {
  assert.equal(uniqueName('Text', ['Text1', 'Text2']), 'Text3');
  assert.equal(uniqueName('Name', []), 'Name1');
  assert.equal(uniqueName('Item2', ['Item2']), 'Item22');
});

test('appearance, visibility, default value and validation round-trip, and validation checks values', async () => {
  const { readForm, updateField, validateValue, withDa, parseDa } = await import('./forms.ts');
  assert.equal(withDa('/Helv 0 Tf 0 g', 11, '#ff0000'), '/Helv 11 Tf 1 0 0 rg');
  assert.deepEqual(parseDa('/Helv 9 Tf 0 0 1 rg'), { fontSize: 9, textColor: '#0000ff' });
  const base = await createFields(await blank(), [{ type: 'text', name: 'Qty', pageIndex: 0, rect: { x: 20, y: 20, w: 100, h: 20 } }]);
  let bytes = await updateField(base, 'Qty', { fontSize: 11, textColor: '#ff0000', borderColor: '#0000ff', backgroundColor: '#ffffcc', visibility: 'noPrint', defaultValue: '1', validation: { kind: 'range', min: 1, max: 99 } });
  let f = (await readForm(bytes)).fields[0]!;
  assert.deepEqual([f.fontSize, f.textColor, f.borderColor, f.backgroundColor, f.visibility, f.defaultValue], [11, '#ff0000', '#0000ff', '#ffffcc', 'noPrint', '1']);
  assert.deepEqual(f.validation, { kind: 'range', min: 1, max: 99 });
  assert.equal(validateValue(f, '120'), 'Enter a number of at most 99.');
  assert.equal(validateValue(f, '5'), null);
  bytes = await updateField(bytes, 'Qty', { validation: { kind: 'pattern', pattern: '^[A-Z]-\\d{3}$', message: 'Use a sheet number like A-101' } });
  f = (await readForm(bytes)).fields[0]!;
  assert.equal(validateValue(f, 'A-101'), null);
  assert.equal(validateValue(f, 'a101'), 'Use a sheet number like A-101');
});

test('button actions are written to the widgets and read back', async () => {
  let bytes = await createFields(await blank(), [{ type: 'button', name: 'Go', pageIndex: 0, rect: box(50, 40, 60, 20) }]);
  assert.equal((await readForm(bytes)).fields[0]!.action, null);
  for (const action of [{ kind: 'url', url: 'https://example.com/spec' }, { kind: 'page', pageIndex: 1 }, { kind: 'reset' }, { kind: 'print' }, { kind: 'submit', url: 'mailto:rfi@example.com' }] as const) {
    bytes = await updateField(bytes, 'Go', { action });
    assert.deepEqual((await readForm(bytes)).fields[0]!.action, action);
  }
  bytes = await updateField(bytes, 'Go', { action: null });
  assert.equal((await readForm(bytes)).fields[0]!.action, null);
});
