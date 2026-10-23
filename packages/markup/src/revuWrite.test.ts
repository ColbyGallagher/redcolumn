import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import type { BpxProfile } from './bpx.ts';
import { parseBpx } from './bpx.ts';
import type { Dropped } from './diagnostics.ts';
import { parseBhx } from './hatchSet.ts';
import { parseBlx, type LineSet } from './lineSet.ts';
import { DEFAULT_STYLES, type Markup, type MarkupStyle, type MarkupType } from './model.ts';
import { BTX_TYPES, fmt, pdfText, writeBhx, writeBlx, writeBpx, writeBtx } from './revuWrite.ts';
import { parseBtx, parsePdfObject, type ToolChestItem } from './toolchest.ts';

const hexZ = (s: string) => deflateSync(Buffer.from(s, 'latin1')).toString('hex');

test('numbers are written without exponents', () => {
  assert.equal(fmt(0.05555556), '0.05555556');
  assert.equal(fmt(-3.051758e-5), '-0.00003051758');
  assert.equal(fmt(12), '12');
});

test('PDF objects written as text read back the same', () => {
  const d = { Subtype: { name: 'Square' }, C: [1, 0, 0.5], BS: { W: 2, S: { name: 'D' }, D: [3, 2] }, Subj: 'Rect (red)\\x', T: 'Ω ok', Depth: 8, F: true, N: null, Nm: { name: 'A B#' } };
  assert.deepEqual(parsePdfObject(pdfText(d)), d);
  assert.match(pdfText(d), /^<<\/Subtype\/Square\/C\[1 0 0\.5\]/);
});

test('.blx: line styles round trip through Revu’s layout', async () => {
  const set: LineSet = {
    title: 'Advanced',
    styles: [
      { name: 'Gas', spec: [true, [0, 18, -2, ['GAS', 'Helvetica', 6, false, false, true], -2]] },
      { name: 'Fence', spec: [false, [0, 22, [2, 2, 1, false, 0, 0, -2, 2, 1.10457, -2, 2, 2, -1.10457, 2, 2, 0]], [3, 10, -5]] },
    ],
  };
  const xml = await writeBlx(set);
  assert.ok(xml.startsWith('﻿<?xml version="1.0" encoding="utf-8"?>\r\n<BluebeamRevuLineStyleSet Version="1">'));
  assert.match(xml, /<Title>789c[0-9a-f]+<\/Title>/, 'the title is packed as Revu stores it');
  assert.match(xml, /<Component Type="Vector" Index="1" Left="2" Right="2" Scale="1" Fill="False">\r\n {8}<Point Type="Start" Index="0" X="0" Y="-2" \/>/);
  const back = await parseBlx(xml);
  assert.deepEqual(back, set);
});

test('.bhx: hatches round trip, and a tile size Revu has no name for is reported', async () => {
  const spec = (size: number) => ({ scaleX: 1, scaleY: 2, size, lineWidth: 0.5, elements: [{ type: 'line' as const, x1: -0.05555556, y1: 1, x2: 1.055556, y2: 1 }, { type: 'dot' as const, x: 0.5, y: 0.25, size: 'large' as const }] });
  const dropped: Dropped[] = [];
  const xml = await writeBhx({ title: 'Mine', hatches: [{ name: 'Bricks', spec: spec(36) }, { name: 'Odd', spec: spec(20) }] }, dropped);
  assert.deepEqual(dropped, [{ item: '2. Odd', reason: 'a 20 pt tile has no Revu size, so QuarterInch is written' }]);
  const back = await parseBhx(xml);
  assert.equal(back.title, 'Mine');
  assert.deepEqual(back.hatches[0]!.spec, spec(36));
  assert.equal(back.hatches[1]!.spec.size, 18);
  assert.match(xml, /<Element Type="Dot" X="0.5" Y="0.25" Size="Large" \/>/);
});

test('.bpx: the markup list round trips', () => {
  const p: BpxProfile = {
    name: 'Field & Office',
    columns: [
      { key: 'Subject', width: 208, visible: true, added: true },
      { key: 'Page Index', width: 98, visible: false, added: true },
      { key: 'UserDefined0', width: 120, visible: true, added: true },
    ],
    customColumns: [{ index: 0, name: 'Responsibility', subtype: 'Text', multiline: false, deleted: false }],
  };
  const xml = writeBpx(p);
  assert.match(xml, /<RevuProfile Version="1" Name="Field &amp; Office">/);
  assert.deepEqual(parseBpx(xml), p);
});

