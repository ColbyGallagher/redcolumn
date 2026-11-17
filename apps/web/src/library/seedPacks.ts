import { DEFAULT_STYLES, type Assembly, type MarkupStyle, type MarkupType, type TakeoffTemplate } from '@nb/markup';
import { starterGroups } from '../assemblies/starters';
import { parseStandardFile, type DrawingStandard } from '../sheets/standards';
import type { ToolChestItem } from '../workspace/profiles';
import type { TradePack } from './pack';

/**
 * The packs the community library starts with, built from the app's own starter assemblies (in
 * metric) and the fictional Kestrel Road demo standard. Every record gets an id made from its
 * name, so adding a newer version of a pack updates what an older one added instead of doubling it.
 * Written out by `pnpm --filter @nb/web library:seed <folder>`.
 */

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** An assembly with ids from its name (and its items' names), under `prefix`. */
function stable(prefix: string, a: Assembly): Assembly {
  const id = `${prefix}-${slug(a.name)}`;
  const used = new Set<string>();
  return {
    ...a,
    id,
    items: a.items.map((i) => {
      let itemId = `${id}-${slug(i.name)}`;
      for (let n = 2; used.has(itemId); n++) itemId = `${id}-${slug(i.name)}-${n}`;
      used.add(itemId);
      return { ...i, id: itemId };
    }),
  };
}

function starter(discipline: string, name: string): Assembly {
  const found = starterGroups('metric')
    .find((g) => g.discipline === discipline)
    ?.assemblies.find((a) => a.name === name);
  if (!found) throw new Error(`No starter assembly "${name}" in ${discipline}`);
  return found;
}

const style = (type: MarkupType, stroke: string, fill: string | null = null): MarkupStyle => ({ ...DEFAULT_STYLES[type], stroke, ...(fill ? { fill, fillOpacity: 0.25 } : {}) });

const tool = (type: MarkupType, label: string, s: MarkupStyle): ToolChestItem => ({ id: '', type, label, subject: label, style: s });

/** A template for `assembly`, measured with `tool` and drawn in `s`. */
const template = (id: string, name: string, toolType: MarkupType, assembly: Assembly, s: MarkupStyle, layer: string): TakeoffTemplate => ({
  id,
  name,
  tool: toolType,
  preset: { subject: name, layer, style: s },
  assemblyId: assembly.id,
});

const AUTHOR = 'redcolumn';

export function civilRoadsPack(standard: DrawingStandard): TradePack {
  const p = 'rc-civil-roads';
  const names = ['Pipe trench: storm or sewer', 'Water main', 'Manhole or catch basin', 'Concrete curb and gutter', 'Concrete sidewalk', 'Asphalt paving', 'Aggregate base course', 'Silt fence', 'Cut and fill'];
  const assemblies = names.map((n) => stable(p, starter('Civil and site', n)));
  const by = (n: string) => assemblies.find((a) => a.name === n)!;
  const looks = {
    kerb: style('length', '#d97706'),
    paving: style('area', '#475569', '#64748b'),
    base: style('area', '#a16207', '#ca8a04'),
    pipe: style('polylength', '#2563eb'),
    water: style('polylength', '#0891b2'),
    pit: style('count', '#dc2626'),
    footpath: style('area', '#9ca3af', '#d1d5db'),
    silt: style('length', '#65a30d'),
  };
  return {
    name: 'Civil / Roads starter',
    trade: 'Civil / Roads',
    description:
      'Road and stormwater takeoff in metric: pipe trenches, water main, pits, kerb and gutter, footpath, asphalt, base course, silt fence and cut and fill. With a takeoff template per measurement, a matching tool set, and the drawing standard for the fictional Kestrel Road demo set (title block, sheet numbers, match lines and chainages).',
    author: AUTHOR,
    units: 'metric',
    tags: ['roads', 'stormwater', 'kerb', 'pavement', 'earthworks', 'drawing standard'],
    estimating: {
      assemblies,
      items: [],
      productLists: [],
      templates: [
        template(`${p}-tpl-kerb`, 'Kerb and gutter', 'length', by('Concrete curb and gutter'), looks.kerb, 'Kerbs'),
        template(`${p}-tpl-asphalt`, 'Asphalt wearing course', 'area', by('Asphalt paving'), looks.paving, 'Pavement'),
        template(`${p}-tpl-base`, 'Base course', 'area', by('Aggregate base course'), looks.base, 'Pavement'),
        template(`${p}-tpl-footpath`, 'Concrete footpath', 'area', by('Concrete sidewalk'), looks.footpath, 'Footpaths'),
        template(`${p}-tpl-stormwater`, 'Stormwater pipe', 'polylength', by('Pipe trench: storm or sewer'), looks.pipe, 'Stormwater'),
        template(`${p}-tpl-water`, 'Water main', 'polylength', by('Water main'), looks.water, 'Water'),
        template(`${p}-tpl-pits`, 'Stormwater pits', 'count', by('Manhole or catch basin'), looks.pit, 'Stormwater'),
        template(`${p}-tpl-silt`, 'Silt fence', 'length', by('Silt fence'), looks.silt, 'Erosion control'),
      ],
    },
    toolSets: [
      {
        id: '',
        name: 'Civil / Roads takeoff',
        collapsed: false,
        view: 'detail',
        items: [
          tool('length', 'Kerb and gutter', looks.kerb),
          tool('area', 'Asphalt', looks.paving),
          tool('area', 'Base course', looks.base),
          tool('area', 'Footpath', looks.footpath),
          tool('polylength', 'Stormwater pipe', looks.pipe),
          tool('polylength', 'Water main', looks.water),
          tool('count', 'Pit', looks.pit),
          tool('length', 'Silt fence', looks.silt),
        ],
      },
    ],
    standards: [standard],
  };
}

export function partitionsPack(): TradePack {
  const p = 'rc-interiors';
  const partition = stable(p, starter('Architectural', 'Interior partition, studs and board both sides'));
  const look = style('polylength', '#7c3aed');
  return {
    name: 'Interior partitions (example)',
    trade: 'Interiors',
    description:
      'A small worked example of a pack: one stud partition assembly (studs, plates, board both sides, screws, tape, compound and insulation, metric), a takeoff template that measures it, and a one-tool tool set. Copy it to start your own trade pack.',
    author: AUTHOR,
    units: 'metric',
    tags: ['partitions', 'drywall', 'plasterboard', 'example'],
    estimating: {
      assemblies: [partition],
      items: [],
      productLists: [],
      templates: [{ ...template(`${p}-tpl-partition`, 'Stud partition', 'polylength', partition, look, 'Partitions'), inputs: { 'Wall Height': 2.7 } }],
    },
    toolSets: [{ id: '', name: 'Partitions', collapsed: false, view: 'detail', items: [tool('polylength', 'Stud partition', look)] }],
    standards: [],
  };
}

/** Every seed pack with its file name, for the library's `packs/` folder. */
export function seedPacks(kestrelStandardFile: string): { file: string; id: string; pack: TradePack }[] {
  const standard = parseStandardFile(kestrelStandardFile);
  return [
    { file: 'civil-roads.rctrade', id: 'civil-roads', pack: civilRoadsPack(standard) },
    { file: 'interior-partitions.rctrade', id: 'interior-partitions', pack: partitionsPack() },
  ];
}
