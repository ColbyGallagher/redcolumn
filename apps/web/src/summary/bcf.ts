/**
 * Bluebeam Revu Markup Summary configuration (.bcf).
 *
 * Revu 21 writes this with Newtonsoft.Json from `BatchSummaryConfiguration`
 * (`NullValueHandling.Ignore`, plus `FilterConditionConverter`). It is one JSON
 * object, not XML and not a zip. Version 3 is the current schema.
 *
 * Public fields come first, then public properties, in this order:
 * - Version (int)
 * - Columns: { Key, Name, Type, FilterOnly, Filter? }
 *   Type is `MarkupListColumnType`: 0 Text, 1 RichText, 2 CheckBox (tick),
 *   3 Date, 4 Color, 5 Measure, 6 Number (formula results use this too),
 *   7 Choice (Status), 8 Layer, 9 Capture, 10 UserDefined.
 *   FilterOnly true means the column is unchecked (filterable, not exported).
 *   Filter is omitted when the column is [All]. A basic filter is
 *   `{ AndConditions: [{ OrConditions: [{ Test, Value }] }] }`.
 *   Test is `MarkupFilterTestEnum` (0 Equals, 1 NotEquals, 2 Contains, …).
 *   Custom-column keys are `{pdf path}|UserDefined{index}`.
 * - Sorts: `{ Item1: column Key, Item2: ascending }` (`Tuple<string, bool>`).
 * - ExportFormat: 0 CSV, 1 XML, 2 PDF, 3 Print (4 is an internal cloud value).
 * - Location, Title (file name without extension)
 * - SplitReportOnPrimarySort — Create Multiple Reports Per {sort column}
 * - AppendDateToTitle, ReplaceExistingFiles (Overwrite Existing File)
 * - IncludeReplies
 * - Template, LayoutStyle, PreviewSize, Padding (decimal), PageSize, Orientation
 *   — PDF layout; kept even when exporting CSV
 * - IncludeContent — markups rows. With IncludeTotals: Markups, Totals, or both.
 * - AppendToCurrentPDF, IncludeTotals, CreateHyperlinks, IncludeMedia, AttachMedia
 * - IncludeSpaces, InsertPageBreaks, UseCurrentColumnWidths
 * - FormatNumbers, IncludeTotalsStyle
 * - IncludeHeaders (Column Headers), IncludeIDColumn (ID and Parent)
 * - OpenDocument (Open File After Creation), IncludeUnits (measurement unit columns)
 * - IncludeFullStatusHistory, IncludeStatusAuthorAndTime
 * - ShowEmptyColumns, ShowUnselectedColumns (Filter tab “Show All Columns”)
 *
 * The file list above the tabs is not part of the .bcf. Revu saves that separately
 * (`BatchFileHelper`) as XML rooted at BatchMatchSet.
 *
 * Unknown properties are kept so a file Revu wrote round-trips.
 */

import type { ColumnType, CustomColumn } from '@nb/markup';

export const BCF_VERSION = 3;

export const COLUMN_TYPE = {
  Text: 0,
  RichText: 1,
  CheckBox: 2,
  Date: 3,
  Color: 4,
  Measure: 5,
  Number: 6,
  Choice: 7,
  Layer: 8,
  Capture: 9,
  UserDefined: 10,
} as const;

/** MarkupFilterTestEnum. Basic checklist filters use Equals. */
export const FILTER_TEST = { Equals: 0, NotEquals: 1, Contains: 2, NotContains: 3 } as const;

export const EXPORT_FORMAT = { CSV: 0, XML: 1, PDF: 2, Print: 3 } as const;

export const EXPORT_FORMATS: { value: number; label: string }[] = [
  { value: EXPORT_FORMAT.CSV, label: 'CSV' },
  { value: EXPORT_FORMAT.XML, label: 'XML' },
  { value: EXPORT_FORMAT.PDF, label: 'PDF' },
  { value: EXPORT_FORMAT.Print, label: 'Print' },
];

export interface BcfCondition {
  Test: number;
  Value: unknown;
  [key: string]: unknown;
}

export interface BcfAndCondition {
  OrConditions: BcfCondition[];
  [key: string]: unknown;
}

