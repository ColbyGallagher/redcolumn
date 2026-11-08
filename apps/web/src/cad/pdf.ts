import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, type PDFFont, type PDFObject, type PDFRef } from 'pdf-lib';
import type { Cmd } from './geom';
import type { FontKey, Prim, TextPrim } from './render';
import type { MeasureScale, Sheet } from './sheets';

/** Font files for the three families text is drawn in (TrueType bytes). */
export type CadFonts = Record<FontKey, Uint8Array>;

export interface PdfMeta {
  title: string;
  /** The file it was converted from. */
  source: string;
}

const fmt = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function pathOps(d: readonly Cmd[], out: string[]) {
  for (const c of d) {
    switch (c[0]) {
      case 'M':
        out.push(`${fmt(c[1])} ${fmt(c[2])} m`);
        break;
      case 'L':
        out.push(`${fmt(c[1])} ${fmt(c[2])} l`);
        break;
      case 'C':
        out.push(`${fmt(c[1])} ${fmt(c[2])} ${fmt(c[3])} ${fmt(c[4])} ${fmt(c[5])} ${fmt(c[6])} c`);
        break;
      case 'Z':
        out.push('h');
    }
  }
}

const rgbOp = (rgb: readonly number[], op: 'RG' | 'rg') => `${rgb.map(fmt).join(' ')} ${op}`;

/** A /Measure dictionary (rectilinear) in the form the viewer reads back as a scale. */
function measureDict(doc: PDFDocument, s: MeasureScale) {
  const nf = (u: string, c: number, d: number) => ({ Type: 'NumberFormat', U: PDFString.of(u), C: c, D: d });
  const x = s.feetInches ? [nf('ft', s.unitsPerPoint, 1), nf('in', 12, 16)] : [nf(s.unit, s.unitsPerPoint, 100)];
  return doc.context.obj({
    Type: 'Measure',
    Subtype: 'RL',
    R: PDFHexString.fromText(s.label),
    X: x,
    D: [nf(s.unit, 1, 100)],
    A: [nf(`sq ${s.unit}`, 1, 100)],
  });
}

interface FontInfo {
  font: PDFFont;
  name: string;
  /** Cap height as a fraction of the em. */
  cap: number;
}

export async function writePdf(sheets: readonly Sheet[], fonts: CadFonts, meta: PdfMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(meta.title);
  doc.setSubject(`Converted from ${meta.source}`);
  doc.setProducer('redcolumn');
  doc.setCreator('redcolumn CAD import');
  doc.setKeywords([`source: ${meta.source}`]);

  // One optional-content group (PDF layer) per CAD layer drawn, in first-use order.
  const layerNames: string[] = [];
  const seen = new Set<string>();
  const walk = (prims: readonly Prim[]) => {
    for (const p of prims) {
      if (p.k === 'clip') walk(p.prims);
      else if (!seen.has(p.layer)) seen.add(p.layer), layerNames.push(p.layer);
    }
  };
  for (const s of sheets) walk(s.prims);
  const ocgs = new Map<string, PDFRef>();
  for (const name of layerNames) ocgs.set(name, doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFHexString.fromText(name) })));
  if (ocgs.size) {
    const refs = [...ocgs.values()];
    doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: refs, D: { Name: PDFString.of('Layers'), Order: refs, BaseState: 'ON' } }));
  }
  const ocgTag = new Map(layerNames.map((n, i) => [n, `L${i}`]));

  const fontInfo = new Map<FontKey, FontInfo>();
  const fontFor = async (key: FontKey): Promise<FontInfo> => {
    let f = fontInfo.get(key);
    if (!f) {
      const font = await doc.embedFont(fonts[key], { subset: true });
      // Text height in CAD is the capital height: size the em from the font's own cap height.
      const kit = (font as unknown as { embedder?: { font?: { capHeight?: number; unitsPerEm?: number } } }).embedder?.font;
      const cap = kit?.capHeight && kit.unitsPerEm ? kit.capHeight / kit.unitsPerEm : 0.7;
      f = { font, name: `F${fontInfo.size}`, cap };
      fontInfo.set(key, f);
    }
    return f;
  };

  // Pictures, embedded once per file and drawn wherever they are used.
  const images = new Map<string, { ref: PDFRef; name: string } | null>();
  const imageFor = async (p: Extract<Prim, { k: 'image' }>) => {
    if (!images.has(p.name)) {
      try {
        const img = p.format === 'png' ? await doc.embedPng(p.bytes) : await doc.embedJpg(p.bytes);
        images.set(p.name, { ref: img.ref, name: `Im${images.size}` });
      } catch {
        images.set(p.name, null);
      }
    }
    return images.get(p.name) ?? null;
  };

  const labels: PDFObject[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]!;
    const page = doc.addPage([sheet.width, sheet.height]);
    const ops: string[] = [];
    const used = new Set<string>();
    const usedFonts = new Set<FontInfo>();
    const usedImages = new Map<string, PDFRef>();
    let open: string | null = null;
    const setLayer = (layer: string | null) => {
      if (layer === open) return;
      if (open !== null) ops.push('EMC');
      open = layer;
      if (layer !== null) {
        const tag = ocgTag.get(layer)!;
        used.add(layer);
        ops.push(`/OC /${tag} BDC`);
      }
    };
    const draw = async (prims: readonly Prim[]) => {
      for (const p of prims) {
        if (p.k === 'clip') {
          setLayer(null);
          ops.push('q');
          pathOps(p.clip, ops);
          ops.push('W n');
          await draw(p.prims);
          setLayer(null);
          ops.push('Q');
          continue;
        }
        setLayer(p.layer);
        if (p.k === 'stroke') {
          if (!p.d.length) continue;
          ops.push(rgbOp(p.rgb, 'RG'), `${fmt(p.width)} w`, p.dash ? `[${p.dash.map(fmt).join(' ')}] 0 d` : '[] 0 d');
          pathOps(p.d, ops);
          ops.push('S');
        } else if (p.k === 'fill') {
          ops.push(rgbOp(p.rgb, 'rg'));
          pathOps(p.d, ops);
          ops.push('f*');
        } else if (p.k === 'image') {
          const img = await imageFor(p);
          if (!img) continue;
          usedImages.set(img.name, img.ref);
          // The unit square of the image onto its parallelogram on the page.
          ops.push('q', `${fmt6(p.u[0])} ${fmt6(p.u[1])} ${fmt6(p.v[0])} ${fmt6(p.v[1])} ${fmt(p.origin[0])} ${fmt(p.origin[1])} cm`, `/${img.name} Do`, 'Q');
        } else if (p.k === 'hatch') {
          ops.push('q');
          pathOps(p.clip, ops);
          ops.push('W* n', rgbOp(p.rgb, 'RG'), `${fmt(p.width)} w`, '[] 0 d');
          pathOps(p.lines, ops);
          ops.push('S', 'Q');
        } else {
          const f = await fontFor(p.font);
          usedFonts.add(f);
          textOps(p, f, ops);
        }
      }
    };
    ops.push('1 J 1 j');
    await draw(sheet.prims);
    setLayer(null);

    const content = doc.context.flateStream(ops.join('\n'));
    page.node.set(PDFName.of('Contents'), doc.context.register(content));
    const resources = page.node.normalizedEntries().Resources;
    if (used.size) {
      const props: Record<string, PDFRef> = {};
      for (const l of used) props[ocgTag.get(l)!] = ocgs.get(l)!;
      resources.set(PDFName.of('Properties'), doc.context.obj(props));
    }
    if (usedImages.size) resources.set(PDFName.of('XObject'), doc.context.obj(Object.fromEntries(usedImages)));
    if (usedFonts.size) {
      const fontDict: Record<string, PDFRef> = {};
      for (const f of usedFonts) fontDict[f.name] = f.font.ref;
      resources.set(PDFName.of('Font'), doc.context.obj(fontDict));
    }

    // Scales: a page-wide viewport for a model page, and one per drawing viewport.
    const vps: PDFObject[] = [];
    if (sheet.pageScale) vps.push(doc.context.obj({ Type: 'Viewport', BBox: [0, 0, sheet.width, sheet.height], Name: PDFHexString.fromText(sheet.name), Measure: measureDict(doc, sheet.pageScale) }));
    for (const v of sheet.viewports) vps.push(doc.context.obj({ Type: 'Viewport', BBox: [v.rect.x, v.rect.y, v.rect.x + v.rect.w, v.rect.y + v.rect.h], Name: PDFHexString.fromText(v.name), Measure: measureDict(doc, v.scale) }));
    if (vps.length) page.node.set(PDFName.of('VP'), doc.context.obj(vps));

    labels.push(PDFNumber.of(i), doc.context.obj({ P: PDFHexString.fromText(sheet.name) }));
  }
  if (sheets.length) doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: labels }));
  return doc.save({ useObjectStreams: true });
}