const base: MarkupStyle = { stroke: '#e11d48', fill: null, width: 1, opacity: 1 };
const defaults = new Proxy({} as Record<MarkupType, MarkupStyle>, { get: (_, k) => DEFAULT_STYLES[k as MarkupType] ?? base });

/** What a tool reads as, for comparing: everything but ids and the Revu original. */
const shape = (i: ToolChestItem) => ({ type: i.type, name: i.name, subject: i.subject, style: i.style, tool: i.tool, sequence: i.sequence });

test('.btx: every type we can write reads back as the same tool and style', async () => {
  const items: ToolChestItem[] = BTX_TYPES.map((type, n) => ({
    id: `t${n}`,
    name: `Tool ${n}`,
    subject: `Subject ${n}`,
    type,
    revuType: '',
    style: {
      ...defaults[type],
      stroke: '#123456',
      ...(type === 'text' || type === 'callout' ? { fontSize: 14, textColor: '#00ff00', textAlign: 'center' as const, bold: true } : {}),
      ...(type === 'rect' ? { fill: '#ffff00', fillOpacity: 0.5, dash: 'dashed' as const, dashArray: [4, 2] } : {}),
      ...(type === 'arrow' ? { startCap: 'none' as const, endCap: 'openArrow' as const } : {}),
      ...(type === 'highlighter' ? { opacity: 0.4, width: 12 } : {}),
    },
  }));
  const dropped: Dropped[] = [];
  const xml = await writeBtx({ title: 'Everything', items }, dropped);
  assert.deepEqual(dropped, []);
  const back = await parseBtx(xml, defaults);
  assert.equal(back.title, 'Everything');
  assert.deepEqual(back.items.map(shape), items.map(shape));
});

test('.btx: a group places its parts where they were', async () => {
  const m = (type: MarkupType, points: [number, number][], text?: string): Markup => ({ id: '', type, pageIndex: 0, points, style: { ...defaults[type], width: 2 }, groupId: 'g', status: 'none', author: '', createdAt: 0, modifiedAt: 0, ...(text !== undefined ? { text } : {}) });
  const template = [m('ellipse', [[0, 0], [40, 40]]), m('line', [[0, 20], [120, 20]]), m('text', [[5, 22], [35, 38]], 'A101')];
  const items: ToolChestItem[] = [{ id: 't', name: 'Detail', subject: 'Detail', type: 'ellipse', revuType: '', style: template[0]!.style, template }];
  const back = await parseBtx(await writeBtx({ title: 'G', items }), defaults);
  const got = back.items[0]!.template!;
  assert.deepEqual(got.map((x) => [x.type, x.text]), [['ellipse', undefined], ['line', undefined], ['text', 'A101']]);
  const near = (a: number[][], b: number[][]) => a.every((p, i) => Math.abs(p[0]! - b[i]![0]!) < 1e-6 && Math.abs(p[1]! - b[i]![1]!) < 1e-6);
  // The group may sit elsewhere on the page; each part keeps its place in it.
  const [dx, dy] = [got[0]!.points[0]![0] - 0, got[0]!.points[0]![1] - 0];
  for (const [i, t] of template.entries()) assert.ok(near(got[i]!.points.map((p) => [p[0] - dx, p[1] - dy]), t.points), `${t.type} keeps its place`);
});