export interface BcfFilter {
  AndConditions: BcfAndCondition[];
  [key: string]: unknown;
}

export interface BcfColumn {
  Key: string;
  Name: string;
  Type: number;
  FilterOnly: boolean;
  Filter?: BcfFilter;
  [key: string]: unknown;
}

export interface BcfSort {
  Item1: string;
  Item2: boolean;
  [key: string]: unknown;
}

export interface BcfConfig {
  Version: number;
  Columns: BcfColumn[];
  Sorts: BcfSort[];
  ExportFormat: number;
  Location: string;
  Title: string;
  SplitReportOnPrimarySort: boolean;
  AppendDateToTitle: boolean;
  ReplaceExistingFiles: boolean;
  IncludeReplies: boolean;
  Template: string;
  LayoutStyle: number;
  PreviewSize: number;
  Padding: number;
  PageSize: number;
  Orientation: number;
  IncludeContent: boolean;
  AppendToCurrentPDF: boolean;
  IncludeTotals: boolean;
  CreateHyperlinks: boolean;
  IncludeMedia: boolean;
  AttachMedia: boolean;
  IncludeSpaces: boolean;
  InsertPageBreaks: boolean;
  UseCurrentColumnWidths: boolean;
  FormatNumbers: boolean;
  IncludeTotalsStyle: number;
  IncludeHeaders: boolean;
  IncludeIDColumn: boolean;
  OpenDocument: boolean;
  IncludeUnits: boolean;
  IncludeFullStatusHistory: boolean;
  IncludeStatusAuthorAndTime: boolean;
  ShowEmptyColumns: boolean;
  ShowUnselectedColumns: boolean;
  [key: string]: unknown;
}

const ROOT_ORDER = [
  'Version',
  'Columns',
  'Sorts',
  'ExportFormat',
  'Location',
  'Title',
  'SplitReportOnPrimarySort',
  'AppendDateToTitle',
  'ReplaceExistingFiles',
  'IncludeReplies',
  'Template',
  'LayoutStyle',
  'PreviewSize',
  'Padding',
  'PageSize',
  'Orientation',
  'IncludeContent',
  'AppendToCurrentPDF',
  'IncludeTotals',
  'CreateHyperlinks',
  'IncludeMedia',
  'AttachMedia',
  'IncludeSpaces',
  'InsertPageBreaks',
  'UseCurrentColumnWidths',
  'FormatNumbers',
  'IncludeTotalsStyle',
  'IncludeHeaders',
  'IncludeIDColumn',
  'OpenDocument',
  'IncludeUnits',
  'IncludeFullStatusHistory',
  'IncludeStatusAuthorAndTime',
  'ShowEmptyColumns',
  'ShowUnselectedColumns',
];

const COLUMN_ORDER = ['Key', 'Name', 'Type', 'FilterOnly', 'Filter'];
const FILTER_ORDER = ['AndConditions'];
const AND_ORDER = ['OrConditions'];
const CONDITION_ORDER = ['Test', 'Value'];
const SORT_ORDER = ['Item1', 'Item2'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function orderObject(obj: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of known) if (k in obj && obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out) && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function parseFilter(raw: unknown): BcfFilter | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.AndConditions)) return undefined;
  const AndConditions = raw.AndConditions.filter(isRecord).map((and) => {
    const OrConditions = (Array.isArray(and.OrConditions) ? and.OrConditions : []).filter(isRecord).map((c) =>
      orderObject({ ...c, Test: asNum(c.Test, 0), Value: c.Value ?? '' }, CONDITION_ORDER),
    ) as BcfCondition[];
    return orderObject({ ...and, OrConditions }, AND_ORDER) as BcfAndCondition;
  });
  return orderObject({ ...raw, AndConditions }, FILTER_ORDER) as BcfFilter;
}

function parseColumn(raw: unknown): BcfColumn | null {
  if (!isRecord(raw) || typeof raw.Key !== 'string') return null;
  const Filter = parseFilter(raw.Filter);
  const column: Record<string, unknown> = { ...raw, Key: raw.Key, Name: asStr(raw.Name, raw.Key), Type: asNum(raw.Type, 0), FilterOnly: asBool(raw.FilterOnly, false) };
  if (Filter) column.Filter = Filter;
  else delete column.Filter;
  return orderObject(column, COLUMN_ORDER) as BcfColumn;
}

