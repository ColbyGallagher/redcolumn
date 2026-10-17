// Builds the A3 Bluebeam test set: PDFs written by redcolumn's real export code, covering every
// markup tool, with custom columns of every type on the markups.
//
//   pnpm --filter @nb/markup compat:a3 [outDir]
//
// Writes A3-00-ALL-combined.pdf and one PDF per area, plus manifest.csv and README.md. If export
// refuses a markup the file is still written without it and the refusal is listed in the README.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SCALE, type Scale } from '@nb/measure';
import { exportWithAnnotations, type ExportOptions } from '../../../src/export.ts';
import { MARKUP_TYPES, type Markup } from '../../../src/model.ts';
import type { Bookmark, Place } from '../../../src/bookmarks.ts';
import type { Viewport } from '../../../src/viewports.ts';
import type { Assembly } from '../../../src/assemblies.ts';
import { baseDocument, resetIds, type PageSpec } from './lib.ts';
import { closedShapes, lines } from './shapes.ts';
import { calloutsNotes, textPage } from './text.ts';
import { imperial, metric, oddScales, viewports } from './measure.ts';
import { formsPage, stampsImages, tablesLinks } from './content.ts';
import { geometry } from './geometry.ts';
import { applyAutoFields, columnsPage, COLUMNS, metadataPage, STATUSES } from './columns.ts';
import { dashMatrix, edgeData, edgeGeometry, unicodePage } from './edge.ts';

interface Part {
  pages: PageSpec[];
  viewports?: Viewport[];
  places?: Place[];
}
type Maker = (p0: number) => Part;

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? join(here, '../../../../../reference_data/a3-bluebeam-test'));

const MAKERS = {
  shapes: [(p) => ({ pages: [lines(p), closedShapes(p + 1)] })],
  text: [(p) => ({ pages: [textPage(p), calloutsNotes(p + 1)] })],
  metric: [
    (p) => ({ pages: [metric(p)] }),
    (p) => {
      const v = viewports(p);
      return { pages: [v.page], viewports: v.viewports };
    },
  ],
  imperial: [(p) => ({ pages: [imperial(p), ...oddScales(p + 1)] })],
  content: [
    (p) => ({ pages: [stampsImages(p)] }),
    (p) => {
      const t = tablesLinks(p);
      return { pages: [t.page], places: t.places };
    },
    (p) => ({ pages: [formsPage(p)] }),
  ],
  geometry: [(p) => ({ pages: geometry(p) })],
  columns: [(p) => ({ pages: [columnsPage(p), metadataPage(p + 1)] })],
  edge: [(p) => ({ pages: [edgeGeometry(p), edgeData(p + 1), unicodePage(p + 2)] })],
  dashes: [(p) => ({ pages: [dashMatrix(p)] })],
} satisfies Record<string, Maker[]>;

const FILES: { file: string; title: string; parts: Maker[] }[] = [
  { file: 'A3-01-lines-and-shapes.pdf', title: 'Lines and shapes', parts: MAKERS.shapes },
  { file: 'A3-02-text-callouts-notes.pdf', title: 'Text, callouts and notes', parts: MAKERS.text },
  { file: 'A3-03-measure-metric-viewports.pdf', title: 'Measurements, metric and viewports', parts: MAKERS.metric },
  { file: 'A3-04-measure-imperial-scales.pdf', title: 'Measurements, imperial and odd scales', parts: MAKERS.imperial },
  { file: 'A3-05-stamps-tables-links-forms.pdf', title: 'Stamps, tables, links, forms', parts: MAKERS.content },
  { file: 'A3-06-page-geometry.pdf', title: 'Page rotation, crop and media boxes', parts: MAKERS.geometry },
  { file: 'A3-07-columns-statuses-metadata.pdf', title: 'Custom columns, statuses, metadata', parts: MAKERS.columns },
  { file: 'A3-08-edge-cases.pdf', title: 'Edge cases', parts: MAKERS.edge },
  { file: 'A3-09-dash-patterns.pdf', title: 'Dash patterns', parts: MAKERS.dashes },
  { file: 'A3-00-ALL-combined.pdf', title: 'Everything', parts: Object.values(MAKERS).flat() },
];

