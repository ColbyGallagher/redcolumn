import type { Markup, MarkupStyle } from '@nb/markup';

/** A Tool Chest count tool, as far as turning found items into a count needs it. */
export interface CountTool {
  id: string;
  name: string;
  style: MarkupStyle;
  subject?: string;
  label?: string;
  /** The markup the tool was saved from, carrying its layer, label and the rest of its properties. */
  markups?: Markup[];
}

/** One found item: the page it is on and where its count symbol goes. */
export interface CountHit {
  pageIndex: number;
  point: [number, number];
}

export interface CountOptions {
  /** What every new markup starts with: author, times, status and custom column values. */
  base: Pick<Markup, 'status' | 'author' | 'createdAt' | 'modifiedAt'> & { fields?: Record<string, string> };
  /** The count style used when no tool is chosen (the tool settings' current one). */
  style: MarkupStyle;
  /** The subject given to a count made without a tool. */
  subject: string;
  tool?: CountTool | null;
  newId?: () => string;
}

/** The properties of a saved count that a tool hands on to the counts it makes. */
const TOOL_PROPERTIES = ['layer', 'legendHidden', 'assemblyId'] as const satisfies readonly (keyof Markup)[];

/** The centre of a rectangle, which is where a count symbol goes on a found item. */
export const centreOf = (r: { x: number; y: number; w: number; h: number }): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/**
 * Counts for found items: one count markup per page holding every item on that page. With a tool,
 * each carries its style, subject, label, layer and other properties; otherwise the default count style.
 */
export function countsFromHits(hits: readonly CountHit[], o: CountOptions): Markup[] {
  const byPage = new Map<number, [number, number][]>();
  for (const h of hits) byPage.set(h.pageIndex, [...(byPage.get(h.pageIndex) ?? []), h.point]);
  const newId = o.newId ?? (() => crypto.randomUUID());
  const saved = o.tool?.markups?.find((m) => m.type === 'count');
  // Only what a tool carries, not what belongs to the one markup it was saved from (its group,
  // lock, capture, import link, replies, status...).
  const carried: Partial<Markup> = {};
  for (const k of TOOL_PROPERTIES) if (saved?.[k] !== undefined) Object.assign(carried, { [k]: saved[k] });
  const savedFields = saved?.fields;
  const fields = o.base.fields || savedFields ? { ...o.base.fields, ...savedFields } : undefined;
  const label = o.tool ? (o.tool.label ?? saved?.label) : undefined;
  return [...byPage].map(([pageIndex, points]) => ({
    ...carried,
    ...o.base,
    ...(fields ? { fields } : {}),
    id: newId(),
    type: 'count' as const,
    pageIndex,
    points,
    style: { ...(o.tool?.style ?? o.style) },
    subject: o.tool ? (o.tool.subject || saved?.subject || o.tool.name) : o.subject,
    ...(label ? { label } : {}),
  }));
}
