import { sanitizeGrouping, type GroupingProposal } from './aiGrouping';
import { MARKUP_TYPES, type AiMethod, type AiOrigin, type Markup, type Point, type ProposedQuantity, type Rect, type SourceKind, type SourceRef } from './model';

/**
 * What an AI client proposed for a document and a person has not taken into the drawing: an
 * assembly for a measurement, a count of found symbols, and the AI drafts a person rejected. Kept
 * in the document (store meta `aiReview`, and /NBAIReview in the saved PDF), so it saves with the
 * file and everyone in a Live Session reviews the same list. AI drafts waiting for review are
 * markups themselves (`Markup.ai`), not kept here.
 */

/** An assembly an AI client proposed for a measurement. Approving writes it onto the measurement. */
export interface TakeoffProposal {
  id: string;
  markupId: string;
  assemblyId: string;
  /** Why the AI chose this assembly for this measurement. */
  reasoning: string;
  /** The quantities the AI expects, to check against what the assembly works out. */
  expected?: ProposedQuantity[];
  /** Who proposed it: the AI client's name. */
  source: string;
  createdAt: number;
  confidence?: number;
  sources?: SourceRef[];
  /** Set when a person rejects it (approvals are on the measurement). */
  rejected?: { by: string; at: number };
}

/** One found symbol: where it is on the page (0-based page index, PDF points). */
export interface CountMatch {
  pageIndex: number;
  rect: Rect;
  /** How well it matched (0–1), when the engine said. */
  score?: number;
}

/** Found symbols an AI client named as a count. Approving places Count markups. */
export interface CountProposal {
  id: string;
  subject: string;
  reasoning: string;
  source: string;
  createdAt: number;
  matches: CountMatch[];
  confidence?: number;
  sources?: SourceRef[];
  /** Set on approval: the Count markups it placed. */
  placed?: { by: string; at: number; markupIds: string[]; count: number };
  rejected?: { by: string; at: number };
}

/** An AI draft a person rejected: off the drawing, kept so it can be reviewed again. */
export interface RejectedDraft {
  markup: Markup;
  by: string;
  at: number;
}

export interface AiReviewData {
  takeoff: TakeoffProposal[];
  counts: CountProposal[];
  rejected: RejectedDraft[];
  /** Grouping columns an AI client (or a tool) proposed (see `aiGrouping.ts`). */
  columns: GroupingProposal[];
  /** What an optional second AI pass, in a fresh context, found wrong or missing (see `ReviewFinding`). */
  findings: ReviewFinding[];
  /** In a saved file only: the review pass was turned on for this document (`MarkupStore.reviewPass`). */
  reviewPass?: { enabled: true };
}

/** The kinds of entry the review list holds, one store map key each. */
export type AiReviewKind = Exclude<keyof AiReviewData, 'reviewPass'>;

/** What a review finding is about. */
export type FindingKind = 'quantity' | 'missed' | 'wrong-item' | 'scale' | 'grouping' | 'duplicate' | 'other';
export const FINDING_KINDS: readonly FindingKind[] = ['quantity', 'missed', 'wrong-item', 'scale', 'grouping', 'duplicate', 'other'];

/**
 * One thing an AI review pass reported: run on demand, in a fresh context that sees only the
 * document and the takeoff output (not the first pass's working or reasoning). It is about one item
 * in the review list (`item`, a review key such as `draft:<id>`), or none for something missed. It
 * is never applied: a person accepts or dismisses each one.
 */
export interface ReviewFinding {
  id: string;
  /** The review item it is about (`draft:`, `assembly:`, `count:` or `column:` and an id); none for something missed. */
  item?: string;
  /** `issue`: something is wrong; `check`: worth a second look; `ok`: the reviewer agrees. */
  severity: 'issue' | 'check' | 'ok';
  kind: FindingKind;
  message: string;
  /** What the reviewer measured or counted instead. */
  expected?: { quantity: number; unit?: string };
  sources?: SourceRef[];
  /** The reviewing AI client's name. */
  source: string;
  createdAt: number;
  status: 'open' | 'accepted' | 'dismissed';
  decided?: { by: string; at: number };
}

export const EMPTY_AI_REVIEW: AiReviewData = Object.freeze({ takeoff: [], counts: [], rejected: [], columns: [], findings: [] }) as AiReviewData;

