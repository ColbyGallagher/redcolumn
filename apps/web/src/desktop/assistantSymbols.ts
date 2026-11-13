import { rasterSearch, templateSegments, toGray, crop, visualSearch, type GrayImage, type SearchRect } from '@nb/measure';
import { countProposals, countStateOf, recalledMatch, rememberMatches, type CountMatch } from '../assemblies/countProposals';
import { findDocument, pageIndexOf, record, type AssistantDocument } from './assistant';

/**
 * Auto count. `find_symbol_matches` runs the app's own symbol search (vector line work, or pixels on
 * a scanned sheet) for repeats of an example symbol. `propose_counts` stages the ones the AI client
 * chooses as a count proposal, which waits in Takeoff Review for a person to approve. The language
 * model is the client's: redcolumn only searches and stages.
 */
export const SYMBOL_METHODS = ['find_symbol_matches', 'propose_counts', 'list_count_proposals'] as const;
export type SymbolMethod = (typeof SYMBOL_METHODS)[number];

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const MAX_PROPOSED = 2000;
/** Pixel search resolution for scanned sheets, as the Symbol Search panel uses. */
const RASTER_DPI = 100;

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function rectOf(raw: unknown, what: string): SearchRect {
  const r = record(raw);
  if (!finite(r.x) || !finite(r.y) || !finite(r.w) || !finite(r.h) || r.w <= 0 || r.h <= 0) throw new Error(`${what} has to be { x, y, w, h } in PDF points, with a width and height above 0.`);
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

/** The example symbol: a markup's bounds, or a rectangle on a page. */
function exampleOf(doc: AssistantDocument, args: Record<string, unknown>): { pageIndex: number; rect: SearchRect } {
  const ex = record(args.example);
  if (typeof ex.markupId === 'string' && ex.markupId) {
    const m = doc.store.get(ex.markupId);
    if (!m) throw new Error(`No markup ${ex.markupId}. list_markups has the ids.`);
    const xs = m.points.map((p) => p[0]);
    const ys = m.points.map((p) => p[1]);
    const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (!(rect.w > 0 && rect.h > 0)) throw new Error(`Markup ${ex.markupId} has no area to search for. Draw a rectangle around the symbol and use its id, or give example.rect.`);
    return { pageIndex: m.pageIndex, rect };
  }
  if (ex.rect !== undefined) {
    const rect = rectOf(ex.rect, 'example.rect');
    const page = record(ex.rect).page ?? ex.page ?? args.page ?? (Array.isArray(args.pages) && args.pages.length === 1 ? args.pages[0] : undefined);
    if (page === undefined) throw new Error('Say which page the example rect is on: example.rect.page, or page.');
    return { pageIndex: pageIndexOf(doc, page), rect };
  }
  throw new Error('Give an example: { markupId } of a markup drawn around the symbol, or { rect: { page, x, y, w, h } }.');
}

function pagesOf(doc: AssistantDocument, args: Record<string, unknown>, fallback: number): number[] {
  if (Array.isArray(args.pages)) {
    if (!args.pages.length) throw new Error('pages is empty. Leave it out to search the example\'s page.');
    return [...new Set(args.pages.map((p) => pageIndexOf(doc, p)))];
  }
  if (args.page !== undefined) return [pageIndexOf(doc, args.page)];
  return [fallback];
}

async function pagePixels(doc: AssistantDocument, pageIndex: number, k: number): Promise<GrayImage> {
  const size = doc.pageSize?.(pageIndex);
  if (!doc.render || !size) throw new Error(`${doc.name} has no vector line work to search here, and its pages cannot be drawn to search pixels.`);
  const image = await doc.render(pageIndex, { x: 0, y: 0, w: size.width, h: size.height }, k, false);
  if (!image) throw new Error(`Page ${pageIndex + 1} could not be drawn.`);
  const bytes = Uint8Array.from(atob(image.png), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return toGray(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

async function findSymbolMatches(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  const { pageIndex: examplePage, rect } = exampleOf(doc, args);
  const pages = pagesOf(doc, args, examplePage);
  const rotations = args.rotations === true;
  const scales = args.scales === true;
  let minScore: number | undefined;
  if (args.minScore !== undefined) {
    if (!finite(args.minScore) || args.minScore <= 0 || args.minScore > 1) throw new Error('minScore has to be above 0 and at most 1.');
    minScore = args.minScore;
  }
  const limit = args.limit === undefined ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(args.limit))));
  if (!Number.isFinite(limit)) throw new Error('limit has to be a whole number, 1 or more.');

  let template: ReturnType<typeof templateSegments> = [];
  let source: ArrayLike<number> | null = null;
  if (doc.geometry) {
    source = (await doc.geometry(examplePage)).segments;
    template = templateSegments(source, rect);
  }
  const all: CountMatch[] = [];
  let engine: 'vector' | 'pixels';
  if (source && template.length >= 2) {
    engine = 'vector';
    for (const p of pages) {
      const segs = p === examplePage ? source : (await doc.geometry!(p)).segments;
      for (const m of visualSearch(segs, template, { rotations, scales, ...(minScore !== undefined ? { minScore } : {}) })) all.push({ pageIndex: p, rect: m.rect, score: m.score });
    }
  } else {
    // No usable line work (a scanned sheet): match the pixels.
    engine = 'pixels';
    const k = RASTER_DPI / 72;
    const first = await pagePixels(doc, examplePage, k);
    const tpl = crop(first, Math.max(0, Math.round(rect.x * k)), Math.max(0, Math.round(rect.y * k)), Math.max(4, Math.round(rect.w * k)), Math.max(4, Math.round(rect.h * k)));
    for (const p of pages) {
      for (const m of rasterSearch(p === examplePage ? first : await pagePixels(doc, p, k), tpl, { rotations, ...(minScore !== undefined ? { threshold: minScore } : {}) })) {
        all.push({ pageIndex: p, rect: { x: m.x / k, y: m.y / k, w: m.w / k, h: m.h / k }, score: m.score });
      }
    }
  }
  all.sort((a, b) => a.pageIndex - b.pageIndex || (b.score ?? 0) - (a.score ?? 0));
  const kept = all.slice(0, limit);
  const ids = rememberMatches(doc.store.fileHash, kept);
  return {
    document: doc.name,
    engine,
    example: { page: examplePage + 1, bbox: { x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) } },
    total: all.length,
    ...(all.length > kept.length ? { truncated: true } : {}),
    matches: kept.map((m, i) => ({ matchId: ids[i]!, page: m.pageIndex + 1, bbox: { x: round(m.rect.x), y: round(m.rect.y), w: round(m.rect.w), h: round(m.rect.h) }, score: round(m.score ?? 0, 3) })),
    note: 'The example itself is among the matches. Check them against get_page_image, then stage the right ones with propose_counts.',
  };
}

