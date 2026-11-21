import { FINDING_KINDS, type FindingKind, type Markup, type ReviewFinding } from '@nb/markup';
import { scaleEquation } from '@nb/measure';
import { evidenceOf, sourceName } from './assistantEvidence';
import { batchItems, errorText, findDocument, measurement, record, type AssistantDocument } from './assistant';
import { reviewItems } from '../takeoff/aiReview';

/**
 * The optional AI review pass. A second AI pass checks the takeoff in a fresh context: it gets the
 * document and the takeoff output (every AI result, where it is, what it measures and its sources)
 * but not the first pass's reasoning or confidence, so it checks the work without inheriting its
 * assumptions. It reports findings per item, and things missed; they show in Review AI Takeoff,
 * labelled as AI review, and a person accepts or dismisses each one. Nothing is applied.
 * redcolumn never calls a model: the person's AI client runs the reviewer, on the model it chooses.
 */
export const REVIEW_PASS_METHODS = ['get_review_packet', 'report_review_findings'] as const;
export type ReviewPassMethod = (typeof REVIEW_PASS_METHODS)[number];

const MAX_FINDINGS = 1000;
const round = (n: number) => Math.round(n * 100) / 100;

/** What the reviewer is told to do, and how. Also what Copy Reviewer Prompt puts on the clipboard. */
export function reviewerInstructions(documentName: string): string {
  return [
    `Review the AI takeoff of ${documentName} in redcolumn as an independent checker.`,
    'Work in a fresh context: start a new conversation or a subagent that has not seen the takeoff being made. Use a strong model; a different one from the first pass is better.',
    'Call get_review_packet for the takeoff output. It holds what was measured, counted and grouped, and where, but not why: check each item against the drawing yourself with get_page_text, get_page_image and get_sheet_info. Do not trust the sources it lists: read them.',
    'For each item report what is wrong (quantity, wrong item, scale, grouping, duplicate) or that it is right, and report anything the takeoff missed, with the page and area. Use report_review_findings, with sources for every finding.',
    'Do not change the drawing. The person decides on each finding.',
  ].join('\n');
}

function geometry(m: Markup) {
  return { type: m.type, page: m.pageIndex + 1, points: m.points.map((p) => [round(p[0]), round(p[1])]) };
}

/** The takeoff output for a reviewer: every AI result that is not rejected, without the reasoning or confidence behind it. */
function getReviewPacket(docs: readonly AssistantDocument[], params: unknown) {
  const doc = findDocument(docs, record(params).document);
  const store = doc.store;
  const sheets = store.allSheets();
  const items = reviewItems(store)
    .filter((i) => i.state !== 'rejected')
    .map((i) => {
      const base = { item: i.key, kind: i.kind, state: i.state === 'approved' ? 'approved by a person' : 'waiting for review', title: i.title, ...(i.pageIndex !== null ? { page: i.pageIndex + 1 } : {}), sources: i.sources.map((s) => ({ page: s.pageIndex + 1, ...(s.rect ? { bbox: s.rect } : {}), ...(s.text ? { text: s.text } : {}), ...(s.kind ? { kind: s.kind } : {}) })) };
      if (i.kind === 'count' && i.count) return { ...base, count: i.count.placed?.count ?? i.count.matches.length, matches: i.count.matches.map((x) => ({ page: x.pageIndex + 1, bbox: x.rect })) };
      const m = i.markup;
      if (!m) return base;
      const assembly = store.resolvedAssemblies().find((a) => a.id === (i.kind === 'assembly' ? i.takeoff!.assemblyId : m.assemblyId));
      return { ...base, markup: { id: m.id, ...geometry(m), ...(m.subject ? { subject: m.subject } : {}) }, measurement: measurement(doc, m) ?? null, ...(assembly ? { assembly: assembly.name } : {}), ...(i.kind === 'assembly' && i.takeoff?.expected ? { expected: i.takeoff.expected } : {}) };
    });
  const columns = store.aiReview().columns
    .filter((g) => g.status !== 'rejected')
    .map((g) => ({ item: `column:${g.id}`, kind: 'column', name: g.name, status: g.status, groups: g.assignments.map((a) => ({ markupId: a.markupId, value: a.value })) }));
  const pass = store.reviewPass();
  // The reviewer has the request now: its own calls are not reminded to start a review.
  if (pass.requested && !pass.requested.taken && !store.readOnly) store.setReviewPass({ ...pass, requested: { ...pass.requested, taken: Date.now() } }, true);
  return {
    document: doc.name,
    pageCount: doc.pageCount,
    sheets: Array.from({ length: doc.pageCount }, (_, i) => ({ page: i + 1, number: sheets[i]?.number ?? null, title: sheets[i]?.title ?? null, scale: store.hasScale(i) ? `${store.scaleFor(i).label} (${scaleEquation(store.scaleFor(i))})` : null })),
    items: [...items, ...columns],
    ...(pass.requested ? { requested: { by: pass.requested.by, at: new Date(pass.requested.at).toISOString() } } : {}),
    instructions: reviewerInstructions(doc.name),
  };
}