test('.btx: an imported tool is written back as Revu stored it; a restyled one keeps its other keys', async () => {
  const dict = '<</IC[1 0 0]/RD[1 1 1 1]/Subj(Architect)/Subtype/Circle/Rect[0 0 38 38]/C[1 0 0]/BS<</W 2>>/TempBBox[0 0 38 38]>>';
  const child = `<Child><Type>Bluebeam.PDF.Annotations.AnnotationFreeText</Type><Raw>${hexZ('<</DS(font: Helvetica 12pt; text-align:center; text-valign:middle; color:#000000)/Subj(Text Box)/Subtype/FreeText/Rect[0 0 36 34]/C[]/BS<</W 0>>>>')}</Raw><X>0</X><Y>-1</Y><Index>4</Index></Child>`;
  const xml = `<BluebeamRevuToolSet Version="1"><Title>Architect Review</Title><ToolChestItem Version="1"><Name>INHFCFBPUYYOUOFL</Name><Type>Bluebeam.PDF.Annotations.AnnotationCircle</Type><Raw>${hexZ(dict)}</Raw><X>1</X><Y>1</Y><Index>3</Index>${child}<Mode>drawing</Mode><Sequence><Enabled>True</Enabled><Start>1</Start><Increment>1</Increment></Sequence></ToolChestItem></BluebeamRevuToolSet>`;
  const set = await parseBtx(xml, defaults);
  const again = await writeBtx(set);
  assert.ok(again.includes('<Name>INHFCFBPUYYOUOFL</Name>'));
  assert.ok(again.includes(child), 'the child is kept as it was');
  const reread = await parseBtx(again, defaults);
  assert.deepEqual(reread.items.map(shape), set.items.map(shape));
  assert.equal(reread.items[0]!.source!.raw, dict, 'the dictionary is byte for byte the same');
  // Restyled: Revu's own keys (TempBBox, RD) stay, the colour changes.
  const red = { ...set.items[0]!, style: { ...set.items[0]!.style, stroke: '#0000ff' } };
  const restyled = await parseBtx(await writeBtx({ title: 'x', items: [red] }), defaults);
  assert.equal(restyled.items[0]!.style.stroke, '#0000ff');
  assert.match(restyled.items[0]!.source!.raw, /\/TempBBox\[0 0 38 38\]/);
  assert.equal(restyled.items[0]!.template?.length, 2);
});

test('.btx: tools Revu cannot carry are reported, not written', async () => {
  const dropped: Dropped[] = [];
  const style = defaults.stamp;
  const xml = await writeBtx({ title: 'x', items: [{ id: 'a', name: 'Approved', subject: 'Approved', type: 'stamp', revuType: '', style }, { id: 'b', name: 'Dim', subject: 'Dim', type: 'dimension', revuType: '', style }] }, dropped);
  assert.deepEqual(dropped, [
    { item: '1. Approved', reason: 'the stamp has no content to write' },
    { item: '2. Dim', reason: 'dimension tools have no Revu equivalent yet' },
  ]);
  assert.ok(!xml.includes('<ToolChestItem'));
});

test('.btx: stamps, pictures and files are written with what they place', async () => {
  const at = (type: MarkupType, extra: Partial<Markup>): Markup => ({ id: '', type, pageIndex: 0, points: [[0, 0], [80, 30]], style: { ...defaults[type], stroke: '#cc0000' }, status: 'none', author: '', createdAt: 0, modifiedAt: 0, ...extra });
  // A 1×1 red PNG with half alpha (RGBA), as the app's pictures are.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const tools: ToolChestItem[] = [
    { id: 'a', name: 'Approved', subject: 'Approved', type: 'stamp', revuType: '', style: { ...defaults.stamp, stroke: '#cc0000' }, template: [at('stamp', { stamp: { lines: ['APPROVED', 'By Colby'], frame: 'rounded' } })] },
    { id: 'b', name: 'Plain', subject: 'Plain', type: 'stamp', revuType: '', style: { ...defaults.stamp, stroke: '#cc0000', width: 0 }, template: [at('stamp', { stamp: { lines: ['NOTED'], frame: 'none' } })] },
    { id: 'c', name: 'Spec', subject: 'Spec', type: 'attachment', revuType: '', style: defaults.attachment, template: [at('attachment', { attachment: { name: 'notes.txt', mime: 'text/plain', size: 5, data: btoa('hello') } })] },
    { id: 'd', name: 'Logo', subject: 'Logo', type: 'image', revuType: '', style: defaults.image, template: [at('image', { image: png })] },
  ];
  const dropped: Dropped[] = [];
  const back = await parseBtx(await writeBtx({ title: 'Content', items: tools }, dropped), defaults);
  assert.deepEqual(dropped, []);
  const [stamp, plain, file, pic] = back.items;
  assert.deepEqual(stamp!.template![0]!.stamp, { lines: ['APPROVED', 'By Colby'], frame: 'rounded' });
  assert.equal(stamp!.style.stroke, '#cc0000');
  assert.deepEqual(plain!.template![0]!.stamp, { lines: ['NOTED'], frame: 'none' });
  assert.deepEqual(file!.template![0]!.attachment, { name: 'notes.txt', mime: 'text/plain', size: 5, data: btoa('hello') });
  assert.match(pic!.template![0]!.image!, /^data:image\/png;base64,/);
  assert.deepEqual(back.items.map((i) => [i.type, i.template![0]!.points]), tools.map((i) => [i.type, [[0, 0], [80, 30]]]));
});
