import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFString,
  PDFTextField,
  PDFArray,
  PDFNumber,
  StandardFonts,
  decodePDFRawStream,
  PDFRawStream,
  rgb,
  type PDFField,
  type PDFForm,
  type PDFPage,
} from 'pdf-lib';
import { applyMatrix, pageMatrix } from '@nb/markup/export';
import { openForEdit } from './incremental';
import { calculationScript, displayValue, formatScripts, parseCalculation, parseFormat, recalculate, type Calculation, type FieldFormat } from './formScripts';

/**
 * PDF forms (AcroForm): reading the fields and their widgets, filling them in, creating and
 * changing fields, and form data in and out. Values are written into the file itself, with
 * appearances, so every reader shows them.
 */

export type FieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'button' | 'signature';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FieldWidget {
  pageIndex: number;
  /** Page space: points, top-left origin, y down. */
  rect: Rect;
  /** Check box and radio widgets: the value this one stands for when on. */
  onValue?: string;
}

export interface FormField {
  name: string;
  type: FieldType;
  /** Text, choice or radio value; "Off" or the on value for check boxes; list boxes join with newlines. */
  value: string;
  options: string[];
  tooltip: string;
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  maxLength: number | null;
  calculation: Calculation | null;
  format: FieldFormat | null;
  widgets: FieldWidget[];
  /** Value Reset Form puts back (/DV). */
  defaultValue: string;
  /** Text size in points (0: fit the box), text colour, and the widgets' border and background (#rrggbb). */
  fontSize: number;
  textColor: string;
  borderColor: string | null;
  backgroundColor: string | null;
  /** Shown and printed, hidden, shown but not printed, or printed only. */
  visibility: FieldVisibility;
  /** What values are accepted. */
  validation: FieldValidation | null;
  /** Buttons: what clicking does (the widget's /A action). */
  action: ButtonAction | null;
}

/** A button's action: open a web address, go to a page, reset the form, print, or submit the form's data. */
export type ButtonAction = { kind: 'url'; url: string } | { kind: 'page'; pageIndex: number } | { kind: 'reset' } | { kind: 'print' } | { kind: 'submit'; url: string };

/** Reads a widget's (or field's) /A action as a button action. */
function readAction(doc: PDFDocument, dict: PDFDict | undefined): ButtonAction | null {
  const a = dict?.lookupMaybe(PDFName.of('A'), PDFDict);
  const s = a?.lookup(PDFName.of('S'));
  if (!a || !(s instanceof PDFName)) return null;
  switch (s.decodeText()) {
    case 'URI':
      return { kind: 'url', url: textOf(a.lookup(PDFName.of('URI'))) };
    case 'GoTo': {
      const d = a.lookup(PDFName.of('D'));
      const target = d instanceof PDFArray ? d.get(0) : null;
      const pageIndex = doc.getPages().findIndex((p) => p.ref === target);
      return pageIndex >= 0 ? { kind: 'page', pageIndex } : null;
    }
    case 'ResetForm':
      return { kind: 'reset' };
    case 'Named': {
      const n = a.lookup(PDFName.of('N'));
      return n instanceof PDFName && n.decodeText() === 'Print' ? { kind: 'print' } : null;
    }
    case 'SubmitForm': {
      const f = a.lookup(PDFName.of('F'));
      const url = f instanceof PDFDict ? textOf(f.lookup(PDFName.of('F'))) : textOf(f);
      return { kind: 'submit', url };
    }
    default:
      return null;
  }
}

/** The /A dictionary for a button action. */
function actionDict(doc: PDFDocument, a: ButtonAction): PDFDict {
  const ctx = doc.context;
  switch (a.kind) {
    case 'url':
      return ctx.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(a.url) });
    case 'page':
      return ctx.obj({ Type: 'Action', S: 'GoTo', D: [doc.getPages()[a.pageIndex]!.ref, PDFName.of('Fit')] });
    case 'reset':
      return ctx.obj({ Type: 'Action', S: 'ResetForm' });
    case 'print':
      return ctx.obj({ Type: 'Action', S: 'Named', N: 'Print' });
    case 'submit':
      // XFDF (flag 32), as Revu and Acrobat send it.
      return ctx.obj({ Type: 'Action', S: 'SubmitForm', F: ctx.obj({ FS: 'URL', F: PDFString.of(a.url) }), Flags: 32 });
  }
}

