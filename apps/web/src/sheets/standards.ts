import { DEFAULT_CHAINAGE_HINTS, DEFAULT_LINK_HINTS, NO_SHEET_HINTS, TITLE_FIELDS, type Band, type ChainageHints, type LinkHints, type SheetHints, type TitleBox, type TitleField } from '@nb/sheets';
import { MARK_KINDS, type MarkKind, type MarkWord, type TaughtMark } from './marks';

/**
 * A drawing standard: one client's way of drawing (title block, drawing numbers, the marks and
 * words its cross-references use), described once and chosen for every set from that client.
 * Kept in the profile and shared as `.rcstandard` files. Builds on Miche-pup's title-block and
 * link work (#166, #167).
 */
export interface DrawingStandard {
  id: string;
  name: string;
  notes: string;
  /** Words printed on this client's sheets (its name, a project code), for suggesting the standard when a set opens. */
  identify: string[];
  createdAt: number;
  updatedAt: number;
  sheets: SheetHints;
  links: LinkHints;
  /** Linear work: chainage prefixes, alignment names, and which sheets are plans and which cross sections. */
  chainage: ChainageHints;
  /** Section marks, titles and detail callouts taught for this client only (marks taught for every set stay in the profile). */
  marks: TaughtMark[];
  /**
   * The boxes drawn in the setup's link steps (text and place only, no pictures): what an AI
   * assistant is given as examples, on this set and the next. Exported with the standard.
   */
  examples?: SetupExample[];
  /** How each link step last did (the meter), for the review and for an AI assistant. Kept in the profile only. */
  results?: Partial<Record<SetupStep, StepResult>>;
  /** Changes an AI assistant proposed to the standard's words, waiting for a person. Kept in the profile only. */
  proposals?: HintProposal[];
}

/** The setup's link steps. */
export type SetupStep = 'sections' | 'elevations' | 'details' | 'matchLines' | 'chainage';
export const SETUP_STEPS: readonly SetupStep[] = ['sections', 'elevations', 'details', 'matchLines', 'chainage'];

/** One box drawn in a link step. */
export interface SetupExample {
  step: SetupStep;
  /** What was boxed: mark, title, label, matchingLabel, planChainage, planAlignment, sectionAlignment, sectionChainage. */
  role: string;
  /** 0-based page in the set it was drawn on. */
  page: number;
  /** That sheet's number, so the example still means something on another set. */
  sheet: string | null;
  /** The box, as fractions of the page. */
  rect: { x: number; y: number; w: number; h: number };
  /** The text read in it. */
  text: string;
}

/** What a step's meter last said. */
export interface StepResult {
  band: Band;
  score: number;
  references: number;
  linked: number;
  checked: number;
  wrong: number;
  unreadable: number;
  ambiguous: number;
  at: number;
}

/** Words an AI assistant proposes the standard learns; each list is added to, never replaced. */
export interface HintChanges {
  sectionWords?: string[];
  elevationWords?: string[];
  matchLineWords?: string[];
  chainagePrefixes?: string[];
  alignments?: string[];
  alignmentTemplate?: string;
  planTitles?: string[];
  sectionTitles?: string[];
}

export interface HintProposal {
  id: string;
  at: number;
  changes: HintChanges;
  reasoning: string;
}

/** Most examples kept per step: the latest ones. */
const EXAMPLES_PER_STEP = 8;

/** The standard with a step's new examples added (the oldest of that step dropped past the limit). */
export function withExamples(s: DrawingStandard, step: SetupStep, added: readonly SetupExample[]): DrawingStandard {
  const all = s.examples ?? [];
  const mine = [...all.filter((e) => e.step === step), ...added].slice(-EXAMPLES_PER_STEP);
  return { ...s, examples: [...all.filter((e) => e.step !== step), ...mine] };
}

