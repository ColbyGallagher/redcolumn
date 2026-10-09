import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_STYLES, type CustomColumn, type Markup } from '@nb/markup';
import { DEFAULT_SCALE } from '@nb/measure';
import type { SheetInfo } from '@nb/sheets';
import type { CellContext } from '../columns/listColumns.ts';
import {
  applyIncludeMode,
  defaultBcf,
  filterFromValues,
  includeMode,
  parseBatchFile,
  parseBcf,
  parsePageSpec,
  readFilter,
  serializeBatchFile,
  serializeBcf,
  type BcfConfig,
} from './bcf.ts';
import { buildSummary, type SummarySource } from './exportSummary.ts';

const real = readFileSync(new URL('./fixtures/batch-config.bcf', import.meta.url), 'utf8');

test('BatchConfig.bcf is Revu JSON version 3 with the saved columns, sort and output flags', () => {
  const config = parseBcf(real);
  assert.equal(config.Version, 3);
  assert.equal(config.ExportFormat, 0);
  assert.equal(config.Location, 'C:\\Users\\Colby\\OneDrive\\Desktop');
  assert.equal(config.Title, 'bluebeam-sample-do-not-edit');
  assert.deepEqual(
    config.Columns.map((c) => [c.Key, c.Name, c.Type, c.FilterOnly]),
    [
      ['Subject', 'Subject', 0, false],
      ['Author', 'Author', 0, false],
      ['Page', 'Page Label', 0, false],
      ['Comments', 'Comments', 0, false],
      ['Date', 'Date', 0, false],
      ['Status', 'Status', 7, false],
      ['Color', 'Colour', 4, false],
      ['Layer', 'Layer', 8, false],
      ['Space', 'Space', 0, false],
      ['C:\\Projects\\redcolumn\\reference_data\\bluebeam-sample-do-not-edit.pdf|UserDefined0', 'CUSTOM COLUMN 1', 0, false],
      ['C:\\Projects\\redcolumn\\reference_data\\bluebeam-sample-do-not-edit.pdf|UserDefined1', 'CUSTOM COLUMN 2', 2, false],
      ['C:\\Projects\\redcolumn\\reference_data\\bluebeam-sample-do-not-edit.pdf|UserDefined2', 'CUSTOM COLUMN 3', 3, false],
      ['C:\\Projects\\redcolumn\\reference_data\\bluebeam-sample-do-not-edit.pdf|UserDefined3', 'CUSTOM COLUMN 4', 6, false],
      ['C:\\Projects\\redcolumn\\reference_data\\bluebeam-sample-do-not-edit.pdf|UserDefined4', 'CUSTOM COLUMN NUMBER', 6, false],
    ],
  );
  assert.deepEqual(config.Sorts, [{ Item1: 'Subject', Item2: true }]);
  assert.equal(config.SplitReportOnPrimarySort, false);
  assert.equal(config.AppendDateToTitle, false);
  assert.equal(config.ReplaceExistingFiles, false);
  assert.equal(config.IncludeReplies, true);
  assert.equal(config.IncludeContent, true);
  assert.equal(config.IncludeTotals, true);
  assert.equal(includeMode(config), 'both');
  assert.equal(config.IncludeHeaders, true);
  assert.equal(config.IncludeIDColumn, true);
  assert.equal(config.OpenDocument, true);
  assert.equal(config.IncludeUnits, true);
  assert.equal(config.FormatNumbers, true);
  assert.equal(config.IncludeFullStatusHistory, true);
  assert.equal(config.IncludeStatusAuthorAndTime, true);
  assert.equal(config.ShowEmptyColumns, false);
  assert.equal(config.ShowUnselectedColumns, false);
  assert.equal(config.Padding, 25);
  assert.equal(config.Columns.every((c) => c.Filter === undefined), true);
});