export type FieldVisibility = 'visible' | 'hidden' | 'noPrint' | 'printOnly';

/** A number within a range, or text matching a pattern (with the message shown otherwise). */
export type FieldValidation = { kind: 'range'; min: number | null; max: number | null } | { kind: 'pattern'; pattern: string; message: string };

const hexOf = (rgb: readonly number[]) => '#' + rgb.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
const rgbOf = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Font size and text colour from a default appearance string such as "/Helv 10 Tf 0 0 1 rg". */
export function parseDa(da: string): { fontSize: number; textColor: string } {
  const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1] ?? 0);
  const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  const g = /([\d.]+)\s+g(?:\s|$)/.exec(da);
  const color = rg ? hexOf([Number(rg[1]), Number(rg[2]), Number(rg[3])]) : g ? hexOf([Number(g[1]), Number(g[1]), Number(g[1])]) : '#000000';
  return { fontSize: size, textColor: color };
}

/** A default appearance string with a new size and/or colour (the font kept). */
export function withDa(da: string, size: number | undefined, color: string | undefined): string {
  let out = da.trim() || '/Helv 0 Tf 0 g';
  if (size !== undefined) out = /[\d.]+\s+Tf/.test(out) ? out.replace(/[\d.]+(\s+Tf)/, `${size}$1`) : `/Helv ${size} Tf ${out}`;
  if (color !== undefined) {
    const [r, g, b] = rgbOf(color).map((v) => Math.round(v * 1000) / 1000);
    const c = `${r} ${g} ${b} rg`;
    out = out.replace(/[\d.]+\s+[\d.]+\s+[\d.]+\s+rg|[\d.]+\s+g(?=\s|$)|[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+k/, c);
    if (!out.includes(c)) out = `${out} ${c}`;
  }
  return out;
}

/** The script for a validation, as Acrobat writes a range check (patterns are our own). */
export function validationScript(v: FieldValidation): string {
  if (v.kind === 'range') return `AFRange_Validate(${v.min !== null}, ${v.min ?? 0}, ${v.max !== null}, ${v.max ?? 0});`;
  return `/* nb:pattern */ var re = new RegExp(${JSON.stringify(v.pattern)}); if (event.value && !re.test(event.value)) { app.alert(${JSON.stringify(v.message)}); event.rc = false; }`;
}

export function parseValidation(script: string): FieldValidation | null {
  const r = /AFRange_Validate\(\s*(true|false)\s*,\s*([-\d.]+)\s*,\s*(true|false)\s*,\s*([-\d.]+)\s*\)/.exec(script);
  if (r) return { kind: 'range', min: r[1] === 'true' ? Number(r[2]) : null, max: r[3] === 'true' ? Number(r[4]) : null };
  const p = /nb:pattern \*\/ var re = new RegExp\(("(?:[^"\\]|\\.)*")\);.*app\.alert\(("(?:[^"\\]|\\.)*")\)/.exec(script);
  if (p) {
    try {
      return { kind: 'pattern', pattern: JSON.parse(p[1]!) as string, message: JSON.parse(p[2]!) as string };
    } catch {
      return null;
    }
  }
  return null;
}

/** Why a value is not accepted by a field's validation, or null if it is. */
export function validateValue(f: Pick<FormField, 'validation'>, value: string): string | null {
  const v = f.validation;
  if (!v || !value.trim()) return null;
  if (v.kind === 'range') {
    const n = Number(value.replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n)) return 'Enter a number.';
    if (v.min !== null && n < v.min) return `Enter a number of at least ${v.min}.`;
    if (v.max !== null && n > v.max) return `Enter a number of at most ${v.max}.`;
    return null;
  }
  try {
    return new RegExp(v.pattern).test(value) ? null : v.message || 'That value is not accepted.';
  } catch {
    return null;
  }
}

export interface FormModel {
  fields: FormField[];
  /** Calculation order (/CO). */
  calcOrder: string[];
}