/** Below this confidence an AI result is flagged, and listed first. */
export const LOW_CONFIDENCE = 0.6;

export const SOURCE_KINDS: readonly SourceKind[] = ['drawing', 'legend', 'schedule', 'note', 'specification', 'layer', 'symbol', 'dimension', 'other'];
export const AI_METHODS: readonly AiMethod[] = ['vector', 'raster', 'layer', 'text', 'llm'];

const MAX_TEXT = 2000;
const MAX_SOURCES = 20;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');

export function sanitizeConfidence(v: unknown): number | undefined {
  return finite(v) && v >= 0 && v <= 1 ? v : undefined;
}

function rectOf(v: unknown): Rect | undefined {
  if (!isObj(v) || !finite(v.x) || !finite(v.y) || !finite(v.w) || !finite(v.h) || v.w < 0 || v.h < 0) return undefined;
  return { x: v.x, y: v.y, w: v.w, h: v.h };
}

export function sanitizeSources(v: unknown, pageCount?: number): SourceRef[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: SourceRef[] = [];
  for (const s of v.slice(0, MAX_SOURCES)) {
    if (!isObj(s) || !Number.isInteger(s.pageIndex) || (s.pageIndex as number) < 0) continue;
    if (pageCount !== undefined && (s.pageIndex as number) >= pageCount) continue;
    const rect = rectOf(s.rect);
    const t = text(s.text, 500);
    const kind = typeof s.kind === 'string' && (SOURCE_KINDS as readonly string[]).includes(s.kind) ? (s.kind as SourceKind) : undefined;
    out.push({ pageIndex: s.pageIndex as number, ...(rect ? { rect } : {}), ...(t ? { text: t } : {}), ...(kind ? { kind } : {}) });
  }
  return out.length ? out : undefined;
}

function expectedOf(v: unknown): ProposedQuantity[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.flatMap((e) => (isObj(e) && typeof e.item === 'string' && finite(e.quantity) ? [{ item: e.item.slice(0, 200), quantity: e.quantity, ...(typeof e.unit === 'string' ? { unit: e.unit.slice(0, 20) } : {}) }] : []));
  return out.length ? out : undefined;
}

const decision = (v: unknown) => (isObj(v) && typeof v.by === 'string' && finite(v.at) ? { by: v.by.slice(0, 200), at: v.at } : undefined);

function takeoffOf(v: unknown, pageCount?: number): TakeoffProposal | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.markupId !== 'string' || typeof v.assemblyId !== 'string') return null;
  const confidence = sanitizeConfidence(v.confidence);
  const sources = sanitizeSources(v.sources, pageCount);
  const expected = expectedOf(v.expected);
  const rejected = decision(v.rejected);
  return {
    id: v.id,
    markupId: v.markupId,
    assemblyId: v.assemblyId,
    reasoning: text(v.reasoning),
    source: text(v.source, 80) || 'AI assistant',
    createdAt: finite(v.createdAt) ? v.createdAt : 0,
    ...(expected ? { expected } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(sources ? { sources } : {}),
    ...(rejected ? { rejected } : {}),
  };
}

function countOf(v: unknown, pageCount?: number): CountProposal | null {
  if (!isObj(v) || typeof v.id !== 'string' || !Array.isArray(v.matches)) return null;
  const matches = v.matches.flatMap((m): CountMatch[] => {
    if (!isObj(m) || !Number.isInteger(m.pageIndex) || (m.pageIndex as number) < 0) return [];
    if (pageCount !== undefined && (m.pageIndex as number) >= pageCount) return [];
    const rect = rectOf(m.rect);
    return rect ? [{ pageIndex: m.pageIndex as number, rect, ...(finite(m.score) ? { score: m.score } : {}) }] : [];
  });
  const confidence = sanitizeConfidence(v.confidence);
  const sources = sanitizeSources(v.sources, pageCount);
  const rejected = decision(v.rejected);
  const p = v.placed;
  const placed = isObj(p) && typeof p.by === 'string' && finite(p.at) && Array.isArray(p.markupIds) ? { by: p.by, at: p.at, markupIds: p.markupIds.filter((x): x is string => typeof x === 'string'), count: finite(p.count) ? p.count : 0 } : undefined;
  return {
    id: v.id,
    subject: text(v.subject, 200),
    reasoning: text(v.reasoning),
    source: text(v.source, 80) || 'AI assistant',
    createdAt: finite(v.createdAt) ? v.createdAt : 0,
    matches,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(sources ? { sources } : {}),
    ...(placed ? { placed } : {}),
    ...(rejected ? { rejected } : {}),
  };
}