function proposeCounts(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  const subject = typeof args.subject === 'string' ? args.subject.trim().slice(0, 200) : '';
  if (!subject) throw new Error('Give a subject: what is being counted, such as "Smoke detector".');
  const reasoning = typeof args.reasoning === 'string' ? args.reasoning.trim().slice(0, 2000) : '';
  if (!reasoning) throw new Error('say why (reasoning), so the person can check it');
  if (!Array.isArray(args.matches) || !args.matches.length) throw new Error('Give matches: matchIds from find_symbol_matches, or { page, bbox } items.');
  if (args.matches.length > MAX_PROPOSED) throw new Error(`That is ${args.matches.length} matches. The most is ${MAX_PROPOSED}.`);
  const source = typeof args.source === 'string' && args.source.trim() ? args.source.trim().slice(0, 80) : 'AI assistant';
  const matches: CountMatch[] = [];
  const seen = new Set<string>();
  args.matches.forEach((item: unknown, n) => {
    try {
      let match: CountMatch;
      if (typeof item === 'string') {
        const found = recalledMatch(doc.store.fileHash, item);
        if (!found) throw new Error(`${item} is not a match from find_symbol_matches in this session. Search again`);
        match = found;
      } else {
        const r = record(item);
        match = { pageIndex: pageIndexOf(doc, r.page), rect: rectOf(r.bbox, 'bbox') };
      }
      const key = `${match.pageIndex}:${round(match.rect.x)}:${round(match.rect.y)}`;
      if (seen.has(key)) return;
      seen.add(key);
      matches.push(match);
    } catch (err) {
      throw new Error(`Match ${n + 1}: ${err instanceof Error ? err.message : 'not a match'}`);
    }
  });
  const proposal = { id: crypto.randomUUID(), subject, reasoning, source, createdAt: Date.now(), matches };
  countProposals.add(doc.store.fileHash, proposal);
  return {
    document: doc.name,
    proposalId: proposal.id,
    proposed: matches.length,
    note: 'Waiting for review: the person checks the matches and approves or rejects them in Tools › Takeoff › Review AI Proposals. Nothing is placed until they approve.',
  };
}

function listCountProposals(docs: readonly AssistantDocument[], params: unknown) {
  const doc = findDocument(docs, record(params).document);
  return {
    document: doc.name,
    proposals: countProposals.list(doc.store.fileHash).map((p) => {
      const state = countStateOf(p, doc.store);
      return {
        id: p.id,
        subject: p.subject,
        matches: p.matches.length,
        pages: [...new Set(p.matches.map((m) => m.pageIndex + 1))].sort((a, b) => a - b),
        state,
        ...(state === 'approved' && p.placed ? { approvedBy: p.placed.by, counted: p.placed.count } : {}),
        ...(state === 'rejected' && p.rejected ? { rejectedBy: p.rejected.by } : {}),
      };
    }),
  };
}

export async function symbolCall(docs: readonly AssistantDocument[], method: SymbolMethod, params: unknown): Promise<unknown> {
  if (method === 'find_symbol_matches') return findSymbolMatches(docs, params);
  if (method === 'propose_counts') return proposeCounts(docs, params);
  return listCountProposals(docs, params);
}
