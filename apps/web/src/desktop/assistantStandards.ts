import { explain, LINK_KINDS, type DetectedLink, type LinkKind, type Rect } from '@nb/sheets';
import { describeChanges, SETUP_STEPS, type DrawingStandard, type HintChanges } from '../sheets/standards';
import { findDocument, pageIndexOf, record, type AssistantDocument } from './assistant';

/**
 * The drawing-standard tools. The setup wizard never calls AI itself: an AI client connected over
 * MCP reads the standard (with the boxes the person drew as examples, and how each step did),
 * reads the set's links, and proposes links and words. Nothing it proposes is used until a person
 * keeps it: links wait in the Links panel's Needs review list, words in the setup's Review step.
 */
export const STANDARD_METHODS = ['get_drawing_standard', 'list_sheet_links', 'propose_sheet_links', 'propose_standard_hints'] as const;

export type StandardMethod = (typeof STANDARD_METHODS)[number];

/** The profile's drawing standards, for the assistant. */
export interface AssistantStandards {
  list(): readonly DrawingStandard[];
  /** Saves a changed standard in the profile. */
  save(s: DrawingStandard): void;
}

const LINKS_REVIEW = 'the Links panel, under Needs review';
const HINTS_REVIEW = 'Set Up Drawing Standard, in its Review step';
const MAX_PROPOSED = 200;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const round2 = (n: number) => Math.round(n * 100) / 100;
const rectOut = (r: Rect) => ({ x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) });

/** The standard named, else the one the document is read with, else the only one. */
function findStandard(docs: readonly AssistantDocument[], standards: AssistantStandards | undefined, args: Record<string, unknown>): { standard: DrawingStandard; doc: AssistantDocument | null } {
  if (!standards) throw new Error('Drawing standards are not available here.');
  const all = standards.list();
  if (!all.length) throw new Error('There are no drawing standards yet. Ask the person to set one up with Document › Set Up Drawing Standard.');
  const names = all.map((s) => s.name).join(', ');
  if (typeof args.standard === 'string' && args.standard.trim()) {
    const wanted = args.standard.trim().toLowerCase();
    const s = all.find((x) => x.id === args.standard || x.name.toLowerCase() === wanted);
    if (!s) throw new Error(`There is no drawing standard "${args.standard}". The standards are: ${names}.`);
    return { standard: s, doc: null };
  }
  let doc: AssistantDocument | null = null;
  try {
    doc = findDocument(docs, args.document);
  } catch {
    doc = null;
  }
  const used = doc?.store.drawingStandard();
  const s = used ? all.find((x) => x.id === used.id) : all.length === 1 ? all[0] : undefined;
  if (!s) throw new Error(`${doc ? `${doc.name} is not read with a drawing standard. ` : ''}Say which standard: ${names}.`);
  return { standard: s, doc };
}

function getDrawingStandard(docs: readonly AssistantDocument[], standards: AssistantStandards | undefined, params: unknown) {
  const args = record(params);
  const { standard: s, doc } = findStandard(docs, standards, args);
  return {
    id: s.id,
    name: s.name,
    ...(doc ? { readingDocument: doc.name } : {}),
    titleBlock: {
      fields: s.sheets.boxes.map((b) => ({ field: b.field, ...(b.name ? { name: b.name } : {}), rect: { x: b.x, y: b.y, w: b.w, h: b.h } })),
      drawingNumberTemplate: s.sheets.template,
      note: 'Title-block boxes are fractions of the page (0 to 1) from the top-left.',
    },
    linkWords: { sectionTitles: s.links.titles.section, elevationTitles: s.links.titles.elevation, enlargedPlanTitles: s.links.titles.enlargedPlan, matchLine: s.links.matchLine, identifierForms: s.links.ids, calloutCitesNumberPart: s.links.calloutPart },
    chainage: s.chainage,
    taughtMarks: s.marks.map((m) => ({ kind: m.kind, name: m.name, size: { w: m.w, h: m.h }, label: m.words.map((w) => ({ role: w.role, text: w.text })) })),
    examples: (s.examples ?? []).map((e) => ({ ...e, page: e.page + 1, note: 'rect is fractions of the page; page is 1-based in the set it was drawn on' })),
    steps: SETUP_STEPS.map((step) => ({ step, ...(s.results?.[step] ?? { band: 'not run' }) })),
    pendingProposals: (s.proposals ?? []).map((p) => ({ changes: describeChanges(p.changes), reasoning: p.reasoning })),
  };
}