const ASSEMBLIES: Assembly[] = [
  {
    id: 'asm-a3-wall',
    name: 'Stud wall (A3 test)',
    description: 'Studs and board for a metre of wall',
    variables: [{ name: 'Stud Spacing', value: 0.4 }, { name: 'Layers', value: 2 }],
    items: [
      { id: 'i1', name: 'Studs', unit: 'ea', formula: '[Length] / [Stud Spacing] + 1', waste: 5, roundUp: true, unitCost: 7.5 },
      { id: 'i2', name: 'Plasterboard', unit: 'sheets', formula: '[Wall Area] * [Layers] / 2.88', roundUp: true, unitCost: 18 },
    ],
  },
];

interface Refusal {
  file: string;
  subject: string;
  type: string;
  error: string;
}

async function exportSafe(file: string, base: Uint8Array, markups: Markup[], options: ExportOptions, refusals: Refusal[]): Promise<{ bytes: Uint8Array; kept: Markup[] }> {
  const run = (ms: Markup[], opts: ExportOptions = options) => exportWithAnnotations(base.slice().buffer as ArrayBuffer, ms, opts);
  try {
    return { bytes: await run(markups), kept: markups };
  } catch (e) {
    console.warn(`${file}: whole-document export failed (${(e as Error).message}); finding the markups responsible`);
  }
  const kept: Markup[] = [];
  for (const m of markups) {
    try {
      await run([m], { ...options, columns: [], bookmarks: undefined });
      kept.push(m);
    } catch (e) {
      refusals.push({ file, subject: m.subject ?? m.id, type: m.type, error: (e as Error).message });
    }
  }
  return { bytes: await run(kept), kept };
}

