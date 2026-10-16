import type { Assembly, AssemblyItem } from '@nb/markup';
import type { UnitSystem } from '../settings/settings';

/**
 * Example assemblies to start from, in the units a page measured in that system shows (feet and
 * square feet, or metres and square metres). Quantities and prices are typical, not advice: they
 * are meant to be edited.
 */

const item = (name: string, unit: string, formula: string, extra: Partial<AssemblyItem> = {}): AssemblyItem => ({ id: crypto.randomUUID(), name, unit, formula, ...extra });

/** Wall height: the measurement's own depth when it has one, else the assembly's default. */
const HEIGHT = 'IF([Depth] > 0, [Depth], [Wall Height])';

export function starterAssemblies(system: UnitSystem): Assembly[] {
  const imperial = system === 'imperial';
  const u = imperial ? { len: 'lf', area: 'sf', vol: 'cy' } : { len: 'm', area: 'm²', vol: 'm³' };
  return [
    {
      id: crypto.randomUUID(),
      name: 'Interior partition, studs and board both sides',
      description: `Measure with Length or Polylength; give it a depth for the wall height, or the Wall Height below is used. Lengths in ${imperial ? 'feet' : 'metres'}.`,
      variables: imperial
        ? [
            { name: 'Wall Height', value: 9 },
            { name: 'Stud Spacing', value: 16 / 12 },
            { name: 'Board Area', value: 32 },
          ]
        : [
            { name: 'Wall Height', value: 2.7 },
            { name: 'Stud Spacing', value: 0.6 },
            { name: 'Board Area', value: 2.88 },
          ],
      items: [
        item('Studs', 'ea', '[Length] / [Stud Spacing] + 1', { waste: 10, roundUp: true }),
        item('Track, top and bottom', u.len, '[Length] * 2', { waste: 5 }),
        item('Gypsum board', 'sheets', `[Length] * ${HEIGHT} * 2 / [Board Area]`, { waste: 10, roundUp: true }),
        item('Insulation', u.area, `[Length] * ${HEIGHT}`, { waste: 5 }),
      ],
    },
    {
      id: crypto.randomUUID(),
      name: 'Slab on grade',
      description: `Measure with Area. Thickness in ${imperial ? 'feet (4" = 0.333)' : 'metres'}.`,
      variables: [{ name: 'Thickness', value: imperial ? 4 / 12 : 0.1 }],
      items: [
        item('Concrete', u.vol, imperial ? '[Area] * [Thickness] / 27' : '[Area] * [Thickness]', { waste: 5 }),
        item('Vapour barrier', u.area, '[Area]', { waste: 10 }),
        item('Mesh', u.area, '[Area]', { waste: 10 }),
        item('Edge form', u.len, '[Perimeter]', { waste: 5 }),
      ],
    },
    {
      id: crypto.randomUUID(),
      name: 'Floor tile',
      description: 'Measure with Area.',
      variables: [{ name: 'Box Coverage', value: imperial ? 15 : 1.44 }],
      items: [
        item('Tile', 'boxes', '[Area] / [Box Coverage]', { waste: 10, roundUp: true }),
        item('Base trim', u.len, '[Perimeter]', { waste: 10 }),
      ],
    },
    {
      id: crypto.randomUUID(),
      name: 'Paint walls, two coats',
      description: 'Measure the wall runs with Length or Polylength; give them a depth for the height, or the Wall Height below is used.',
      variables: imperial
        ? [
            { name: 'Wall Height', value: 9 },
            { name: 'Coats', value: 2 },
            { name: 'Coverage', value: 350 },
          ]
        : [
            { name: 'Wall Height', value: 2.7 },
            { name: 'Coats', value: 2 },
            { name: 'Coverage', value: 10 },
          ],
      items: [item('Paint', imperial ? 'gal' : 'L', `[Length] * ${HEIGHT} * [Coats] / [Coverage]`, { waste: 5, roundUp: true })],
    },
    {
      id: crypto.randomUUID(),
      name: 'Single door, prehung',
      description: 'Count the doors.',
      variables: [],
      items: [item('Door', 'ea', '[Count]'), item('Hinges', 'ea', '[Count] * 3'), item('Lockset', 'ea', '[Count]')],
    },
  ];
}
