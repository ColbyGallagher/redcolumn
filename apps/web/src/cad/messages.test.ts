import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summaryText, warningText } from './messages';

test('skipped entities are named in words, with plurals', () => {
  assert.equal(warningText({ kind: 'unsupported', type: 'MULTILEADER', count: 3 }), '3 multileaders not drawn (not supported yet).');
  assert.equal(warningText({ kind: 'unsupported', type: 'BODY', count: 2 }), '2 3D bodies not drawn (not supported yet).');
  assert.equal(warningText({ kind: 'unsupported', type: 'HATCH (pattern too dense)', count: 1 }), '1 hatch not drawn (pattern too dense).');
  assert.equal(warningText({ kind: 'unsupported', type: 'HATCH (pattern too dense)', count: 2 }), '2 hatches not drawn (pattern too dense).');
  assert.equal(warningText({ kind: 'unsupported', type: 'objects that could not be read', count: 4 }), '4 objects could not be read and are left out.');
});

test('references, fonts and scales read as instructions', () => {
  assert.match(warningText({ kind: 'missing-xref', name: 'SURVEY', path: 'survey.dwg' }), /^Reference survey\.dwg was not found.*Convert Again/);
  assert.match(warningText({ kind: 'font-substituted', font: 'romans.shx', with: 'sans' }), /romans\.shx is drawn in Liberation Sans/);
  assert.match(warningText({ kind: 'scale-check', sheet: 'A-101', viewport: 'Viewport 1', measured: 10.2, stated: 10 }), /stating 10 measures 10\.2/);
});

test('the summary counts pages and things to check', () => {
  const report = { format: 'dwg', version: 'AC1032', pages: [{}, {}], layers: [], layouts: [], references: [], warnings: [] } as never;
  assert.equal(summaryText('site.dwg', report), 'Converted from site.dwg: 2 pages.');
  const one = { ...(report as object), pages: [{}], warnings: [{ kind: 'units-assumed', unit: 'millimetres' }] } as never;
  assert.equal(summaryText('site.dxf', one), 'Converted from site.dxf: 1 page, 1 thing to check.');
});
