import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFContext } from 'pdf-lib';
import { saveIncremental, snapshot, type Snapshot } from '../incremental';
import { optimizeContent, parseStrokeForm, placements, type OptimizeStats, type StrokeForm } from './content';
import { canRescale, rescalable, rescale, rescaledSize, type Rescalable } from './images';

/**
 * An optimised render copy of a PDF: the same file with heavy pages' content rewritten to draw
 * faster (see content.ts), appended as an incremental update so everything else stays byte for
 * byte. The viewer draws from it; the original stays the document.
 */

/** A page's content with fewer objects than this removed (or clips cut away) is left as it is. */
const MIN_REMOVED = 500;
const MIN_CLIPS = 50;
/** Forms larger than this are content in their own right (a placed drawing), not hatch tiles. */
const TILE_FORM_MAX_BYTES = 64 * 1024;

/** What optimising one page did. */
export interface PagePlan {
  pageIndex: number;
  /** Stroke objects (and form placements) merged, and the path objects that replace them. */
  objectsBefore: number;
  objectsAfter: number;
  /** Hatch-form placements drawn inline. */
  inlined: number;
  /** Clipping paths made cheap: lines cut to them instead, or rewritten as the rectangles they are. */
  clips: number;
  /** Pictures sharper than the page shows them, and their pixels before and after rescaling. */
  images: number;
  imagePixelsBefore: number;
  imagePixelsAfter: number;
  /** The rewrite is worth using. */
  worthwhile: boolean;
}

/** A page's (or a placed form's) content rewritten, or a picture of the page rescaled (by object). */
type Rewrite = { target: { page: number } | { form: PDFRef }; bytes: Uint8Array } | { image: string };

const N = (s: string) => PDFName.of(s);

/** Decodes a stream: native inflate for plain Flate (fast), pdf-lib for anything else. */
async function decode(stream: PDFRawStream): Promise<Uint8Array> {
  const filter = stream.dict.lookup(N('Filter'));
  const name = filter instanceof PDFArray && filter.size() === 1 ? filter.lookup(0) : filter;
  if (name === N('FlateDecode') && !stream.dict.has(N('DecodeParms'))) {
    try {
      const out = new Blob([stream.contents as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(out).arrayBuffer());
    } catch {
      // A damaged stream: pdf-lib's inflate reads as much as it can, as PDFium does.
    }
  }
  return decodePDFRawStream(stream).decode();
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function flateStream(context: PDFContext, bytes: Uint8Array, dict?: PDFDict): PDFRawStream {
  const d = dict ? (dict.clone(context) as PDFDict) : context.obj({});
  d.delete(N('DecodeParms'));
  d.set(N('Filter'), N('FlateDecode'));
  d.set(N('Length'), PDFNumber.of(bytes.length));
  return PDFRawStream.of(d, bytes);
}

function numbers(arr: unknown): number[] | null {
  if (!(arr instanceof PDFArray)) return null;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i);
    if (!(v instanceof PDFNumber)) return null;
    out.push(v.asNumber());
  }
  return out;
}

export class RenderCopyBuilder {
  /** Stroke-only forms by object, decoded once (null: not one). */
  private forms = new Map<string, StrokeForm | null>();
  private plans = new Map<number, { plan: PagePlan; rewrites: Rewrite[] }>();
  private bigFormsPlanned = new Set<string>();
  /** Pages whose rewrites are in the document, and whether there are any. */
  private applied = new Set<number>();
  private changed = false;
  /** Pictures to rescale, by object: the size wanted, and the size written so far. */
  private images = new Map<string, { ref: PDFRef; img: Rescalable; size: { width: number; height: number }; applied: { width: number; height: number } | null }>();

  private constructor(
    private readonly original: Uint8Array,
    private readonly doc: PDFDocument,
    private readonly snap: Snapshot,
  ) {}