/** An example from a box drawn on a page of `size`. */
export function exampleOf(step: SetupStep, role: string, page: number, rect: { x: number; y: number; w: number; h: number }, size: { width: number; height: number }, sheet: string | null, text: string): SetupExample {
  const f = (v: number, d: number) => Math.round(Math.min(1, Math.max(0, v / d)) * 10000) / 10000;
  return { step, role, page, sheet, rect: { x: f(rect.x, size.width), y: f(rect.y, size.height), w: f(rect.w, size.width), h: f(rect.h, size.height) }, text: text.slice(0, 200) };
}

const addWords = (list: readonly string[], more: readonly string[] | undefined) => {
  const out = [...list];
  for (const w of more ?? []) if (w.trim() && !out.some((x) => x.toUpperCase() === w.trim().toUpperCase())) out.push(w.trim());
  return out;
};

/** What a proposal would change, one line each, for the person deciding. */
export function describeChanges(c: HintChanges): string[] {
  const out: string[] = [];
  const list = (label: string, v?: string[]) => {
    if (v?.length) out.push(`${label}: ${v.join(', ')}`);
  };
  list('Section title words', c.sectionWords);
  list('Elevation title words', c.elevationWords);
  list('Match-line words', c.matchLineWords);
  list('Chainage prefixes', c.chainagePrefixes);
  list('Alignment names', c.alignments);
  if (c.alignmentTemplate) out.push(`Alignment names look like ${c.alignmentTemplate}`);
  list('Plan sheet titles', c.planTitles);
  list('Cross-section sheet titles', c.sectionTitles);
  return out;
}

/** The standard with a proposal's words added, and the proposal gone. */
export function acceptProposal(s: DrawingStandard, id: string): DrawingStandard {
  const p = s.proposals?.find((x) => x.id === id);
  if (!p) return s;
  const c = p.changes;
  return {
    ...s,
    links: {
      ...s.links,
      titles: { ...s.links.titles, section: addWords(s.links.titles.section, c.sectionWords), elevation: addWords(s.links.titles.elevation, c.elevationWords) },
      matchLine: addWords(s.links.matchLine, c.matchLineWords),
    },
    chainage: {
      ...s.chainage,
      prefixes: addWords(s.chainage.prefixes, c.chainagePrefixes),
      alignments: addWords(s.chainage.alignments, c.alignments),
      alignmentTemplate: c.alignmentTemplate ?? s.chainage.alignmentTemplate,
      planTitles: addWords(s.chainage.planTitles, c.planTitles),
      sectionTitles: addWords(s.chainage.sectionTitles, c.sectionTitles),
    },
    proposals: (s.proposals ?? []).filter((x) => x.id !== id),
  };
}

export function dismissProposal(s: DrawingStandard, id: string): DrawingStandard {
  return { ...s, proposals: (s.proposals ?? []).filter((x) => x.id !== id) };
}

export function newStandard(name: string): DrawingStandard {
  const now = Date.now();
  return { id: crypto.randomUUID(), name, notes: '', identify: [], createdAt: now, updatedAt: now, sheets: { ...NO_SHEET_HINTS, boxes: [], disciplines: {} }, links: structuredClone(DEFAULT_LINK_HINTS), chainage: structuredClone(DEFAULT_CHAINAGE_HINTS), marks: [] };
}

/** A standard saved before it held links, chainage and marks, with the defaults for them. */
export function withDefaults(s: DrawingStandard): DrawingStandard {
  return s.links && s.chainage && s.marks && s.identify ? s : { ...s, identify: s.identify ?? [], links: s.links ?? structuredClone(DEFAULT_LINK_HINTS), chainage: s.chainage ?? structuredClone(DEFAULT_CHAINAGE_HINTS), marks: s.marks ?? [] };
}

/**
 * Identifies what a standard does to detection (not its name or notes): a document records it,
 * so it is read again once the standard changes.
 */