/** Reads a Markup Summary .bcf. Throws a short message when the file is not one. */
export function parseBcf(text: string): BcfConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a Bluebeam summary config (expected a JSON .bcf file).');
  }
  if (!isRecord(raw) || !Array.isArray(raw.Columns)) {
    throw new Error('This is not a Bluebeam summary config (expected a Columns list).');
  }
  const Columns = raw.Columns.map(parseColumn).filter((c): c is BcfColumn => !!c);
  const Sorts = (Array.isArray(raw.Sorts) ? raw.Sorts : []).filter(isRecord).map(
    (s) => orderObject({ ...s, Item1: asStr(s.Item1), Item2: asBool(s.Item2, true) }, SORT_ORDER) as BcfSort,
  );
  const config: Record<string, unknown> = {
    ...raw,
    Version: asNum(raw.Version, BCF_VERSION),
    Columns,
    Sorts,
    ExportFormat: asNum(raw.ExportFormat, EXPORT_FORMAT.CSV),
    Location: asStr(raw.Location),
    Title: asStr(raw.Title),
    SplitReportOnPrimarySort: asBool(raw.SplitReportOnPrimarySort, false),
    AppendDateToTitle: asBool(raw.AppendDateToTitle, false),
    ReplaceExistingFiles: asBool(raw.ReplaceExistingFiles, false),
    IncludeReplies: asBool(raw.IncludeReplies, true),
    Template: asStr(raw.Template),
    LayoutStyle: asNum(raw.LayoutStyle, 0),
    PreviewSize: asNum(raw.PreviewSize, 0),
    Padding: asNum(raw.Padding, 25),
    PageSize: asNum(raw.PageSize, 4),
    Orientation: asNum(raw.Orientation, 0),
    IncludeContent: asBool(raw.IncludeContent, true),
    AppendToCurrentPDF: asBool(raw.AppendToCurrentPDF, false),
    IncludeTotals: asBool(raw.IncludeTotals, false),
    CreateHyperlinks: asBool(raw.CreateHyperlinks, false),
    IncludeMedia: asBool(raw.IncludeMedia, false),
    AttachMedia: asBool(raw.AttachMedia, false),
    IncludeSpaces: asBool(raw.IncludeSpaces, false),
    InsertPageBreaks: asBool(raw.InsertPageBreaks, false),
    UseCurrentColumnWidths: asBool(raw.UseCurrentColumnWidths, false),
    FormatNumbers: asBool(raw.FormatNumbers, true),
    IncludeTotalsStyle: asNum(raw.IncludeTotalsStyle, 0),
    IncludeHeaders: asBool(raw.IncludeHeaders, true),
    IncludeIDColumn: asBool(raw.IncludeIDColumn, false),
    OpenDocument: asBool(raw.OpenDocument, true),
    IncludeUnits: asBool(raw.IncludeUnits, true),
    IncludeFullStatusHistory: asBool(raw.IncludeFullStatusHistory, true),
    IncludeStatusAuthorAndTime: asBool(raw.IncludeStatusAuthorAndTime, true),
    ShowEmptyColumns: asBool(raw.ShowEmptyColumns, false),
    ShowUnselectedColumns: asBool(raw.ShowUnselectedColumns, false),
  };
  return orderObject(config, ROOT_ORDER) as BcfConfig;
}

function emitFilter(filter: BcfFilter | undefined): BcfFilter | undefined {
  if (!filter) return undefined;
  return orderObject(
    {
      ...filter,
      AndConditions: filter.AndConditions.map((and) =>
        orderObject(
          {
            ...and,
            OrConditions: and.OrConditions.map((c) => orderObject({ ...c }, CONDITION_ORDER)),
          },
          AND_ORDER,
        ),
      ),
    },
    FILTER_ORDER,
  ) as BcfFilter;
}

