import type { Rect } from './model';

/** Text laid over a stamp's artwork. Positions are fractions of the stamp's box (y down). */
export interface StampArtText {
  /** May contain the same dynamic fields as a stamp's lines. */
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Font size as a fraction of the box height. */
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
}

/** A stamp that is a picture (a seal, a tag, a box) with live text on it, as Revu's stamps are. */
export interface StampArt {
  /** The artwork without its text: a PNG data URL on a transparent background. */
  image: string;
  /** Width over height of the stamp's box. */
  aspect: number;
  texts: StampArtText[];
}

/** A stamp in the library: its wording (with dynamic fields), colour and frame. */
export interface StampDef {
  id: string;
  name: string;
  /** Lines of text; the first is the headline. May contain {User}, {Date}, {Time}, {File}, {Page}, {Path}, {dd}, {mm}, {yyyy}. */
  lines: string[];
  color: string;
  frame: 'rounded' | 'box' | 'none';
  /** A picture with text over it, instead of text in a frame (`lines` then lists that text). */
  art?: StampArt;
  /**
   * Boxes to tick and blanks to fill in, listed under the wording. Ticking a box can fill in other
   * fields and recolour the stamp (see `StampOption`). Not for picture stamps.
   */
  fields?: StampField[];
  /** Built-in stamps cannot be deleted (they can be copied and changed). */
  builtIn?: boolean;
}

/** One box in a list of boxes: what ticking it says, and what else it changes. */
export interface StampOption {
  label: string;
  /** Ticking it turns the stamp this colour. */
  color?: string;
  /** Ticking it fills in other fields: field id to value (text, or the label of a box to tick). */
  sets?: Record<string, string>;
}

/**
 * A field on a stamp. `choice`: a list of boxes, one of which can be ticked. `text`: a blank shown
 * as "Label: value". Either can be used in the wording as `{Label}`, and is then not listed again.
 */
export interface StampField {
  id: string;
  label: string;
  kind: 'choice' | 'text';
  /** choice: its boxes. */
  options?: StampOption[];
  /** The value it starts with: text (which may hold {Date} and the like), or the ticked box's label. */
  value?: string;
}

/** How a stamp's line is drawn: plain (centred), a box (ticked or not), or a filled-in field. */
export type StampLineKind = 'line' | 'box' | 'ticked' | 'field';

/** What a stamp with fields keeps so its fields can be changed after it is placed. */
export interface StampForm {
  /** The stamp's own wording, colour and fields, before anything is filled in. */
  lines: string[];
  color: string;
  fields: StampField[];
  /** Each field's value, by field id. */
  values: Record<string, string>;
  /** What {User}, {Date} and the other dynamic fields were filled in with when it was placed. */
  placed: { user: string; file: string; page: string; path?: string; now: number };
}

/** What a placed stamp shows: its resolved lines and frame. */
export interface StampContent {
  lines: string[];
  frame: StampDef['frame'];
  art?: StampArt;
  /** How each line is drawn, when not all plain; parallel to `lines`. */
  kinds?: StampLineKind[];
  /** A stamp with fields: what is needed to fill them in again. */
  form?: StampForm;
}

export const STAMP_FIELDS: { token: string; label: string }[] = [
  { token: '{User}', label: 'Your name' },
  { token: '{Date}', label: 'Date' },
  { token: '{Time}', label: 'Time' },
  { token: '{File}', label: 'File name' },
  { token: '{Page}', label: 'Page or sheet number' },
  { token: '{Path}', label: 'File location' },
  { token: '{dd}', label: 'Day of the month (01–31)' },
  { token: '{mm}', label: 'Month number (01–12)' },
  { token: '{yyyy}', label: 'Year (2026)' },
];

const stamp = (id: string, name: string, color: string, second = 'By {User} on {Date}'): StampDef => ({ id: `builtin-${id}`, name, lines: [name.toUpperCase(), ...(second ? [second] : [])], color, frame: 'rounded', builtIn: true });