test('saving a .bcf round-trips Revu fields and keeps unknown ones', () => {
  const parsed = parseBcf(real);
  parsed.Columns[0] = { ...parsed.Columns[0]!, Note: 'keep me' };
  const withExtra = { ...parsed, FutureFlag: true } as BcfConfig;
  const again = parseBcf(serializeBcf(withExtra));
  assert.equal(again.FutureFlag, true);
  assert.equal(again.Columns[0]?.Note, 'keep me');
  assert.deepEqual(again.Columns.map((c) => c.Key), parsed.Columns.map((c) => c.Key));
  assert.deepEqual(again.Sorts, parsed.Sorts);
  assert.deepEqual(
    Object.keys(JSON.parse(serializeBcf(parseBcf(real))) as object),
    Object.keys(JSON.parse(real) as object),
  );
  const filtered = parseBcf(serializeBcf({ ...parsed, Columns: parsed.Columns.map((c, i) => (i === 0 ? { ...c, Filter: filterFromValues(['Line']) } : c)) }));
  assert.deepEqual(readFilter(filtered.Columns[0]?.Filter), { values: ['Line'], custom: false });
  const cleared = parseBcf(serializeBcf({ ...filtered, Columns: filtered.Columns.map((c, i) => (i === 0 ? { ...c, Filter: undefined } : c)) }));
  assert.equal(cleared.Columns[0]?.Filter, undefined);
});

test('a basic filter is an OR of Equals, and [All] writes no Filter', () => {
  assert.equal(filterFromValues(null), undefined);
  assert.deepEqual(readFilter(filterFromValues(['A', 'B'])), { values: ['A', 'B'], custom: false });
  assert.deepEqual(readFilter(undefined), { values: null, custom: false });
  assert.equal(readFilter({ AndConditions: [{ OrConditions: [{ Test: 2, Value: 'x' }] }] }).custom, true);
  assert.equal(includeMode(applyIncludeMode(defaultBcf('t', []), 'totals')), 'totals');
  assert.equal(includeMode(applyIncludeMode(defaultBcf('t', []), 'markups')), 'markups');
});

test('page lists and the batch file list round-trip', () => {
  assert.deepEqual(parsePageSpec('1-2, 4', 5), [0, 1, 3]);
  assert.deepEqual(parsePageSpec('3-1', 0), [0, 1, 2]);
  const xml = serializeBatchFile([
    { filename: 'a.pdf', scope: { kind: 'all' } },
    { filename: 'b.pdf', scope: { kind: 'custom', text: '1-2' } },
  ]);
  assert.match(xml, /<BatchMatchSet Version="3">/);
  assert.deepEqual(parseBatchFile(xml), [
    { filename: 'a.pdf', scope: { kind: 'all' } },
    { filename: 'b.pdf', scope: { kind: 'custom', text: '1-2' } },
  ]);
});

const sheet: SheetInfo = { number: 'PAGE LABEL 1', title: null, discipline: null, scaleText: null, revision: null, source: 'manual', confidence: 1 };

const custom: CustomColumn[] = [
  { id: 'bluebeam:CUSTOM COLUMN 1', name: 'CUSTOM COLUMN 1', type: 'text' },
  { id: 'bluebeam:CUSTOM COLUMN NUMBER', name: 'CUSTOM COLUMN NUMBER', type: 'number', decimals: 2 },
];

function markup(extra: Partial<Markup> & Pick<Markup, 'id' | 'subject'>): Markup {
  return {
    type: 'line',
    pageIndex: 0,
    points: [
      [0, 0],
      [10, 0],
    ],
    style: { ...DEFAULT_STYLES.line, stroke: '#ff0000' },
    status: 'none',
    author: 'Colby',
    createdAt: 1,
    modifiedAt: Date.parse('2026-10-08T00:00:00Z'),
    ...extra,
  };
}

function source(markups: Markup[], scope: SummarySource['scope'] = { kind: 'all' }): SummarySource {
  const ctx: CellContext = {
    scaleOf: () => DEFAULT_SCALE,
    sheets: { 0: sheet, 1: { ...sheet, number: 'PAGE LABEL 2' } },
    statuses: [{ id: 'accepted', name: 'Accepted', color: '#16a34a' }],
    columns: custom,
  };
  return { id: 'f', fileName: 'bluebeam-sample-do-not-edit.pdf', pageCount: 2, currentPage: 1, scope, markups, ctx };
}