/** Writes a .bcf Revu can open: same names, unknown fields kept, null filters left out. */
export function serializeBcf(config: BcfConfig): string {
  const Columns = config.Columns.map((c) => {
    const Filter = emitFilter(c.Filter);
    const column: Record<string, unknown> = { ...c };
    if (Filter && Filter.AndConditions.length) column.Filter = Filter;
    else delete column.Filter;
    return orderObject(column, COLUMN_ORDER);
  });
  const Sorts = config.Sorts.filter((s) => s.Item1).map((s) => orderObject({ ...s }, SORT_ORDER));
  return JSON.stringify(orderObject({ ...config, Columns, Sorts }, ROOT_ORDER));
}

/** A fresh config in the shape Revu saves, with the columns given (all included). */
export function defaultBcf(title: string, columns: readonly BcfColumn[]): BcfConfig {
  return parseBcf(
    JSON.stringify({
      Version: BCF_VERSION,
      Columns: columns,
      Sorts: [{ Item1: 'Subject', Item2: true }],
      ExportFormat: EXPORT_FORMAT.CSV,
      Location: '',
      Title: title,
      SplitReportOnPrimarySort: false,
      AppendDateToTitle: false,
      ReplaceExistingFiles: false,
      IncludeReplies: true,
      Template: '',
      LayoutStyle: 0,
      PreviewSize: 0,
      Padding: 25,
      PageSize: 4,
      Orientation: 0,
      IncludeContent: true,
      AppendToCurrentPDF: false,
      IncludeTotals: false,
      CreateHyperlinks: false,
      IncludeMedia: false,
      AttachMedia: false,
      IncludeSpaces: false,
      InsertPageBreaks: false,
      UseCurrentColumnWidths: false,
      FormatNumbers: true,
      IncludeTotalsStyle: 0,
      IncludeHeaders: true,
      IncludeIDColumn: false,
      OpenDocument: true,
      IncludeUnits: true,
      IncludeFullStatusHistory: true,
      IncludeStatusAuthorAndTime: true,
      ShowEmptyColumns: false,
      ShowUnselectedColumns: false,
    }),
  );
}

/** Markups / Totals / Markups & Totals. */
export type IncludeMode = 'markups' | 'totals' | 'both';

export function includeMode(config: Pick<BcfConfig, 'IncludeContent' | 'IncludeTotals'>): IncludeMode {
  if (config.IncludeContent && config.IncludeTotals) return 'both';
  if (config.IncludeTotals) return 'totals';
  return 'markups';
}

export function applyIncludeMode(config: BcfConfig, mode: IncludeMode): BcfConfig {
  return { ...config, IncludeContent: mode !== 'totals', IncludeTotals: mode !== 'markups' };
}

/**
 * Values checked in a basic filter (OR of Equals). Null means [All] (no Filter).
 * A filter Revu saved with any other test is left untouched (`custom`).
 */
export function readFilter(filter: BcfFilter | undefined): { values: string[] | null; custom: boolean } {
  if (!filter || !filter.AndConditions.length) return { values: null, custom: false };
  const ors = filter.AndConditions.length === 1 ? filter.AndConditions[0]!.OrConditions : null;
  if (!ors) return { values: null, custom: true };
  if (ors.some((c) => c.Test !== FILTER_TEST.Equals)) return { values: null, custom: true };
  return { values: ors.map((c) => (c.Value == null ? '' : String(c.Value))), custom: false };
}

/** A basic checklist filter. Null (everything selected) omits Filter, which Revu reads as [All]. */
export function filterFromValues(values: readonly string[] | null): BcfFilter | undefined {
  if (!values) return undefined;
  return {
    AndConditions: [{ OrConditions: values.map((Value) => ({ Test: FILTER_TEST.Equals, Value })) }],
  };
}

export interface SummaryColumnInfo {
  /** Cell key in the markups list (`subject`, `custom:…`, `layer`, …). */
  key: string;
  /** Bluebeam column Key. */
  bcfKey: string;
  name: string;
  type: number;
  /** Type column: Built-In, or the custom column's type (Text, Tick mark, Date, Formula, Number). */
  typeLabel: string;
  custom?: CustomColumn;
  measure: boolean;
  align?: 'right';
  width: number;
}

const MEASURE_KEYS = new Set(['measurement', 'length', 'area', 'volume', 'wallArea', 'depth', 'slope']);

