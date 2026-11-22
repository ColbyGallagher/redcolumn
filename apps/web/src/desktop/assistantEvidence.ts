import { AI_METHODS, SOURCE_KINDS, isAiDraft, type AiMethod, type AiOrigin, type Markup, type ProposedQuantity, type SourceKind, type SourceRef } from '@nb/markup';
import { isMeasureKind } from '@nb/measure';

/**
 * The evidence an AI client gives with what it proposes over MCP: how sure it is, where in the
 * document it read it, how it found it and why. Shown beside each result in Review AI Takeoff so
 * the person checks it against the source. Pages come in 1-based, as every assistant tool takes them.
 */
export interface Evidence {
  reasoning?: string;
  confidence?: number;
  method?: AiMethod;
  sources?: SourceRef[];
  expected?: ProposedQuantity[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Reads `confidence`, `method`, `sources`, `expected` and `reasoning` from one proposal; throws on a bad one. */
export function evidenceOf(item: Record<string, unknown>, pageCount: number): Evidence {
  const out: Evidence = {};
  if (typeof item.reasoning === 'string' && item.reasoning.trim()) out.reasoning = item.reasoning.trim().slice(0, 2000);
  if (item.confidence !== undefined) {
    const c = item.confidence;
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) throw new Error('confidence has to be a number from 0 (a guess) to 1 (certain)');
    out.confidence = c;
  }
  if (item.method !== undefined) {
    if (typeof item.method !== 'string' || !(AI_METHODS as readonly string[]).includes(item.method)) throw new Error(`method has to be one of ${AI_METHODS.join(', ')}`);
    out.method = item.method as AiMethod;
  }
  if (item.sources !== undefined) {
    if (!Array.isArray(item.sources)) throw new Error('sources has to be a list of { page, bbox, text, kind }');
    if (item.sources.length > 20) throw new Error('give at most 20 sources');
    out.sources = item.sources.map((raw, i) => {
      if (!isObj(raw)) throw new Error(`source ${i + 1} has to be { page, bbox, text, kind }`);
      const page = raw.page;
      if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > pageCount) throw new Error(`source ${i + 1}: page has to be from 1 to ${pageCount}`);
      const src: SourceRef = { pageIndex: page - 1 };
      if (raw.bbox !== undefined) {
        const b = raw.bbox;
        if (!isObj(b) || ![b.x, b.y, b.w, b.h].every((n) => typeof n === 'number' && Number.isFinite(n)) || (b.w as number) < 0 || (b.h as number) < 0) throw new Error(`source ${i + 1}: bbox has to be { x, y, w, h } in PDF points`);
        src.rect = { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number };
      }
      if (typeof raw.text === 'string' && raw.text.trim()) src.text = raw.text.trim().slice(0, 500);
      if (raw.kind !== undefined) {
        if (typeof raw.kind !== 'string' || !(SOURCE_KINDS as readonly string[]).includes(raw.kind)) throw new Error(`source ${i + 1}: kind has to be one of ${SOURCE_KINDS.join(', ')}`);
        src.kind = raw.kind as SourceKind;
      }
      return src;
    });
    if (!out.sources.length) delete out.sources;
  }
  if (Array.isArray(item.expected)) {
    const expected = item.expected.flatMap((e: unknown) => {
      if (!isObj(e)) return [];
      const quantity = typeof e.quantity === 'number' ? e.quantity : Number(e.quantity);
      return typeof e.item === 'string' && Number.isFinite(quantity) ? [{ item: e.item.slice(0, 200), quantity, ...(typeof e.unit === 'string' ? { unit: e.unit.slice(0, 20) } : {}) }] : [];
    });
    if (expected.length) out.expected = expected;
  }
  return out;
}

/** The AI client's name, as it gave it. */
export function sourceName(raw: unknown): string {
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 80) : 'AI assistant';
}

/**
 * What an AI-made measurement carries: it is a draft until a person approves it. Other markups an
 * AI client draws (clouds, notes) are not quantities and are left as they are.
 */
export function aiDraftOf(m: Markup, source: string, evidence: Evidence): AiOrigin | undefined {
  if (!isMeasureKind(m.type)) return undefined;
  return {
    source,
    at: Date.now(),
    status: 'pending',
    original: { points: m.points.map((p) => [p[0], p[1]]), ...(m.subject ? { subject: m.subject } : {}), ...(m.text ? { text: m.text } : {}), ...(m.comment ? { comment: m.comment } : {}), ...(m.assemblyId ? { assemblyId: m.assemblyId } : {}) },
    ...evidence,
  };
}

/** How the assistant reports a markup's review state. */
export function publicAi(m: Markup) {
  if (!m.ai) return {};
  return { ai: { status: isAiDraft(m) ? 'draft' : 'approved', ...(m.ai.confidence !== undefined ? { confidence: m.ai.confidence } : {}), ...(m.ai.review ? { approvedBy: m.ai.review.by } : {}) } };
}
