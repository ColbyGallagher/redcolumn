import { msg } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import { deriveTemplate, numberParts, readBox, type PageText, type SheetInfo, type TitleBox, type TitleField } from '@nb/sheets';
import { SETUP_STEPS, type DrawingStandard, type SetupStep } from './standards';

/**
 * The drawing standards setup wizard: the questions it asks, in order, and the checks it runs on
 * each answer. No React here, so it can be tested on its own (StandardsWizard.tsx draws it).
 * Plan: docs/drawing-standards-wizard-plan.md.
 */

export type WizardStepId = 'titleBlock' | 'sections' | 'elevations' | 'details' | 'matchLines' | 'chainage' | 'review';

export interface WizardStep {
  id: WizardStepId;
  label: string;
  /** Built in this version of the wizard; the others point to the panels that do the job for now. */
  ready: boolean;
}

export const WIZARD_STEPS: WizardStep[] = [
  { id: 'titleBlock', get label() { return msg('Title block'); }, ready: true },
  { id: 'sections', get label() { return msg('Sections'); }, ready: true },
  { id: 'elevations', get label() { return msg('Elevations'); }, ready: true },
  { id: 'details', get label() { return msg('Details'); }, ready: true },
  { id: 'matchLines', get label() { return msg('Match lines'); }, ready: true },
  { id: 'chainage', get label() { return msg('Chainages'); }, ready: true },
  { id: 'review', get label() { return msg('Review'); }, ready: true },
];

/** One title-block question: which box to draw, and what to say about it. */
export interface TitleQuestion {
  key: string;
  field: TitleField;
  /** A custom field's name. */
  name?: string;
  label: string;
  prompt: string;
  /** Can be skipped without a second thought (the drawing number cannot). */
  optional: boolean;
}

export const TITLE_QUESTIONS = lazy((): TitleQuestion[] => [
  { key: 'number', field: 'number', label: msg('Drawing number'), prompt: msg('Drag a box around the drawing number in the title block. Take in the whole number; its label can be inside the box too.'), optional: false },
  { key: 'revision', field: 'revision', label: msg('Revision'), prompt: msg('Drag a box around the current revision (the letter or number in the revision box, not the revision table).'), optional: true },
  { key: 'title', field: 'title', label: msg('Title'), prompt: msg('Drag a box around the drawing title, every line of it.'), optional: true },
  { key: 'scale', field: 'scale', label: msg('Scale'), prompt: msg('Drag a box around the scale, such as 1:500 or AS SHOWN.'), optional: true },
  { key: 'sheetSize', field: 'sheetSize', label: msg('Sheet size'), prompt: msg('Drag a box around the sheet size the drawing is made for, such as A1.'), optional: true },
  { key: 'custom:Project', field: 'custom', name: 'Project', label: msg('Project'), prompt: msg('If the title block names the project (a name or number), drag a box around it. Skip if not.'), optional: true },
  { key: 'custom:Status', field: 'custom', name: 'Status', label: msg('Status'), prompt: msg('If the title block gives a status or suitability (FOR CONSTRUCTION, S3), drag a box around it. Skip if not.'), optional: true },
  { key: 'custom:Date', field: 'custom', name: 'Date', label: msg('Date'), prompt: msg('If the title block gives an issue date, drag a box around it. Skip if not.'), optional: true },
]);

/** After the questions: the person's own fields, numbers to ignore, and how drawing numbers are built. */
export type TitleExtra = 'ownFields' | 'ignore' | 'numbers';
export const TITLE_EXTRAS: { id: TitleExtra; label: string }[] = [
  { id: 'ownFields', get label() { return msg('Your own fields'); } },
  { id: 'ignore', get label() { return msg('Other numbers'); } },
  { id: 'numbers', get label() { return msg('Drawing numbers'); } },
];

/** The box that answers a question, if one was drawn. */
export function boxFor(boxes: readonly TitleBox[], q: Pick<TitleQuestion, 'field' | 'name'>): TitleBox | undefined {
  return boxes.find((b) => b.field === q.field && (q.field !== 'custom' || b.name === q.name));
}

/** The boxes with a question's answer replaced by `box` (or removed, with null). */
export function withAnswer(boxes: readonly TitleBox[], q: Pick<TitleQuestion, 'field' | 'name'>, box: TitleBox | null): TitleBox[] {
  const old = boxFor(boxes, q);
  const rest = boxes.filter((b) => b !== old);
  return box ? [...rest, q.field === 'custom' ? { ...box, field: 'custom', name: q.name } : { ...box, field: q.field }] : rest;
}

