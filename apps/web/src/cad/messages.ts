import type { CadWarning, ConversionReport } from './convert';

/** The conversion report in plain words, for the bar shown over a converted drawing. */

const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : (many ?? (/(s|sh|ch|x)$/.test(one) ? `${one}es` : `${one}s`))}`;

const FONT_NAMES = { sans: 'Liberation Sans', serif: 'Liberation Serif', mono: 'Liberation Mono' } as const;

export function warningText(w: CadWarning): string {
  switch (w.kind) {
    case 'missing-xref':
      return `Reference ${w.path || w.name} was not found, so it is not drawn. Add it with Convert Again.`;
    case 'reference-unreadable':
      return `${w.file} could not be read as a reference: ${w.message}`;
    case 'missing-image':
      return `Picture ${w.path} is not drawn; a frame shows where it goes.`;
    case 'font-substituted':
      return `Font ${w.font} is drawn in ${FONT_NAMES[w.with]}, so text may run a little longer or shorter.`;
    case 'unsupported':
      if (w.type === 'objects that could not be read') return `${plural(w.count, 'object')} could not be read and are left out.`;
      return `${plural(w.count, ...entityWord(w.type))} not drawn (${describe(w.type)}).`;
    case 'units-assumed':
      return `The drawing does not say its units; they are taken as ${w.unit}. Check a known length before measuring.`;
    case 'nonstandard-scale':
      return `${w.sheet}, ${w.viewport} is at ${w.label}, not a standard scale. Check a known length before measuring.`;
    case 'non-plan-view':
      return `${w.sheet}, ${w.viewport} is a 3D view, drawn flat from above.`;
    case 'scale-check':
      return `${w.sheet}, ${w.viewport}: a dimension stating ${round(w.stated)} measures ${round(w.measured)} at the viewport's scale. Check the scale before measuring.`;
  }
}

/** CAD entity type names in words. */
const WORDS: Record<string, [string, string?]> = {
  INSERT: ['block reference'],
  MULTILEADER: ['multileader'],
  MLEADER: ['multileader'],
  WIPEOUT: ['wipeout'],
  ACAD_TABLE: ['table'],
  '3DSOLID': ['3D solid'],
  REGION: ['region'],
  BODY: ['3D body', '3D bodies'],
  SURFACE: ['surface'],
  MESH: ['mesh', 'meshes'],
  'POLYFACE MESH': ['mesh', 'meshes'],
  'POLYGON MESH': ['mesh', 'meshes'],
  ACAD_PROXY_ENTITY: ['proxy object'],
  OLE2FRAME: ['OLE object'],
  OLEFRAME: ['OLE object'],
  HATCH: ['hatch', 'hatches'],
  IMAGE: ['picture'],
  XLINE: ['construction line'],
  RAY: ['ray'],
  SHAPE: ['shape'],
  TOLERANCE: ['tolerance'],
  MLINE: ['multiline'],
  DIMENSION: ['dimension'],
  ARC_DIMENSION: ['arc dimension'],
};
function entityWord(type: string): [string, string?] {
  const base = type.replace(/ \(.*\)$/, '');
  return WORDS[base] ?? [base.toLowerCase().replace(/_/g, ' ')];
}

function describe(type: string): string {
  const m = / \((.*)\)$/.exec(type);
  return m ? m[1]! : 'not supported yet';
}

const round = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toPrecision(4).replace(/\.?0+$/, ''));

/** One line for the bar: what was converted and how many things to look at. */
export function summaryText(sourceName: string, report: ConversionReport): string {
  const pages = report.pages.length;
  const notes = report.warnings.length;
  const base = `Converted from ${sourceName}: ${plural(pages, 'page')}`;
  return notes ? `${base}, ${plural(notes, 'thing')} to check.` : `${base}.`;
}
