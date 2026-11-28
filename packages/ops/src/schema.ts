import * as v from 'valibot';
import { MAX_BATCH_SIZE } from './apply.ts';
import { ITEM_KINDS, PLACEMENT_METHODS, PLACEMENT_STATES, RESPONSE_KINDS } from './entities.ts';
import { CONTENT_KEYS, type GeometryKey, MARKUP_TYPE_IDS } from './fieldGroups.ts';
import type { Operation } from './operations.ts';
import { readsVersion } from './protocol.ts';
import type { Rejection } from './state.ts';

// Validation of what a client sends, with Valibot: no code is generated at run time, so it works
// under a Content-Security-Policy without 'unsafe-eval'. Objects are strict: an unknown key (an
// author, an owner, a server time) is refused rather than dropped. Size limits are the server's
// (it measures the bytes it received); nesting depth is limited here.

/** The deepest nesting an operation may have. */
export const MAX_DEPTH = 64;

const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const notReserved = v.check((s: string) => !RESERVED.has(s), 'This name is reserved');

/** A client-made id: letters, digits, `_` and `-` (UUIDs, nanoids, ULIDs...). */
export const IdSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,128}$/, 'Not a valid id'), notReserved);
/** A name chosen elsewhere (a status, a custom column, a group key). */
const KeySchema = v.pipe(v.string(), v.minLength(1), v.maxLength(200), notReserved);
const Finite = v.pipe(v.number(), v.finite());
const Count = (min: number) => v.pipe(v.number(), v.integer(), v.minValue(min));
const Fraction = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const JsonSchema: v.GenericSchema<JsonValue> = v.lazy(() =>
  v.union([v.string(), Finite, v.boolean(), v.null(), v.array(JsonSchema), v.record(KeySchema, JsonSchema)]),
);

const Point = v.strictTuple([Finite, Finite]);
const Points = v.array(Point);

/** Each geometry field's shape. Adding a geometry field to the group map needs an entry here. */
const GEOMETRY_VALUES = {
  points: Points,
  arcAngles: v.strictTuple([Finite, Finite]),
  holes: v.array(Points),
  holeBulges: v.array(v.nullable(v.array(Finite))),
  bulges: v.array(Finite),
  rotation: Finite,
  depth: Finite,
  connect: v.record(KeySchema, JsonSchema),
} satisfies Record<GeometryKey, v.GenericSchema>;

/** A placement's whole shape (`points` required), or a patch of it (null clears a field). */
const geometryEntries = (patch: boolean): v.ObjectEntries =>
  Object.fromEntries(
    Object.entries(GEOMETRY_VALUES).map(([k, s]) => [k, k === 'points' ? (patch ? v.optional(s) : s) : v.optional(patch ? v.nullable(s) : s)]),
  );

const Style = v.objectWithRest({ stroke: v.string(), fill: v.nullable(v.string()), width: Finite, opacity: Finite }, JsonSchema);
const Columns = v.record(KeySchema, v.string());

/**
 * A markup's content (`style` required), or a patch of it (null clears a field; custom columns are
 * patched apart). Values other than style and custom columns are checked as JSON only; the editor
 * checks them as it reads them.
 */
const contentEntries = (patch: boolean): v.ObjectEntries =>
  Object.fromEntries(
    CONTENT_KEYS.filter((k) => !(patch && k === 'fields')).map((k) => [
      k,
      k === 'style' ? (patch ? v.optional(Style) : Style) : k === 'fields' ? v.optional(Columns) : v.optional(patch ? v.nullable(JsonSchema) : JsonSchema),
    ]),
  );

const Empty = v.strictObject({});
const ItemRefSchema = v.strictObject({ kind: v.picklist(ITEM_KINDS), id: IdSchema, rev: Count(1) });

const envelope = {
  opId: IdSchema,
  schemaVersion: v.pipe(v.number(), v.check(readsVersion, 'This protocol version is not supported')),
  streamId: IdSchema,
  entityId: IdSchema,
  basedOn: v.optional(v.record(KeySchema, v.union([Count(0), IdSchema]))),
  batchId: v.optional(IdSchema),
  batchSize: v.optional(v.pipe(Count(1), v.maxValue(MAX_BATCH_SIZE))),
  clientTime: v.optional(Finite),
};

const op = <T extends string, P extends v.GenericSchema>(type: T, payload: P) => v.strictObject({ ...envelope, type: v.literal(type), payload });

