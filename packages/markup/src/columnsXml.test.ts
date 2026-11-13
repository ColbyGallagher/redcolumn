import test from 'node:test';
import assert from 'node:assert/strict';
import { bluebeamColumnsFromXml, importColumnsXml } from './columns.ts';

const choice = (index: number, name: string, order: number, values: string[], def?: string) =>
  `<BSIColumnItem Index="${index}" Subtype="Choice"><Name>${name}</Name><DisplayOrder>${order}</DisplayOrder>${def ? `<DefaultValue>${def}</DefaultValue>` : ''}<Deleted>False</Deleted><Format>Normal</Format><Precision>2</Precision><Items>${values.map((v, i) => `<Item Index="${i}"><Value>${v}</Value>${v === def ? '<Default>True</Default>' : ''}</Item>`).join('')}</Items><AllowCustom>False</AllowCustom></BSIColumnItem>`;

// Shaped like a Bluebeam Manage Columns export, with its own names and values.
const sample = `<?xml version="1.0" encoding="utf-8"?>
<BluebeamUserDefinedColumns>
  <BSIColumnItem Index="0" Subtype="Date"><Name>Inspection Day</Name><DisplayOrder>0</DisplayOrder><Deleted>False</Deleted><DefaultStyle>Current</DefaultStyle><Format>dd/MM/yyyy</Format></BSIColumnItem>
  ${choice(1, 'Zone', 1, ['North', 'South', 'East'])}
  ${choice(2, 'Severity', 2, ['Minor', 'Major', 'Blocker'], 'Major')}
  ${choice(3, 'Trade', 3, ['Electrical', 'Plumbing', 'Joinery', 'Other'])}
  ${choice(4, 'Sign-off', 4, ['Open', 'Closed', 'Deferred'], 'Open')}
</BluebeamUserDefinedColumns>`;

test('Bluebeam custom columns XML imports in display order with types, choices and defaults', () => {
  const cols = bluebeamColumnsFromXml(sample);
  assert.deepEqual(cols.map((c) => c.name), ['Inspection Day', 'Zone', 'Severity', 'Trade', 'Sign-off']);
  assert.equal(cols[0]!.type, 'date');
  assert.deepEqual(cols[1]!.options, ['North', 'South', 'East']);
  assert.equal(cols[2]!.defaultValue, 'Major');
  assert.equal(cols[4]!.defaultValue, 'Open');
  assert.equal(cols[2]!.id, 'bluebeam:Severity');
});

test('importColumnsXml leaves statuses alone for a Bluebeam file', () => {
  const set = importColumnsXml(sample);
  assert.equal(set.columns.length, 5);
  assert.equal(set.statuses, undefined);
});

test('Bluebeam import skips deleted columns', () => {
  const xml = '<BluebeamUserDefinedColumns><BSIColumnItem Index="0" Subtype="Text"><Name>Retired</Name><Deleted>True</Deleted></BSIColumnItem><BSIColumnItem Index="1" Subtype="Checkmark"><Name>Photographed</Name><DefaultValue>True</DefaultValue></BSIColumnItem></BluebeamUserDefinedColumns>';
  const cols = bluebeamColumnsFromXml(xml);
  assert.deepEqual(cols.map((c) => c.name), ['Photographed']);
  assert.equal(cols[0]!.defaultValue, 'true');
});