const sourceOf = (id: string) => (id.startsWith('pdf-') ? 'pdf' : id.startsWith('mark-') ? 'taught mark' : id.startsWith('ai-') ? 'ai' : 'text');

function listSheetLinks(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  const kinds = Object.keys(LINK_KINDS);
  if (args.kind !== undefined && (typeof args.kind !== 'string' || !kinds.includes(args.kind))) throw new Error(`kind is one of ${kinds.join(', ')}.`);
  const statuses = ['auto', 'review', 'accepted', 'rejected'];
  if (args.status !== undefined && (typeof args.status !== 'string' || !statuses.includes(args.status))) throw new Error(`status is one of ${statuses.join(', ')}.`);
  const page = args.page === undefined ? null : pageIndexOf(doc, args.page);
  const offset = args.offset === undefined ? 0 : Number(args.offset);
  const limit = args.limit === undefined ? DEFAULT_LIMIT : Number(args.limit);
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset is a whole number, 0 or more.');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`limit is a whole number from 1 to ${MAX_LIMIT}.`);
  const all = doc.store.allLinks();
  const wanted = all.filter((l) => (args.kind === undefined || l.kind === args.kind) && (args.status === undefined || l.status === args.status) && (page === null || l.pageIndex === page));
  const counts: Record<string, number> = {};
  for (const l of wanted) counts[l.status] = (counts[l.status] ?? 0) + 1;
  const sheet = (i: number) => doc.store.allSheets()[i]?.number ?? null;
  const shown = wanted.slice(offset, offset + limit);
  return {
    document: doc.name,
    total: wanted.length,
    byStatus: counts,
    links: shown.map((l) => ({
      id: l.id,
      page: l.pageIndex + 1,
      sheet: sheet(l.pageIndex),
      rect: rectOut(l.rect),
      label: l.label,
      kind: l.kind,
      targetPage: l.targetPage + 1,
      targetSheet: sheet(l.targetPage),
      ...(l.targetRect ? { targetRect: rectOut(l.targetRect) } : {}),
      confidence: l.confidence,
      status: l.status,
      source: sourceOf(l.id),
      ...(l.evidence?.length ? { why: explain(l).map((e) => `${e.effect}: ${e.says}`) } : {}),
      ...(l.note ? { note: l.note } : {}),
    })),
    ...(offset + shown.length < wanted.length ? { more: `Showing ${offset + 1}-${offset + shown.length}. Ask again with offset ${offset + shown.length} for the rest.` } : {}),
  };
}

function rectIn(v: unknown, what: string, page: { width: number; height: number } | null): Rect {
  const r = record(v);
  const n = (k: string) => {
    const x = r[k];
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`${what} needs x, y, w and h in PDF points.`);
    return x;
  };
  const rect = { x: n('x'), y: n('y'), w: n('w'), h: n('h') };
  if (rect.w <= 0 || rect.h <= 0) throw new Error(`${what} has no size.`);
  if (page && (rect.x < -1 || rect.y < -1 || rect.x + rect.w > page.width + 1 || rect.y + rect.h > page.height + 1)) throw new Error(`${what} is off the page (${Math.round(page.width)} × ${Math.round(page.height)} points).`);
  return rect;
}

const FROM_AI: DetectedLink['evidence'] = ['aiProposed'];