/** Built-in summary columns Revu lists, in the order a saved config uses. */
const BUILTIN: { key: string; bcfKey: string; name: string; type: number; measure?: boolean; align?: 'right'; width: number }[] = [
  { key: 'subject', bcfKey: 'Subject', name: 'Subject', type: COLUMN_TYPE.Text, width: 130 },
  { key: 'author', bcfKey: 'Author', name: 'Author', type: COLUMN_TYPE.Text, width: 100 },
  { key: 'sheet', bcfKey: 'Page', name: 'Page Label', type: COLUMN_TYPE.Text, width: 110 },
  { key: 'comment', bcfKey: 'Comments', name: 'Comments', type: COLUMN_TYPE.Text, width: 200 },
  { key: 'date', bcfKey: 'Date', name: 'Date', type: COLUMN_TYPE.Text, width: 140 },
  { key: 'status', bcfKey: 'Status', name: 'Status', type: COLUMN_TYPE.Choice, width: 220 },
  { key: 'color', bcfKey: 'Color', name: 'Colour', type: COLUMN_TYPE.Color, width: 70 },
  { key: 'layer', bcfKey: 'Layer', name: 'Layer', type: COLUMN_TYPE.Layer, width: 100 },
  { key: 'space', bcfKey: 'Space', name: 'Space', type: COLUMN_TYPE.Text, width: 130 },
];

/** Further list columns, shown when they have data or Show Empty Columns is on. */
const EXTRA: { key: string; bcfKey: string; name: string; type: number; measure?: boolean; align?: 'right'; width: number }[] = [
  { key: 'page', bcfKey: 'PageIndex', name: 'Page', type: COLUMN_TYPE.Text, align: 'right', width: 56 },
  { key: 'measurement', bcfKey: 'Measurement', name: 'Measurement', type: COLUMN_TYPE.Measure, measure: true, align: 'right', width: 110 },
  { key: 'length', bcfKey: 'Length', name: 'Length', type: COLUMN_TYPE.Measure, measure: true, align: 'right', width: 100 },
  { key: 'area', bcfKey: 'Area', name: 'Area', type: COLUMN_TYPE.Measure, measure: true, align: 'right', width: 100 },
  { key: 'volume', bcfKey: 'Volume', name: 'Volume', type: COLUMN_TYPE.Measure, measure: true, align: 'right', width: 100 },
  { key: 'wallArea', bcfKey: 'WallArea', name: 'Wall Area', type: COLUMN_TYPE.Measure, measure: true, align: 'right', width: 100 },
  { key: 'depth', bcfKey: 'Depth', name: 'Depth', type: COLUMN_TYPE.Measure, measure: true, align: 'right', width: 90 },
  { key: 'slope', bcfKey: 'Slope', name: 'Slope', type: COLUMN_TYPE.Measure, measure: true, align: 'right', width: 70 },
  { key: 'checked', bcfKey: 'Checkmark', name: 'Checkmark', type: COLUMN_TYPE.CheckBox, width: 50 },
  { key: 'type', bcfKey: 'MarkupType', name: 'Type', type: COLUMN_TYPE.Text, width: 90 },
  { key: 'capture', bcfKey: 'Capture', name: 'Capture', type: COLUMN_TYPE.Capture, width: 70 },
];

const APP_BY_BCF = new Map([...BUILTIN, ...EXTRA].map((c) => [c.bcfKey.toLowerCase(), c.key]));

function typeLabelFor(type: ColumnType): string {
  switch (type) {
    case 'checkmark':
      return 'Tick mark';
    case 'date':
      return 'Date';
    case 'formula':
      return 'Formula';
    case 'number':
      return 'Number';
    case 'choice':
      return 'Dropdown';
    case 'multiline':
    case 'text':
      return 'Text';
  }
}

function typeLabelFromCode(type: number): string {
  switch (type) {
    case COLUMN_TYPE.CheckBox:
      return 'Tick mark';
    case COLUMN_TYPE.Date:
      return 'Date';
    case COLUMN_TYPE.Number:
      return 'Number';
    case COLUMN_TYPE.Choice:
      return 'Dropdown';
    case COLUMN_TYPE.Measure:
      return 'Measurement';
    default:
      return 'Text';
  }
}