/** The submittal review stamp: tick one action, and the resubmittal line and colour follow. */
const SUBMITTAL_REVIEW: StampDef = {
  id: 'builtin-submittal-review',
  name: 'Submittal Review',
  lines: ['SUBMITTAL REVIEW'],
  color: '#1d4ed8',
  frame: 'box',
  builtIn: true,
  fields: [
    {
      id: 'action',
      label: 'Action',
      kind: 'choice',
      options: [
        { label: 'No Exceptions Taken', color: '#15803d', sets: { resubmit: 'Not required' } },
        { label: 'Make Corrections Noted', color: '#15803d', sets: { resubmit: 'Not required' } },
        { label: 'Revise and Resubmit', color: '#b45309', sets: { resubmit: 'Required' } },
        { label: 'Rejected', color: '#b91c1c', sets: { resubmit: 'Required' } },
      ],
    },
    { id: 'resubmit', label: 'Resubmittal', kind: 'text', value: '' },
    { id: 'by', label: 'Reviewed by', kind: 'text', value: '{User}' },
    { id: 'on', label: 'Reviewed on', kind: 'text', value: '{Date}' },
  ],
};

export const DEFAULT_STAMPS: readonly StampDef[] = [
  stamp('approved', 'Approved', '#15803d'),
  stamp('approved-noted', 'Approved as Noted', '#15803d'),
  stamp('reviewed', 'Reviewed', '#1d4ed8'),
  stamp('revise', 'Revise and Resubmit', '#b45309'),
  stamp('rejected', 'Rejected', '#b91c1c'),
  stamp('for-construction', 'For Construction', '#15803d', 'Issued {Date}'),
  stamp('not-for-construction', 'Not for Construction', '#b91c1c', ''),
  stamp('preliminary', 'Preliminary', '#b45309', ''),
  stamp('draft', 'Draft', '#6b7280', ''),
  stamp('void', 'Void', '#b91c1c', ''),
  stamp('superseded', 'Superseded', '#b91c1c'),
  stamp('confidential', 'Confidential', '#b91c1c', ''),
  SUBMITTAL_REVIEW,
];

/** Values for a stamp's dynamic fields when it is placed. */
export interface StampValues {
  user: string;
  file: string;
  page: string;
  /** Where the file is, when known. */
  path?: string;
  now: Date;
}

/** Fills in {User}, {Date} and the other dynamic fields. */
function fillFields(s: string, v: StampValues): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return s
    .replace(/\{User\}/gi, v.user)
    .replace(/\{Date\}/gi, v.now.toLocaleDateString())
    .replace(/\{Time\}/gi, v.now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{File\}/gi, v.file)
    .replace(/\{Page\}/gi, v.page)
    .replace(/\{Path\}/gi, v.path ?? '')
    .replace(/\{dd\}/gi, two(v.now.getDate()))
    .replace(/\{mm\}/gi, two(v.now.getMonth() + 1))
    .replace(/\{yyyy\}/gi, String(v.now.getFullYear()));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fieldToken = (f: StampField) => new RegExp(`\\{${escapeRe(f.label.trim())}\\}`, 'gi');

/**
 * Text fields' values with {User} and the date fields filled in now, for showing them before the
 * stamp is placed; {File}, {Page} and {Path} stay to be filled in where it is placed.
 */
export function fillStampFieldsNow(fields: readonly StampField[], values: Readonly<Record<string, string>>, user: string, now = new Date()): Record<string, string> {
  const out = { ...values };
  for (const f of fields) if (f.kind === 'text' && out[f.id]) out[f.id] = fillFields(out[f.id]!, { user, now, file: '{File}', page: '{Page}', path: '{Path}' });
  return out;
}

/** Each field's starting value, by field id. */
export function stampFieldValues(fields: readonly StampField[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.id, f.value ?? '']));
}

/**
 * Ticks a box (or fills in a field) and everything ticking it sets: other fields' values. Ticking a
 * box that is already ticked unticks it. Returns the new values.
 */