/** `count` pages spread through the set, other than `except`: the sheets a box is checked on. */
export function samplePages(pageCount: number, except: number, count = 5): number[] {
  const all = Array.from({ length: pageCount }, (_, i) => i).filter((i) => i !== except);
  if (all.length <= count) return all;
  return Array.from({ length: count }, (_, k) => all[Math.round(((k + 0.5) * all.length) / count - 0.5)]!);
}

/**
 * The page to start on: the first sheet with a drawing number and title detected (a cover or
 * index often has neither, or an odd title block), else the first page.
 */
export function startPage(sheets: readonly (SheetInfo | null | undefined)[]): number {
  const i = sheets.findIndex((s) => s?.number && s.title);
  return i >= 0 ? i : 0;
}

/** What a box reads across the set. */
export interface BoxCheck {
  /** What it reads on the page it was drawn on. */
  here: string | null;
  /** On a few other sheets, for the person to look over. */
  samples: { page: number; value: string | null }[];
  /** Pages it reads something on, of all pages. */
  read: number;
  of: number;
  /** Values read on more than one page (drawing numbers should be unique). */
  repeated: string[];
  /** Pages it reads nothing on. */
  empty: number[];
}

export function checkBox(texts: readonly PageText[], box: TitleBox, here: number, template: string | null = null): BoxCheck {
  const values = texts.map((t) => readBox(t, box, template));
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return {
    here: values[here] ?? null,
    samples: samplePages(texts.length, here).map((page) => ({ page, value: values[page] ?? null })),
    read: values.filter(Boolean).length,
    of: texts.length,
    repeated: box.field === 'number' ? [...counts].filter(([, n]) => n > 1).map(([v]) => v) : [],
    empty: values.flatMap((v, i) => (v ? [] : [i])),
  };
}

/** How well a box reads: every page, most pages (a cover or two without), or too few. */
export function checkVerdict(c: BoxCheck, field: TitleField): 'good' | 'some' | 'poor' {
  const share = c.of ? c.read / c.of : 0;
  if (!c.here || share < 0.5 || (field === 'number' && c.repeated.length > c.read / 4)) return 'poor';
  return share >= 0.9 && !c.repeated.length ? 'good' : 'some';
}

/** The drawing numbers a number box reads across the set. */
export function numbersRead(texts: readonly PageText[], box: TitleBox): string[] {
  return texts.map((t) => readBox(t, box)).filter((v): v is string => !!v);
}

/** The template that fits the numbers read, leaving out numbers built another way (another consultant's sheets). */
export function templateFor(numbers: readonly string[]): string | null {
  const whole = deriveTemplate(numbers);
  if (whole || numbers.length < 3) return whole;
  // The shape most numbers share: same part count and separators.
  const shape = (n: string) => n.toUpperCase().replace(/[A-Z0-9]+/g, 'x');
  const groups = new Map<string, string[]>();
  for (const n of numbers) groups.set(shape(n), [...(groups.get(shape(n)) ?? []), n]);
  const [, most] = [...groups].sort((a, b) => b[1].length - a[1].length)[0]!;
  return most.length >= numbers.length / 2 ? deriveTemplate(most) : null;
}

/**
 * Parts of the drawing numbers that could name the discipline: short letter codes (RW, BR, DR),
 * with the codes found. Parts that change between sheets come first; a part the same on every
 * sheet is still offered (a set of one discipline), after them.
 */
export function disciplineCandidates(numbers: readonly string[]): { part: number; codes: string[] }[] {
  const split = numbers.map(numberParts);
  const longest = Math.max(0, ...split.map((p) => p.length));
  const out: { part: number; codes: string[] }[] = [];
  for (let i = 0; i < longest; i++) {
    const values = split.map((p) => p[i]).filter((v): v is string => !!v);
    const codes = [...new Set(values)];
    // Discipline codes are short and all letters (RW, C, STR); project codes mix in digits (KRU2).
    if (!codes.length || codes.some((c) => !/^[A-Z]{1,4}$/.test(c))) continue;
    if (codes.length > Math.max(12, values.length / 2)) continue;
    out.push({ part: i, codes: codes.sort() });
  }
  // A part that is the same on every sheet can still be the discipline (a set of one discipline): keep it last.
  return out.sort((a, b) => b.codes.length - a.codes.length);
}

/**
 * Why a name cannot be used for a new field of the person's own, or null when it can: one of the
 * questions already asks for it, or a field of that name is already boxed (a second box would
 * replace the first).
 */
