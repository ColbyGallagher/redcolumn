import { NO_SHEET_HINTS, TITLE_FIELDS, type SheetHints, type TitleBox, type TitleField } from '@nb/sheets';

/**
 * A drawing standard: one client's way of drawing (title block, drawing numbers), described once
 * and chosen for every set from that client. Kept in the profile and shared as `.rcstandard` files.
 * Builds on Miche-pup's title-block and link work (#166, #167).
 */
export interface DrawingStandard {
  id: string;
  name: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  sheets: SheetHints;
}

export function newStandard(name: string): DrawingStandard {
  const now = Date.now();
  return { id: crypto.randomUUID(), name, notes: '', createdAt: now, updatedAt: now, sheets: { ...NO_SHEET_HINTS, boxes: [], disciplines: {} } };
}

/**
 * Identifies what a standard does to detection (not its name or notes): a document records it,
 * so it is read again once the standard changes.
 */
export function standardHash(s: DrawingStandard): string {
  const text = JSON.stringify(s.sheets);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** What a document records about the standard it was read with. */
export interface DocumentStandard {
  id: string;
  hash: string;
}

const FORMAT = 'redcolumn.drawing-standard';
const VERSION = 1;

export function exportStandard(s: DrawingStandard): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, standard: s }, null, 2);
}

/** A file name for a standard: its name without characters file systems refuse. */
export function standardFileName(s: DrawingStandard): string {
  return `${s.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Drawing standard'}.rcstandard`;
}

const MAX_FILE = 512 * 1024;
const MAX_BOXES = 50;
const MAX_DISCIPLINES = 500;

function fail(message: string): never {
  throw new Error(`This is not a drawing standard redcolumn can read: ${message}.`);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string') fail(`${what} is missing`);
  if (v.length > max) fail(`${what} is too long`);
  return v;
};
const fraction = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) fail('a title-block box is off the page');
  return v;
};

/**
 * Reads a `.rcstandard` file. Shared files come from other people, so every field is checked
 * and only known fields are kept; anything unexpected fails with a message for the user.
 */
export function parseStandardFile(content: string): DrawingStandard {
  if (content.length > MAX_FILE) fail('the file is too large');
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    fail('the file is not JSON');
  }
  if (!isObject(data) || data.format !== FORMAT) fail('the file is another kind of file');
  if (typeof data.version !== 'number' || data.version > VERSION) fail('the file was made by a newer version of redcolumn');
  const s = data.standard;
  if (!isObject(s)) fail('the standard is missing');
  const sheets = s.sheets;
  if (!isObject(sheets)) fail('the title block is missing');
  if (!Array.isArray(sheets.boxes) || sheets.boxes.length > MAX_BOXES) fail('the title-block boxes are missing');
  const boxes: TitleBox[] = sheets.boxes.map((b: unknown) => {
    if (!isObject(b) || typeof b.field !== 'string' || !Object.hasOwn(TITLE_FIELDS, b.field)) fail('a title-block box has no field');
    const box = { field: b.field as TitleField, x: fraction(b.x), y: fraction(b.y), w: fraction(b.w), h: fraction(b.h) };
    if (box.x + box.w > 1.0001 || box.y + box.h > 1.0001) fail('a title-block box is off the page');
    return box;
  });
  const template = sheets.template === null ? null : text(sheets.template, 200, 'the drawing-number template');
  const part = sheets.disciplinePart;
  if (part !== null && (typeof part !== 'number' || !Number.isInteger(part) || part < 0 || part > 30)) fail('the discipline part is not a part of the number');
  if (!isObject(sheets.disciplines) || Object.keys(sheets.disciplines).length > MAX_DISCIPLINES) fail('the discipline names are missing');
  // Built as own properties: a code named `__proto__` stays a code.
  const disciplines: Record<string, string> = Object.fromEntries(
    Object.entries(sheets.disciplines).map(([code, name]) => {
      if (code.length > 40) fail('a discipline code is too long');
      return [code, text(name, 100, 'a discipline name')];
    }),
  );
  const created = typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) ? s.createdAt : Date.now();
  const updated = typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : created;
  const id = text(s.id, 100, 'its id');
  if (!/^[\w-]+$/.test(id)) fail('its id is not one redcolumn makes');
  return {
    id,
    name: text(s.name, 200, 'its name').trim() || 'Drawing standard',
    notes: s.notes === undefined ? '' : text(s.notes, 5000, 'its notes'),
    createdAt: created,
    updatedAt: updated,
    sheets: { boxes, template: template?.trim() || null, disciplinePart: part as number | null, disciplines },
  };
}
