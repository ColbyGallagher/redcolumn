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
