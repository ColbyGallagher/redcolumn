import { isMeasureKind, parseScaleText, parseTypedScale, scaleEquation, type Scale } from '@nb/measure';
import type { Point } from '@nb/markup';
import type { SheetInfo } from '@nb/sheets';
import { pageReadings } from '../measure/scaleCheck';
import { isNotToScale, scaleReviewRows, type PageScan, type ScaleReviewRow } from '../measure/scaleReview';
import { proposeViews } from '../measure/viewScales';
import { findDocument, pageIndexOf, record, type AssistantDocument } from './assistant';

/**
 * The scale tools. Every quantity an AI client measures depends on the page's scale, so it can read
 * what each sheet says about its scale (get_sheet_info) and propose one from the title block
 * (propose_page_scale), but it never sets one: a proposal waits in Document › Review Sheet Scales
 * for a person. Measurements it places need a page (or viewport) that has a scale.
 */
export const SCALE_METHODS = ['get_sheet_info', 'propose_page_scale'] as const;

export type ScaleMethod = (typeof SCALE_METHODS)[number];

const REVIEW = 'Document › Review Sheet Scales';

const round2 = (n: number) => Math.round(n * 100) / 100;
const scaleText = (s: Scale) => `${s.label} (${scaleEquation(s)})`;

/** Measurements whose result is a real-world size, so they need a scale (angles and counts do not). */
function needsScale(type: string): boolean {
  return isMeasureKind(type) && type !== 'angle' && type !== 'count' && type !== 'manual';
}

/**
 * Refuses an AI-placed measurement at `point` on a page with no scale there (no page scale, and no
 * viewport around it), saying what to do instead. A sheet marked NOT TO SCALE says so.
 */
export function requireScaleFor(doc: AssistantDocument, type: string, pageIndex: number, point: Point | undefined): void {
  if (!needsScale(type) || !point || doc.store.isScaledAt(pageIndex, point)) return;
  const sheet = doc.store.allSheets()[pageIndex];
  if (isNotToScale(sheet?.scaleText)) throw new Error(`Page ${pageIndex + 1} is marked NOT TO SCALE in its title block, so lengths measured on it are not real-world lengths. Measure a sheet drawn to scale.`);
  throw new Error(`Page ${pageIndex + 1} has no scale yet, so measurements on it would not be real-world lengths. Read its title block with get_sheet_info and propose one with propose_page_scale; a person applies it in ${REVIEW}.`);
}

function sizes(doc: AssistantDocument) {
  return Array.from({ length: doc.pageCount }, (_, i) => doc.pageSize?.(i) ?? { width: 0, height: 0 });
}

function publicRow(doc: AssistantDocument, row: ScaleReviewRow, detail: boolean) {
  const s = row.sheet;
  const viewports = doc.store.allViewports().filter((v) => v.pageIndex === row.page);
  return {
    page: row.page + 1,
    number: s?.number ?? null,
    title: s?.title ?? null,
    discipline: s?.discipline ?? null,
    scaleText: s?.scaleText ?? null,
    ...(s?.paperText ? { sheetSizeText: s.paperText } : {}),
    source: s?.source ?? null,
    sheetSize: { stated: row.stated, actual: row.actual?.paper.name ?? null },
    ...(row.printRatio !== 1 ? { printRatio: round2(row.printRatio) } : {}),
    proposedScale: row.proposed ? scaleText(row.proposed) : null,
    status: row.status,
    pageScale: doc.store.hasScale(row.page) ? scaleText(doc.store.scaleFor(row.page)) : null,
    viewports: viewports.map((v) => ({ id: v.id, name: v.name, scale: scaleText(v.scale) })),
    ...(row.check
      ? {
          check: {
            result: row.check.result,
            ...(row.check.reading ? { by: row.check.reading.kind === 'bar' ? `scale bar ${row.check.reading.text}` : row.check.reading.text } : {}),
            ...(row.check.ratio ? { ratio: round2(row.check.ratio) } : {}),
          },
        }
      : {}),
    ...(detail && row.views.length ? { proposedViewports: row.views.map((v) => ({ name: v.name, scale: scaleText(v.scale), rect: { x: round2(v.rect.x), y: round2(v.rect.y), w: round2(v.rect.w), h: round2(v.rect.h) } })) } : {}),
    measurable: doc.store.hasScale(row.page) || viewports.length > 0,
  };
}

/**
 * Each sheet's number, title and discipline, the scale its title block states, the sheet size it
 * was stated for and the size the page is, the scale that gives (corrected for the size), where the
 * page stands, and its viewports. For one page it also measures the scale against the page's scale
 * bars and dimensions, and proposes viewports from its view titles.
 */
