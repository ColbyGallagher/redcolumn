import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseBpx, writeBpx } from '@nb/markup';
import { bpxFromLayout, layoutFromBpx } from './bpxLayout.ts';

const BPX = `﻿<?xml version="1.0" encoding="utf-8"?>
<RevuProfile Version="1" Name="Field Issues">
  <Record Key="MarkupList">
    <ActiveColumn>1</ActiveColumn>
    <CustomColumns>
      <BSIColumnItem Index="0" Subtype="Text"><Name>Responsibility</Name><Deleted>False</Deleted><Multiline>False</Multiline></BSIColumnItem>
    </CustomColumns>
    <Columns>
      <Column Key="Page Index"><Width>98</Width><Visible>False</Visible><Added>True</Added></Column>
      <Column Key="Subject"><Width>208</Width><Visible>True</Visible><Added>True</Added></Column>
      <Column Key="Page"><Width>100</Width><Visible>True</Visible><Added>True</Added></Column>
      <Column Key="Status"><Width>148</Width><Visible>True</Visible><Added>True</Added></Column>
      <Column Key="Sequence"><Width>50</Width><Visible>True</Visible><Added>True</Added></Column>
      <Column Key="Legend"><Width>50</Width><Visible>False</Visible><Added>True</Added></Column>
      <Column Key="Author"><Width>95</Width><Visible>True</Visible><Added>False</Added></Column>
      <Column Key="UserDefined0"><Width>120</Width><Visible>True</Visible><Added>True</Added></Column>
    </Columns>
    <DisplayOrder>
      <Column Key="Subject" />
      <Column Key="Page" />
      <Column Key="Page Index" />
      <Column Key="UserDefined0" />
      <Column Key="Status" />
    </DisplayOrder>
  </Record>
</RevuProfile>`;

const ids = () => {
  let n = 0;
  return () => `c${n++}`;
};

test('a profile is read in its display order with each column width and visibility', () => {
  const p = parseBpx(BPX);
  assert.equal(p.name, 'Field Issues');
  assert.deepEqual(
    p.columns.map((c) => [c.key, c.width, c.visible, c.added]),
    [
      ['Subject', 208, true, true],
      ['Page', 100, true, true],
      ['Page Index', 98, false, true],
      ['UserDefined0', 120, true, true],
      ['Status', 148, true, true],
      // Stored but not in the display order: after it.
      ['Sequence', 50, true, true],
      ['Legend', 50, false, true],
      ['Author', 95, true, false],
    ],
  );
  assert.deepEqual(p.customColumns, [{ index: 0, name: 'Responsibility', subtype: 'Text', multiline: false, deleted: false }]);
});

test('other XML, and a profile with no markup list, are refused', () => {
  assert.throws(() => parseBpx('<ToolSetConfigs/>'), /not a Bluebeam profile/);
  assert.throws(() => parseBpx('<RevuProfile Name="x"><Record Key="Bookmarks"/></RevuProfile>'), /no markup list/);
  assert.throws(() => parseBpx('nope'), /not a Bluebeam profile/);
});

test('a profile becomes a column layout, with custom columns made and unknown ones reported', () => {
  const r = layoutFromBpx(parseBpx(BPX), ids());
  assert.deepEqual(r.layout, [
    { key: 'subject', width: 208, hidden: false },
    { key: 'page', width: 100, hidden: false },
    { key: 'custom:c0', width: 120, hidden: false },
    { key: 'status', width: 148, hidden: false },
    // Not added in Revu: kept, hidden.
    { key: 'author', width: 95, hidden: true },
  ]);
  assert.deepEqual(r.custom, [{ id: 'c0', name: 'Responsibility', type: 'text' }]);
  // Sequence shows in Revu and we have no such column; Legend is hidden there, and Author is not in the list.
  assert.deepEqual(r.skipped, ['Sequence']);
});

test('a column hidden in Revu is hidden here, and widths stay sensible', () => {
  const text = BPX.replace('<Width>208</Width><Visible>True</Visible>', '<Width>9000</Width><Visible>False</Visible>');
  const r = layoutFromBpx(parseBpx(text), ids());
  assert.deepEqual(r.layout[0], { key: 'subject', width: 600, hidden: true });
});