  /** Throws for encrypted files: their streams cannot be rewritten without the key. */
  static async load(bytes: Uint8Array): Promise<RenderCopyBuilder> {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    if (doc.isEncrypted) throw new Error('Encrypted PDFs are drawn as they are');
    return new RenderCopyBuilder(bytes, doc, snapshot(doc, bytes));
  }

  get pageCount() {
    return this.doc.getPageCount();
  }

  /** The stroke-only forms a resources dictionary's XObjects hold, by name. */
  private async strokeForms(resources: PDFDict | undefined): Promise<Map<string, StrokeForm>> {
    const out = new Map<string, StrokeForm>();
    const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict);
    if (!xobjects) return out;
    for (const [name, ref] of xobjects.entries()) {
      if (!(ref instanceof PDFRef)) continue;
      const key = ref.toString();
      if (!this.forms.has(key)) this.forms.set(key, await this.strokeForm(ref));
      const f = this.forms.get(key);
      if (f) out.set(name.decodeText(), f);
    }
    return out;
  }

  private async strokeForm(ref: PDFRef): Promise<StrokeForm | null> {
    const s = this.doc.context.lookup(ref);
    if (!(s instanceof PDFRawStream) || s.contents.length > TILE_FORM_MAX_BYTES) return null;
    const d = s.dict;
    if (d.lookup(N('Subtype')) !== N('Form')) return null;
    // A transparency group, optional content or a reference form changes how it draws.
    if (d.has(N('Group')) || d.has(N('OC')) || d.has(N('Ref')) || d.has(N('OPI'))) return null;
    const m = d.has(N('Matrix')) ? numbers(d.lookup(N('Matrix'))) : [1, 0, 0, 1, 0, 0];
    if (!m || m.join() !== '1,0,0,1,0,0') return null;
    const bbox = numbers(d.lookup(N('BBox')));
    if (!bbox || bbox.length !== 4) return null;
    try {
      return parseStrokeForm(await decode(s), [Math.min(bbox[0]!, bbox[2]!), Math.min(bbox[1]!, bbox[3]!), Math.max(bbox[0]!, bbox[2]!), Math.max(bbox[1]!, bbox[3]!)]);
    } catch {
      return null;
    }
  }

  /** Big forms placed on the page (a drawing placed as a form): content worth optimising too. */
  private bigForms(resources: PDFDict | undefined): [PDFRef, PDFRawStream][] {
    const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict);
    const out: [PDFRef, PDFRawStream][] = [];
    for (const ref of xobjects?.values() ?? []) {
      if (!(ref instanceof PDFRef)) continue;
      const s = this.doc.context.lookup(ref);
      if (s instanceof PDFRawStream && s.contents.length > TILE_FORM_MAX_BYTES && s.dict.lookup(N('Subtype')) === N('Form')) out.push([ref, s]);
    }
    return out;
  }

  /** Works out (and keeps) a page's rewrite; nothing in the file changes yet. */
  async plan(pageIndex: number): Promise<PagePlan> {
    const cached = this.plans.get(pageIndex);
    if (cached) return cached.plan;
    const page = this.doc.getPage(pageIndex);
    const resources = page.node.Resources();
    const forms = await this.strokeForms(resources);
    const plan: PagePlan = { pageIndex, objectsBefore: 0, objectsAfter: 0, inlined: 0, clips: 0, images: 0, imagePixelsBefore: 0, imagePixelsAfter: 0, worthwhile: false };
    const rewrites: Rewrite[] = [];
    const tally = (stats: OptimizeStats) => {
      plan.objectsBefore += stats.merged;
      plan.objectsAfter += stats.written;
      plan.inlined += stats.inlined;
      plan.clips += stats.clips + stats.rects;
      return stats.merged - stats.written >= MIN_REMOVED || stats.clips + stats.rects >= MIN_CLIPS;
    };

    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => this.doc.context.lookup(r)) : [contents];
    if (streams.length && streams.every((s) => s instanceof PDFRawStream)) {
      const parts = await Promise.all((streams as PDFRawStream[]).map(decode));
      // Streams are split only between tokens; a newline keeps the last of one apart from the next.
      const data = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
      let at = 0;
      for (const p of parts) {
        data.set(p, at);
        data[at + p.length] = 10;
        at += p.length + 1;
      }
      const res = optimizeContent(data, { form: (name) => forms.get(name) ?? null });
      if (tally(res.stats)) rewrites.push({ target: { page: pageIndex }, bytes: res.bytes });
      // Pictures sharper than the page shows them.
      if (canRescale()) {
        const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict);
        for (const [name, size] of placements(data)) {
          const ref = xobjects?.get(N(name));
          if (!(ref instanceof PDFRef)) continue;
          const img = rescalable(this.doc.context.lookup(ref));
          const to = img && rescaledSize(img, size);
          if (!img || !to) continue;
          // Placed larger elsewhere: the larger need wins.
          const key = ref.toString();
          const was = this.images.get(key);
          if (!was || to.width > was.size.width) this.images.set(key, { ref, img, size: to, applied: was?.applied ?? null });
          plan.images++;
          plan.imagePixelsBefore += img.width * img.height;
          plan.imagePixelsAfter += to.width * to.height;
          rewrites.push({ image: key });
        }
      }
    }
    for (const [ref, s] of this.bigForms(resources)) {
      // A form placed on several pages is planned (and counted) on the first.
      const key = ref.toString();
      if (this.bigFormsPlanned.has(key)) continue;
      this.bigFormsPlanned.add(key);
      const own = await this.strokeForms(s.dict.lookupMaybe(N('Resources'), PDFDict) ?? resources);
      const res = optimizeContent(await decode(s), { form: (name) => own.get(name) ?? null });
      if (tally(res.stats)) rewrites.push({ target: { form: ref }, bytes: res.bytes });
    }
    plan.worthwhile = rewrites.length > 0;
    this.plans.set(pageIndex, { plan, rewrites });
    return plan;
  }

  /**
   * The render copy with `pages` (all when null) optimised, plus any optimised by earlier builds:
   * their worthwhile rewrites appended to the original. Null when no page has gained anything.
   * Build the pages someone is looking at first, then the rest: each build adds to the last.
   */
  async build(pages: number[] | null, onPage?: (plan: PagePlan, done: number, total: number) => void, signal?: AbortSignal): Promise<{ bytes: Uint8Array | null; pages: PagePlan[] }> {
    const list = pages ?? Array.from({ length: this.pageCount }, (_, i) => i);
    const plans: PagePlan[] = [];
    for (const [k, i] of list.entries()) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const plan = await this.plan(i);
      plans.push(plan);
      onPage?.(plan, k + 1, list.length);
    }
    const ctx = this.doc.context;
    for (const i of list) {
      for (const r of this.plans.get(i)!.rewrites) {
        if ('image' in r) {
          // Rescaled again if a page planned since needs it larger.
          const job = this.images.get(r.image)!;
          if (job.applied && job.applied.width >= job.size.width) continue;
          ctx.assign(job.ref, await rescale(job.ref, job.img, job.size, ctx));
          job.applied = job.size;
          this.changed = true;
          continue;
        }
        if (this.applied.has(i)) continue;
        const bytes = await deflate(r.bytes);
        if ('page' in r.target) {
          this.doc.getPage(r.target.page).node.set(N('Contents'), ctx.register(flateStream(ctx, bytes)));
        } else {
          const old = ctx.lookup(r.target.form) as PDFStream;
          ctx.assign(r.target.form, flateStream(ctx, bytes, old.dict));
        }
        this.changed = true;
      }
      this.applied.add(i);
    }
    if (!this.changed) return { bytes: null, pages: plans };
    return { bytes: await saveIncremental(this.original, this.doc, this.snap), pages: plans };
  }
}
