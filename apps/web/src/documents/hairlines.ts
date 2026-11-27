import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFContext, type PDFDocument, type PDFPage } from 'pdf-lib';
import { Scanner } from './renderCopy/content';
import { decode, deflate, flateStream } from './renderCopy/renderCopy';

/**
 * Disable Line Weights on paper: page content rewritten so every line is the thinnest the printer
 * draws (width 0) and solid. For a copy about to be printed; annotations (markups) keep theirs.
 * The screen does the same in the render worker (pdf-core's thinPage).
 */

const N = (s: string) => PDFName.of(s);

/** Content with every line width set to 0 and every dash pattern to solid. */
export function hairlineContent(data: Uint8Array): Uint8Array {
  const sc = new Scanner(data);
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let kept = 0;
  while (sc.next()) {
    const to = sc.op === 'w' ? '0 w' : sc.op === 'd' ? '[] 0 d' : null;
    if (to === null) continue;
    parts.push(data.subarray(kept, sc.start), encoder.encode(to));
    kept = sc.end;
  }
  parts.push(data.subarray(kept));
  return join(parts);
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Graphics-state dictionaries can set a width or dashes too (`gs`). */
function hairlineStates(context: PDFContext, resources: PDFDict) {
  const states = resources.lookupMaybe(N('ExtGState'), PDFDict);
  for (const ref of states?.values() ?? []) {
    const state = context.lookup(ref);
    if (!(state instanceof PDFDict)) continue;
    if (state.has(N('LW'))) state.set(N('LW'), PDFNumber.of(0));
    if (state.has(N('D'))) state.set(N('D'), context.obj([[], 0]));
  }
}

/** The graphics states and forms (nested ones too) a resources dictionary names; each form once. */
async function hairlineResources(context: PDFContext, resources: PDFDict | undefined, done: Set<PDFRef>) {
  if (!resources) return;
  hairlineStates(context, resources);
  const xobjects = resources.lookupMaybe(N('XObject'), PDFDict);
  for (const ref of xobjects?.values() ?? []) {
    if (!(ref instanceof PDFRef) || done.has(ref)) continue;
    done.add(ref);
    const form = context.lookup(ref);
    if (!(form instanceof PDFRawStream) || form.dict.lookup(N('Subtype')) !== N('Form')) continue;
    context.assign(ref, flateStream(context, await deflate(hairlineContent(await decode(form))), form.dict));
    await hairlineResources(context, form.dict.lookupMaybe(N('Resources'), PDFDict), done);
  }
}

/** Rewrites the content of `pages` of `doc` as hairlines. */
export async function hairlinePages(doc: PDFDocument, pages: readonly PDFPage[]): Promise<void> {
  const context = doc.context;
  const done = new Set<PDFRef>();
  // A line drawn before any width is set would take the default, 1 point.
  const preamble = new TextEncoder().encode('0 w\n');
  const newline = new Uint8Array([10]);
  for (const page of pages) {
    await hairlineResources(context, page.node.Resources(), done);
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => context.lookup(r)) : [contents];
    if (!streams.every((s) => s instanceof PDFRawStream)) continue;
    // Rewritten as one stream: operands can be split from their operator across streams.
    const parts: Uint8Array[] = [];
    for (const s of streams as PDFRawStream[]) parts.push(await decode(s), newline);
    const bytes = join([preamble, hairlineContent(join(parts))]);
    page.node.set(N('Contents'), context.register(flateStream(context, await deflate(bytes))));
  }
}
