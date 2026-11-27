import type { Markup, MarkupType } from '@nb/markup';

/**
 * Where each `Markup` field lives in a synced document, and which version it is checked against.
 *
 * Fields that must change together share a version (a field group). Two edits to different groups
 * of one markup both apply; two edits to the same group conflict unless the second was based on
 * the first.
 *
 * - `fixed`: set when the record is made (`id`, `type`) or by the server (`seq`, the author and
 *   the times). Never patched.
 * - `placement`: where the markup sits. A placement names a page by id; `pageIndex` is the local
 *   view's index of that page within one revision.
 * - `geometry`: the shape on its page. Kept on the placement, one version for all of it.
 * - `text`, `style`, `picture`, `assembly`: content on the markup, one version per group.
 * - `fields`: custom columns, one version per column (group key `fields.<column id>`).
 * - `prop`: content on the markup, one version per field (group key: the field's name).
 * - `response`, `status`, `issue`: not markup content. Replies become Response records, status and
 *   its history become status events, and the tick and the revision a comment was raised on belong
 *   to the issue.
 * - `local`: kept only in local files; not sent.
 */
export type FieldGroup =
  | 'fixed'
  | 'placement'
  | 'geometry'
  | 'text'
  | 'style'
  | 'picture'
  | 'assembly'
  | 'fields'
  | 'prop'
  | 'response'
  | 'status'
  | 'issue'
  | 'local';

/**
 * Every `Markup` field's group. Adding a field to `Markup` does not compile until it is listed
 * here, and a field removed from `Markup` must be removed here too.
 */
export const MARKUP_FIELD_GROUPS = {
  id: 'fixed',
  seq: 'fixed',
  type: 'fixed',
  author: 'fixed',
  createdAt: 'fixed',
  modifiedAt: 'fixed',

  pageIndex: 'placement',

  points: 'geometry',
  arcAngles: 'geometry',
  holes: 'geometry',
  holeBulges: 'geometry',
  bulges: 'geometry',
  rotation: 'geometry',
  depth: 'geometry',
  connect: 'geometry',

  text: 'text',
  spans: 'text',
  stamp: 'text',

  style: 'style',

  image: 'picture',
  crop: 'picture',
  vector: 'picture',

  assemblyId: 'assembly',
  assemblyOverrides: 'assembly',
  assemblyInputs: 'assembly',

  fields: 'fields',

  comment: 'prop',
  subject: 'prop',
  label: 'prop',
  layer: 'prop',
  groupId: 'prop',
  locked: 'prop',
  hidden: 'prop',
  flagged: 'prop',
  legendHidden: 'prop',
  link: 'prop',
  legend: 'prop',
  table: 'prop',
  flowShape: 'prop',
  slope: 'prop',
  manual: 'prop',
  takeoffApproval: 'prop',
  ai: 'prop',
  capture: 'prop',
  attachment: 'prop',

  replies: 'response',
  status: 'status',
  statusHistory: 'status',
  checked: 'issue',
  raisedRev: 'issue',

  pdfAnnot: 'local',
  portalLink: 'local',
  signature: 'local',
} as const satisfies Record<keyof Markup, FieldGroup>;

/** The `Markup` fields in one or more groups. */
export type MarkupKeysIn<G extends FieldGroup> = {
  [K in keyof Markup]-?: (typeof MARKUP_FIELD_GROUPS)[K] extends G ? K : never;
}[keyof Markup];

/** Groups whose fields are content on the markup record. */
export type ContentGroup = 'text' | 'style' | 'picture' | 'assembly' | 'fields' | 'prop';

/** Fields kept on the markup record. */
export type ContentKey = MarkupKeysIn<ContentGroup>;
/** Fields kept on a placement. */
export type GeometryKey = MarkupKeysIn<'geometry'>;

/** A markup's content as synced: `style` always, the rest when set. */
export type MarkupContent = Pick<Markup, ContentKey>;
/** A placement's shape: `points` always, the rest when set. */
export type MarkupGeometry = Pick<Markup, GeometryKey>;

const keysIn = <G extends FieldGroup>(groups: readonly G[]): MarkupKeysIn<G>[] =>
  (Object.keys(MARKUP_FIELD_GROUPS) as (keyof Markup)[]).filter((k) => (groups as readonly FieldGroup[]).includes(MARKUP_FIELD_GROUPS[k])) as MarkupKeysIn<G>[];

export const CONTENT_GROUPS: readonly ContentGroup[] = ['text', 'style', 'picture', 'assembly', 'fields', 'prop'];
export const CONTENT_KEYS: readonly ContentKey[] = keysIn(CONTENT_GROUPS);
export const GEOMETRY_KEYS: readonly GeometryKey[] = keysIn(['geometry']);

/** The version a content field is checked against. Custom columns use {@link columnGroupKey}. */
export function contentGroupKey(key: Exclude<ContentKey, 'fields'>): string {
  const group = MARKUP_FIELD_GROUPS[key];
  return group === 'prop' ? key : group;
}

/** The version one custom column's value is checked against. */
export const columnGroupKey = (columnId: string): string => `fields.${columnId}`;

/** A placement's groups: its shape, and how it was placed (method, confidence, state). */
export const PLACEMENT_GROUPS = ['geometry', 'state'] as const;

/**
 * Every markup type. A copy of `@nb/markup`'s list, so validating an operation does not load that
 * package at run time; `fieldGroups.check.ts` keeps the two the same.
 */
export const MARKUP_TYPE_IDS = [
  'line', 'arrow', 'polyline', 'arc', 'rect', 'ellipse', 'polygon', 'cloud', 'polygonCloud', 'ellipticalArc',
  'pen', 'highlighter', 'textHighlight', 'underline', 'strikeout', 'squiggly', 'text', 'callout', 'typewriter',
  'note', 'image', 'signature', 'stamp', 'legend', 'table', 'hyperlink', 'space', 'redaction', 'dimension',
  'attachment', 'flag', 'flagLabel', 'replaceText', 'flowShape', 'connector',
  'length', 'polylength', 'area', 'perimeter', 'count', 'angle', 'diameter', 'radius', 'arcLength', 'volume', 'manual',
] as const satisfies readonly MarkupType[];