async function getSheetInfo(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  const viewportPages = new Set(doc.store.allViewports().map((v) => v.pageIndex));
  if (args.page === undefined) {
    const rows = scaleReviewRows(sizes(doc), doc.store.allSheets(), doc.store.allScales(), {}, viewportPages);
    return { document: doc.name, pages: rows.map((r) => publicRow(doc, r, false)) };
  }
  const pageIndex = pageIndexOf(doc, args.page);
  const scans: Record<number, PageScan> = {};
  if (doc.text && doc.geometry && doc.pageSize?.(pageIndex)) {
    const [words, { segments }] = await Promise.all([doc.text(pageIndex), doc.geometry(pageIndex)]);
    const sheet = doc.store.allSheets()[pageIndex];
    const own = sheet?.scaleText ? parseScaleText(sheet.scaleText) : null;
    const unit = doc.store.hasScale(pageIndex) ? doc.store.scaleFor(pageIndex).unit : (own?.unit ?? 'm');
    const number = sheet?.number ? words.filter((w) => w.text.trim() === sheet.number).sort((a, b) => b.size - a.size)[0] : undefined;
    const numberRect = number ? { x: number.x0, y: number.y0, w: number.x1 - number.x0, h: number.y1 - number.y0 } : null;
    scans[pageIndex] = { readings: pageReadings(words, segments, unit), views: viewportPages.has(pageIndex) ? [] : proposeViews(doc.pageSize(pageIndex)!, words, segments, own, numberRect) };
  }
  const row = scaleReviewRows(sizes(doc), doc.store.allSheets(), doc.store.allScales(), scans, viewportPages)[pageIndex]!;
  return { document: doc.name, ...publicRow(doc, row, true) };
}

/**
 * Records the scale an AI client read for a page as the page's title-block scale, marked as from
 * AI, with its reasoning. It replaces scale text read from the page's text, never one from the
 * drawing standard or typed by a person, and sets nothing: the person applies it in the review.
 */
function proposePageScale(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  if (doc.store.readOnly) throw new Error(`${doc.name} is read-only.`);
  if (args.page === undefined) throw new Error('Say which page the scale is for.');
  const pageIndex = pageIndexOf(doc, args.page);
  if (typeof args.scale !== 'string' || !args.scale.trim()) throw new Error('Give the scale as the title block writes it, such as 1:100 or 1/4" = 1\'-0".');
  if (!/\b(NTS|N\.T\.S\.?|NOT TO SCALE|AS SHOWN|AS NOTED|VARIES)\b/i.test(args.scale) && !parseTypedScale(args.scale)) throw new Error(`"${args.scale}" is not a scale. Write it as 1:100, 1/4" = 1'-0", NTS or AS SHOWN.`);
  if (typeof args.reasoning !== 'string' || !args.reasoning.trim()) throw new Error('Say where on the sheet you read the scale, for the person checking it.');
  if (args.sheetSize !== undefined && typeof args.sheetSize !== 'string') throw new Error('sheetSize has to be text, such as A1 or ANSI D.');
  const current = doc.store.allSheets()[pageIndex];
  if (current && (current.source === 'standard' || current.source === 'manual')) {
    throw new Error(`Page ${pageIndex + 1}'s sheet info comes from ${current.source === 'manual' ? 'a person' : 'the drawing standard'} (scale ${current.scaleText ?? 'not given'}), so it is not replaced. Tell the person what you read instead.`);
  }
  const base: SheetInfo = current ?? { number: null, title: null, discipline: null, scaleText: null, revision: null, source: 'ai', confidence: 0 };
  const sheetSize = typeof args.sheetSize === 'string' && args.sheetSize.trim() ? args.sheetSize.trim() : null;
  doc.store.setDetectedSheets([[pageIndex, { ...base, scaleText: args.scale.trim(), ...(sheetSize ? { paperText: sheetSize } : {}), scaleReason: args.reasoning.trim(), source: 'ai', confidence: 0.6 }]]);
  const viewportPages = new Set(doc.store.allViewports().map((v) => v.pageIndex));
  const row = scaleReviewRows(sizes(doc), doc.store.allSheets(), doc.store.allScales(), {}, viewportPages)[pageIndex]!;
  return { document: doc.name, ...publicRow(doc, row, false), review: `Waiting for a person in ${REVIEW}. Nothing is measured with it until they apply it.` };
}

export async function scaleCall(docs: readonly AssistantDocument[], method: ScaleMethod, params: unknown): Promise<unknown> {
  if (method === 'get_sheet_info') return getSheetInfo(docs, params);
  return proposePageScale(docs, params);
}
