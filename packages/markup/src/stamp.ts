import type { Rect } from './model';

/** A stamp in the library: its wording (with dynamic fields), colour and frame. */
export interface StampDef {
  id: string;
  name: string;
  /** Lines of text; the first is the headline. May contain {User}, {Date}, {Time}, {File}, {Page}. */
  lines: string[];
  color: string;
  frame: 'rounded' | 'box' | 'none';
  /** Built-in stamps cannot be deleted (they can be copied and changed). */
  builtIn?: boolean;
}

/** What a placed stamp shows: its resolved lines and frame. */
export interface StampContent {
  lines: string[];
  frame: StampDef['frame'];
}

export const STAMP_FIELDS: { token: string; label: string }[] = [
  { token: '{User}', label: 'Your name' },
  { token: '{Date}', label: 'Date' },
  { token: '{Time}', label: 'Time' },
  { token: '{File}', label: 'File name' },
  { token: '{Page}', label: 'Page or sheet number' },
];

const stamp = (id: string, name: string, color: string, second = 'By {User} on {Date}'): StampDef => ({ id: `builtin-${id}`, name, lines: [name.toUpperCase(), ...(second ? [second] : [])], color, frame: 'rounded', builtIn: true });

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
  stamp('confidential', 'Confidential', '#b91c1c', ''),
];

/** Values for a stamp's dynamic fields when it is placed. */
export interface StampValues {
  user: string;
  file: string;
  page: string;
  now: Date;
}

/** A stamp's lines with its dynamic fields filled in; empty lines are dropped. */
export function resolveStamp(def: Pick<StampDef, 'lines' | 'frame'>, v: StampValues): StampContent {
  const fill = (s: string) =>
    s
      .replace(/\{User\}/gi, v.user)
      .replace(/\{Date\}/gi, v.now.toLocaleDateString())
      .replace(/\{Time\}/gi, v.now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      .replace(/\{File\}/gi, v.file)
      .replace(/\{Page\}/gi, v.page);
  return { lines: def.lines.map(fill).filter((l) => l.trim()), frame: def.frame };
}

/** Headline size relative to the other lines. */
const HEAD = 1.7;
/** Width of an average character as a fraction of the font size (bold sans). */
const CHAR = 0.62;

/** Width / height a stamp's text wants, for placing it at a natural shape. */
export function stampAspect(content: StampContent): number {
  const [head = '', ...rest] = content.lines;
  const w = Math.max(head.length * CHAR * HEAD, ...rest.map((l) => l.length * CHAR), 4) + 1.2;
  const h = HEAD * 1.15 + rest.length * 1.2 + 0.8;
  return w / h;
}

/**
 * Where a stamp's lines go in its box: centred, the headline larger, all scaled to fit. `measure`
 * gives a string's width at font size 1 (bold for the headline).
 */
export function stampLayout(box: Rect, content: StampContent, measure: (s: string, bold: boolean) => number): { text: string; x: number; y: number; size: number; bold: boolean }[] {
  const [head = '', ...rest] = content.lines;
  const pad = Math.min(box.w, box.h) * 0.1;
  const innerW = Math.max(1, box.w - pad * 2);
  const innerH = Math.max(1, box.h - pad * 2);
  // Font size at which everything fits the box's height, then its width.
  const units = HEAD * 1.15 + rest.length * 1.2;
  const widest = Math.max(measure(head, true) * HEAD, ...rest.map((l) => measure(l, false)), 1e-6);
  const size = Math.min(innerH / units, innerW / widest);
  const top = box.y + (box.h - units * size) / 2;
  const out = [{ text: head, x: box.x + box.w / 2, y: top + (HEAD * 1.15 * size) / 2, size: size * HEAD, bold: true }];
  rest.forEach((text, i) => out.push({ text, x: box.x + box.w / 2, y: top + HEAD * 1.15 * size + (i + 0.5) * 1.2 * size, size, bold: false }));
  return out;
}
