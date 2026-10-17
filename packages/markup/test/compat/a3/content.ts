// Content markups: stamps (text, form, picture), images, signatures, attachments, legends, tables,
// hyperlinks, Spaces, redactions, and a form-fields page.
import { mk, PageBuilder, T0, type PageSpec } from './lib.ts';
import { encodePng } from '../../../src/pdfExtras.ts';
import { DEFAULT_STAMPS, resolveStamp, setStampField, stampAspect, type StampContent, type StampDef } from '../../../src/stamp.ts';
import { newTable, type TableData } from '../../../src/table.ts';
import type { Attachment, Markup, Point } from '../../../src/model.ts';
import type { Place } from '../../../src/bookmarks.ts';
import { ngon, star } from './shapes.ts';

// ---- Generated pictures and files ----------------------------------------------------------------

async function png(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Promise<string> {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(px(x, y), (y * w + x) * 4);
  return `data:image/png;base64,${Buffer.from(await encodePng(w, h, rgba)).toString('base64')}`;
}

/** Colour gradient with a transparent top-left corner and a black frame. */
const PICTURE = await png(96, 64, (x, y) => {
  if (x < 2 || y < 2 || x > 93 || y > 61) return [0, 0, 0, 255];
  if (x < 28 && y < 20) return [0, 0, 0, 0];
  return [Math.round((x / 96) * 255), Math.round((y / 64) * 255), 160, 255];
});

/** A scribble on transparency, as a signature image. */
const SIGNATURE = await png(160, 48, (x, y) => {
  const wave = 24 + Math.sin(x / 7) * 12 * Math.sin(x / 31 + 1);
  return Math.abs(y - wave) < 1.6 && x > 6 && x < 150 ? [20, 20, 120, 255] : [0, 0, 0, 0];
});

/** A circular seal, as the artwork for a picture stamp. */
const SEAL = await png(120, 120, (x, y) => {
  const d = Math.hypot(x - 60, y - 60);
  return d < 58 && d > 52 ? [180, 30, 30, 255] : d < 40 && d > 37 ? [180, 30, 30, 255] : [0, 0, 0, 0];
});

const b64 = (s: string | Uint8Array) => Buffer.from(s).toString('base64');

function wav(): Uint8Array {
  const n = 1600;
  const out = Buffer.alloc(44 + n);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + n, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(8000, 24);
  out.writeUInt32LE(8000, 28);
  out.writeUInt16LE(1, 32);
  out.writeUInt16LE(8, 34);
  out.write('data', 36);
  out.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) out[44 + i] = 128 + Math.round(60 * Math.sin((i / 8000) * 2 * Math.PI * 440));
  return out;
}

const MINI_PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n';

const attach = (name: string, mime: string, data: string | Uint8Array): Attachment => ({ name, mime, size: Buffer.from(data).length, data: b64(data) });

const ctx = { user: 'A3 Tester', file: 'A3-05-content.pdf', page: 'C-101', now: new Date(T0) };
const stampOf = (id: string, values?: Record<string, string>): { def: StampDef; content: StampContent } => {
  const def = DEFAULT_STAMPS.find((s) => s.id === `builtin-${id}`);
  if (!def) throw new Error(`no stamp ${id}`);
  return { def, content: resolveStamp(def, ctx, values) };
};

function stampMarkup(def: StampDef, content: StampContent, r: { x: number; y: number }, w: number, extra: Partial<Markup> = {}): Markup {
  const h = w / stampAspect(content);
  return mk('stamp', 0, [[r.x, r.y], [r.x + w, r.y + h]], { stamp: content, ...extra }, { stroke: def.color });
}

// ---- Pages ---------------------------------------------------------------------------------------