function rejectedOf(v: unknown, pageCount?: number): RejectedDraft | null {
  if (!isObj(v) || !isObj(v.markup) || typeof v.by !== 'string' || !finite(v.at)) return null;
  const raw = v.markup as unknown as Markup;
  // Review Again puts this markup back in the drawing: check it as the importer checks NBData.
  if (typeof raw.id !== 'string' || !MARKUP_TYPES.includes(raw.type) || !Number.isInteger(raw.pageIndex) || raw.pageIndex < 0) return null;
  if (!Array.isArray(raw.points) || !raw.points.length || !raw.points.every((p) => Array.isArray(p) && finite(p[0]) && finite(p[1]))) return null;
  if (!isObj(raw.style)) return null;
  if (pageCount !== undefined && raw.pageIndex >= pageCount) return null;
  const { ai: rawAi, pdfAnnot: _stale, ...rest } = raw;
  const ai = sanitizeAiOrigin(rawAi, pageCount);
  const m = { ...rest, ...(ai ? { ai } : {}) } as Markup;
  return { markup: m, by: v.by, at: v.at };
}

function findingOf(v: unknown, pageCount?: number): ReviewFinding | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.message !== 'string') return null;
  const severity = v.severity === 'issue' || v.severity === 'check' || v.severity === 'ok' ? v.severity : 'check';
  const kind = typeof v.kind === 'string' && (FINDING_KINDS as readonly string[]).includes(v.kind) ? (v.kind as FindingKind) : 'other';
  const status = v.status === 'accepted' || v.status === 'dismissed' ? v.status : 'open';
  const e = v.expected;
  const expected = isObj(e) && finite(e.quantity) ? { quantity: e.quantity, ...(typeof e.unit === 'string' ? { unit: e.unit.slice(0, 20) } : {}) } : undefined;
  const sources = sanitizeSources(v.sources, pageCount);
  const decided = decision(v.decided);
  return {
    id: v.id,
    ...(typeof v.item === 'string' && v.item ? { item: v.item.slice(0, 200) } : {}),
    severity,
    kind,
    message: text(v.message),
    ...(expected ? { expected } : {}),
    ...(sources ? { sources } : {}),
    source: text(v.source, 80) || 'AI reviewer',
    createdAt: finite(v.createdAt) ? v.createdAt : 0,
    status,
    ...(decided ? { decided } : {}),
  };
}

/** Checks what a file or a Live Session peer wrote: anything malformed is dropped. */
export function sanitizeAiReview(raw: unknown, pageCount?: number): AiReviewData {
  if (!isObj(raw)) return EMPTY_AI_REVIEW;
  const list = <T>(v: unknown, of: (x: unknown, n?: number) => T | null) => (Array.isArray(v) ? v.flatMap((x) => of(x, pageCount) ?? []) : []);
  const pass = isObj(raw.reviewPass) && raw.reviewPass.enabled === true;
  return { takeoff: list(raw.takeoff, takeoffOf), counts: list(raw.counts, countOf), rejected: list(raw.rejected, rejectedOf), columns: list(raw.columns, sanitizeGrouping), findings: list(raw.findings, findingOf), ...(pass ? { reviewPass: { enabled: true } } : {}) };
}

export function isEmptyAiReview(d: AiReviewData): boolean {
  return !d.takeoff.length && !d.counts.length && !d.rejected.length && !d.columns.length && !d.findings.length && !d.reviewPass;
}

/** An AI draft: made by an AI client and not yet approved. Drawn dashed and left out of quantities. */
export function isAiDraft(m: Pick<Markup, 'ai'>): boolean {
  return m.ai?.status === 'pending';
}

/** Markups that count towards quantities and reports: AI drafts wait for a person. */
export function reviewedOnly<T extends Pick<Markup, 'ai'>>(markups: readonly T[]): T[] {
  return markups.some(isAiDraft) ? markups.filter((m) => !isAiDraft(m)) : (markups as T[]);
}