export function standardHash(s: DrawingStandard): string {
  const { sheets, links, chainage, marks } = withDefaults(s);
  const text = JSON.stringify({ sheets, links, chainage, marks: marks.map((m) => m.id) });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const FORMAT = 'redcolumn.drawing-standard';
const VERSION = 1;

export function exportStandard(s: DrawingStandard): string {
  // How this set's steps went, and pending AI proposals, stay with the person.
  const { results: _results, proposals: _proposals, ...shared } = withDefaults(s);
  return JSON.stringify({ format: FORMAT, version: VERSION, standard: shared }, null, 2);
}

/**
 * The standard a Project's owner chose for its files, as kept in project.json (an exported
 * standard). Anyone who can edit the folder could have written it, so it is read like a shared file;
 * null when there is none or it cannot be read.
 */
export function standardOfProject(value: unknown): DrawingStandard | null {
  if (!value) return null;
  try {
    return parseStandardFile(JSON.stringify(value));
  } catch {
    return null;
  }
}

/** A file name for a standard: its name without characters file systems refuse. */
export function standardFileName(s: DrawingStandard): string {
  return `${s.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Drawing standard'}.rcstandard`;
}

const MAX_FILE = 4 * 1024 * 1024;
const MAX_BOXES = 50;
const MAX_DISCIPLINES = 500;
const MAX_WORDS = 40;
const MAX_MARKS = 40;
/** As teachMark allows: more line work than this is more than one mark. */
const MAX_MARK_LINES = 600 * 4;

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
const finite = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e6) fail(`${what} is not a number`);
  return v;
};
const part = (v: unknown, what: string): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 30) fail(`${what} is not a part of the number`);
  return v;
};
const words = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.length > MAX_WORDS) fail(`${what} are missing`);
  return v.map((w) => text(w, 60, what).trim()).filter(Boolean);
};
const plainId = (v: unknown, what: string): string => {
  const id = text(v, 100, what);
  if (!/^[\w-]+$/.test(id)) fail(`${what} is not one redcolumn makes`);
  return id;
};

function parseLinks(v: unknown): LinkHints {
  if (v === undefined) return structuredClone(DEFAULT_LINK_HINTS);
  if (!isObject(v)) fail('the link words are missing');
  const titles = v.titles;
  if (!isObject(titles)) fail('the title words are missing');
  return {
    ids: v.ids === null ? null : words(v.ids, 'the identifier forms'),
    titles: { section: words(titles.section, 'section words'), elevation: words(titles.elevation, 'elevation words'), enlargedPlan: words(titles.enlargedPlan, 'enlarged plan words') },
    matchLine: words(v.matchLine, 'match line words'),
    calloutPart: part(v.calloutPart, 'the part callouts cite'),
  };
}

function parseChainage(v: unknown): ChainageHints {
  if (v === undefined) return structuredClone(DEFAULT_CHAINAGE_HINTS);
  if (!isObject(v)) fail('the chainage settings are missing');
  const out: ChainageHints = { prefixes: words(v.prefixes, 'chainage prefixes'), alignments: words(v.alignments, 'alignment names'), planTitles: words(v.planTitles, 'plan titles'), sectionTitles: words(v.sectionTitles, 'cross-section titles') };
  if (v.alignmentTemplate != null) out.alignmentTemplate = text(v.alignmentTemplate, 60, 'the alignment name form');
  if (v.alignmentSource != null) {
    if (v.alignmentSource !== 'title' && v.alignmentSource !== 'sheet' && v.alignmentSource !== 'section') fail('where cross sections say their alignment is not one of title, sheet or section');
    out.alignmentSource = v.alignmentSource;
  }
  return out;
}

