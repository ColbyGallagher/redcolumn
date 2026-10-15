import { PAGE_SIZES } from './pageSizes';

/**
 * The built-in templates File › New PDF offers: drawing sheets with a border, zone references and
 * a fillable title block, and grid paper. Kept apart from the builder (pdfTemplates.ts) so listing
 * them does not load pdf-lib.
 */

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  /** Page size in points as the template is laid out (landscape sheets are wider than tall). */
  width: number;
  height: number;
}

const size = (id: string, landscape: boolean) => {
  const p = PAGE_SIZES.find((s) => s.id === id)!;
  return landscape ? { width: p.height, height: p.width } : { width: p.width, height: p.height };
};

export type TemplateKind = { kind: 'sheet'; sheet: string } | { kind: 'grid'; step: number };
export const TEMPLATE_DEFS: (BuiltinTemplate & TemplateKind)[] = [
  { id: 'sheet-a3-landscape', name: 'A3 Landscape Drawing Sheet', description: 'Border, zone references, revision table and a fillable title block.', ...size('a3', true), kind: 'sheet', sheet: 'A3' },
  { id: 'sheet-a4-portrait', name: 'A4 Portrait Drawing Sheet', description: 'Border, revision table and a fillable title block across the foot of the page.', ...size('a4', false), kind: 'sheet', sheet: 'A4' },
  { id: 'sheet-a2-landscape', name: 'A2 Landscape Drawing Sheet', description: 'Border, zone references, revision table and a fillable title block.', ...size('a2', true), kind: 'sheet', sheet: 'A2' },
  { id: 'sheet-a1-landscape', name: 'A1 Landscape Drawing Sheet', description: 'Border, zone references, revision table and a fillable title block.', ...size('a1', true), kind: 'sheet', sheet: 'A1' },
  { id: 'sheet-a0-landscape', name: 'A0 Landscape Drawing Sheet', description: 'Border, zone references, revision table and a fillable title block.', ...size('a0', true), kind: 'sheet', sheet: 'A0' },
  { id: 'sheet-ansi-b-landscape', name: 'ANSI B (11 × 17) Landscape Drawing Sheet', description: 'Border, zone references, revision table and a fillable title block.', ...size('tabloid', true), kind: 'sheet', sheet: 'ANSI B' },
  { id: 'sheet-ansi-d-landscape', name: 'ANSI D (22 × 34) Landscape Drawing Sheet', description: 'Border, zone references, revision table and a fillable title block.', ...size('ansi-d', true), kind: 'sheet', sheet: 'ANSI D' },
  { id: 'sheet-arch-d-landscape', name: 'ARCH D (24 × 36) Landscape Drawing Sheet', description: 'Border, zone references, revision table and a fillable title block.', ...size('arch-d', true), kind: 'sheet', sheet: 'ARCH D' },
  { id: 'grid-a4-5mm', name: 'A4 Grid Paper (5 mm)', description: '5 mm squares with a heavier line every 10 mm, for sketches and calculations.', ...size('a4', false), kind: 'grid', step: 5 },
  { id: 'grid-a3-landscape-5mm', name: 'A3 Landscape Grid Paper (5 mm)', description: '5 mm squares with a heavier line every 10 mm, for sketches.', ...size('a3', true), kind: 'grid', step: 5 },
];

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = TEMPLATE_DEFS.map(({ id, name, description, width, height }) => ({ id, name, description, width, height }));