/** What a person changed on an AI-made markup, by field, against what the AI made. */
export function aiEdits(m: Markup): ('geometry' | 'subject' | 'text' | 'comment' | 'assembly')[] {
  const o = m.ai?.original;
  if (!o) return [];
  const out: ('geometry' | 'subject' | 'text' | 'comment' | 'assembly')[] = [];
  const same = (a: readonly Point[], b: readonly Point[]) => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i]![0]) < 1e-6 && Math.abs(p[1] - b[i]![1]) < 1e-6);
  if (!same(m.points, o.points)) out.push('geometry');
  if ((m.subject ?? '') !== (o.subject ?? '')) out.push('subject');
  if ((m.text ?? '') !== (o.text ?? '')) out.push('text');
  if ((m.comment ?? '') !== (o.comment ?? '')) out.push('comment');
  if ((m.assemblyId ?? '') !== (o.assemblyId ?? '')) out.push('assembly');
  return out;
}

/** Checks an `ai` record on a markup read from a file or a peer. */
export function sanitizeAiOrigin(v: unknown, pageCount?: number): AiOrigin | undefined {
  if (!isObj(v) || (v.status !== 'pending' && v.status !== 'approved') || !isObj(v.original) || !Array.isArray(v.original.points)) return undefined;
  const o = v.original as Record<string, unknown> & { points: unknown[] };
  const points = o.points.filter((p): p is Point => Array.isArray(p) && finite(p[0]) && finite(p[1])).map((p) => [p[0], p[1]] as Point);
  const confidence = sanitizeConfidence(v.confidence);
  const sources = sanitizeSources(v.sources, pageCount);
  const expected = expectedOf(v.expected);
  const review = decision(v.review);
  const method = typeof v.method === 'string' && (AI_METHODS as readonly string[]).includes(v.method) ? (v.method as AiMethod) : undefined;
  const reasoning = text(v.reasoning);
  const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
  return {
    source: text(v.source, 80) || 'AI assistant',
    at: finite(v.at) ? v.at : 0,
    status: v.status,
    original: { points, ...(str(o.subject) !== undefined ? { subject: str(o.subject) } : {}), ...(str(o.text) !== undefined ? { text: str(o.text) } : {}), ...(str(o.comment) !== undefined ? { comment: str(o.comment) } : {}), ...(str(o.assemblyId) !== undefined ? { assemblyId: str(o.assemblyId) } : {}) },
    ...(reasoning ? { reasoning } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(method ? { method } : {}),
    ...(sources ? { sources } : {}),
    ...(expected ? { expected } : {}),
    ...(review ? { review } : {}),
  };
}

/**
 * Follows page operations: `to` gives a page's new index (null when deleted), `turn` and
 * `turnRect` move page-space geometry on rotated pages. Proposals left with nothing are dropped.
 */
export function remapAiReview(
  d: AiReviewData,
  to: (i: number) => number | null,
  turn: (page: number, p: readonly [number, number]) => Point,
  turnRect: (page: number, r: Rect) => Rect,
  turnMarkup: (m: Markup, page: number) => Markup,
): AiReviewData {
  const sources = (list: SourceRef[] | undefined) => {
    const out = (list ?? []).flatMap((s) => {
      const n = to(s.pageIndex);
      return n === null ? [] : [{ ...s, pageIndex: n, ...(s.rect ? { rect: turnRect(s.pageIndex, s.rect) } : {}) }];
    });
    return out.length ? out : undefined;
  };
  const withSources = <T extends { sources?: SourceRef[] }>(x: T): T => {
    if (!x.sources) return x;
    const s = sources(x.sources);
    const { sources: _drop, ...rest } = x;
    return (s ? { ...rest, sources: s } : rest) as T;
  };
  return {
    takeoff: d.takeoff.map(withSources),
    counts: d.counts.flatMap((c) => {
      const matches = c.matches.flatMap((m) => {
        const n = to(m.pageIndex);
        return n === null ? [] : [{ ...m, pageIndex: n, rect: turnRect(m.pageIndex, m.rect) }];
      });
      return matches.length ? [withSources({ ...c, matches })] : [];
    }),
    rejected: d.rejected.flatMap((r) => {
      const n = to(r.markup.pageIndex);
      if (n === null) return [];
      return [{ ...r, markup: remapAiOrigin(turnMarkup(r.markup, n), r.markup.pageIndex, to, turn, turnRect) }];
    }),
    columns: d.columns,
    // A missed-item finding is only where its sources are: with every source page deleted, it goes.
    findings: d.findings.flatMap((f) => {
      const moved = withSources(f);
      return !f.item && f.sources?.length && !moved.sources?.length ? [] : [moved];
    }),
  };
}

/** A markup's `ai` record after its page moved or turned (`page` is its old page index). */
export function remapAiOrigin(m: Markup, page: number, to: (i: number) => number | null, turn: (page: number, p: readonly [number, number]) => Point, turnRect: (page: number, r: Rect) => Rect): Markup {
  if (!m.ai) return m;
  const srcs = (m.ai.sources ?? []).flatMap((s) => {
    const n = to(s.pageIndex);
    return n === null ? [] : [{ ...s, pageIndex: n, ...(s.rect ? { rect: turnRect(s.pageIndex, s.rect) } : {}) }];
  });
  const { sources: _drop, ...ai } = m.ai;
  return { ...m, ai: { ...ai, original: { ...ai.original, points: ai.original.points.map((p) => turn(page, p)) }, ...(srcs.length ? { sources: srcs } : {}) } };
}

/** Entries to add or replace, and ids to remove, in one change to the review list. */
export interface AiReviewChange {
  takeoff?: TakeoffProposal[];
  counts?: CountProposal[];
  /** Keyed by the rejected markup's id. */
  rejected?: RejectedDraft[];
  columns?: GroupingProposal[];
  findings?: ReviewFinding[];
  remove?: Partial<Record<AiReviewKind, string[]>>;
}

const PREFIX: Record<AiReviewKind, string> = { takeoff: 't:', counts: 'c:', rejected: 'r:', columns: 'g:', findings: 'f:' };

/** The key an entry is kept under in the store's `aiReview` map. */
export function aiReviewKey(kind: AiReviewKind, id: string): string {
  return PREFIX[kind] + id;
}

/** Every entry of the review list by its store map key. */
export function aiReviewEntries(d: AiReviewData): Map<string, unknown> {
  return new Map<string, unknown>([
    ...d.takeoff.map((p) => [aiReviewKey('takeoff', p.id), p] as const),
    ...d.counts.map((p) => [aiReviewKey('counts', p.id), p] as const),
    ...d.rejected.map((r) => [aiReviewKey('rejected', r.markup.id), r] as const),
    ...d.columns.map((g) => [aiReviewKey('columns', g.id), g] as const),
    ...d.findings.map((f) => [aiReviewKey('findings', f.id), f] as const),
  ]);
}

/** The review list from the store's map entries, checked as it is read (oldest first). */
export function aiReviewFromEntries(entries: Iterable<[string, unknown]>, pageCount?: number): AiReviewData {
  const out: AiReviewData = { takeoff: [], counts: [], rejected: [], columns: [], findings: [] };
  for (const [key, v] of entries) {
    if (key.startsWith(PREFIX.takeoff)) {
      const p = takeoffOf(v, pageCount);
      if (p) out.takeoff.push(p);
    } else if (key.startsWith(PREFIX.counts)) {
      const p = countOf(v, pageCount);
      if (p) out.counts.push(p);
    } else if (key.startsWith(PREFIX.rejected)) {
      const r = rejectedOf(v, pageCount);
      if (r) out.rejected.push(r);
    } else if (key.startsWith(PREFIX.columns)) {
      const g = sanitizeGrouping(v);
      if (g) out.columns.push(g);
    } else if (key.startsWith(PREFIX.findings)) {
      const f = findingOf(v, pageCount);
      if (f) out.findings.push(f);
    }
  }
  out.takeoff.sort((a, b) => a.createdAt - b.createdAt);
  out.counts.sort((a, b) => a.createdAt - b.createdAt);
  out.rejected.sort((a, b) => a.at - b.at);
  out.columns.sort((a, b) => a.createdAt - b.createdAt);
  out.findings.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

/** The optional AI review pass for a document (see `MarkupStore.reviewPass`). */
export interface ReviewPassSettings {
  /** Run a review pass after each AI takeoff. Off by default. */
  enabled: boolean;
  /** A person asked for a review pass now; cleared when the reviewer reports. */
  requested?: { by: string; at: number; /** When a reviewer fetched get_review_packet for it: no more reminders. */ taken?: number };
}