test('CSV export follows columns, filters, sort, ids, replies, status and empty columns', () => {
  const config = parseBcf(real);
  config.IncludeTotals = false;
  config.Columns = config.Columns.map((c) => (c.Key === 'Subject' ? { ...c, Filter: filterFromValues(['Line']) } : c));
  config.Sorts = [{ Item1: 'Subject', Item2: false }];
  const markups = [
    markup({
      id: 'a',
      seq: 2,
      subject: 'Line',
      comment: 'TEXTBOX',
      status: 'accepted',
      statusHistory: [{ state: 'Accepted', model: 'Review', author: 'Colby', at: Date.parse('2026-05-10T00:00:00Z') }],
      replies: [{ id: 'r', author: 'Colby', text: 'noted', createdAt: 2 }],
      fields: { 'bluebeam:CUSTOM COLUMN 1': 'DSFSDFDG', 'bluebeam:CUSTOM COLUMN NUMBER': '7' },
      layer: '',
    }),
    markup({ id: 'b', seq: 1, subject: 'Cloud', pageIndex: 1, groupId: 'g', fields: { 'bluebeam:CUSTOM COLUMN NUMBER': '1.5' } }),
    markup({ id: 'c', seq: 3, subject: 'Line', pageIndex: 1, groupId: 'g' }),
  ];
  markups[0]!.groupId = 'g';
  const [file] = buildSummary(config, [source(markups)]);
  const csv = file?.text ?? '';
  const lines = csv.split('\r\n');
  assert.match(lines[0]!, /^ID,Parent,Subject,/);
  assert.equal(lines[0]!.includes('Layer'), false);
  assert.equal(lines[0]!.includes('Space'), false);
  assert.match(lines[0]!, /CUSTOM COLUMN 1/);
  assert.match(lines[0]!, /CUSTOM COLUMN NUMBER/);
  assert.equal(lines.length, 3);
  assert.match(lines[1]!, /DSFSDFDG/);
  assert.match(lines[1]!, /7\.00/);
  assert.match(lines[1]!, /noted/);
  assert.match(lines[1]!, /Accepted set by Colby on/);
  assert.match(lines[1]!, /PAGE LABEL/);
  const page2 = lines.find((line) => line.includes('PAGE LABEL 2'));
  assert.ok(page2);
  assert.match(page2!, /^3,/);
  assert.match(page2!, /,2,/);
});

test('page scope, unformatted numbers and totals-only change the CSV', () => {
  const config = parseBcf(real);
  config.ShowEmptyColumns = true;
  config.IncludeContent = false;
  config.IncludeTotals = true;
  config.IncludeIDColumn = false;
  config.IncludeReplies = false;
  config.IncludeFullStatusHistory = false;
  config.FormatNumbers = false;
  config.Columns = config.Columns.filter((c) => c.Key === 'Subject' || c.Key.endsWith('UserDefined4'));
  const markups = [
    markup({ id: 'a', seq: 5, subject: 'Line', fields: { 'bluebeam:CUSTOM COLUMN NUMBER': '7' } }),
    markup({ id: 'b', subject: 'Line', pageIndex: 1, fields: { 'bluebeam:CUSTOM COLUMN NUMBER': '1.5' } }),
  ];
  const scoped = buildSummary(config, [source(markups, { kind: 'custom', text: '1' })]);
  const lines = (scoped[0]?.text ?? '').split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1]!, /7/);
  assert.doesNotMatch(lines[1]!, /7\.00/);
  assert.equal(lines[1]!.includes('1.5'), false);
  config.IncludeIDColumn = true;
  const withId = buildSummary(config, [source(markups, { kind: 'custom', text: '1' })])[0]?.text ?? '';
  assert.match(withId, /ID,Parent,Subject/);
  assert.match(withId, /\r\n,,Line,/);
  assert.doesNotMatch(withId, /\r\n5,/);
});