export function setStampField(fields: readonly StampField[], values: Readonly<Record<string, string>>, id: string, value: string): Record<string, string> {
  const field = fields.find((f) => f.id === id);
  if (!field) return { ...values };
  if (field.kind === 'text') return { ...values, [id]: value };
  const next = { ...values, [id]: values[id] === value ? '' : value };
  const option = field.options?.find((o) => o.label === next[id]);
  for (const [other, v] of Object.entries(option?.sets ?? {})) if (other !== id && fields.some((f) => f.id === other)) next[other] = v;
  return next;
}

/** The colour of a stamp with fields: that of the last ticked box with a colour of its own. */
export function stampFormColor(fields: readonly StampField[], values: Readonly<Record<string, string>>, color: string): string {
  let out = color;
  for (const f of fields) if (f.kind === 'choice') out = f.options?.find((o) => o.label === values[f.id])?.color ?? out;
  return out;
}

/** The colour a library stamp is placed in: its own, or that of a box it starts with ticked. */
export function stampColor(def: Pick<StampDef, 'color' | 'fields'>): string {
  return def.fields?.length ? stampFormColor(def.fields, stampFieldValues(def.fields), def.color) : def.color;
}

/** A stamp's fields starting at the values given (so it is placed already filled in). */
export function withFieldValues<T extends Pick<StampDef, 'fields'>>(def: T, values: Readonly<Record<string, string>>): T {
  return def.fields ? { ...def, fields: def.fields.map((f) => ({ ...f, value: values[f.id] ?? f.value ?? '' })) } : def;
}

/** A stamp's lines with its dynamic fields filled in; empty lines are dropped. */
export function resolveStamp(def: Pick<StampDef, 'lines' | 'frame' | 'art' | 'fields'> & { color?: string }, v: StampValues, values?: Readonly<Record<string, string>>): StampContent {
  const fill = (s: string) => fillFields(s, v);
  if (def.art) {
    const texts = def.art.texts.map((t) => ({ ...t, text: fill(t.text) })).filter((t) => t.text.trim());
    return { lines: texts.map((t) => t.text), frame: 'none', art: { ...def.art, texts } };
  }
  const fields = def.fields?.filter((f) => f.label.trim()) ?? [];
  if (!fields.length) return { lines: def.lines.map(fill).filter((l) => l.trim()), frame: def.frame };

  const vals = { ...stampFieldValues(fields), ...values };
  const shown = (f: StampField) => (f.kind === 'text' ? fill(vals[f.id] ?? '') : (vals[f.id] ?? ''));
  // The wording, with {Label} for each field it uses; those fields are not listed again.
  const used = new Set<string>();
  const lines: string[] = [];
  const kinds: StampLineKind[] = [];
  for (const raw of def.lines) {
    let line = fill(raw);
    for (const f of fields) {
      const re = fieldToken(f);
      if (!re.test(line)) continue;
      used.add(f.id);
      line = line.replace(re, () => shown(f));
    }
    if (!line.trim()) continue;
    lines.push(line);
    kinds.push('line');
  }
  for (const f of fields) {
    if (used.has(f.id)) continue;
    if (f.kind === 'choice') {
      for (const o of f.options ?? []) {
        if (!o.label.trim()) continue;
        lines.push(o.label);
        kinds.push(vals[f.id] === o.label ? 'ticked' : 'box');
      }
    } else {
      lines.push(`${f.label.trim()}: ${shown(f)}`.trimEnd());
      kinds.push('field');
    }
  }
  const placed = { user: v.user, file: v.file, page: v.page, ...(v.path ? { path: v.path } : {}), now: v.now.getTime() };
  return { lines, frame: def.frame, kinds, form: { lines: [...def.lines], color: def.color ?? '#000000', fields: structuredClone(fields), values: vals, placed } };
}

/**
 * A placed stamp with its fields changed: its new content and colour. {User}, {Date} and the like
 * keep what they were filled in with when it was placed.
 */
export function refillStamp(content: StampContent, values: Readonly<Record<string, string>>): { stamp: StampContent; color: string } | null {
  const form = content.form;
  if (!form) return null;
  const { now, ...rest } = form.placed;
  const stamp = resolveStamp({ lines: form.lines, frame: content.frame, fields: form.fields, color: form.color }, { ...rest, now: new Date(now) }, values);
  return { stamp, color: stampFormColor(form.fields, values, form.color) };
}

