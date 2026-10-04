import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { parseBtx as parse, parsePdfObject } from './toolchest.ts';
import type { MarkupStyle, MarkupType } from './model.ts';

const base: MarkupStyle = { stroke: '#e11d48', fill: null, width: 1, opacity: 1 };
const defaults = new Proxy({} as Record<MarkupType, MarkupStyle>, { get: (_, k) => (k === 'area' ? { ...base, fill: '#16a34a' } : base) });
const parseBtx = (xml: string) => parse(xml, defaults);

const hexZ = (s: string) => deflateSync(Buffer.from(s, 'latin1')).toString('hex').toUpperCase();

const item = (name: string, type: string, dict: string, raw = hexZ(dict)) =>
  `<ToolChestItem Version="1"><Name>${name}</Name><Type>${type}</Type><Raw>${raw}</Raw><Index>0</Index></ToolChestItem>`;

test('PDF dictionaries parse: names, numbers, strings, arrays, nested dicts', () => {
  const d = parsePdfObject('<</Type/Annot/Subtype/Square/C[1 0 0]/BS<</W 2.5/S/D/D[3 2]>>/Subj(Rect \(red\))/T<FEFF0041>/F 4>>') as Record<string, unknown>;
  assert.deepEqual(d.Subtype, { name: 'Square' });
  assert.deepEqual(d.C, [1, 0, 0]);
  assert.deepEqual(d.BS, { W: 2.5, S: { name: 'D' }, D: [3, 2] });
  assert.equal(d.Subj, 'Rect (red)');
  assert.equal(d.T, 'A');
});