const csv = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' / ')}"`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const refusals: Refusal[] = [];
  const rows: string[] = ['file,page,sheet,type,subject,status,locked,hidden,layer,group,replies,comment,discipline,priority,ref,qty,unit_cost,due,verified'];
  const summary: { file: string; title: string; pages: number; markups: number; bytes: number; types: number }[] = [];
  const typesInAll = new Set<string>();

  for (const f of FILES) {
    resetIds();
    const pages: PageSpec[] = [];
    const vps: Viewport[] = [];
    const places: Place[] = [];
    for (const make of f.parts) {
      const part = make(pages.length);
      pages.push(...part.pages);
      vps.push(...(part.viewports ?? []));
      places.push(...(part.places ?? []));
    }
    const markups = pages.flatMap((pg) => pg.markups);
    applyAutoFields(markups);
    // Link the first length and first area of the metric page to an assembly.
    const wall = markups.find((m) => m.type === 'length' && m.subject?.startsWith('M01'));
    const slab = markups.find((m) => m.type === 'area' && m.subject?.startsWith('M10'));
    if (wall) wall.assemblyId = 'asm-a3-wall';
    if (slab) slab.assemblyId = 'asm-a3-wall';

    const scales: Record<number, Scale> = {};
    pages.forEach((pg, i) => {
      if (pg.scale) scales[i] = pg.scale;
    });
    // Bookmark tree: one per page; in the combined file nested under a heading per area.
    const pageBookmarks = pages.map((pg, i): Bookmark => ({ id: `bm-p${i}`, title: `${pg.sheet}  ${pg.title}`, pageIndex: i, rect: null, children: [] }));
    if (pageBookmarks[0]) pageBookmarks[0].children = [{ id: 'bm-zoom', title: 'Zoomed view (top-left quarter)', pageIndex: 0, rect: { x: 0, y: 0, w: pages[0]!.w / 2, h: pages[0]!.h / 2 }, children: [] }];
    let tree: Bookmark[] = pageBookmarks;
    if (f.file.includes('ALL')) {
      // The combined file is the other files' pages in order.
      let at = 0;
      tree = summary.map((g) => {
        const node: Bookmark = { id: `bm-area-${g.file}`, title: g.title, pageIndex: at, rect: null, children: pageBookmarks.slice(at, at + g.pages) };
        at += g.pages;
        return node;
      });
    }

    const base = await baseDocument(pages, 'redcolumn A3 Bluebeam compatibility test');
    const options: ExportOptions = {
      scaleFor: (i) => scales[i] ?? DEFAULT_SCALE,
      viewports: vps,
      places,
      pageLabels: pages.map((pg) => pg.sheet),
      bookmarks: tree,
      pageScales: scales,
      columns: COLUMNS,
      statuses: STATUSES,
      assemblies: ASSEMBLIES,
    };
    const { bytes, kept } = await exportSafe(f.file, base, markups, options, refusals);
    writeFileSync(join(OUT, f.file), bytes);
    const types = new Set(kept.map((m) => m.type));
    if (f.file.includes('ALL')) for (const t of types) typesInAll.add(t);
    summary.push({ file: f.file, title: f.title, pages: pages.length, markups: kept.length, bytes: bytes.length, types: types.size });
    console.log(`${f.file}: ${pages.length} pages, ${kept.length} markups, ${types.size} types, ${(bytes.length / 1024).toFixed(0)} KB`);

    if (f.file.includes('ALL')) {
      for (const m of kept) {
        const fl = m.fields ?? {};
        rows.push(
          [f.file, m.pageIndex + 1, pages[m.pageIndex]!.sheet, m.type, m.subject ?? '', m.status, !!m.locked, !!m.hidden, m.layer ?? '', m.groupId ?? '', m.replies?.length ?? 0, m.comment ?? '', fl['col-discipline'], fl['col-priority'], fl['col-ref'], fl['col-qty'], fl['col-cost'], fl['col-due'], fl['col-verified']].map(csv).join(','),
        );
      }
    }
  }
  writeFileSync(join(OUT, 'manifest.csv'), rows.join('\n') + '\n');

  const missing = MARKUP_TYPES.filter((t) => !typesInAll.has(t));
  const readme = [
    '# A3 Bluebeam compatibility test set',
    '',
    'Generated by `packages/markup/test/compat/a3/build.ts` with redcolumn\'s own export code. Every page is A3 (1190.55 x 841.89 pt), landscape unless the page title says otherwise.',
    '',
    '| File | Pages | Markups | Markup types |',
    '| --- | --- | --- | --- |',
    ...summary.map((s) => `| ${s.file} | ${s.pages} | ${s.markups} | ${s.types} |`),
    '',
    `Markup types in the combined file: ${typesInAll.size} of ${MARKUP_TYPES.length}.${missing.length ? ` Missing: ${missing.join(', ')}.` : ' Every markup type is present.'}`,
    '',
    '## Custom columns',
    '',
    'Eleven columns cover every type, and most markups carry values (a mix, with gaps):',
    '',
    ...COLUMNS.map((c) => `- **${c.name}**: ${c.type}${c.options ? ` (${c.options.join(', ')})` : ''}${c.formula ? ` = ${c.formula}` : ''}${c.required ? ', required' : ''}`),
    '',
    'Page Z-101 holds one markup per edge value (empty, 255 characters, unicode, XML specials, out-of-list choice, negative / huge / non-numeric numbers, leap-day and invalid dates, every checkmark state).',
    '',
    '## Statuses',
    '',
    `Review statuses plus a custom set (model \`BSI_A3TESTSET0001\`): ${STATUSES.map((s) => s.name).join(', ')}.`,
    '',
    '## How to read a page',
    '',
    'Each test sits in a captioned cell (ID and what it is). Cell IDs are the markup Subject, so the Markups List shows them. Measurement cells also print what redcolumn reads for that measurement ("rc: ...") for comparison with Bluebeam\'s label. A faint 50 pt grid is labelled in page coordinates.',
    '',
    '`manifest.csv` lists every markup in the combined file (page, type, subject, status, column values) to diff against a Bluebeam Markups List CSV export.',
    '',
    '## Markups export refused',
    '',
    refusals.length ? ['| File | Type | Subject | Error |', '| --- | --- | --- | --- |', ...refusals.map((r) => `| ${r.file} | ${r.type} | ${r.subject} | ${r.error.replace(/\|/g, '/')} |`)].join('\n') : 'None: every markup exported.',
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'README.md'), readme);
  console.log(`\nMissing types: ${missing.join(', ') || 'none'}; refusals: ${refusals.length}\nOutput: ${OUT}`);
  process.exit(0);
}

await main();