/** Headline size relative to the other lines. */
const HEAD = 1.7;
/** Width of an average character as a fraction of the font size (bold sans). */
const CHAR = 0.62;

/** Width of a box and the gap after it, in font sizes. */
const BOX = 0.8;
const BOX_GAP = 0.5;

/**
 * A stamp's lines in font-size units: the headline larger and centred, other plain lines centred,
 * boxes and fields left-aligned as one block. `widest` and `units` are the width and height it needs.
 */
function stampRows(content: StampContent, measure: (s: string, bold: boolean) => number) {
  const kinds = content.kinds ?? content.lines.map((): StampLineKind => 'line');
  const rows = content.lines.map((text, i) => {
    const kind = kinds[i] ?? 'line';
    const head = i === 0 && kind === 'line';
    const scale = head ? HEAD : 1;
    const indent = kind === 'box' || kind === 'ticked' ? BOX + BOX_GAP : 0;
    return { text, kind, head, scale, h: head ? HEAD * 1.15 : 1.2, w: measure(text, head) * scale + indent };
  });
  const left = Math.max(0, ...rows.filter((r) => r.kind !== 'line').map((r) => r.w));
  const widest = Math.max(left, ...rows.filter((r) => r.kind === 'line').map((r) => r.w), 1e-6);
  const units = rows.reduce((n, r) => n + r.h, 0);
  return { rows, left, widest, units };
}

/** Width / height a stamp's text wants, for placing it at a natural shape. */
export function stampAspect(content: StampContent): number {
  if (content.art) return content.art.aspect;
  const { widest, units } = stampRows(content, (s) => s.length * CHAR);
  return (Math.max(widest, 4) + 1.2) / ((units || HEAD * 1.15) + 0.8);
}

/** One line of a stamp as laid out in its box. `x` is its centre, or its left end when `align` is left. */
export interface StampLine {
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  align: 'center' | 'left';
  /** A box drawn left of the text: its top left corner and side, and whether it is ticked. */
  box?: { x: number; y: number; size: number; ticked: boolean };
}

/**
 * Where a stamp's lines go in its box: centred, the headline larger, all scaled to fit. Boxes and
 * fields are left-aligned together, centred as a block. `measure` gives a string's width at font
 * size 1 (bold for the headline).
 */
export function stampLayout(box: Rect, content: StampContent, measure: (s: string, bold: boolean) => number): StampLine[] {
  const { rows, left, widest, units } = stampRows(content, measure);
  const pad = Math.min(box.w, box.h) * 0.1;
  const innerW = Math.max(1, box.w - pad * 2);
  const innerH = Math.max(1, box.h - pad * 2);
  // Font size at which everything fits the box's height, then its width.
  const size = Math.min(innerH / Math.max(units, 1e-6), innerW / widest);
  const blockX = box.x + (box.w - left * size) / 2;
  let y = box.y + (box.h - units * size) / 2;
  return rows.map((r) => {
    const mid = y + (r.h * size) / 2;
    y += r.h * size;
    if (r.kind === 'line') return { text: r.text, x: box.x + box.w / 2, y: mid, size: size * r.scale, bold: r.head, align: 'center' as const };
    if (r.kind === 'field') return { text: r.text, x: blockX, y: mid, size, bold: false, align: 'left' as const };
    const side = BOX * size;
    return { text: r.text, x: blockX + (BOX + BOX_GAP) * size, y: mid, size, bold: false, align: 'left' as const, box: { x: blockX, y: mid - side / 2, size: side, ticked: r.kind === 'ticked' } };
  });
}

/** The tick in a ticked box: a check mark's three points. */
export function stampTick(box: { x: number; y: number; size: number }): [number, number][] {
  const { x, y, size: s } = box;
  return [
    [x + s * 0.18, y + s * 0.52],
    [x + s * 0.42, y + s * 0.76],
    [x + s * 0.84, y + s * 0.22],
  ];
}