const TYPE_OF = (f: PDFField): FieldType =>
  f instanceof PDFTextField ? 'text' : f instanceof PDFCheckBox ? 'checkbox' : f instanceof PDFRadioGroup ? 'radio' : f instanceof PDFDropdown ? 'dropdown' : f instanceof PDFOptionList ? 'list' : f instanceof PDFSignature ? 'signature' : 'button';

function textOf(obj: unknown): string {
  return obj instanceof PDFString || obj instanceof PDFHexString ? obj.decodeText() : '';
}

/** A field's action script (/AA /C calculate, /F format, /V validate), in a string or a stream. */
function actionScript(field: PDFField, key: 'C' | 'F' | 'V'): string {
  const aa = field.acroField.dict.lookupMaybe(PDFName.of('AA'), PDFDict);
  const action = aa?.lookupMaybe(PDFName.of(key), PDFDict);
  const js = action?.lookup(PDFName.of('JS'));
  if (!js) return '';
  if (js instanceof PDFString || js instanceof PDFHexString) return js.decodeText();
  // A stream: decoded text.
  try {
    if (js instanceof PDFRawStream) return new TextDecoder().decode(decodePDFRawStream(js).decode());
  } catch {
    // Unreadable script.
  }
  return '';
}

/** Which page each widget annotation is on. */
function widgetPages(doc: PDFDocument): Map<PDFRef | PDFDict, number> {
  const out = new Map<PDFRef | PDFDict, number>();
  doc.getPages().forEach((page, i) => {
    const annots = page.node.Annots();
    for (const a of annots?.asArray() ?? []) out.set(a as PDFRef, i);
  });
  return out;
}

function pageRect(page: PDFPage, r: { x: number; y: number; width: number; height: number }): Rect {
  // User space → page space: inverse of pageMatrix (a rotation or flip plus an offset).
  const m = pageMatrix(page);
  const det = m[0] * m[3] - m[1] * m[2];
  const inv = (x: number, y: number): [number, number] => {
    const dx = x - m[4];
    const dy = y - m[5];
    return [(m[3] * dx - m[2] * dy) / det, (-m[1] * dx + m[0] * dy) / det];
  };
  const a = inv(r.x, r.y);
  const b = inv(r.x + r.width, r.y + r.height);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

function valueOf(f: PDFField): string {
  if (f instanceof PDFTextField) return f.getText() ?? '';
  if (f instanceof PDFCheckBox) {
    const v = f.acroField.dict.lookup(PDFName.of('V'));
    return v instanceof PDFName ? v.decodeText() : f.isChecked() ? 'Yes' : 'Off';
  }
  if (f instanceof PDFRadioGroup) return f.getSelected() ?? 'Off';
  if (f instanceof PDFDropdown || f instanceof PDFOptionList) return f.getSelected().join('\n');
  // Signature fields: whether they are signed.
  if (f instanceof PDFSignature) return f.acroField.dict.get(PDFName.of('V')) ? 'Signed' : '';
  return '';
}

export async function readForm(bytes: ArrayBuffer | Uint8Array): Promise<FormModel> {
  return modelOf(await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }));
}

