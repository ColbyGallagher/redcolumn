import { CadReadError, readDxf } from './dxf';
import type { Drawing } from './drawing';
import { writePdf, type CadFonts } from './pdf';
import type { FontKey } from './render';
import { planSheets, type SheetOptions } from './sheets';

/**
 * DWG/DXF to vector PDF, entirely in memory: read the drawing, plan a page per layout, write the
 * PDF. Pure (no DOM): runs in a worker or under node.
 */

export { CadReadError } from './dxf';

export type CadWarning =
  | { kind: 'missing-xref'; name: string; path: string }
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
  warnings: CadWarning[];
}

export interface ConvertOptions extends Partial<SheetOptions> {
  fonts: CadFonts;
}

export const CAD_EXTENSIONS = ['.dwg', '.dxf'];

export function isCadFile(file: { name: string }): boolean {
  return /\.(dwg|dxf)$/i.test(file.name);
}

/** Reads a drawing (DXF now; DWG in a later phase). */
export function readDrawing(name: string, bytes: Uint8Array): { drawing: Drawing; format: 'dxf' | 'dwg' } {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 6));
  if (/^AC\d{4}$/.test(head)) throw new CadReadError('DWG files cannot be converted yet. Save the drawing as DXF to open it now.');
  if (!/\.dxf$/i.test(name) && !/^\s*0\s*\r?\n\s*SECTION/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 64)))) throw new CadReadError('This is not a DXF or DWG file.');
  return { drawing: readDxf(bytes), format: 'dxf' };
}

export async function convertCad(name: string, bytes: Uint8Array, opts: ConvertOptions): Promise<{ pdf: Uint8Array; report: ConversionReport }> {
  const { drawing, format } = readDrawing(name, bytes);
  const { sheets, stats, notes } = planSheets(drawing, { colorMode: opts.colorMode ?? 'color', lineweights: opts.lineweights ?? true, layouts: opts.layouts, includeModel: opts.includeModel });
  if (!sheets.length) throw new CadReadError('This drawing has no layouts to convert.');
  const title = name.replace(/\.[^.]+$/, '');
  const pdf = await writePdf(sheets, opts.fonts, { title, source: name });

  const warnings: CadWarning[] = [];
  for (const [blockName, path] of stats.xrefs) warnings.push({ kind: 'missing-xref', name: blockName, path });
  for (const path of stats.images) warnings.push({ kind: 'missing-image', path });
  for (const [font, sub] of stats.fonts) warnings.push({ kind: 'font-substituted', font, with: sub });
  for (const [type, count] of stats.skipped) warnings.push({ kind: 'unsupported', type, count });
  for (const n of notes) warnings.push(n);
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
      warnings,
    },
  };
}