export function customNameProblem(name: string, boxes: readonly TitleBox[]): string | null {
  const n = name.trim().toUpperCase();
  if (!n) return null;
  const asked = TITLE_QUESTIONS().find((q) => q.field === 'custom' && q.name?.toUpperCase() === n);
  if (asked) return msg('{label} has its own question above; box it there.', { label: asked.label });
  const taken = boxes.find((b) => b.field === 'custom' && b.name?.trim().toUpperCase() === n);
  if (taken) return msg('There is already a field called {name}. Use another name, or remove that one first.', { name: taken.name });
  return null;
}

/** Where the wizard was, kept per standard so closing the window resumes there. */
export interface WizardPlace {
  step: WizardStepId;
  /** Index into TITLE_QUESTIONS(), then TITLE_EXTRAS after them. */
  question: number;
}

const PLACE_KEY = 'rc.standardsWizard.place.';

export function loadPlace(standardId: string): WizardPlace | null {
  try {
    const raw = localStorage.getItem(PLACE_KEY + standardId);
    const v = raw ? (JSON.parse(raw) as WizardPlace) : null;
    return v && WIZARD_STEPS.some((s) => s.id === v.step) && Number.isInteger(v.question) ? v : null;
  } catch {
    return null;
  }
}

export function savePlace(standardId: string, place: WizardPlace) {
  try {
    localStorage.setItem(PLACE_KEY + standardId, JSON.stringify(place));
  } catch {
    // Private windows and full storage: the wizard starts at the top next time.
  }
}

const SPLIT_KEY = 'rc.standardsWizard.split';

/** The instructions pane's share of the window (a third unless the person dragged it). */
export function loadSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v >= 0.2 && v <= 0.6 ? v : 1 / 3;
  } catch {
    return 1 / 3;
  }
}

export function saveSplit(v: number) {
  try {
    localStorage.setItem(SPLIT_KEY, String(v));
  } catch {
    // As above.
  }
}

const STEP_NAME = lazy((): Record<SetupStep, string> => ({ sections: msg('Sections'), elevations: msg('Elevations'), details: msg('Details'), matchLines: msg('Match lines'), chainage: msg('Chainages') }));

/** The steps worth handing to an AI assistant: those whose meter says AI, then those to review. */
export function stepsForAi(results: DrawingStandard['results']): SetupStep[] {
  const r = results ?? {};
  const rank = (s: SetupStep) => (r[s]?.band === 'ai' ? 0 : r[s]?.band === 'review' || (r[s]?.unreadable ?? 0) > 0 || (r[s]?.ambiguous ?? 0) > 0 ? 1 : 2);
  return SETUP_STEPS.filter((s) => r[s] && rank(s) < 2).sort((a, b) => rank(a) - rank(b));
}

/**
 * A prompt for an AI assistant connected to redcolumn over MCP, to finish the steps text and shape
 * search could not: which standard and drawing, which steps and why, the tools to use, and that
 * a person reviews everything it proposes.
 */
export function aiPrompt(standard: DrawingStandard, fileName: string, steps: readonly SetupStep[]): string {
  const r = standard.results ?? {};
  const lines = steps.map((s) => {
    const x = r[s];
    if (!x) return `- ${STEP_NAME()[s]}`;
    const why = [msg('{linked} of {references} references linked', { linked: x.linked, references: x.references }), x.wrong ? msg('{wrong} of {checked} checked links wrong', { wrong: x.wrong, checked: x.checked }) : '', x.unreadable ? msg('{unreadable} marks found by shape but not read', { unreadable: x.unreadable }) : '', x.ambiguous ? msg('{ambiguous} chainages whose alignment is unclear', { ambiguous: x.ambiguous }) : ''].filter(Boolean);
    return `- ${STEP_NAME()[s]}: ${why.join('; ')}.`;
  });
  return [
    msg('In redcolumn, {fileName} is open with the drawing standard "{name}". Text and shape search did not finish these setup steps:', { fileName, name: standard.name }),
    ...lines,
    '',
    msg('1. Call get_drawing_standard (standard "{name}") for the examples I boxed in each step and how each step did.', { name: standard.name }),
    '2. Call list_sheet_links for the document, for those kinds, to see what was found and what waits for review.',
    '3. Read the sheets with get_page_text and get_page_image (zoom into callouts, titles, match-line labels and chainages), using my examples to know what to look for.',
    '4. Propose the missing or wrong links with propose_sheet_links, saying how you read each one.',
    '5. If the standard is missing words that would let text search find these next time (title words, match-line words, chainage prefixes, alignment names), propose them with propose_standard_hints.',
    '',
    msg('Do not change anything else. I will review your links in the Links panel and your words in the setup’s Review step.'),
  ].join('\n');
}