/** The form of a loaded document, as it is now (edits included). */
function modelOf(doc: PDFDocument): FormModel {
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acro) return { fields: [], calcOrder: [] };
  const form = doc.getForm();
  const pages = doc.getPages();
  const where = widgetPages(doc);
  const fields: FormField[] = [];
  for (const f of form.getFields()) {
    const type = TYPE_OF(f);
    const widgets: FieldWidget[] = [];
    // Radio buttons with /Opt name their states 0, 1…; the options list holds what each stands for.
    const radioOptions = f instanceof PDFRadioGroup && f.acroField.dict.has(PDFName.of('Opt')) ? f.getOptions() : null;
    f.acroField.getWidgets().forEach((w, k) => {
      const ref = doc.context.getObjectRef(w.dict);
      const pageIndex = (ref && where.get(ref)) ?? pages.findIndex((p) => p.ref === w.P());
      if (pageIndex === undefined || pageIndex < 0) return;
      const onValue = type === 'checkbox' || type === 'radio' ? (radioOptions?.[k] ?? w.getOnValue()?.decodeText()) : undefined;
      widgets.push({ pageIndex, rect: pageRect(pages[pageIndex]!, w.getRectangle()), ...(onValue !== undefined ? { onValue } : {}) });
    });
    fields.push({
      name: f.getName(),
      type,
      value: valueOf(f),
      options: f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup ? f.getOptions() : [],
      tooltip: textOf(f.acroField.dict.lookup(PDFName.of('TU'))),
      readOnly: f.isReadOnly(),
      required: f.isRequired(),
      multiline: f instanceof PDFTextField ? f.isMultiline() : false,
      maxLength: f instanceof PDFTextField ? (f.getMaxLength() ?? null) : null,
      calculation: parseCalculation(actionScript(f, 'C')),
      format: parseFormat(actionScript(f, 'F')),
      widgets,
      defaultValue: (() => {
        const dv = f.acroField.dict.lookup(PDFName.of('DV'));
        return dv instanceof PDFName ? dv.decodeText() : textOf(dv);
      })(),
      ...parseDa(textOf(f.acroField.dict.lookup(PDFName.of('DA'))) || textOf(acro.lookup(PDFName.of('DA')))),
      ...(() => {
        const w = f.acroField.getWidgets()[0];
        const mk = w?.getAppearanceCharacteristics();
        const bc = mk?.getBorderColor();
        const bg = mk?.getBackgroundColor();
        const flags = w?.dict.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 4;
        const visibility: FieldVisibility = flags & 2 ? 'hidden' : flags & 32 ? 'printOnly' : flags & 4 ? 'visible' : 'noPrint';
        return { borderColor: bc?.length === 3 ? hexOf(bc) : null, backgroundColor: bg?.length === 3 ? hexOf(bg) : null, visibility };
      })(),
      validation: parseValidation(actionScript(f, 'V')),
      action: type === 'button' ? (readAction(doc, f.acroField.getWidgets()[0]?.dict) ?? readAction(doc, f.acroField.dict)) : null,
    });
  }
  const co = acro.lookupMaybe(PDFName.of('CO'), PDFArray);
  const calcOrder = (co?.asArray() ?? []).flatMap((r) => {
    const d = doc.context.lookup(r);
    const hit = form.getFields().find((f) => f.acroField.dict === d);
    return hit ? [hit.getName()] : [];
  });
  return { fields, calcOrder };
}

/**
 * Sets values (by field name), recalculates calculated fields, and regenerates appearances.
 * Returns the form as filled in, so it need not be read from the new file again. With `validate`,
 * values a field does not accept are refused (as other PDF readers do).
 */