function customTypeCode(type: ColumnType): number {
  switch (type) {
    case 'checkmark':
      return COLUMN_TYPE.CheckBox;
    case 'date':
      return COLUMN_TYPE.Date;
    case 'number':
    case 'formula':
      return COLUMN_TYPE.Number;
    case 'choice':
      return COLUMN_TYPE.Choice;
    default:
      return COLUMN_TYPE.Text;
  }
}

const customKey = (id: string) => `custom:${id}`;

/** UserDefined index at the end of a Bluebeam custom-column key, if it has one. */
export function userDefinedIndex(bcfKey: string): number | null {
  const m = /\|UserDefined(\d+)$/.exec(bcfKey);
  return m ? Number(m[1]) : null;
}

function builtinInfo(row: (typeof BUILTIN)[number]): SummaryColumnInfo {
  return { key: row.key, bcfKey: row.bcfKey, name: row.name, type: row.type, typeLabel: 'Built-In', measure: !!row.measure, width: row.width, ...(row.align ? { align: row.align } : {}) };
}

/** Columns the dialog can offer: Revu's built-ins, this document's custom columns, then the rest of the list. */
export function catalogColumns(custom: readonly CustomColumn[], fileName: string): SummaryColumnInfo[] {
  const customs: SummaryColumnInfo[] = custom.map((c, i) => ({
    key: customKey(c.id),
    bcfKey: `${fileName}|UserDefined${i}`,
    name: c.name,
    type: customTypeCode(c.type),
    typeLabel: typeLabelFor(c.type),
    custom: c,
    measure: false,
    width: c.type === 'multiline' ? 200 : 120,
    ...(c.type === 'number' || c.type === 'formula' ? { align: 'right' as const } : {}),
  }));
  return [...BUILTIN.map(builtinInfo), ...customs, ...EXTRA.map(builtinInfo)];
}

/** Default columns: the built-ins Revu shows first, then this document's custom columns. */
export function defaultColumns(custom: readonly CustomColumn[], fileName: string): BcfColumn[] {
  const catalog = catalogColumns(custom, fileName);
  const keys = new Set([...BUILTIN.map((b) => b.key), ...custom.map((c) => customKey(c.id))]);
  return catalog.filter((c) => keys.has(c.key)).map((c) => columnFromInfo(c, true));
}

export function columnFromInfo(info: SummaryColumnInfo, checked: boolean): BcfColumn {
  return { Key: info.bcfKey, Name: info.name, Type: info.type, FilterOnly: !checked };
}

function norm(s: string) {
  return s.trim().toLowerCase();
}

/** The catalog column a saved BCF column refers to, matched by key, custom-column name, or UserDefined index. */
export function matchColumn(column: BcfColumn, catalog: readonly SummaryColumnInfo[]): SummaryColumnInfo | null {
  const byKey = catalog.find((c) => c.bcfKey === column.Key || c.bcfKey.toLowerCase() === column.Key.toLowerCase());
  if (byKey) return byKey;
  const app = APP_BY_BCF.get(column.Key.toLowerCase());
  if (app) return catalog.find((c) => c.key === app) ?? null;
  const byName = catalog.find((c) => c.custom && norm(c.name) === norm(column.Name));
  if (byName) return byName;
  const index = userDefinedIndex(column.Key);
  if (index !== null) {
    const customs = catalog.filter((c) => c.custom);
    return customs[index] ?? null;
  }
  return null;
}

/** Display info for a BCF column, synthesizing one when this document has no such column. */
export function describeColumn(column: BcfColumn, catalog: readonly SummaryColumnInfo[]): SummaryColumnInfo {
  const found = matchColumn(column, catalog);
  if (found) {
    // Keep the file's Key and Name so a round-trip does not rename localised headings.
    return { ...found, bcfKey: column.Key, name: column.Name || found.name, type: column.Type };
  }
  return {
    key: `bcf:${column.Key}`,
    bcfKey: column.Key,
    name: column.Name || column.Key,
    type: column.Type,
    typeLabel: userDefinedIndex(column.Key) !== null ? typeLabelFromCode(column.Type) : 'Built-In',
    measure: column.Type === COLUMN_TYPE.Measure,
    width: 120,
  };
}