const SEVERITIES = new Set(['issue', 'check', 'ok']);

function reportReviewFindings(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  const store = doc.store;
  if (store.readOnly) throw new Error(`${doc.name} is read-only.`);
  const items = batchItems(args.findings, 'Give findings: a list of { item (from get_review_packet) or none for something missed, severity, kind, message, sources }.', MAX_FINDINGS);
  const known = new Set([...reviewItems(store).map((i) => i.key), ...store.aiReview().columns.map((g) => `column:${g.id}`)]);
  const source = sourceName(args.source === undefined ? 'AI reviewer' : args.source);
  const now = Date.now();
  const findings: ReviewFinding[] = items.map((f, n) => {
    try {
      const item = f.item === undefined || f.item === null || f.item === '' ? undefined : String(f.item);
      if (item && !known.has(item)) throw new Error(`${item} is not an item of get_review_packet`);
      const severity = f.severity ?? 'issue';
      if (typeof severity !== 'string' || !SEVERITIES.has(severity)) throw new Error('severity has to be issue, check or ok');
      const kind = f.kind ?? (item ? 'other' : 'missed');
      if (typeof kind !== 'string' || !(FINDING_KINDS as readonly string[]).includes(kind)) throw new Error(`kind has to be one of ${FINDING_KINDS.join(', ')}`);
      if (typeof f.message !== 'string' || !f.message.trim()) throw new Error('say what you found (message)');
      const { sources } = evidenceOf(f, doc.pageCount);
      if (!item && !sources?.length) throw new Error('something missed needs a source: the page (and bbox) where it is');
      const e = f.expected === undefined ? undefined : record(f.expected);
      if (e && (typeof e.quantity !== 'number' || !Number.isFinite(e.quantity))) throw new Error('expected has to be { quantity, unit }');
      return {
        id: crypto.randomUUID(),
        ...(item ? { item } : {}),
        severity: severity as ReviewFinding['severity'],
        kind: kind as FindingKind,
        message: f.message.trim().slice(0, 2000),
        ...(e ? { expected: { quantity: e.quantity as number, ...(typeof e.unit === 'string' ? { unit: e.unit.slice(0, 20) } : {}) } } : {}),
        ...(sources ? { sources } : {}),
        source,
        createdAt: now,
        status: 'open',
      };
    } catch (err) {
      throw new Error(`Finding ${n + 1}: ${errorText(err)}`);
    }
  });
  store.changeAiReview({ findings }, true);
  const pass = store.reviewPass();
  if (pass.requested) store.setReviewPass({ enabled: pass.enabled }, true);
  return {
    document: doc.name,
    reported: findings.length,
    issues: findings.filter((f) => f.severity === 'issue').length,
    note: 'Shown in Review AI Takeoff as AI review findings, beside the items they are about. The person accepts or dismisses each one; nothing is applied.',
  };
}

export function reviewPassCall(docs: readonly AssistantDocument[], method: ReviewPassMethod, params: unknown): unknown {
  return method === 'get_review_packet' ? getReviewPacket(docs, params) : reportReviewFindings(docs, params);
}