export async function fillForm(bytes: ArrayBuffer | Uint8Array, values: Readonly<Record<string, string>>, { validate = false } = {}): Promise<{ bytes: Uint8Array; changed: string[]; model: FormModel }> {
  const { doc, save } = await openForEdit(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const model = modelOf(doc);
  if (validate) {
    for (const [name, value] of Object.entries(values)) {
      const f = model.fields.find((x) => x.name === name);
      const problem = f ? validateValue(f, value) : null;
      if (problem) throw new Error(`${name}: ${problem}`);
    }
  }
  const all = new Map(model.fields.map((f) => [f.name, f.value]));
  for (const [k, v] of Object.entries(values)) all.set(k, v);
  const calcs = new Map(model.fields.filter((f) => f.calculation).map((f) => [f.name, f.calculation!]));
  const calculated = recalculate(model.calcOrder, calcs, all);
  const changed = new Set([...Object.keys(values), ...calculated.keys()]);
  const formats = new Map(model.fields.map((f) => [f.name, f.format]));
  for (const name of changed) setValue(form, name, all.get(name) ?? '');
  await writeAppearances(doc, form, [...changed], formats);
  return { bytes: await save(), changed: [...changed], model: modelOf(doc) };
}

function setValue(form: PDFForm, name: string, value: string) {
  const f = form.getFieldMaybe(name);
  if (!f) return;
  if (f instanceof PDFTextField) {
    // A limit on length would make pdf-lib throw; values are cut to fit instead.
    const max = f.getMaxLength();
    f.setText(max !== undefined ? value.slice(0, max) : value);
  } else if (f instanceof PDFCheckBox) {
    if (value && value !== 'Off') f.check();
    else f.uncheck();
  } else if (f instanceof PDFRadioGroup) {
    if (value && value !== 'Off' && f.getOptions().includes(value)) f.select(value);
    else f.clear();
  } else if (f instanceof PDFDropdown) {
    if (!value) f.clear();
    else f.select(value, !f.getOptions().includes(value));
  } else if (f instanceof PDFOptionList) {
    const chosen = value.split('\n').filter((v) => f.getOptions().includes(v));
    if (chosen.length) f.select(chosen);
    else f.clear();
  }
}

/** Appearances for changed fields; formatted fields show their formatted value while keeping the raw one. */
async function writeAppearances(doc: PDFDocument, form: PDFForm, names: string[], formats: ReadonlyMap<string, FieldFormat | null>) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const name of names) {
    const f = form.getFieldMaybe(name);
    if (!f) continue;
    try {
      const format = formats.get(name);
      if (f instanceof PDFTextField && format) {
        const raw = f.getText() ?? '';
        const shown = displayValue(raw, format);
        if (shown !== raw) {
          f.setText(shown);
          f.updateAppearances(font);
          f.acroField.setValue(PDFHexString.fromText(raw));
          continue;
        }
      }
      if (f instanceof PDFTextField || f instanceof PDFDropdown || f instanceof PDFOptionList) f.updateAppearances(font);
      else if (f instanceof PDFCheckBox || f instanceof PDFRadioGroup) f.updateAppearances();
    } catch {
      // A field whose appearance can't be regenerated keeps its value; readers draw it themselves.
    }
  }
  // Readers that can, redraw appearances from the values.
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), doc.context.obj(false));
}

/** Clears every field (Reset Form) to its default value (/DV) or empty. */
export async function resetForm(bytes: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const { doc, save } = await openForEdit(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const model = await readForm(bytes);
  const values: Record<string, string> = {};
  for (const f of form.getFields()) {
    if (f.isReadOnly() || f instanceof PDFSignature) continue;
    const dv = f.acroField.dict.lookup(PDFName.of('DV'));
    values[f.getName()] = dv instanceof PDFName ? dv.decodeText() : textOf(dv);
  }
  for (const [name, v] of Object.entries(values)) setValue(form, name, v);
  await writeAppearances(doc, form, Object.keys(values), new Map(model.fields.map((f) => [f.name, f.format])));
  return save();
}

export interface NewField {
  type: Exclude<FieldType, 'signature'> | 'signature';
  name: string;
  pageIndex: number;
  rect: Rect;
  options?: string[];
}

/** A field name not used yet: "Text1", "Text2"… */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base) && !/\d$/.test(base)) {
    for (let i = 1; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
  }
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/** Page-space rectangle → pdf-lib's addToPage box (user space). */
function userBox(page: PDFPage, r: Rect) {
  const m = pageMatrix(page);
  const a = applyMatrix(m, [r.x, r.y]);
  const b = applyMatrix(m, [r.x + r.w, r.y + r.h]);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
}

/** Creates fields with a widget each (a radio field adds a button to an existing group of the same name). */
export async function createFields(bytes: ArrayBuffer | Uint8Array, specs: readonly NewField[]): Promise<Uint8Array> {
  const { doc, save } = await openForEdit(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const look = { borderColor: rgb(0.35, 0.45, 0.6), borderWidth: 1, backgroundColor: rgb(1, 1, 1), font };
  for (const s of specs) {
    const page = pages[s.pageIndex];
    if (!page) continue;
    // pdf-lib grows the widget by half the border on each side; shrink first so it lands on the drawn box.
    const u = userBox(page, s.rect);
    const bw = look.borderWidth / 2;
    const box = { x: u.x + bw, y: u.y + bw, width: Math.max(1, u.width - look.borderWidth), height: Math.max(1, u.height - look.borderWidth), ...look };
    switch (s.type) {
      case 'text': {
        const f = form.createTextField(s.name);
        f.addToPage(page, box);
        f.setFontSize(0);
        break;
      }
      case 'checkbox':
        form.createCheckBox(s.name).addToPage(page, box);
        break;
      case 'radio': {
        const existing = form.getFieldMaybe(s.name);
        const group = existing instanceof PDFRadioGroup ? existing : form.createRadioGroup(s.name);
        const option = s.options?.[0] || uniqueName('Choice', group.getOptions());
        group.addOptionToPage(option, page, box);
        break;
      }
      case 'dropdown': {
        const f = form.createDropdown(s.name);
        f.setOptions(s.options?.length ? s.options : ['Option 1', 'Option 2']);
        f.addToPage(page, box);
        break;
      }
      case 'list': {
        const f = form.createOptionList(s.name);
        f.setOptions(s.options?.length ? s.options : ['Option 1', 'Option 2']);
        f.addToPage(page, box);
        break;
      }
      case 'button': {
        const f = form.createButton(s.name);
        f.addToPage(s.name, page, box);
        break;
      }
      case 'signature': {
        // An empty signature field: pdf-lib has no creator for these, so the dictionaries are built here.
        const widget = doc.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText(s.name), F: 4, Rect: [u.x, u.y, u.x + u.width, u.y + u.height], P: page.ref, MK: { BC: [0.35, 0.45, 0.6] } });
        const ref = doc.context.register(widget);
        page.node.addAnnot(ref);
        form.acroForm.addField(ref);
        break;
      }
    }
  }
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), doc.context.obj(false));
  return save();
}

