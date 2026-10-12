import type { Markup, MarkupType } from './model';
import { TYPE_INFO } from './types';

/** The subject Bluebeam gives a markup of this kind, for those whose name differs from ours. */
const BLUEBEAM_SUBJECTS: Partial<Record<MarkupType, string>> = {
  polyline: 'PolyLine',
  text: 'Text Box',
  callout: 'Call-out',
  typewriter: 'Typewritten Text',
  flagLabel: 'Flag',
  flag: 'Flag',
  highlighter: 'Highlight',
  textHighlight: 'Highlight',
  strikeout: 'Strikeout',
  attachment: 'File Attachment',
  length: 'Length Measurement',
  polylength: 'Polylength Measurement',
  area: 'Area Measurement',
  perimeter: 'Perimeter Measurement',
  volume: 'Volume Measurement',
  count: 'Count Measurement',
  diameter: 'Diameter Measurement',
  radius: 'Radius Measurement',
  angle: 'Angle Measurement',
  arc: 'Arc',
  polygonCloud: 'Cloud',
};

/** The subject exported for a markup that has none of its own. */
export function defaultSubject(m: Markup): string {
  if (m.type === 'stamp') return m.stamp?.lines[0] || 'Stamp';
  return BLUEBEAM_SUBJECTS[m.type] ?? TYPE_INFO[m.type].label;
}

/**
 * Bluebeam's annotation type numbers, as its legends' keys name them (read from a legend listing
 * one of each tool). A legend lists the markups whose type and subject match one of its keys.
 */
export const BLUEBEAM_TYPES: Partial<Record<MarkupType, number>> = {
  note: 0,
  flag: 0,
  text: 2,
  typewriter: 3,
  callout: 4,
  flagLabel: 5,
  line: 6,
  dimension: 7,
  arrow: 8,
  rect: 9,
  ellipse: 10,
  polygon: 11,
  polyline: 12,
  cloud: 17,
  polygonCloud: 17,
  highlighter: 18,
  stamp: 22,
  pen: 24,
  image: 35,
  area: 36,
  diameter: 37,
  count: 38,
  perimeter: 39,
  angle: 40,
  radius: 41,
  arc: 43,
  ellipticalArc: 43,
  length: 45,
  volume: 46,
  polylength: 55,
};

/** A Cloud+ (callout with its cloud): one legend key, a callout whose sub-key is the cloud. */
export const CLOUD_PLUS_TYPE = 52;
export const CLOUD_TYPE = 17;
/** The sub-key of a Cloud+ key: the cloud it draws. */
export const CLOUD_PLUS_CLOUD_TYPE = 53;
export const SNAPSHOT_TYPE = 47;
export const STAMP_TYPE = 22;
const SKETCH_TYPES: Record<string, number> = { Polygon: 13, Rectangle: 14, Ellipse: 15, Polyline: 16 };

/** The groups that are a Cloud+: exactly a cloud and a callout. */
export function cloudPlusGroups(all: readonly Markup[]): Set<string> {
  const groups = new Map<string, Markup[]>();
  for (const m of all) if (m.groupId) groups.set(m.groupId, [...(groups.get(m.groupId) ?? []), m]);
  const plus = new Set<string>();
  for (const [id, members] of groups) if (members.length === 2 && members.some((m) => m.type === 'cloud') && members.some((m) => m.type === 'callout')) plus.add(id);
  return plus;
}

/** What Bluebeam's legend calls a markup: its type number and subject. Null for kinds it has no key for. */
export function legendKeyOf(m: Markup, plus: ReadonlySet<string>): { type: number; subject: string } | null {
  if (m.groupId && plus.has(m.groupId)) return { type: CLOUD_PLUS_TYPE, subject: 'Cloud+' };
  const subject = m.subject || defaultSubject(m);
  // Bluebeam's perimeter and sketch-to-scale tools come in as the measurements they are drawn as,
  // but its legend keys them by tool, which the subject names.
  if (subject === 'Perimeter Measurement') return { type: 39, subject };
  const sketch = /^(Polygon|Rectangle|Ellipse|Polyline) Sketch to Scale$/.exec(subject)?.[1];
  if (sketch) return { type: SKETCH_TYPES[sketch]!, subject };
  // A picture that came from another tool's stamp keeps being a stamp (or a snapshot) there.
  const type = m.type === 'image' && m.pdfAnnot?.image ? (subject === 'Snapshot' ? SNAPSHOT_TYPE : STAMP_TYPE) : m.type === 'image' && subject === 'Snapshot' ? SNAPSHOT_TYPE : BLUEBEAM_TYPES[m.type];
  return type === undefined ? null : { type, subject };
}