export function stampsImages(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Stamps, pictures, signatures and attachments', sheet: 'C-101' });
  for (const id of ['approved', 'approved-noted', 'revise', 'rejected', 'for-construction', 'confidential', 'draft', 'void']) {
    P.cell(`ST ${id} (text stamp)`, null, (r) => {
      const { def, content } = stampOf(id);
      return [stampMarkup(def, content, r, 150, { subject: `ST ${id}` })];
    });
  }
  P.cell('ST rotated 15 / 90, opacity .5', [2, 1], (r) => {
    const a = stampOf('draft');
    const b = stampOf('rejected');
    return [stampMarkup(a.def, a.content, { x: r.x + 10, y: r.y + 10 }, 120, { rotation: 15, subject: 'ST draft rotated 15' }), stampMarkup(b.def, b.content, { x: r.x + 190, y: r.y + 15 }, 120, { rotation: 90, subject: 'ST rejected rotated 90' })];
  });
  P.cell('ST submittal review form: ticked "Revise and Resubmit"', [2, 2], (r) => {
    const { def } = stampOf('submittal-review');
    let values: Record<string, string> = {};
    values = setStampField(def.fields!, values, 'action', 'Revise and Resubmit');
    const content = resolveStamp(def, ctx, values);
    return [stampMarkup(def, content, r, 190, { subject: 'ST submittal review (Revise)' }, )];
  });
  P.cell('ST submittal review form: nothing ticked', [2, 2], (r) => {
    const { def, content } = stampOf('submittal-review');
    return [stampMarkup(def, content, r, 190, { subject: 'ST submittal review (blank)' })];
  });
  P.cell('ST picture stamp (seal artwork + live text)', null, (r) => {
    const content: StampContent = {
      lines: ['PE', 'APPROVED'],
      frame: 'none',
      art: {
        image: SEAL,
        aspect: 1,
        texts: [
          { text: 'PE', x: 0.3, y: 0.3, w: 0.4, h: 0.2, size: 0.18, color: '#b41e1e', bold: true, italic: false, align: 'center' },
          { text: 'APPROVED', x: 0.15, y: 0.5, w: 0.7, h: 0.15, size: 0.12, color: '#b41e1e', bold: false, italic: true, align: 'center' },
        ],
      },
    };
    return [mk('stamp', 0, [[r.x + 10, r.y], [r.x + 90, r.y + 80]], { stamp: content, subject: 'ST picture stamp' }, { stroke: '#b41e1e' })];
  });
  P.cell('ST long text stamp (5 lines)', null, (r) => [
    mk('stamp', 0, [[r.x, r.y], [r.x + 150, r.y + 70]], { stamp: { lines: ['CHECKED', 'By A3 Tester', 'On 17/10/2026', 'Ref: RFI-0042 / SK-17', 'Valid for 30 days'], frame: 'box' }, subject: 'ST long' }, { stroke: '#1d4ed8' }),
  ]);
  P.cell('IM image (PNG with transparency)', null, (r) => [mk('image', 0, [[r.x, r.y], [r.x + 96, r.y + 64]], { image: PICTURE })]);
  P.cell('IM image stretched, rotated 20, opacity .5', null, (r) => [mk('image', 0, [[r.x + 5, r.y + 5], [r.x + 135, r.y + 45]], { image: PICTURE, rotation: 20 }, { opacity: 0.5 })]);
  P.cell('IM image tiny 6x4 and huge-aspect 150x6', null, (r) => [
    mk('image', 0, [[r.x, r.y], [r.x + 6, r.y + 4]], { image: PICTURE, subject: 'IM tiny' }),
    mk('image', 0, [[r.x + 20, r.y + 30], [r.x + 170, r.y + 36]], { image: PICTURE, subject: 'IM sliver' }),
  ]);
  P.cell('SG signature image + signer details', null, (r) => [
    mk('signature', 0, [[r.x, r.y], [r.x + 140, r.y + 42]], {
      image: SIGNATURE,
      signature: { signer: 'A3 Tester', signedAt: T0, digest: 'a3'.repeat(32), reason: 'Approved for construction' },
    }),
  ]);
  P.cell('AT attachments: text, tiny PDF, WAV sound', [2, 1], (r) => [
    mk('attachment', 0, [[r.x + 10, r.y + 20], [r.x + 34, r.y + 44]], { attachment: attach('site-notes.txt', 'text/plain', 'Site notes\nLine two with unicode: café ± 5mm\n'), comment: 'Text file', subject: 'AT text file' }),
    mk('attachment', 0, [[r.x + 110, r.y + 20], [r.x + 134, r.y + 44]], { attachment: attach('spec.pdf', 'application/pdf', MINI_PDF), subject: 'AT pdf' }),
    mk('attachment', 0, [[r.x + 210, r.y + 20], [r.x + 234, r.y + 44]], { attachment: attach('tone 440Hz.wav', 'audio/wav', wav()), subject: 'AT wav' }),
  ]);
  P.cell('AT attachment: empty file; name with spaces/unicode', null, (r) => [
    mk('attachment', 0, [[r.x + 10, r.y + 20], [r.x + 34, r.y + 44]], { attachment: attach('empty.bin', 'application/octet-stream', ''), subject: 'AT empty' }),
    mk('attachment', 0, [[r.x + 70, r.y + 20], [r.x + 94, r.y + 44]], { attachment: attach('plan – rév B (final).txt', 'text/plain', 'x'), subject: 'AT unicode name' }),
  ]);
  return P.spec;
}