function parseMark(v: unknown): TaughtMark {
  if (!isObject(v) || typeof v.kind !== 'string' || !Object.hasOwn(MARK_KINDS, v.kind)) fail('a taught mark has no kind');
  if (!Array.isArray(v.lines) || v.lines.length > MAX_MARK_LINES || v.lines.length % 4) fail('a taught mark has too much line work');
  if (!Array.isArray(v.words) || v.words.length > MAX_WORDS) fail("a taught mark's label is missing");
  const markWords: MarkWord[] = v.words.map((w: unknown) => {
    if (!isObject(w) || (w.role !== 'detail' && w.role !== 'sheet' && w.role !== 'text')) fail("a taught mark's label is missing");
    return { role: w.role, text: text(w.text, 100, "a taught mark's label"), x: finite(w.x, 'a label position'), y: finite(w.y, 'a label position'), size: finite(w.size, 'a label size') };
  });
  return {
    id: plainId(v.id, "a taught mark's id"),
    kind: v.kind as MarkKind,
    name: text(v.name, 200, "a taught mark's name"),
    createdAt: finite(v.createdAt, 'a date'),
    w: finite(v.w, "a taught mark's size"),
    h: finite(v.h, "a taught mark's size"),
    lines: v.lines.map((n: unknown) => finite(n, 'line work')),
    words: markWords,
  };
}

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
    const box: TitleBox = { field: b.field as TitleField, x: fraction(b.x), y: fraction(b.y), w: fraction(b.w), h: fraction(b.h) };
    if (box.field === 'custom') box.name = text(b.name, 60, "a custom field's name").trim() || 'Field';
    if (box.x + box.w > 1.0001 || box.y + box.h > 1.0001) fail('a title-block box is off the page');
    return box;
  });
  const template = sheets.template === null ? null : text(sheets.template, 200, 'the drawing-number template');
  if (!isObject(sheets.disciplines) || Object.keys(sheets.disciplines).length > MAX_DISCIPLINES) fail('the discipline names are missing');
  // Built as own properties: a code named `__proto__` stays a code.
  const disciplines: Record<string, string> = Object.fromEntries(
    Object.entries(sheets.disciplines).map(([code, name]) => {
      if (code.length > 40) fail('a discipline code is too long');
      return [code, text(name, 100, 'a discipline name')];
    }),
  );
  if (s.marks !== undefined && (!Array.isArray(s.marks) || s.marks.length > MAX_MARKS)) fail('the taught marks are missing');
  const created = typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) ? s.createdAt : Date.now();
  const updated = typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : created;
  return {
    id: plainId(s.id, 'its id'),
    name: text(s.name, 200, 'its name').trim() || 'Drawing standard',
    notes: s.notes === undefined ? '' : text(s.notes, 5000, 'its notes'),
    identify: s.identify === undefined ? [] : words(s.identify, 'identifying words'),
    createdAt: created,
    updatedAt: updated,
    sheets: { boxes, template: template?.trim() || null, disciplinePart: part(sheets.disciplinePart, 'the discipline part'), disciplines },
    links: parseLinks(s.links),
    chainage: parseChainage(s.chainage),
    marks: ((s.marks as unknown[] | undefined) ?? []).map(parseMark),
    ...(s.examples === undefined ? {} : { examples: parseExamples(s.examples) }),
  };
}

const MAX_EXAMPLES = 60;

function parseExamples(v: unknown): SetupExample[] {
  if (!Array.isArray(v) || v.length > MAX_EXAMPLES) fail('the setup examples are missing');
  return v.map((e: unknown) => {
    if (!isObject(e) || typeof e.step !== 'string' || !(SETUP_STEPS as readonly string[]).includes(e.step)) fail('a setup example has no step');
    if (typeof e.page !== 'number' || !Number.isInteger(e.page) || e.page < 0 || e.page > 100000) fail('a setup example has no page');
    const r = e.rect;
    if (!isObject(r)) fail('a setup example has no box');
    return {
      step: e.step as SetupStep,
      role: text(e.role, 40, "a setup example's role"),
      page: e.page,
      sheet: e.sheet === null || e.sheet === undefined ? null : text(e.sheet, 100, "a setup example's sheet"),
      rect: { x: fraction(r.x), y: fraction(r.y), w: fraction(r.w), h: fraction(r.h) },
      text: text(e.text ?? '', 200, "a setup example's text"),
    };
  });
}