export interface FieldChanges {
  name?: string;
  tooltip?: string;
  readOnly?: boolean;
  required?: boolean;
  multiline?: boolean;
  maxLength?: number | null;
  options?: string[];
  calculation?: Calculation | null;
  format?: FieldFormat | null;
  defaultValue?: string;
  fontSize?: number;
  textColor?: string;
  borderColor?: string | null;
  backgroundColor?: string | null;
  visibility?: FieldVisibility;
  validation?: FieldValidation | null;
  /** Buttons only. */
  action?: ButtonAction | null;
}

/** Changes a field's properties (and recalculates if its calculation changed). */
export async function updateField(bytes: ArrayBuffer | Uint8Array, name: string, c: FieldChanges): Promise<Uint8Array> {
  const { doc, save } = await openForEdit(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const f = form.getField(name);
  const dict = f.acroField.dict;
  if (c.name !== undefined && c.name !== name) {
    if (form.getFieldMaybe(c.name)) throw new Error(`There is already a field called "${c.name}"`);
    f.acroField.setPartialName(c.name);
  }
  if (c.tooltip !== undefined) {
    if (c.tooltip) dict.set(PDFName.of('TU'), PDFHexString.fromText(c.tooltip));
    else dict.delete(PDFName.of('TU'));
  }
  if (c.readOnly !== undefined) (c.readOnly ? f.enableReadOnly() : f.disableReadOnly());
  if (c.required !== undefined) (c.required ? f.enableRequired() : f.disableRequired());
  if (f instanceof PDFTextField) {
    if (c.multiline !== undefined) (c.multiline ? f.enableMultiline() : f.disableMultiline());
    if (c.maxLength !== undefined) {
      if (c.maxLength) {
        f.setText((f.getText() ?? '').slice(0, c.maxLength));
        f.setMaxLength(c.maxLength);
      } else f.removeMaxLength();
    }
  }
  if (c.options && (f instanceof PDFDropdown || f instanceof PDFOptionList)) f.setOptions(c.options);
  const aa = () => {
    let d = dict.lookupMaybe(PDFName.of('AA'), PDFDict);
    if (!d) {
      d = doc.context.obj({});
      dict.set(PDFName.of('AA'), d);
    }
    return d;
  };
  const js = (script: string) => doc.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(script) });
  const fieldRef = doc.context.getObjectRef(dict);
  if (c.calculation !== undefined) {
    const co = form.acroForm.dict.lookupMaybe(PDFName.of('CO'), PDFArray);
    if (c.calculation && c.calculation.fields.length) {
      aa().set(PDFName.of('C'), js(calculationScript(c.calculation)));
      if (fieldRef) {
        const list = co ?? doc.context.obj([]);
        if (!list.asArray().some((r) => r === fieldRef)) list.push(fieldRef);
        form.acroForm.dict.set(PDFName.of('CO'), list);
      }
    } else {
      aa().delete(PDFName.of('C'));
      if (co && fieldRef) {
        const i = co.asArray().findIndex((r) => r === fieldRef);
        if (i >= 0) co.remove(i);
      }
    }
  }
  if (c.format !== undefined) {
    if (c.format) {
      const s = formatScripts(c.format);
      aa().set(PDFName.of('F'), js(s.format));
      aa().set(PDFName.of('K'), js(s.keystroke));
    } else {
      aa().delete(PDFName.of('F'));
      aa().delete(PDFName.of('K'));
    }
  }
  if (c.validation !== undefined) {
    if (c.validation) aa().set(PDFName.of('V'), js(validationScript(c.validation)));
    else aa().delete(PDFName.of('V'));
  }
  if (c.defaultValue !== undefined) {
    if (!c.defaultValue) dict.delete(PDFName.of('DV'));
    else dict.set(PDFName.of('DV'), f instanceof PDFCheckBox || f instanceof PDFRadioGroup ? PDFName.of(c.defaultValue) : PDFHexString.fromText(c.defaultValue));
  }
  if (c.fontSize !== undefined || c.textColor !== undefined) {
    const current = textOf(dict.lookup(PDFName.of('DA'))) || textOf(form.acroForm.dict.lookup(PDFName.of('DA')));
    dict.set(PDFName.of('DA'), PDFString.of(withDa(current, c.fontSize, c.textColor)));
  }
  for (const w of f.acroField.getWidgets()) {
    if (c.borderColor !== undefined || c.backgroundColor !== undefined) {
      const mk = w.getOrCreateAppearanceCharacteristics();
      if (c.borderColor !== undefined) {
        if (c.borderColor) mk.setBorderColor(rgbOf(c.borderColor));
        else mk.dict.delete(PDFName.of('BC'));
      }
      if (c.backgroundColor !== undefined) {
        if (c.backgroundColor) mk.setBackgroundColor(rgbOf(c.backgroundColor));
        else mk.dict.delete(PDFName.of('BG'));
      }
    }
    if (c.visibility !== undefined) {
      const was = w.dict.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0;
      const base = was & ~(2 | 4 | 32);
      const bits = c.visibility === 'hidden' ? 2 : c.visibility === 'visible' ? 4 : c.visibility === 'printOnly' ? 4 | 32 : 0;
      w.dict.set(PDFName.of('F'), PDFNumber.of(base | bits));
    }
  }
  if (c.action !== undefined)
    for (const w of f.acroField.getWidgets()) {
      if (c.action) w.dict.set(PDFName.of('A'), actionDict(doc, c.action));
      else w.dict.delete(PDFName.of('A'));
    }
  const saved = await save();
  // Values may follow from the new calculation, or look different with the new format or appearance.
  if (c.calculation !== undefined || c.format !== undefined || c.fontSize !== undefined || c.textColor !== undefined || c.borderColor !== undefined || c.backgroundColor !== undefined) return refreshField(saved, c.name ?? name);
  return saved;
}