test('Page and Page Index are one column here, shown when either is', () => {
  const text = BPX.replace('<Column Key="Page"><Width>100</Width><Visible>True</Visible>', '<Column Key="Page"><Width>100</Width><Visible>False</Visible>').replace('<Column Key="Page Index"><Width>98</Width><Visible>False</Visible>', '<Column Key="Page Index"><Width>98</Width><Visible>True</Visible>');
  const r = layoutFromBpx(parseBpx(text), ids());
  assert.deepEqual(r.layout.filter((c) => c.key === 'page'), [{ key: 'page', width: 98, hidden: false }]);
  // The other way round (Page Index hidden first, Page shown later) must not lose the visible one.
  const flipped = BPX.replace('<Column Key="Page" />', 'TMP').replace('<Column Key="Page Index" />', '<Column Key="Page" />').replace('TMP', '<Column Key="Page Index" />');
  assert.deepEqual(layoutFromBpx(parseBpx(flipped), ids()).layout.filter((c) => c.key === 'page'), [{ key: 'page', width: 100, hidden: false }]);
});

// Run with REVU_SETTINGS_DIR pointing at a Revu settings folder to read its own profiles.
const dir = process.env.REVU_SETTINGS_DIR;
test('Revu\'s own profiles all read, and their visible columns come across', { skip: !dir }, () => {
  const files = [...readdirSync(dir!).filter((f) => f.endsWith('.bpx')).map((f) => `${dir}/${f}`), `${dir}/_BuiltIn/FullScreen.bpx`];
  assert.ok(files.length >= 4);
  for (const f of files) {
    const r = layoutFromBpx(parseBpx(readFileSync(f, 'utf8')), ids());
    assert.ok(r.layout.some((c) => c.key === 'subject' && !c.hidden), f);
    assert.equal(new Set(r.layout.map((c) => c.key)).size, r.layout.length, `no duplicates in ${f}`);
  }
  const qto = layoutFromBpx(parseBpx(readFileSync(`${dir}/Quantity Takeoff.bpx`, 'utf8')), ids());
  assert.ok(qto.layout.some((c) => c.key === 'length' && !c.hidden));
  const issues = layoutFromBpx(parseBpx(readFileSync(`${dir}/Field Issues.bpx`, 'utf8')), ids());
  assert.deepEqual(issues.custom.map((c) => c.name), ['Responsibility']);
});

test('our markup list goes out as a Revu profile and comes back the same', () => {
  const custom = [
    { id: 'c1', name: 'Responsibility', type: 'text' as const },
    { id: 'c2', name: 'Cost', type: 'number' as const },
  ];
  const layout = [
    { key: 'subject', width: 200, hidden: false },
    { key: 'page', width: 60, hidden: false },
    { key: 'custom:c2', width: 90, hidden: false },
    { key: 'status', width: 120, hidden: true },
    { key: 'custom:c1', width: 150, hidden: false },
    { key: 'seq', width: 40, hidden: false },
  ];
  const { profile, skipped } = bpxFromLayout('Office', layout, custom);
  assert.deepEqual(skipped, []);
  assert.deepEqual(
    profile.columns.map((c) => [c.key, c.visible]),
    [['Subject', true], ['Page Index', true], ['UserDefined0', true], ['Status', false], ['UserDefined1', true]],
  );
  assert.deepEqual(profile.customColumns.map((c) => [c.index, c.name, c.subtype]), [[0, 'Cost', 'Number'], [1, 'Responsibility', 'Text']]);
  let n = 0;
  const back = layoutFromBpx(parseBpx(writeBpx(profile)), () => `n${n++}`);
  assert.deepEqual(back.layout.map((l) => [l.key.startsWith('custom:') ? back.custom.find((c) => `custom:${c.id}` === l.key)!.name : l.key, l.width, l.hidden]), [
    ['subject', 200, false],
    ['page', 60, false],
    ['Cost', 90, false],
    ['status', 120, true],
    ['Responsibility', 150, false],
  ]);
  assert.deepEqual(back.custom.map((c) => c.type), ['number', 'text']);
});