function proposeSheetLinks(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  if (doc.store.readOnly) throw new Error(`${doc.name} is read-only.`);
  if (!Array.isArray(args.links) || !args.links.length) throw new Error('Give the links to propose, in links.');
  if (args.links.length > MAX_PROPOSED) throw new Error(`Propose at most ${MAX_PROPOSED} links at a time.`);
  const kinds = Object.keys(LINK_KINDS) as LinkKind[];
  // Every item is checked before any is added.
  const links: DetectedLink[] = args.links.map((raw: unknown, n: number) => {
    const at = `Link ${n + 1}`;
    try {
      const item = record(raw);
      const pageIndex = pageIndexOf(doc, item.page);
      const targetPage = pageIndexOf(doc, item.targetPage);
      const kind = item.kind as LinkKind;
      if (!kinds.includes(kind)) throw new Error(`kind is one of ${kinds.join(', ')}.`);
      if (typeof item.label !== 'string' || !item.label.trim()) throw new Error('label is the callout as it reads (3/C-501, CH 100).');
      if (typeof item.reasoning !== 'string' || !item.reasoning.trim()) throw new Error('Say how you read it, in reasoning, for the person checking it.');
      if (targetPage === pageIndex && kind !== 'section' && kind !== 'elevation') throw new Error('a link goes to another sheet (only a section or elevation title can point at its own sheet).');
      const rect = rectIn(item.rect, 'rect', doc.pageSize?.(pageIndex) ?? null);
      const targetRect = item.targetRect === undefined || item.targetRect === null ? null : rectIn(item.targetRect, 'targetRect', doc.pageSize?.(targetPage) ?? null);
      const label = item.label.trim().slice(0, 80);
      const detail = typeof item.detail === 'string' && item.detail.trim() ? item.detail.trim().slice(0, 20) : kind === 'detail' || kind === 'section' || kind === 'elevation' ? (label.split('/')[0]!.trim() || null) : null;
      return { id: `${pageIndex}:${label}:${Math.round(rect.x / 4)}:${Math.round(rect.y / 4)}`, pageIndex, rect, label, kind, detail, targetPage, targetRect, confidence: 0.6, evidence: FROM_AI, note: item.reasoning.trim().slice(0, 500) };
    } catch (err) {
      throw new Error(`${at}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const ids = doc.store.proposeLinks(links);
  return { document: doc.name, proposed: ids.length, ids, review: `Waiting for a person in ${LINKS_REVIEW}. Proposing the same place again updates it.` };
}

const HINT_FIELDS: Record<keyof HintChanges, 'list' | 'text'> = {
  sectionWords: 'list',
  elevationWords: 'list',
  matchLineWords: 'list',
  chainagePrefixes: 'list',
  alignments: 'list',
  alignmentTemplate: 'text',
  planTitles: 'list',
  sectionTitles: 'list',
};

function proposeStandardHints(docs: readonly AssistantDocument[], standards: AssistantStandards | undefined, params: unknown) {
  const args = record(params);
  const { standard } = findStandard(docs, standards, args);
  if (typeof args.reasoning !== 'string' || !args.reasoning.trim()) throw new Error('Say what you saw on the sheets, in reasoning, for the person deciding.');
  const changes: HintChanges = {};
  for (const [key, type] of Object.entries(HINT_FIELDS) as [keyof HintChanges, 'list' | 'text'][]) {
    const v = args[key];
    if (v === undefined) continue;
    if (type === 'text') {
      if (typeof v !== 'string' || !v.trim() || v.length > 60) throw new Error(`${key} is a short text, such as MC##.`);
      changes.alignmentTemplate = v.trim().toUpperCase();
      continue;
    }
    if (!Array.isArray(v) || v.length > 20 || v.some((w) => typeof w !== 'string' || !w.trim() || w.length > 60)) throw new Error(`${key} is a list of up to 20 short texts.`);
    (changes as Record<string, string[]>)[key] = (v as string[]).map((w) => w.trim());
  }
  const lines = describeChanges(changes);
  if (!lines.length) throw new Error(`Propose at least one of: ${Object.keys(HINT_FIELDS).join(', ')}.`);
  const proposal = { id: crypto.randomUUID(), at: Date.now(), changes, reasoning: args.reasoning.trim().slice(0, 1000) };
  standards!.save({ ...standard, proposals: [...(standard.proposals ?? []), proposal].slice(-20) });
  return { standard: standard.name, proposed: lines, review: `Waiting for a person in ${HINTS_REVIEW}. Words are only ever added, never removed.` };
}

export async function standardCall(docs: readonly AssistantDocument[], method: StandardMethod, params: unknown, standards: AssistantStandards | undefined): Promise<unknown> {
  if (method === 'get_drawing_standard') return getDrawingStandard(docs, standards, params);
  if (method === 'list_sheet_links') return listSheetLinks(docs, params);
  if (method === 'propose_sheet_links') return proposeSheetLinks(docs, params);
  return proposeStandardHints(docs, standards, params);
}