test('a Revu tool set maps to our tools and styles', async () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<BluebeamRevuToolSet Version="1"><Title>QA &amp; Review</Title>
${item('Red cloud', 'Bluebeam.PDF.Annotations.AnnotationPolygonCloud', '<</Subtype/Polygon/IT/PolygonCloud/C[1 0 0]/IC[1 1 0]/CA 0.8/BS<</W 3>>/Subj(Cloud)>>')}
${item('Callout text', 'Bluebeam.PDF.Annotations.AnnotationFreeText', '<</Subtype/FreeText/C[0 0 1]/DA(0 0 1 rg /Helv 14 Tf)/DS(font: Times New Roman 14pt; color:#0000FF)>>')}
${item('Dim', 'Bluebeam.PDF.Annotations.AnnotationMeasureLength', '<</Subtype/Line/IT/LineDimension/C[0 0.5 0]/LE[/Butt/Butt]/BS<</W 1/S/D/D[6 3]>>>>')}
${item('Arrow', 'Bluebeam.PDF.Annotations.AnnotationArrow', '<</Subtype/Line/LE[/None/OpenArrow]/C[0 0 0]>>')}
${item('Area', 'Bluebeam.PDF.Annotations.AnnotationMeasureArea', '<</Subtype/Polygon/IT/PolygonDimension/C[0 1 0]/IC[0 1 0]/FillOpacity 0.3>>')}
${item('Approved', 'Bluebeam.PDF.Annotations.AnnotationStamp', '<</Subtype/Stamp>>')}
${item('Plain', 'Bluebeam.PDF.Annotations.AnnotationSquare', '<</Subtype/Square/C[0 0 0 1]>>', '<</Subtype/Square/C[0 0 0 1]>>')}
</BluebeamRevuToolSet>`;
  const set = await parseBtx(xml);
  assert.equal(set.title, 'QA & Review');
  const [cloud, text, dim, arrow, area, stamp, plain] = set.items;
  assert.equal(cloud!.type, 'cloud');
  assert.equal(cloud!.style.stroke, '#ff0000');
  assert.equal(cloud!.style.fill, '#ffff00');
  assert.equal(cloud!.style.opacity, 0.8);
  assert.equal(cloud!.style.width, 3);
  assert.equal(text!.type, 'text');
  assert.equal(text!.style.fontSize, 14);
  assert.equal(text!.style.textColor, '#0000ff');
  assert.equal(text!.style.fontFamily, 'serif');
  assert.equal(dim!.type, 'length');
  assert.equal(dim!.style.dash, 'dashed');
  assert.equal(dim!.style.startCap, 'tick');
  assert.equal(arrow!.type, 'arrow');
  assert.equal(arrow!.style.endCap, 'openArrow');
  assert.equal(area!.type, 'area');
  assert.equal(area!.style.fillOpacity, 0.3);
  assert.equal(stamp!.type, null, 'stamps are kept but not drawable yet');
  assert.equal(plain!.type, 'rect');
  assert.equal(plain!.style.stroke, '#000000', 'CMYK black, uncompressed raw');
});

test('files that are not tool sets are refused', async () => {
  await assert.rejects(parseBtx('<html></html>'), /not a \.btx tool set/);
});

test('Revu 2017+ tool sets: compressed title, generated names, Cloud+, callouts and numbered groups', async () => {
  const child = (type: string, dict: string, x: number, y: number) => `<Child><Type>${type}</Type><Raw>${hexZ(dict)}</Raw><X>${x}</X><Y>${y}</Y><Index>1</Index></Child>`;
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<BluebeamRevuToolSet Version="1"><Title>${hexZ('Architect Review').toLowerCase()}</Title>
<ToolChestItem Version="2"><Name>QRGOYETREOFCJYJO</Name><Type>Bluebeam.PDF.Annotations.AnnotationPolygon</Type><Raw>${hexZ('<</IT/PolygonCloud/ITEx/PolyText/Subj(Architect)/Subtype/Polygon/C[1 0 0]/BE<</S/C/I 2>>>>')}</Raw>${child('Bluebeam.PDF.Annotations.AnnotationFreeText', '<</IT/FreeTextCallout/Subj(Cloud+)/Subtype/FreeText/C[]>>', -100, 5)}<Mode>properties</Mode></ToolChestItem>
${item('VFFZOEUQBEIQILSU', 'Bluebeam.PDF.Annotations.AnnotationFreeText', '<</DA(1 0 0 rg /Helv 12 Tf)/IT/FreeTextCallout/DS(font: Helvetica 12pt; text-align:left; color:#FF0000)/Subj(Architect)/Subtype/FreeText/C[]/BS<</W 0>>>>')}
${item('AQQEDGQEWPZTPYWL', 'Bluebeam.PDF.Annotations.AnnotationFreeText', '<</DS(font: Helvetica 12pt; color:#FF0000)/Subj(Architect)/Subtype/FreeText/C[]/BS<</W 0>>>>')}
<ToolChestItem Version="1"><Name>INHFCFBPUYYOUOFL</Name><Type>Bluebeam.PDF.Annotations.AnnotationCircle</Type><Raw>${hexZ('<</IC[1 0 0]/RD[1 1 1 1]/Subj(Architect)/Subtype/Circle/Rect[0 0 38 38]/C[1 0 0]/BS<</W 2>>>>')}</Raw>${child('Bluebeam.PDF.Annotations.AnnotationFreeText', '<</DS(font: Helvetica 12pt; text-align:center; text-valign:middle; color:#000000)/Subj(Text Box)/Subtype/FreeText/Rect[0 0 36 34]/C[]/BS<</W 0>>>>', 0, -1)}<Mode>drawing</Mode><Sequence><Enabled>True</Enabled><Style>Number</Style><Start>1</Start><Increment>1</Increment></Sequence></ToolChestItem>
</BluebeamRevuToolSet>`;
  const set = await parseBtx(xml);
  assert.equal(set.title, 'Architect Review');
  const [cloudPlus, callout, text, bubble] = set.items;
  assert.deepEqual([cloudPlus!.name, cloudPlus!.type, cloudPlus!.tool, cloudPlus!.subject], ['Cloud+', 'cloud', 'cloudPlus', 'Architect']);
  assert.equal(cloudPlus!.template, undefined);
  assert.deepEqual([callout!.name, callout!.type, callout!.style.textColor, callout!.style.stroke], ['Callout', 'callout', '#ff0000', '#ff0000']);
  assert.deepEqual([text!.name, text!.type, text!.style.noBox], ['Text Box', 'text', true]);
  assert.equal(bubble!.type, 'ellipse');
  assert.deepEqual(bubble!.sequence, { start: 1, increment: 1 });
  const [circle, number] = bubble!.template!;
  // The circle is inset by its /RD; the number is centred in it (1 pt lower, as Revu has it).
  assert.deepEqual(circle!.points, [[1, 1], [37, 37]]);
  assert.deepEqual(number!.points, [[1, 3], [37, 37]]);
  assert.deepEqual([number!.type, number!.text, number!.style.textAlign, number!.style.verticalAlign, number!.style.noBox], ['text', '1', 'center', 'middle', true]);
  assert.ok(circle!.groupId && circle!.groupId === number!.groupId);
});