export function tablesLinks(p0: number): { page: PageSpec; places: Place[] } {
  const P = new PageBuilder(p0, { title: 'Legend, tables, links, Spaces, redactions', sheet: 'C-102' });
  const places: Place[] = [{ id: 'place-a3-1', name: 'Detail A (place)', pageIndex: p0, rect: { x: 600, y: 300, w: 200, h: 120 } }];

  // Legend first, so the markups around it have something to list.
  P.cell('LG legend (this page), lists the markups on this page', [2, 2], (r) => [
    mk('legend', 0, [[r.x, r.y], [r.x + 330, r.y + 190]], { legend: { scope: 'page' } }),
  ]);
  P.cell('LG sample markups for the legend', null, (r) => [
    mk('rect', 0, [[r.x, r.y], [r.x + 60, r.y + 40]], { subject: 'Legend rectangle A' }, { fill: '#bfdbfe' }),
    mk('rect', 0, [[r.x + 70, r.y], [r.x + 130, r.y + 40]], { subject: 'Legend rectangle B' }, { stroke: '#16a34a' }),
    mk('line', 0, [[r.x, r.y + 60], [r.x + 130, r.y + 60]], { subject: 'Legend line' }),
  ]);
  P.cell('TB table 3 x 3 with header text', null, (r) => {
    const t = newTable(3, 3);
    t.cells = [['Item', 'Qty', 'Unit'], ['Door', '12', 'ea'], ['Window', '8', 'ea']];
    return [mk('table', 0, [[r.x, r.y], [r.x + r.w, r.y + 60]], { table: t }, { fontSize: 9 })];
  });
  P.cell('TB table with merged cells, cell fills, per-cell fonts', [2, 1], (r) => {
    const t: TableData = {
      cols: [2, 1, 1, 1],
      rows: [1, 1, 1, 1],
      cells: [['MERGED HEADER', '', '', 'Total'], ['A', 'B', 'C', '10'], ['D', 'E', 'F', '20'], ['Sum', '', '', '30']],
      merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 3 }, { row: 3, col: 0, rowSpan: 1, colSpan: 3 }],
      formats: { '0,0': { bold: true, fill: '#fde68a', textAlign: 'center' }, '0,3': { bold: true, fill: '#fde68a' }, '3,3': { fontFamily: 'mono', textColor: '#b91c1c', italic: true }, '1,1': { fill: '#bbf7d0' } },
    };
    return [mk('table', 0, [[r.x, r.y], [r.x + 330, r.y + 80]], { table: t }, { fontSize: 10, stroke: '#1e3a8a', width: 1.5 })];
  });
  P.cell('TB table 1 x 1; table 12 x 3 at 6pt', [2, 1], (r) => {
    const big = newTable(12, 3);
    big.cells = big.cells.map((row, i) => row.map((_, j) => `r${i + 1}c${j + 1}`));
    return [
      mk('table', 0, [[r.x, r.y + 30], [r.x + 70, r.y + 50]], { table: { ...newTable(1, 1), cells: [['solo']] }, subject: 'TB 1x1' }),
      mk('table', 0, [[r.x + 100, r.y], [r.x + 250, r.y + 80]], { table: big, subject: 'TB 12x3' }, { fontSize: 6 }),
    ];
  });
  P.cell('HL hyperlinks: to page, URL, place, other file', [2, 1], (r) => [
    mk('hyperlink', 0, [[r.x, r.y + 10], [r.x + 70, r.y + 40]], { link: { kind: 'page', pageIndex: p0, rect: null }, subject: 'HL to this page', comment: 'Go to page' }),
    mk('hyperlink', 0, [[r.x + 85, r.y + 10], [r.x + 155, r.y + 40]], { link: { kind: 'url', url: 'https://example.com/path?a=1&b=two#frag' }, subject: 'HL URL' }),
    mk('hyperlink', 0, [[r.x + 170, r.y + 10], [r.x + 240, r.y + 40]], { link: { kind: 'place', placeId: 'place-a3-1' }, subject: 'HL place' }),
    mk('hyperlink', 0, [[r.x + 255, r.y + 10], [r.x + 325, r.y + 40]], { link: { kind: 'file', fileId: 'f-1', name: 'Other Drawing.pdf', pageIndex: 2, rect: null }, subject: 'HL other file' }),
  ]);
  P.cell('HL link to page with a zoomed view (rect)', null, (r) => [mk('hyperlink', 0, [[r.x, r.y + 10], [r.x + 90, r.y + 50]], { link: { kind: 'page', pageIndex: p0, rect: { x: 100, y: 100, w: 300, h: 200 } }, subject: 'HL page view' })]);
  P.cell('SP Spaces: Room 101, Corridor (concave)', [2, 1], (r) => [
    mk('space', 0, [[r.x, r.y], [r.x + 140, r.y], [r.x + 140, r.y + 70], [r.x, r.y + 70]], { subject: 'Room 101' }),
    mk('space', 0, [[r.x + 170, r.y], [r.x + 330, r.y], [r.x + 330, r.y + 30], [r.x + 230, r.y + 30], [r.x + 230, r.y + 70], [r.x + 170, r.y + 70]], { subject: 'Corridor L1' }, { fill: '#fb923c' }),
  ]);
  P.cell('RD redactions (marked, not applied)', null, (r) => [
    mk('redaction', 0, [[r.x, r.y], [r.x + 70, r.y + 20]], { subject: 'RD plain' }),
    mk('redaction', 0, [[r.x + 80, r.y + 20], [r.x + 150, r.y + 60]], { subject: 'RD with comment', comment: 'Personal information' }),
  ]);
  P.cell('Smart fill region (area) and symbol-search style counts', null, (r) => [
    mk('area', 0, ngon(r.x + 50, r.y + 38, 38, 30, 7), { subject: 'Smart Fill region' }, { fill: '#22c55e', fillOpacity: 0.3 }),
    mk('count', 0, [[r.x + 110, r.y + 20], [r.x + 125, r.y + 50], [r.x + 140, r.y + 20]], { subject: 'Symbol search results' }, { countShape: 'diamond' }),
  ]);
  P.cell('Sketch to scale style: polygon with dimensions', null, (r) => [
    mk('polygon', 0, [[r.x, r.y], [r.x + 100, r.y], [r.x + 100, r.y + 60], [r.x, r.y + 60]], { subject: 'Sketch outline' }),
    mk('dimension', 0, [[r.x, r.y + 70], [r.x + 100, r.y + 70]], { text: '5.00 m', subject: 'Sketch dimension' }),
  ]);
  void star;
  return { page: P.spec, places };
}

export function formsPage(p0: number): PageSpec {
  const P = new PageBuilder(p0, { title: 'Form fields (AcroForm) with markups over them', sheet: 'C-103', note: 'AcroForm: text, check box, radio, drop-down, list' });
  P.spec.form = true;
  P.reserve(0, 0, 3, 3);
  P.add(
    mk('rect', 0, [[40, 60], [260, 100]], { subject: 'Markup over a form field' }, { stroke: '#2563eb', width: 2 }),
    mk('text', 0, [[300, 60], [460, 100]], { text: 'Markup text next to fields' }),
  );
  P.cell('Count markers over check boxes', null, (r) => [mk('count', 0, [[r.x + 20, r.y + 20], [r.x + 50, r.y + 20]], { subject: 'Count near field' })]);
  return P.spec;
}

export type { Point };
