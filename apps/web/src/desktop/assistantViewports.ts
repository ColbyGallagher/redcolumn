import { scaleEquation, parseTypedScale, type Scale } from '@nb/measure';
import { viewportRectFromCorners, type Viewport } from '@nb/markup';
import { withDefaultUnits } from '../settings/settings';
import { findDocument, pageIndexOf, pointsOf, record, type AssistantDocument } from './assistant';

/**
 * The viewport tools: a viewport is a rectangle on a page drawn at its own scale (a detail or
 * section beside a plan). Pages are 1-based and points are PDF points from the page's top-left,
 * y down, as in the markup tools. Scales are written as `get_page` writes them.
 */
export const VIEWPORT_METHODS = ['list_viewports', 'place_viewport', 'place_viewports', 'set_viewport_scale'] as const;

export type ViewportMethod = (typeof VIEWPORT_METHODS)[number];

/** The most viewports one call places. */
const MAX_VIEWPORTS = 100;

const round2 = (n: number) => Math.round(n * 100) / 100;

function publicViewport(v: Viewport) {
  return {
    id: v.id,
    name: v.name,
    page: v.pageIndex + 1,
    rect: { x: round2(v.rect.x), y: round2(v.rect.y), w: round2(v.rect.w), h: round2(v.rect.h) },
    scale: scaleEquation(v.scale),
  };
}

function writable(doc: AssistantDocument) {
  if (doc.store.readOnly) throw new Error(`${doc.name} is read-only.`);
}

/** A scale written as the UI's fields take it, with the default units filled in as the UI does. */
function scaleOf(raw: unknown): Scale {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Give the scale as text, such as 1/4" = 1\'-0" or 1:100.');
  const scale = parseTypedScale(raw);
  if (!scale || !(scale.metersPerPoint > 0) || !Number.isFinite(scale.metersPerPoint)) throw new Error(`"${raw}" is not a scale. Write it as 1/4" = 1'-0" or 1:100.`);
  return withDefaultUnits(scale);
}

/** One viewport to place, checked. `fallbackPage` is the call's page for items that name none. */
function planViewport(doc: AssistantDocument, item: Record<string, unknown>, fallbackPage: unknown, taken: Map<number, number>): { viewport: Viewport } {
  const page = item.page ?? fallbackPage;
  if (page === undefined) throw new Error('Say which page to place the viewport on.');
  const pageIndex = pageIndexOf(doc, page);
  const size = doc.pageSize?.(pageIndex) ?? null;
  if (!size) throw new Error(`Page size is not available for page ${pageIndex + 1} of ${doc.name}.`);
  const points = pointsOf(item.points);
  if (points.length !== 2) throw new Error('Give two opposite corners: [[x, y], [x, y]].');
  const rect = viewportRectFromCorners(points[0]!, points[1]!, size);
  if (!rect) throw new Error(`Those corners leave nothing on page ${pageIndex + 1} (${Math.round(size.width)} × ${Math.round(size.height)} points).`);
  if (item.name !== undefined && (typeof item.name !== 'string' || !item.name.trim())) throw new Error('Name has to be text.');
  const scale = item.scale === undefined ? doc.store.scaleFor(pageIndex) : scaleOf(item.scale);
  const n = (taken.get(pageIndex) ?? doc.store.allViewports().filter((v) => v.pageIndex === pageIndex).length) + 1;
  taken.set(pageIndex, n);
  const name = typeof item.name === 'string' ? item.name.trim() : `Viewport ${n}`;
  return { viewport: { id: crypto.randomUUID(), pageIndex, name, rect, scale } };
}

function listViewports(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  const pageIndex = args.page === undefined ? null : pageIndexOf(doc, args.page);
  const viewports = doc.store.allViewports().filter((v) => pageIndex === null || v.pageIndex === pageIndex);
  return { document: doc.name, viewports: viewports.map(publicViewport) };
}

function place(doc: AssistantDocument, items: Record<string, unknown>[], fallbackPage: unknown, label: (i: number) => string) {
  const taken = new Map<number, number>();
  const plan = items.map((item, i) => {
    try {
      return planViewport(doc, item, fallbackPage, taken);
    } catch (err) {
      throw new Error(`${label(i)}${err instanceof Error ? err.message : 'That viewport cannot be placed.'}`);
    }
  });
  doc.store.checkpoint();
  doc.store.batch(() => {
    for (const { viewport } of plan) doc.store.setViewport(viewport);
  });
  return { document: doc.name, placed: plan.map(({ viewport }) => publicViewport(viewport)) };
}

function placeViewport(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  writable(doc);
  const result = place(doc, [args], undefined, () => '');
  return { document: result.document, viewport: result.placed[0]! };
}

function placeViewports(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  writable(doc);
  const raw = args.viewports;
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('Give viewports: a list of what to place, each with a page, two corners, and optionally a name and scale.');
  }
  if (raw.length > MAX_VIEWPORTS) throw new Error(`That is ${raw.length} at once. The most is ${MAX_VIEWPORTS}: send the rest in another call.`);
  return place(doc, raw as Record<string, unknown>[], args.page, (i) => `Viewport ${i + 1}: `);
}

function setViewportScale(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  writable(doc);
  if (typeof args.id !== 'string' || !args.id) throw new Error('Give the viewport id from list_viewports.');
  const viewport = doc.store.allViewports().find((v) => v.id === args.id);
  if (!viewport) throw new Error(`No viewport ${args.id} in ${doc.name}. List them with list_viewports.`);
  const scale = scaleOf(args.scale);
  doc.store.checkpoint();
  doc.store.setViewport({ ...viewport, scale });
  const updated = doc.store.allViewports().find((v) => v.id === viewport.id) ?? { ...viewport, scale };
  return { document: doc.name, viewport: publicViewport(updated) };
}

export function viewportCall(docs: readonly AssistantDocument[], method: string, params: unknown): unknown {
  if (method === 'list_viewports') return listViewports(docs, params);
  if (method === 'place_viewport') return placeViewport(docs, params);
  if (method === 'place_viewports') return placeViewports(docs, params);
  if (method === 'set_viewport_scale') return setViewportScale(docs, params);
  throw new Error('Unknown tool.');
}