export function sameColumn(column: BcfColumn, info: SummaryColumnInfo, catalog: readonly SummaryColumnInfo[]): boolean {
  const matched = matchColumn(column, catalog);
  return matched ? matched.key === info.key : column.Key === info.bcfKey;
}

/** Which pages a file contributes. `all` means every page. Indexes are 0-based. */
export type PageScope = { kind: 'all' } | { kind: 'current' } | { kind: 'custom'; text: string };

export function pageScopeLabel(scope: PageScope, pageCount: number | null, currentPage: number): string {
  const span = pageCount && pageCount > 0 ? ` (1 - ${pageCount})` : '';
  if (scope.kind === 'all') return `All Pages${span}`;
  if (scope.kind === 'current') return `Current Page (${currentPage})`;
  return scope.text.trim() || 'Pages…';
}

/** 0-based page indexes, or null for every page. `pageCount` 0 means the count is not known yet. */
export function pagesInScope(scope: PageScope, pageCount: number, currentPage: number): number[] | null {
  if (scope.kind === 'all') return null;
  if (scope.kind === 'current') {
    const p = Math.max(1, currentPage);
    if (pageCount > 0 && p > pageCount) return [];
    return [p - 1];
  }
  return parsePageSpec(scope.text, pageCount);
}

/** Parses `1-2, 4` as 0-based indexes. An unknown page count does not drop pages. */
export function parsePageSpec(text: string, pageCount: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,;]/)) {
    const t = part.trim();
    if (!t) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    const add = (page: number) => {
      if (page < 1) return;
      if (pageCount > 0 && page > pageCount) return;
      out.add(page - 1);
    };
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > b) [a, b] = [b, a];
      for (let p = a; p <= b; p++) add(p);
    } else if (/^\d+$/.test(t)) add(Number(t));
  }
  return [...out].sort((a, b) => a - b);
}

export interface BatchFileEntry {
  filename: string;
  scope: PageScope;
}

const xmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const xmlUnesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function scopeFromBatch(flags: string, rangeType: string, selected: string): PageScope {
  const flag = Number(flags);
  const type = rangeType.toLowerCase();
  if (flag === 2 || type === 'current' || type === 'currentpage') return { kind: 'current' };
  if (flag === 8 || type === 'custom' || selected.trim()) return { kind: 'custom', text: selected.trim() };
  return { kind: 'all' };
}

/**
 * The file list Revu's Save… / Load… writes (`BatchMatchSet` XML):
 * one Document per file, with Filename, RangeType, SelectedPages and PageRangeFlags.
 */
export function parseBatchFile(xml: string): BatchFileEntry[] {
  if (!/<BatchMatchSet\b/i.test(xml) && !/<Document\b/i.test(xml)) {
    throw new Error('This is not a batch file list (expected a BatchMatchSet document).');
  }
  const docs = [...xml.matchAll(/<Document\b([^>]*)\/?>/gi)];
  if (!docs.length) throw new Error('This batch file has no documents.');
  return docs.map((d) => {
    const attrs = d[1] ?? '';
    const attr = (name: string) => {
      const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
      return xmlUnesc(m?.[1] ?? '');
    };
    return { filename: attr('Filename'), scope: scopeFromBatch(attr('PageRangeFlags'), attr('RangeType'), attr('SelectedPages')) };
  });
}

export function serializeBatchFile(entries: readonly BatchFileEntry[]): string {
  const docs = entries
    .map((e) => {
      const flags = e.scope.kind === 'current' ? 2 : e.scope.kind === 'custom' ? 8 : 1;
      const rangeType = e.scope.kind === 'current' ? 'Current' : e.scope.kind === 'custom' ? 'Custom' : 'AllPages';
      const selected = e.scope.kind === 'custom' ? e.scope.text.trim() : '';
      return `    <Document Filename="${xmlAttr(e.filename)}" RangeType="${rangeType}" SelectedPages="${xmlAttr(selected)}" PageRangeFlags="${flags}" />`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<BatchMatchSet Version="3">\n  <CurrentRevisions>\n${docs}\n  </CurrentRevisions>\n  <NewRevisions />\n</BatchMatchSet>\n`;
}

export function measureColumn(key: string): boolean {
  return MEASURE_KEYS.has(key);
}