/** Recalculates and redraws one field (after its calculation or format changed). */
async function refreshField(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const model = await readForm(bytes);
  const f = model.fields.find((x) => x.name === name);
  return (await fillForm(bytes, f ? { [name]: f.value } : {})).bytes;
}

/** Deletes fields and their widgets. */
export async function removeFields(bytes: ArrayBuffer | Uint8Array, names: readonly string[]): Promise<Uint8Array> {
  const { doc, save } = await openForEdit(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  for (const n of names) {
    const f = form.getFieldMaybe(n);
    if (!f) continue;
    // Take the widgets off their pages too (pdf-lib leaves them in /Annots).
    const refs = new Set(f.acroField.getWidgets().map((w) => doc.context.getObjectRef(w.dict)));
    for (const page of doc.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--) if (refs.has(annots.get(i) as PDFRef)) annots.remove(i);
    }
    form.removeField(f);
  }
  return save();
}

/**
 * Tab order: widgets on each page follow the order of `names` (fields not listed keep their
 * places after them), and pages tab in that order (/Tabs /S for structure… here the array order).
 */
export async function setTabOrder(bytes: ArrayBuffer | Uint8Array, names: readonly string[]): Promise<Uint8Array> {
  const { doc, save } = await openForEdit(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const rank = new Map<PDFRef, number>();
  names.forEach((n, i) => {
    const f = form.getFieldMaybe(n);
    for (const w of f?.acroField.getWidgets() ?? []) {
      const ref = doc.context.getObjectRef(w.dict);
      if (ref) rank.set(ref, i);
    }
  });
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const list = annots.asArray();
    const widgets = list.filter((r): r is PDFRef => r instanceof PDFRef && rank.has(r)).sort((a, b) => rank.get(a)! - rank.get(b)!);
    let k = 0;
    const next = list.map((r) => (r instanceof PDFRef && rank.has(r) ? widgets[k++]! : r));
    next.forEach((r, i) => annots.set(i, r));
    page.node.set(PDFName.of('Tabs'), PDFName.of('R'));
  }
  // The form's own field list follows the same order, so lists of the fields show it too.
  const list = form.acroForm.dict.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (list) {
    const order = new Map(names.map((n, i) => [n, i]));
    const rankOf = (r: unknown) => {
      const f = form.getFields().find((x) => x.acroField.dict === doc.context.lookup(r as PDFRef));
      return f ? (order.get(f.getName()) ?? names.length) : names.length;
    };
    const sorted = list.asArray().map((r, i) => ({ r, i, k: rankOf(r) })).sort((a, b) => a.k - b.k || a.i - b.i);
    sorted.forEach(({ r }, i) => list.set(i, r));
  }
  return save();
}