/** Lines of a text primitive, wrapped where it has a wrap width. */
function textLines(p: TextPrim, f: FontInfo, em: number, wf: number): string[] {
  if (!p.wrap) return p.lines;
  const max = p.wrap / (em * wf);
  const out: string[] = [];
  for (const para of p.lines) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line.trim() && f.font.widthOfTextAtSize(next.trimEnd(), 1) > max) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

function textOps(p: TextPrim, f: FontInfo, ops: string[]) {
  let em = p.h / f.cap;
  let wf = p.widthFactor;
  const lines = textLines(p, f, em, wf);
  const widths = lines.map((l) => f.font.widthOfTextAtSize(l, 1));
  if (p.fit && widths[0]) {
    const k = p.fit / (widths[0] * em * wf);
    if (p.fitHeight) em *= k;
    else wf *= k;
  }
  const h = em * f.cap;
  const spacing = p.fitHeight && p.fit ? p.spacing * (h / p.h) : p.spacing;
  const n = lines.length;
  // Baseline of the first line, relative to the insertion point (drawing units).
  let y0: number;
  if (p.block) y0 = p.valign === 3 ? -h : p.valign === 2 ? (n - 1) * spacing / 2 - h / 2 : (n - 1) * spacing;
  else y0 = p.valign === 3 ? -h : p.valign === 2 ? -h / 2 : p.valign === 1 ? h / 3 : 0;
  const t = Math.tan(p.oblique);
  ops.push('BT', `/${f.name} 1 Tf`, rgbOp(p.rgb, 'rg'));
  lines.forEach((line, i) => {
    if (!line) return;
    const w = widths[i]! * em * wf;
    const dx = p.halign === 1 ? -w / 2 : p.halign === 2 ? -w : 0;
    const dy = y0 - i * spacing;
    const a = p.u[0] * em * wf;
    const b = p.u[1] * em * wf;
    const c = p.v[0] * em + p.u[0] * em * t;
    const d = p.v[1] * em + p.u[1] * em * t;
    const e = p.origin[0] + p.u[0] * dx + p.v[0] * dy;
    const ff = p.origin[1] + p.u[1] * dx + p.v[1] * dy;
    ops.push(`${fmt6(a)} ${fmt6(b)} ${fmt6(c)} ${fmt6(d)} ${fmt(e)} ${fmt(ff)} Tm`, `${f.font.encodeText(line).toString()} Tj`);
  });
  ops.push('ET');
}

/** Text matrix terms are small (an em can be a fraction of a point): keep more digits. */
const fmt6 = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};