/** Every operation a client may send. */
export const OperationSchema = v.variant('type', [
  op('markup.create', v.strictObject({ scopeId: IdSchema, type: v.picklist(MARKUP_TYPE_IDS), content: v.strictObject(contentEntries(false)) })),
  op('markup.patch', v.strictObject({ set: v.optional(v.strictObject(contentEntries(true))), fields: v.optional(v.record(KeySchema, v.nullable(v.string()))) })),
  op('markup.delete', Empty),
  op('markup.restore', Empty),
  op(
    'placement.create',
    v.strictObject({
      markupId: IdSchema,
      revisionId: IdSchema,
      pageId: IdSchema,
      geometry: v.strictObject(geometryEntries(false)),
      method: v.picklist(PLACEMENT_METHODS),
      confidence: v.nullable(Fraction),
      state: v.picklist(PLACEMENT_STATES),
    }),
  ),
  op(
    'placement.patch',
    v.strictObject({
      geometry: v.optional(v.strictObject(geometryEntries(true))),
      placed: v.optional(
        v.strictObject({
          method: v.optional(v.picklist(PLACEMENT_METHODS)),
          confidence: v.optional(v.nullable(Fraction)),
          state: v.optional(v.picklist(PLACEMENT_STATES)),
        }),
      ),
    }),
  ),
  op('placement.delete', Empty),
  op('placement.restore', Empty),
  op(
    'issue.create',
    v.strictObject({
      scopeId: IdSchema,
      title: v.string(),
      status: KeySchema,
      markupIds: v.optional(v.array(IdSchema)),
      originatingReviewId: v.optional(v.nullable(IdSchema)),
    }),
  ),
  op('issue.patch', v.strictObject({ title: v.optional(v.string()), checked: v.optional(v.boolean()) })),
  op('issue.link', v.strictObject({ markupId: IdSchema })),
  op('issue.unlink', v.strictObject({ markupId: IdSchema })),
  op('issue.delete', Empty),
  op('issue.restore', Empty),
  op(
    'response.create',
    v.strictObject({
      parent: v.strictObject({ kind: v.picklist(['markup', 'issue']), id: IdSchema }),
      inReplyTo: v.optional(v.nullable(IdSchema)),
      answersRev: v.optional(v.nullable(Count(1))),
      kind: v.picklist(RESPONSE_KINDS),
      body: v.string(),
    }),
  ),
  op('response.patch', v.strictObject({ body: v.string() })),
  op('response.delete', Empty),
  op('response.restore', Empty),
  op(
    'status.transition',
    v.strictObject({
      issueId: IdSchema,
      from: v.nullable(KeySchema),
      to: KeySchema,
      note: v.optional(v.nullable(v.string())),
      revisionSeenId: v.optional(v.nullable(IdSchema)),
    }),
  ),
  op(
    'release.create',
    v.strictObject({
      gateId: v.nullable(IdSchema),
      toLaneIds: v.pipe(v.array(IdSchema), v.minLength(1)),
      items: v.pipe(v.array(ItemRefSchema), v.minLength(1)),
    }),
  ),
]);

/** Whether `value` nests no deeper than `max` arrays and objects. Iterative, so deep input cannot overflow the stack. */
export function withinDepth(value: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length) {
    const [item, depth] = stack.pop()!;
    if (typeof item !== 'object' || item === null) continue;
    if (depth >= max) return false;
    for (const child of Object.values(item)) stack.push([child, depth + 1]);
  }
  return true;
}

// A NUL, or half of a surrogate pair. With the `u` flag a whole pair is one character, so only a
// lone half matches.
const UNSTORABLE = /[\0\uD800-\uDFFF]/u;

/**
 * Whether any string in `value`, keys included, holds a character a database cannot store as text
 * or JSON. An operation holding one could never be applied, however often it was sent. Iterative,
 * like `withinDepth`.
 */
export function hasUnstorableText(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length) {
    const item = stack.pop();
    if (typeof item === 'string') {
      if (UNSTORABLE.test(item)) return true;
    } else if (typeof item === 'object' && item !== null) {
      for (const [key, child] of Object.entries(item)) {
        if (UNSTORABLE.test(key)) return true;
        stack.push(child);
      }
    }
  }
  return false;
}

export type ParseResult = { ok: true; op: Operation } | { ok: false; rejection: Extract<Rejection, { code: 'invalid' }> };

/** Reads an operation a client sent (already parsed from JSON). Server-only operations are refused. */
export function parseOperation(input: unknown): ParseResult {
  if (!withinDepth(input, MAX_DEPTH)) return { ok: false, rejection: { code: 'invalid', message: 'The operation is nested too deeply' } };
  if (hasUnstorableText(input)) {
    return {
      ok: false,
      rejection: { code: 'invalid', message: 'Text holds a character that cannot be saved (a NUL or half of a surrogate pair)' },
    };
  }
  const result = v.safeParse(OperationSchema, input);
  if (result.success) return { ok: true, op: result.output as Operation };
  const issue = result.issues[0];
  const path = v.getDotPath(issue);
  return { ok: false, rejection: { code: 'invalid', message: path ? `${path}: ${issue.message}` : issue.message } };
}
