import { CadReadError, readDxf } from './dxf';
import { readDwg } from './dwg';
import type { Drawing } from './drawing';
import { writePdf, type CadFonts } from './pdf';
import { imageKey, referenceKey, type FontKey } from './render';
import { paperLayouts, planSheets, type SheetOptions } from './sheets';

/**
 * DWG/DXF to vector PDF, entirely in memory: read the drawing, plan a page per layout, write the
 * PDF. Pure (no DOM): runs in a worker or under node.
 */

export { CadReadError } from './dxf';

export type CadWarning =
  | { kind: 'missing-xref'; name: string; path: string }
  | { kind: 'reference-unreadable'; file: string; message: string }
  | { kind: 'missing-image'; path: string }
  | { kind: 'font-substituted'; font: string; with: FontKey }
  | { kind: 'unsupported'; type: string; count: number }
  | { kind: 'units-assumed'; unit: string }
  | { kind: 'nonstandard-scale'; sheet: string; viewport: string; label: string }
  | { kind: 'non-plan-view'; sheet: string; viewport: string }
  | { kind: 'scale-check'; sheet: string; viewport: string; measured: number; stated: number };

export interface ConversionReport {
  format: 'dxf' | 'dwg';
  version: string;
  pages: {
    name: string;
    widthPt: number;
    heightPt: number;
    scale: string | null;
    viewports: { name: string; scale: string; ratio: number; twistDeg: number; frozen: string[] }[];
  }[];
  layers: string[];
  /** Every paper-space layout in the drawing, converted or not (for choosing them again). */
  layouts: string[];
  /** Reference drawings that were supplied and drawn. */
  references: string[];
  warnings: CadWarning[];
}

export interface CadFile {
  name: string;
  bytes: Uint8Array;
}

export interface ConvertOptions extends Partial<Omit<SheetOptions, 'references'>> {
  fonts: CadFonts;
  /** Drawings for external references, matched to them by file name. */
  references?: readonly CadFile[];
}

export { CAD_EXTENSIONS, isCadFile } from './files';

/** Reads a drawing: DWG (R2000–R2018) or ASCII DXF, told apart by content. */
export function readDrawing(name: string, bytes: Uint8Array): { drawing: Drawing; format: 'dxf' | 'dwg'; unreadable: number } {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 6));
  if (/^AC\d{4}$/.test(head)) {
    const { drawing, failed } = readDwg(bytes);
    return { drawing, format: 'dwg', unreadable: [...failed.values()].reduce((a, b) => a + b, 0) };
  }
  if (!/\.dxf$/i.test(name) && !/^\s*0\s*\r?\n\s*SECTION/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 64)))) throw new CadReadError('This is not a DXF or DWG file.');
  return { drawing: readDxf(bytes), format: 'dxf', unreadable: 0 };
}

export async function convertCad(name: string, bytes: Uint8Array, opts: ConvertOptions): Promise<{ pdf: Uint8Array; report: ConversionReport }> {
  const { drawing, format, unreadable } = readDrawing(name, bytes);
  const warnings: CadWarning[] = [];
  const references = new Map<string, Drawing>();
  // Supplied files: drawings for external references, PNG/JPEG pictures for images.
  const images = new Map<string, { name: string; bytes: Uint8Array; format: 'png' | 'jpg' }>();
  for (const ref of opts.references ?? []) {
    if (/\.(png|jpe?g)$/i.test(ref.name)) {
      images.set(imageKey(ref.name), { name: ref.name, bytes: ref.bytes, format: /\.png$/i.test(ref.name) ? 'png' : 'jpg' });
      continue;
    }
    try {
      references.set(referenceKey(ref.name), readDrawing(ref.name, ref.bytes).drawing);
    } catch (err) {
      warnings.push({ kind: 'reference-unreadable', file: ref.name, message: err instanceof Error ? err.message : String(err) });
    }
  }
  const { sheets, stats, notes } = planSheets(drawing, { colorMode: opts.colorMode ?? 'auto', lineweights: opts.lineweights ?? true, layouts: opts.layouts, includeModel: opts.includeModel, references, images });
  if (!sheets.length) throw new CadReadError('This drawing has no layouts to convert.');
  const title = name.replace(/\.[^.]+$/, '');
  const pdf = await writePdf(sheets, opts.fonts, { title, source: name });

  for (const [blockName, path] of stats.xrefs) warnings.push({ kind: 'missing-xref', name: blockName, path });
  for (const path of stats.images) warnings.push({ kind: 'missing-image', path });
  for (const [font, sub] of stats.fonts) warnings.push({ kind: 'font-substituted', font, with: sub });
  for (const [type, count] of stats.skipped) warnings.push({ kind: 'unsupported', type, count });
  for (const n of notes) warnings.push(n);
  if (unreadable) warnings.push({ kind: 'unsupported', type: 'objects that could not be read', count: unreadable });
  for (const s of sheets) {
    for (const v of s.viewports) {
      if (!v.scale.standard) warnings.push({ kind: 'nonstandard-scale', sheet: s.name, viewport: v.name, label: v.scale.label });
      if (!v.planView) warnings.push({ kind: 'non-plan-view', sheet: s.name, viewport: v.name });
    }
    for (const c of s.scaleChecks) if (c.stated && Math.abs(c.measured / c.stated - 1) > 0.01) warnings.push({ kind: 'scale-check', sheet: c.sheet, viewport: c.viewport, measured: c.measured, stated: c.stated });
  }
  const layers = new Set<string>();
  const walk = (prims: (typeof sheets)[number]['prims']) => {
    for (const p of prims) {
      if (p.k === 'clip') walk(p.prims);
      else layers.add(p.layer);
    }
  };
  for (const s of sheets) walk(s.prims);
  return {
    pdf,
    report: {
      format,
      version: drawing.version,
      pages: sheets.map((s) => ({
        name: s.name,
        widthPt: s.width,
        heightPt: s.height,
        scale: s.pageScale?.label ?? null,
        viewports: s.viewports.map((v) => ({ name: v.name, scale: v.scale.label, ratio: v.scale.ratio, twistDeg: v.twistDeg, frozen: v.frozen })),
      })),
      layers: [...layers],
      layouts: paperLayouts(drawing).map((l) => l.layout.name),
      references: (opts.references ?? []).map((r) => r.name).filter((n) => references.has(referenceKey(n)) || images.has(imageKey(n))),
      warnings,
    },
  };
}
