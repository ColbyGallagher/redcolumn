import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dropped } from './diagnostics.ts';
import { parseBhx } from './hatchSet.ts';
import { parseBlx } from './lineSet.ts';
import { parseBpx } from './bpx.ts';
import { parseBtx } from './toolchest.ts';
import type { MarkupStyle, MarkupType } from './model.ts';

// Each reader names what it could not keep, so a settings file that loses something is never silent.

test('a line style with an unknown component type is listed, and the rest of the style still reads', async () => {
  const xml = `<BluebeamRevuLineStyleSet><LineStyle Name="Mixed"><Line Offset="0">
    <Component Type="Dash" Width="4" />
    <Component Type="Glyph" Width="2" />
  </Line></LineStyle></BluebeamRevuLineStyleSet>`;
  const dropped: Dropped[] = [];
  const set = await parseBlx(xml, 'Set', dropped);
  assert.equal(set.styles.length, 1);
  assert.deepEqual(set.styles[0]!.spec, [true, [0, 4]]);
  assert.deepEqual(dropped, [{ item: '1. Mixed', reason: 'component type "Glyph" is not supported yet' }]);
});

test('a line style with no name is listed as dropped', async () => {
  const xml = `<BluebeamRevuLineStyleSet><LineStyle><Line Offset="0"><Component Type="Dash" Width="4" /></Line></LineStyle></BluebeamRevuLineStyleSet>`;
  const dropped: Dropped[] = [];
  const set = await parseBlx(xml, 'Set', dropped);
  assert.equal(set.styles.length, 0);
  assert.deepEqual(dropped, [{ item: '1. (unnamed)', reason: 'the line style has no name' }]);
});

test('a hatch with an unknown element type and an unknown tile size is listed', async () => {
  const xml = `<BluebeamRevuHatchSet><Title>Set</Title><Hatch Name="Odd"><Size>Parsec</Size>
    <Element Type="Line" X1="0" Y1="0" X2="1" Y2="1" />
    <Element Type="Spiral" />
  </Hatch></BluebeamRevuHatchSet>`;
  const dropped: Dropped[] = [];
  const set = await parseBhx(xml, 'Fallback', dropped);
  assert.equal(set.hatches.length, 1);
  assert.deepEqual(dropped, [
    { item: '1. Odd', reason: 'element type "Spiral" is not supported yet' },
    { item: '1. Odd', reason: 'tile size "Parsec" is not known, so the default is used' },
  ]);
});

test('a hatch with nothing this app can draw is listed and not kept', async () => {
  const xml = `<BluebeamRevuHatchSet><Hatch Name="Empty"><Element Type="Spiral" /></Hatch></BluebeamRevuHatchSet>`;
  const dropped: Dropped[] = [];
  const set = await parseBhx(xml, 'Set', dropped);
  assert.equal(set.hatches.length, 0);
  assert.ok(dropped.some((d) => d.item === '1. Empty' && d.reason === 'the hatch has no elements this app can draw'));
});

test('profile columns with no key, and display-order entries with no stored column, are listed', () => {
  const xml = `<RevuProfile Name="P"><Record Key="MarkupList">
    <Columns><Column Key="Subject"><Width>120</Width></Column><Column><Width>40</Width></Column></Columns>
    <DisplayOrder><Column Key="Subject" /><Column Key="Ghost" /></DisplayOrder>
    <CustomColumns><BSIColumnItem Index="0" Subtype="Number"><Name>Qty</Name></BSIColumnItem><BSIColumnItem Index="1" /></CustomColumns>
  </Record></RevuProfile>`;
  const dropped: Dropped[] = [];
  const profile = parseBpx(xml, 'Fallback', dropped);
  assert.deepEqual(
    profile.columns.map((c) => c.key),
    ['Subject'],
  );
  assert.deepEqual(profile.customColumns.map((c) => c.name), ['Qty']);
  assert.deepEqual(dropped, [
    { item: 'Column 2', reason: 'the column has no key' },
    { item: 'Column Ghost', reason: 'listed in the display order but not stored' },
    { item: 'Custom column 2', reason: 'the custom column has no name' },
  ]);
});

test('a tool whose type this app does not know is kept as an unsupported tool and listed', async () => {
  const defaults = new Proxy({} as Record<MarkupType, MarkupStyle>, { get: () => ({ stroke: '#000000', fill: null, width: 1, opacity: 1 }) });
  const xml = `<BluebeamRevuToolSet><Title>Set</Title><ToolChestItem><Name>Mystery</Name><Type>Bluebeam.PDF.Annotations.AnnotationNonsense</Type></ToolChestItem></BluebeamRevuToolSet>`;
  const dropped: Dropped[] = [];
  const set = await parseBtx(xml, defaults, 'Fallback', dropped);
  assert.equal(set.items.length, 1);
  assert.equal(set.items[0]!.type, null);
  assert.deepEqual(dropped, [{ item: '1. Mystery', reason: 'tool type "Bluebeam.PDF.Annotations.AnnotationNonsense" is not supported yet' }]);
});

test('readers without a list still work as before', async () => {
  const xml = `<BluebeamRevuHatchSet><Title>Set</Title><Hatch Name="Dot"><Element Type="Dot" X="1" Y="1" Size="Small" /></Hatch></BluebeamRevuHatchSet>`;
  const set = await parseBhx(xml, 'Fallback');
  assert.equal(set.hatches.length, 1);
});