// --- Form data in and out -------------------------------------------------------------------

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** XFDF, the XML form data format Acrobat and Revu import. */
export function toXfdf(fields: readonly FormField[], file: string): string {
  const rows = fields
    .filter((f) => f.type !== 'button' && f.type !== 'signature')
    .map((f) => {
      const values = f.type === 'list' ? f.value.split('\n').filter(Boolean) : [f.value];
      return `    <field name="${xml(f.name)}">${values.map((v) => `<value>${xml(v)}</value>`).join('')}</field>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">\n  <f href="${xml(file)}"/>\n  <fields>\n${rows.join('\n')}\n  </fields>\n</xfdf>\n`;
}

const unxml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1)));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[k]!;
  });

/** Values from XFDF (nested field names are joined with dots). */
export function fromXfdf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const names: string[] = [];
  const values: string[][] = [];
  let inValue = false;
  let current = '';
  for (const m of text.matchAll(/<(\/?)(?:[\w-]+:)?(field|value)\b([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, close, tag, attrs, selfClosing, textPart] = m;
    if (textPart !== undefined) {
      if (inValue) current += textPart;
      continue;
    }
    if (tag === 'field') {
      if (!close) {
        const name = /name\s*=\s*"([^"]*)"|name\s*=\s*'([^']*)'/.exec(attrs ?? '');
        names.push(unxml(name?.[1] ?? name?.[2] ?? ''));
        values.push([]);
        if (!selfClosing) continue;
      }
      const list = values.pop() ?? [];
      const full = names.join('.');
      names.pop();
      if (list.length) out[full] = list.join('\n');
    } else if (tag === 'value') {
      if (!close && !selfClosing) {
        inValue = true;
        current = '';
      } else {
        if (inValue || selfClosing) values.at(-1)?.push(unxml(current));
        inValue = false;
        current = '';
      }
    }
  }
  return out;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** One header row of field names and one row of values. */
export function toCsv(fields: readonly FormField[]): string {
  const list = fields.filter((f) => f.type !== 'button' && f.type !== 'signature');
  return `${list.map((f) => csvCell(f.name)).join(',')}\r\n${list.map((f) => csvCell(f.value)).join(',')}\r\n`;
}

/** Parses CSV (quotes, commas and newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Values from CSV: the first row names the fields, the second holds the values. */
export function fromCsv(text: string): Record<string, string> {
  const [head, values] = parseCsv(text);
  const out: Record<string, string> = {};
  head?.forEach((name, i) => {
    if (name) out[name] = values?.[i] ?? '';
  });
  return out;
}

