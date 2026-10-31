import type { Assembly, AssemblyItem, AssemblyVariable } from '@nb/markup';
import type { UnitSystem } from '../settings/settings';

/**
 * Example assemblies to start from, grouped by discipline, in the units a page measured in that
 * system shows (feet and square feet, or metres and square metres). Each is driven by one
 * measurement (a length, an area, a volume or a count) and lists what that measurement implies.
 *
 * Quantities and waste are typical, not advice: they are meant to be checked against the spec and
 * edited. There are no prices; add your own.
 */

const item = (name: string, unit: string, formula: string, extra: Partial<AssemblyItem> = {}): AssemblyItem => ({ id: crypto.randomUUID(), name, unit, formula, ...extra });

const assembly = (name: string, description: string, variables: AssemblyVariable[], items: AssemblyItem[]): Assembly => ({ id: crypto.randomUUID(), name, description, variables, items });

export interface StarterGroup {
  discipline: string;
  assemblies: Assembly[];
}

/** Wall height: the measurement's own depth when it has one, else the assembly's default. */
const HEIGHT = 'IF([Depth] > 0, [Depth], [Wall Height])';

export function starterGroups(system: UnitSystem): StarterGroup[] {
  const imperial = system === 'imperial';
  const u = imperial ? { len: 'lf', area: 'sf', vol: 'cy', tons: 'tons', mass: 'lb', pipe: 20, conduit: 10 } : { len: 'm', area: 'm²', vol: 'm³', tons: 't', mass: 'kg', pipe: 6, conduit: 3 };
  /** A variable with a value for each unit system. */
  const v = (name: string, feet: number, metres: number): AssemblyVariable => ({ name, value: imperial ? feet : metres });
  /** A cubic-foot expression as cubic yards, or a cubic-metre one as it is. */
  const vol = (e: string) => (imperial ? `(${e}) / 27` : e);
  /** A depth: the measurement's own when it has one, else the named variable. */
  const depthOr = (name: string) => `IF([Depth] > 0, [Depth], [${name}])`;
  const lengths = imperial ? 'Lengths in feet' : 'Lengths in metres';

  const architectural: Assembly[] = [
    assembly(
      'Interior partition, studs and board both sides',
      `Measure with Length or Polylength; give it a depth for the wall height, or the Wall Height below is used. Lengths in ${imperial ? 'feet' : 'metres'}.`,
      [v('Wall Height', 9, 2.7), v('Stud Spacing', 1.333, 0.6), v('Board Area', 32, 2.88)],
      [
        item('Studs', 'ea', '[Length] / [Stud Spacing] + 1', { waste: 10, roundUp: true }),
        item('Track, top and bottom', u.len, '[Length] * 2', { waste: 5 }),
        item('Gypsum board', 'sheets', `[Length] * ${HEIGHT} * 2 / [Board Area]`, { waste: 10, roundUp: true }),
        item('Insulation', u.area, `[Length] * ${HEIGHT}`, { waste: 5 }),
      ],
    ),
    assembly(
      'Slab on grade',
      `Measure with Area. Thickness in ${imperial ? 'feet (4" = 0.333)' : 'metres'}.`,
      [v('Thickness', 0.333, 0.1)],
      [
        item('Concrete', u.vol, imperial ? '[Area] * [Thickness] / 27' : '[Area] * [Thickness]', { waste: 5 }),
        item('Vapour barrier', u.area, '[Area]', { waste: 10 }),
        item('Mesh', u.area, '[Area]', { waste: 10 }),
        item('Edge form', u.len, '[Perimeter]', { waste: 5 }),
      ],
    ),
    assembly('Floor tile', 'Measure with Area.', [v('Box Coverage', 15, 1.44)], [item('Tile', 'boxes', '[Area] / [Box Coverage]', { waste: 10, roundUp: true }), item('Base trim', u.len, '[Perimeter]', { waste: 10 })]),
    assembly(
      'Paint walls, two coats',
      'Measure the wall runs with Length or Polylength; give them a depth for the height, or the Wall Height below is used.',
      [v('Wall Height', 9, 2.7), { name: 'Coats', value: 2 }, v('Coverage', 350, 10)],
      [item('Paint', imperial ? 'gal' : 'L', `[Length] * ${HEIGHT} * [Coats] / [Coverage]`, { waste: 5, roundUp: true })],
    ),
    assembly('Single door, prehung', 'Count the doors.', [], [item('Door', 'ea', '[Count]'), item('Hinges', 'ea', '[Count] * 3'), item('Lockset', 'ea', '[Count]')]),
    assembly(
      'Suspended ceiling, lay-in tile',
      'Measure with Area. Grid spacings are the distance between main tees and between cross tees.',
      [v('Tile Area', 4, 0.36), v('Main Tee Spacing', 4, 1.2), v('Cross Tee Spacing', 2, 0.6), v('Hanger Coverage', 16, 1.5)],
      [
        item('Ceiling tile', 'ea', '[Area] / [Tile Area]', { waste: 5, roundUp: true }),
        item('Main tees', u.len, '[Area] / [Main Tee Spacing]', { waste: 5 }),
        item('Cross tees', u.len, '[Area] / [Cross Tee Spacing]', { waste: 5 }),
        item('Wall angle', u.len, '[Perimeter]', { waste: 5, roundUp: true, roundTo: imperial ? 10 : 3 }),
        item('Hanger wire', 'ea', '[Area] / [Hanger Coverage]', { roundUp: true }),
      ],
    ),
    assembly(
      'Roofing, membrane on insulation',
      'Measure with Area (the sloped roof area). The perimeter takes the edge flashing.',
      [v('Board Area', 32, 2.88), v('Fastener Coverage', 2, 0.2), v('Adhesive Coverage', 100, 2.5)],
      [
        item('Membrane', u.area, '[Area]', { waste: 10 }),
        item('Insulation boards', 'boards', '[Area] / [Board Area]', { waste: 5, roundUp: true }),
        item('Fasteners and plates', 'ea', '[Area] / [Fastener Coverage]', { waste: 5, roundUp: true }),
        item('Bonding adhesive', imperial ? 'gal' : 'L', '[Area] / [Adhesive Coverage]', { roundUp: true }),
        item('Edge flashing', u.len, '[Perimeter]', { waste: 10 }),
      ],
    ),
    assembly(
      'Exterior stud wall, sheathed and clad',
      `Measure with Length or Polylength; give it a depth for the wall height, or the Wall Height below is used. ${lengths}.`,
      [v('Wall Height', 9, 2.7), v('Stud Spacing', 1.333, 0.4), v('Sheet Area', 32, 2.88)],
      [
        item('Studs', 'ea', '[Length] / [Stud Spacing] + 1', { waste: 10, roundUp: true }),
        item('Plates, one bottom and two top', u.len, '[Length] * 3', { waste: 5 }),
        item('Sheathing', 'sheets', `[Length] * ${HEIGHT} / [Sheet Area]`, { waste: 10, roundUp: true }),
        item('Weather barrier', u.area, `[Length] * ${HEIGHT}`, { waste: 15 }),
        item('Cladding', u.area, `[Length] * ${HEIGHT}`, { waste: 10 }),
        item('Insulation', u.area, `[Length] * ${HEIGHT}`, { waste: 5 }),
      ],
    ),
    assembly(
      'Window or storefront unit',
      'Count the units. Perimeter is the distance around one opening.',
      [v('Opening Perimeter', 14, 4.2)],
      [item('Window unit', 'ea', '[Count]'), item('Flashing', u.len, '[Count] * [Opening Perimeter]', { waste: 10 }), item('Sealant', u.len, '[Count] * [Opening Perimeter] * 2', { waste: 10 }), item('Interior trim', u.len, '[Count] * [Opening Perimeter]', { waste: 10 })],
    ),
    assembly(
      'Stair, straight run',
      'Count the stairs. Risers is the number of risers in one flight; Run is the length of the handrail.',
      [{ name: 'Risers', value: 14 }, v('Handrail Run', 12, 3.6)],
      [item('Treads', 'ea', '[Count] * ([Risers] - 1)'), item('Risers', 'ea', '[Count] * [Risers]'), item('Stringers', 'ea', '[Count] * 2'), item('Handrail', u.len, '[Count] * [Handrail Run]', { waste: 5 })],
    ),
  ];

  const civil: Assembly[] = [
    assembly(
      'Pipe trench: storm or sewer',
      `Measure with Length along the pipe; give it a depth for the average trench depth, or Trench Depth is used. Excavation is in bank volume, haul in loose volume, and backfill is net of the bedding and the pipe. Take the swell from the geotechnical report. ${lengths}.`,
      [v('Trench Width', 3, 0.9), v('Trench Depth', 6, 1.8), v('Bedding Depth', 0.5, 0.15), v('Pipe OD', 1.5, 0.45), { name: 'Swell Factor', value: 1.3 }],
      [
        item('Excavation, bank', u.vol, vol(`[Length] * [Trench Width] * ${depthOr('Trench Depth')}`), { waste: 5 }),
        item('Spoil haul, loose', u.vol, vol(`[Length] * [Trench Width] * ${depthOr('Trench Depth')} * [Swell Factor]`), { waste: 5 }),
        item('Pipe', u.len, '[Length]', { waste: 3, roundUp: true, roundTo: u.pipe }),
        item('Pipe bedding', u.vol, vol('[Length] * [Trench Width] * [Bedding Depth]'), { waste: 10 }),
        item('Backfill, compacted', u.vol, vol(`[Length] * ([Trench Width] * (${depthOr('Trench Depth')} - [Bedding Depth]) - 0.7854 * [Pipe OD] ^ 2)`), { waste: 5 }),
        item('Trench safety', u.len, '[Length]'),
        item('Warning tape', u.len, '[Length]', { waste: 5 }),
      ],
    ),
    assembly(
      'Water main',
      `Measure with Length along the main. Fittings are an allowance per 100 ${imperial ? 'ft' : 'm'}; thrust blocks go at one per fitting. ${lengths}.`,
      [v('Trench Width', 2.5, 0.75), v('Trench Depth', 5, 1.5), v('Bedding Depth', 0.5, 0.15), { name: 'Fittings per 100', value: 2 }],
      [
        item('Excavation, bank', u.vol, vol(`[Length] * [Trench Width] * ${depthOr('Trench Depth')}`), { waste: 5 }),
        item('Pipe', u.len, '[Length]', { waste: 3, roundUp: true, roundTo: u.pipe }),
        item('Fittings', 'ea', '[Length] / 100 * [Fittings per 100]', { roundUp: true }),
        item('Thrust blocks', 'ea', '[Length] / 100 * [Fittings per 100]', { roundUp: true }),
        item('Bedding', u.vol, vol('[Length] * [Trench Width] * [Bedding Depth]'), { waste: 10 }),
        item('Backfill, compacted', u.vol, vol(`[Length] * [Trench Width] * (${depthOr('Trench Depth')} - [Bedding Depth])`), { waste: 5 }),
        item('Tracer wire', u.len, '[Length]', { waste: 10 }),
        item('Warning tape', u.len, '[Length]', { waste: 5 }),
      ],
    ),
    assembly(
      'Manhole or catch basin',
      'Count the structures. Structure Depth is cover to invert; Riser Height is the height of one riser section.',
      [v('Structure Depth', 8, 2.4), v('Riser Height', 4, 1.2), v('Structure Diameter', 4, 1.2), v('Pit Size', 8, 2.4)],
      [
        item('Base section', 'ea', '[Count]'),
        item('Riser sections', 'ea', '[Count] * [Structure Depth] / [Riser Height]', { roundUp: true }),
        item('Cone or top slab', 'ea', '[Count]'),
        item('Frame and cover', 'ea', '[Count]'),
        item('Joint seals', 'ea', '[Count] * ([Structure Depth] / [Riser Height] + 1)', { roundUp: true }),
        item('Excavation, bank', u.vol, vol('[Count] * [Pit Size] ^ 2 * [Structure Depth]'), { waste: 5 }),
        item('Backfill, compacted', u.vol, vol('[Count] * ([Pit Size] ^ 2 - 0.7854 * [Structure Diameter] ^ 2) * [Structure Depth]'), { waste: 5 }),
      ],
    ),
    assembly(
      'Concrete curb and gutter',
      `Measure with Length along the back of curb. Section Area is the cross-section of the concrete. ${lengths}.`,
      [v('Section Area', 2.5, 0.23), v('Base Width', 2, 0.6), v('Base Depth', 0.5, 0.15), v('Joint Spacing', 10, 3)],
      [
        item('Concrete', u.vol, vol('[Length] * [Section Area]'), { waste: 5 }),
        item('Base course', u.vol, vol('[Length] * [Base Width] * [Base Depth]'), { waste: 10 }),
        item('Expansion joints', 'ea', '[Length] / [Joint Spacing]', { roundUp: true }),
        item('Forms, both faces', u.len, '[Length] * 2', { waste: 5 }),
      ],
    ),
    assembly(
      'Concrete sidewalk',
      `Measure with Area. Thickness and Base Depth in ${imperial ? 'feet (4" = 0.333)' : 'metres'}; Joint Spacing is between control joints.`,
      [v('Thickness', 0.333, 0.1), v('Base Depth', 0.333, 0.1), v('Joint Spacing', 5, 1.5), v('Curing Coverage', 200, 5)],
      [
        item('Concrete', u.vol, vol('[Area] * [Thickness]'), { waste: 5 }),
        item('Gravel base', u.vol, vol('[Area] * [Base Depth]'), { waste: 10 }),
        item('Mesh or fibre reinforcing', u.area, '[Area]', { waste: 10 }),
        item('Control joints', u.len, '[Area] / [Joint Spacing]'),
        item('Edge form', u.len, '[Perimeter]', { waste: 5 }),
        item('Curing compound', imperial ? 'gal' : 'L', '[Area] / [Curing Coverage]', { roundUp: true }),
      ],
    ),
    assembly(
      'Asphalt paving',
      `Measure with Area. Thickness and Base Depth in ${imperial ? 'feet (3" = 0.25)' : 'metres'}; Density is ${imperial ? 'lb per cubic foot' : 'tonnes per cubic metre'}; Tack Rate is ${imperial ? 'gal per square yard' : 'L per m²'}.`,
      [v('Thickness', 0.25, 0.075), v('Base Depth', 0.667, 0.2), v('Density', 145, 2.3), v('Tack Rate', 0.07, 0.3)],
      [
        item('Asphalt', u.tons, imperial ? '[Area] * [Thickness] * [Density] / 2000' : '[Area] * [Thickness] * [Density]', { waste: 5 }),
        item('Aggregate base', u.vol, vol('[Area] * [Base Depth]'), { waste: 10 }),
        item('Tack coat', imperial ? 'gal' : 'L', imperial ? '[Area] / 9 * [Tack Rate]' : '[Area] * [Tack Rate]', { waste: 10, roundUp: true }),
        item('Edge striping', u.len, '[Perimeter]'),
      ],
    ),
    assembly(
      'Aggregate base course',
      `Measure with Area. Depth in ${imperial ? 'feet' : 'metres'}; Density is ${imperial ? 'lb per cubic foot of compacted stone' : 'tonnes per cubic metre'}.`,
      [v('Base Depth', 0.5, 0.15), v('Density', 125, 2.1)],
      [item('Stone', u.tons, imperial ? '[Area] * [Base Depth] * [Density] / 2000' : '[Area] * [Base Depth] * [Density]', { waste: 5 }), item('Geotextile', u.area, '[Area]', { waste: 15 })],
    ),
    assembly(
      'Silt fence',
      `Measure with Length along the fence. Fabric comes in rolls, so it rounds up to a whole roll. ${lengths}.`,
      [v('Post Spacing', 6, 2)],
      [
        item('Fabric', u.len, '[Length]', { waste: 10, roundUp: true, roundTo: imperial ? 100 : 30 }),
        item('Posts', 'ea', '[Length] / [Post Spacing] + 1', { waste: 5, roundUp: true }),
        item('Removal', u.len, '[Length]'),
      ],
    ),
    assembly(
      'Cut and fill',
      'Measure with Volume (an area with a depth). Swell converts bank to loose for hauling; Compaction Factor is how much loose fill is brought in to place one compacted.',
      [{ name: 'Swell Factor', value: 1.25 }, { name: 'Compaction Factor', value: 1.15 }, v('Truck Capacity', 12, 9)],
      [
        item('Excavation, bank', u.vol, '[Volume]'),
        item('Haul, loose', u.vol, '[Volume] * [Swell Factor]'),
        item('Truck loads', 'loads', '[Volume] * [Swell Factor] / [Truck Capacity]', { roundUp: true }),
        item('Imported fill to place compacted', u.vol, '[Volume] * [Compaction Factor]'),
      ],
    ),
  ];

  const structural: Assembly[] = [
    assembly(
      'Spread footing',
      `Count the footings (square). ${lengths}; thickness and cover as well.`,
      [v('Footing Size', 4, 1.2), v('Footing Thickness', 1.5, 0.45), { name: 'Bars Each Way', value: 5 }, v('Cover', 0.25, 0.075), v('Working Space', 1, 0.3), v('Bury Depth', 3, 0.9)],
      [
        item('Concrete', u.vol, vol('[Count] * [Footing Size] ^ 2 * [Footing Thickness]'), { waste: 5 }),
        item('Formwork', u.area, '[Count] * 4 * [Footing Size] * [Footing Thickness]', { waste: 10 }),
        item('Rebar', u.len, '[Count] * 2 * [Bars Each Way] * ([Footing Size] - 2 * [Cover])', { waste: 10 }),
        item('Anchor bolts', 'ea', '[Count] * 4'),
        item('Excavation, bank', u.vol, vol('[Count] * ([Footing Size] + 2 * [Working Space]) ^ 2 * [Bury Depth]'), { waste: 5 }),
        item('Backfill, compacted', u.vol, vol('[Count] * (([Footing Size] + 2 * [Working Space]) ^ 2 * [Bury Depth] - [Footing Size] ^ 2 * [Footing Thickness])'), { waste: 5 }),
      ],
    ),
    assembly(
      'Strip footing',
      `Measure with Length along the footing. ${lengths}.`,
      [v('Footing Width', 2, 0.6), v('Footing Thickness', 1, 0.3), { name: 'Longitudinal Bars', value: 3 }, v('Transverse Spacing', 2, 0.6), v('Cover', 0.25, 0.075)],
      [
        item('Concrete', u.vol, vol('[Length] * [Footing Width] * [Footing Thickness]'), { waste: 5 }),
        item('Formwork, both sides', u.area, '[Length] * 2 * [Footing Thickness]', { waste: 10 }),
        item('Longitudinal rebar', u.len, '[Length] * [Longitudinal Bars]', { waste: 10 }),
        item('Transverse rebar', u.len, '([Length] / [Transverse Spacing] + 1) * ([Footing Width] - 2 * [Cover])', { waste: 10 }),
        item('Keyway', u.len, '[Length]', { waste: 5 }),
      ],
    ),
    assembly(
      'Elevated concrete slab',
      `Measure with Area. Thickness in ${imperial ? 'feet (8" = 0.667)' : 'metres'}; Rebar Rate is ${imperial ? 'lb per square foot' : 'kg per m²'}.`,
      [v('Thickness', 0.667, 0.2), v('Rebar Rate', 1.1, 5.4)],
      [
        item('Concrete', u.vol, vol('[Area] * [Thickness]'), { waste: 5 }),
        item('Deck forming', u.area, '[Area]', { waste: 10 }),
        item('Shoring', u.area, '[Area]'),
        item('Rebar', u.tons, imperial ? '[Area] * [Rebar Rate] / 2000' : '[Area] * [Rebar Rate] / 1000', { waste: 10 }),
        item('Edge form', u.len, '[Perimeter]', { waste: 5 }),
        item('Finishing and curing', u.area, '[Area]'),
      ],
    ),
    assembly(
      'Concrete wall',
      `Measure with Length; give it a depth for the wall height, or the Wall Height below is used. Curtains is the layers of rebar (1 or 2); Tie Coverage is the area one form tie serves. ${lengths}.`,
      [v('Wall Height', 10, 3), v('Wall Thickness', 1, 0.3), v('Vertical Spacing', 1, 0.3), v('Horizontal Spacing', 1, 0.3), { name: 'Curtains', value: 2 }, v('Tie Coverage', 4, 0.37)],
      [
        item('Concrete', u.vol, vol(`[Length] * ${HEIGHT} * [Wall Thickness]`), { waste: 5 }),
        item('Formwork, both faces', u.area, `[Length] * ${HEIGHT} * 2`, { waste: 10 }),
        item('Form ties', 'ea', `[Length] * ${HEIGHT} / [Tie Coverage]`, { waste: 5, roundUp: true }),
        item('Vertical rebar', u.len, `([Length] / [Vertical Spacing] + 1) * ${HEIGHT} * [Curtains]`, { waste: 10 }),
        item('Horizontal rebar', u.len, `(${HEIGHT} / [Horizontal Spacing] + 1) * [Length] * [Curtains]`, { waste: 10 }),
      ],
    ),
    assembly(
      'Concrete column',
      `Count the columns (square). Tie Spacing is between ties; Lap is the splice length at the top of the vertical bars. ${lengths}.`,
      [v('Column Size', 2, 0.6), v('Column Height', 12, 3.6), { name: 'Vertical Bars', value: 8 }, v('Tie Spacing', 1, 0.3), v('Lap', 2.5, 0.75)],
      [
        item('Concrete', u.vol, vol('[Count] * [Column Size] ^ 2 * [Column Height]'), { waste: 5 }),
        item('Formwork', u.area, '[Count] * 4 * [Column Size] * [Column Height]', { waste: 10 }),
        item('Vertical bars', u.len, '[Count] * [Vertical Bars] * ([Column Height] + [Lap])', { waste: 5 }),
        item('Ties', 'ea', '[Count] * ([Column Height] / [Tie Spacing] + 1)', { waste: 5, roundUp: true }),
      ],
    ),
    assembly(
      'Structural steel beam',
      `Measure with Length. Steel Weight is ${imperial ? 'lb per foot' : 'kg per metre'} of the section (a W12×26 is 26); the connection allowance adds plates, bolts and clips as a percent; Surface is the area to coat per ${imperial ? 'foot' : 'metre'}.`,
      [v('Steel Weight', 26, 38.7), { name: 'Connection Allowance', value: 8 }, v('Surface', 3.3, 1)],
      [
        item('Structural steel', u.tons, imperial ? '[Length] * [Steel Weight] / 2000 * (1 + [Connection Allowance] / 100)' : '[Length] * [Steel Weight] / 1000 * (1 + [Connection Allowance] / 100)'),
        item('Shop primer', u.area, '[Length] * [Surface]'),
        item('Fireproofing', u.area, '[Length] * [Surface]', { waste: 10 }),
      ],
    ),
    assembly(
      'Steel column with base plate',
      `Count the columns. Steel Weight is ${imperial ? 'lb per foot' : 'kg per metre'}; Plate Weight is per base plate. ${lengths}.`,
      [v('Column Height', 12, 3.6), v('Steel Weight', 49, 73), v('Plate Weight', 55, 25), v('Grout per Column', 0.5, 0.014)],
      [
        item('Column steel', u.tons, imperial ? '[Count] * [Column Height] * [Steel Weight] / 2000' : '[Count] * [Column Height] * [Steel Weight] / 1000'),
        item('Base plates', 'ea', '[Count]'),
        item('Plate steel', u.tons, imperial ? '[Count] * [Plate Weight] / 2000' : '[Count] * [Plate Weight] / 1000'),
        item('Anchor rods', 'ea', '[Count] * 4'),
        item('Grout', imperial ? 'cf' : 'm³', '[Count] * [Grout per Column]', { waste: 10 }),
      ],
    ),
    assembly(
      'Metal deck with concrete topping',
      `Measure with Area. Topping is the average thickness above the deck. Studs per ${imperial ? 'square foot' : 'm²'} is the shear stud density.`,
      [v('Topping Thickness', 0.333, 0.1), v('Studs per Area', 0.4, 4.3)],
      [
        item('Metal deck', u.area, '[Area]', { waste: 5 }),
        item('Edge form', u.len, '[Perimeter]', { waste: 5 }),
        item('Shear studs', 'ea', '[Area] * [Studs per Area]', { waste: 3, roundUp: true }),
        item('Mesh', u.area, '[Area]', { waste: 10 }),
        item('Concrete topping', u.vol, vol('[Area] * [Topping Thickness]'), { waste: 8 }),
      ],
    ),
    assembly(
      'Concrete masonry (CMU) wall',
      `Measure with Length; give it a depth for the wall height, or the Wall Height below is used. Cell Volume is grout per ${imperial ? 'foot' : 'metre'} of height in one filled cell. ${lengths}.`,
      [v('Wall Height', 10, 3), v('Blocks per Area', 1.125, 12.5), v('Rebar Spacing', 4, 1.2), v('Mortar Coverage', 30, 3), v('Cell Volume', 0.2, 0.0186)],
      [
        item('Block', 'ea', `[Length] * ${HEIGHT} * [Blocks per Area]`, { waste: 5, roundUp: true }),
        item('Mortar', 'bags', `[Length] * ${HEIGHT} / [Mortar Coverage]`, { waste: 5, roundUp: true }),
        item('Vertical rebar', u.len, `([Length] / [Rebar Spacing] + 1) * ${HEIGHT}`, { waste: 10 }),
        item('Grout, filled cells', u.vol, vol(`([Length] / [Rebar Spacing] + 1) * ${HEIGHT} * [Cell Volume]`), { waste: 10 }),
      ],
    ),
    assembly(
      'Wood floor framing',
      `Measure with Area. Joist Length is the span plus bearing; Sheet Area is one sheet of subfloor. ${lengths}.`,
      [v('Joist Spacing', 1.333, 0.4), v('Joist Length', 12, 3.6), v('Sheet Area', 32, 2.88)],
      [
        item('Joists', u.len, '[Area] / [Joist Spacing]', { waste: 10 }),
        item('Rim joist', u.len, '[Perimeter]', { waste: 5 }),
        item('Joist hangers', 'ea', '[Area] / [Joist Spacing] / [Joist Length] * 2', { roundUp: true }),
        item('Subfloor sheets', 'sheets', '[Area] / [Sheet Area]', { waste: 10, roundUp: true }),
      ],
    ),
    assembly(
      'Roof trusses',
      `Measure with Length along the building, parallel to the ridge. ${lengths}.`,
      [v('Truss Spacing', 2, 0.6), { name: 'Brace Rows', value: 3 }],
      [
        item('Trusses', 'ea', '[Length] / [Truss Spacing] + 1', { roundUp: true }),
        item('Hurricane ties', 'ea', '([Length] / [Truss Spacing] + 1) * 2', { roundUp: true }),
        item('Lateral bracing', u.len, '[Length] * [Brace Rows]', { waste: 10 }),
      ],
    ),
  ];

  const mechanical: Assembly[] = [
    assembly(
      'Piping run',
      `Measure with Length along the pipe. Fittings are an allowance per 100 ${imperial ? 'ft' : 'm'}, not a count; hangers go at the spacing shown. Pipe rounds up to whole ${u.pipe} ${u.len} lengths. ${lengths}.`,
      [{ name: 'Fittings per 100', value: 10 }, v('Hanger Spacing', 10, 3)],
      [
        item('Pipe', u.len, '[Length]', { waste: 5, roundUp: true, roundTo: u.pipe }),
        item('Fittings', 'ea', '[Length] / 100 * [Fittings per 100]', { roundUp: true }),
        item('Hangers', 'ea', '[Length] / [Hanger Spacing]', { roundUp: true }),
        item('Insulation', u.len, '[Length]', { waste: 5 }),
        item('Pressure test', u.len, '[Length]'),
      ],
    ),
    assembly(
      'Insulated pipe',
      `Measure with Length along the pipe. Insulation comes in sections of Section Length. ${lengths}.`,
      [v('Section Length', 6, 2), v('Shield Spacing', 10, 3)],
      [
        item('Pipe insulation', u.len, '[Length]', { waste: 5, roundUp: true, roundTo: imperial ? 6 : 2 }),
        item('Jacket', u.len, '[Length]', { waste: 10 }),
        item('Joint seals', 'ea', '[Length] / [Section Length]', { roundUp: true }),
        item('Insulation shields', 'ea', '[Length] / [Shield Spacing]', { roundUp: true }),
      ],
    ),
    assembly(
      'Rectangular duct',
      `Measure with Length along the duct. Gauge Weight is ${imperial ? 'lb per square foot' : 'kg per m²'} of sheet metal (24 ga galvanized is about 1.16 lb/sf); Fitting Allowance adds elbows and transitions as a percent. Size in ${imperial ? 'feet (18" = 1.5)' : 'metres'}.`,
      [v('Duct Width', 1.5, 0.45), v('Duct Height', 1, 0.3), v('Gauge Weight', 1.156, 5.6), { name: 'Fitting Allowance', value: 30 }, v('Joint Spacing', 4, 1.2), v('Hanger Spacing', 8, 2.4)],
      [
        item('Sheet metal', u.mass, '[Length] * 2 * ([Duct Width] + [Duct Height]) * [Gauge Weight] * (1 + [Fitting Allowance] / 100)', { waste: 5 }),
        item('Duct liner', u.area, '[Length] * 2 * ([Duct Width] + [Duct Height])', { waste: 10 }),
        item('Joints and stiffeners', 'ea', '[Length] / [Joint Spacing]', { roundUp: true }),
        item('Hangers', 'ea', '[Length] / [Hanger Spacing] * 2', { roundUp: true }),
      ],
    ),
    assembly(
      'Round spiral duct',
      `Measure with Length along the duct. Diameter in ${imperial ? 'feet (12" = 1)' : 'metres'}; ducts come in lengths of Section Length. ${lengths}.`,
      [v('Duct Diameter', 1, 0.3), v('Section Length', 10, 3), v('Hanger Spacing', 10, 3)],
      [
        item('Spiral duct', u.len, '[Length]', { waste: 5, roundUp: true, roundTo: imperial ? 10 : 3 }),
        item('Couplings', 'ea', '[Length] / [Section Length]', { roundUp: true }),
        item('Hangers', 'ea', '[Length] / [Hanger Spacing]', { roundUp: true }),
        item('Insulation wrap', u.area, '[Length] * 3.1416 * [Duct Diameter]', { waste: 10 }),
      ],
    ),
    assembly(
      'Supply diffuser or grille',
      'Count the outlets. Flex Length is the run from the main to the outlet; Test and Balance is hours per outlet.',
      [v('Flex Length', 6, 2), { name: 'Balance Hours', value: 0.5 }],
      [
        item('Diffuser or grille', 'ea', '[Count]'),
        item('Flex duct', u.len, '[Count] * [Flex Length]', { waste: 10 }),
        item('Collar or boot', 'ea', '[Count]'),
        item('Balancing damper', 'ea', '[Count]'),
        item('Test and balance', 'hr', '[Count] * [Balance Hours]'),
      ],
    ),
    assembly(
      'VAV box with controls',
      'Count the boxes. Control Wire is the low-voltage run per box; Commissioning is hours per box.',
      [v('Flex Length', 6, 2), v('Control Wire', 50, 15), { name: 'Commissioning Hours', value: 1 }],
      [
        item('VAV box', 'ea', '[Count]'),
        item('Flex inlet duct', u.len, '[Count] * [Flex Length]', { waste: 10 }),
        item('Hangers', 'ea', '[Count] * 4'),
        item('Thermostat or sensor', 'ea', '[Count]'),
        item('Control wiring', u.len, '[Count] * [Control Wire]', { waste: 10 }),
        item('Commissioning', 'hr', '[Count] * [Commissioning Hours]'),
      ],
    ),
    assembly(
      'Plumbing fixture rough-in',
      'Count the fixtures. Rough-in Pipe is the waste, vent and supply pipe run per fixture.',
      [v('Rough-in Pipe', 15, 4.5)],
      [
        item('Supply stubs', 'ea', '[Count] * 2'),
        item('Waste and vent pipe', u.len, '[Count] * [Rough-in Pipe]', { waste: 10 }),
        item('Stop valves', 'ea', '[Count] * 2'),
        item('Carrier or support', 'ea', '[Count]'),
        item('Trim', 'ea', '[Count]'),
      ],
    ),
    assembly(
      'Sprinkler head layout',
      'Count the heads. Armover is the branch pipe per head; fittings and hangers are per head.',
      [v('Armover Length', 4, 1.2), { name: 'Fittings per Head', value: 1.5 }, { name: 'Hangers per Head', value: 0.5 }],
      [
        item('Sprinkler head', 'ea', '[Count]', { waste: 2, roundUp: true }),
        item('Drop nipple', 'ea', '[Count]'),
        item('Armover pipe', u.len, '[Count] * [Armover Length]', { waste: 5 }),
        item('Fittings', 'ea', '[Count] * [Fittings per Head]', { roundUp: true }),
        item('Hangers', 'ea', '[Count] * [Hangers per Head]', { roundUp: true }),
      ],
    ),
    assembly(
      'Equipment pad and connections',
      `Count the units. Pad size in ${imperial ? 'feet' : 'metres'}; Valves per Unit includes unions and isolation valves.`,
      [v('Pad Length', 4, 1.2), v('Pad Width', 3, 0.9), v('Pad Thickness', 0.5, 0.15), { name: 'Valves per Unit', value: 4 }, { name: 'Startup Hours', value: 2 }],
      [
        item('Concrete pad', u.vol, vol('[Count] * [Pad Length] * [Pad Width] * [Pad Thickness]'), { waste: 5 }),
        item('Vibration isolators', 'ea', '[Count] * 4'),
        item('Valves and unions', 'ea', '[Count] * [Valves per Unit]'),
        item('Gauges', 'ea', '[Count] * 2'),
        item('Startup', 'hr', '[Count] * [Startup Hours]'),
      ],
    ),
  ];

  const electrical: Assembly[] = [
    assembly(
      'Duplex receptacle',
      `Count the devices. Raceway per Device is the conduit or MC cable from the previous box; each foot of raceway carries Conductors wires. ${lengths}.`,
      [v('Raceway per Device', 40, 12), { name: 'Conductors', value: 3 }, v('Strap Spacing', 5, 1.5), v('Pigtail Length', 2, 0.6)],
      [
        item('Receptacle', 'ea', '[Count]'),
        item('Box', 'ea', '[Count]'),
        item('Mud ring', 'ea', '[Count]'),
        item('Cover plate', 'ea', '[Count]'),
        item('Conduit or cable', u.len, '[Count] * [Raceway per Device]', { waste: 5 }),
        item('Conductors', u.len, '[Count] * [Raceway per Device] * [Conductors]', { waste: 10 }),
        item('Ground pigtail', u.len, '[Count] * [Pigtail Length]', { waste: 10 }),
        item('Connectors', 'ea', '[Count] * 2'),
        item('Straps', 'ea', '[Count] * [Raceway per Device] / [Strap Spacing]', { roundUp: true }),
        item('Wire nuts', 'ea', '[Count] * 2'),
      ],
    ),
    assembly(
      'Switch',
      `Count the switches. Use 4 conductors for a 3-way. ${lengths}.`,
      [v('Raceway per Device', 20, 6), { name: 'Conductors', value: 3 }, v('Strap Spacing', 5, 1.5)],
      [
        item('Switch', 'ea', '[Count]'),
        item('Box', 'ea', '[Count]'),
        item('Mud ring', 'ea', '[Count]'),
        item('Cover plate', 'ea', '[Count]'),
        item('Conduit or cable', u.len, '[Count] * [Raceway per Device]', { waste: 5 }),
        item('Conductors', u.len, '[Count] * [Raceway per Device] * [Conductors]', { waste: 10 }),
        item('Connectors', 'ea', '[Count] * 2'),
        item('Straps', 'ea', '[Count] * [Raceway per Device] / [Strap Spacing]', { roundUp: true }),
        item('Wire nuts', 'ea', '[Count] * 3'),
      ],
    ),
    assembly(
      'Light fixture',
      'Count the fixtures. Whip is the flexible connection to the fixture; Lamps is per fixture (0 for integral LED).',
      [v('Whip Length', 6, 2), v('Support Wire', 8, 2.4), { name: 'Lamps', value: 0 }],
      [
        item('Fixture', 'ea', '[Count]'),
        item('Whip', u.len, '[Count] * [Whip Length]', { waste: 5 }),
        item('Support wire', u.len, '[Count] * [Support Wire]', { waste: 5 }),
        item('Lamps', 'ea', '[Count] * [Lamps]', { waste: 2, roundUp: true }),
        item('Wire nuts', 'ea', '[Count] * 3'),
      ],
    ),
    assembly(
      'Conduit run, EMT or rigid',
      `Measure with Length along the conduit. Conduit comes in Stock Length pieces, so it rounds up to a whole ${u.conduit} ${u.len}; Bends per 100 is the elbows and offsets. ${lengths}.`,
      [v('Stock Length', 10, 3), v('Strap Spacing', 10, 3), { name: 'Conductors per Run', value: 3 }, { name: 'Bends per 100', value: 2 }],
      [
        item('Conduit', u.len, '[Length]', { waste: 3, roundUp: true, roundTo: u.conduit }),
        item('Couplings', 'ea', '[Length] / [Stock Length]', { roundUp: true }),
        item('Connectors', 'ea', '2'),
        item('Straps', 'ea', '[Length] / [Strap Spacing]', { roundUp: true }),
        item('Elbows and bends', 'ea', '[Length] / 100 * [Bends per 100]', { roundUp: true }),
        item('Conductors', u.len, '[Length] * [Conductors per Run]', { waste: 10 }),
        item('Pull string', u.len, '[Length]', { waste: 5 }),
      ],
    ),
    assembly(
      'Cable tray',
      `Measure with Length along the tray. ${lengths}.`,
      [v('Section Length', 10, 3), v('Hanger Spacing', 8, 2.4)],
      [
        item('Tray sections', 'ea', '[Length] / [Section Length]', { roundUp: true }),
        item('Splice plates', 'ea', '[Length] / [Section Length]', { roundUp: true }),
        item('Hanger rods and clamps', 'ea', '[Length] / [Hanger Spacing] * 2', { roundUp: true }),
        item('Covers', u.len, '[Length]', { waste: 5 }),
        item('Bonding jumpers', 'ea', '[Length] / [Section Length]', { roundUp: true }),
      ],
    ),
    assembly(
      'Feeder',
      `Measure with Length along the feeder. Sets is parallel runs. ${lengths}.`,
      [{ name: 'Sets', value: 1 }, { name: 'Hot Conductors', value: 3 }, { name: 'Neutral Conductors', value: 1 }, { name: 'Ground Conductors', value: 1 }],
      [
        item('Conductors', u.len, '[Length] * [Sets] * ([Hot Conductors] + [Neutral Conductors] + [Ground Conductors])', { waste: 5 }),
        item('Conduit', u.len, '[Length] * [Sets]', { waste: 3, roundUp: true, roundTo: u.conduit }),
        item('Terminations', 'ea', '[Sets] * ([Hot Conductors] + [Neutral Conductors] + [Ground Conductors]) * 2'),
      ],
    ),
    assembly(
      'Panelboard',
      'Count the panels. Breakers is the number of breaker poles installed per panel.',
      [{ name: 'Breakers per Panel', value: 20 }, { name: 'Feeder Conductors', value: 5 }],
      [
        item('Panelboard', 'ea', '[Count]'),
        item('Breakers', 'ea', '[Count] * [Breakers per Panel]'),
        item('Feeder terminations', 'ea', '[Count] * [Feeder Conductors]'),
        item('Backboard', 'ea', '[Count]'),
        item('Directory and labels', 'ea', '[Count]'),
      ],
    ),
    assembly(
      'Fire alarm device',
      `Count the devices. Cable per Device is the loop wire to the next device; Test Hours is programming and testing per device. ${lengths}.`,
      [v('Cable per Device', 60, 18), { name: 'Test Hours', value: 0.25 }],
      [
        item('Device', 'ea', '[Count]'),
        item('Back box', 'ea', '[Count]'),
        item('Mounting plate', 'ea', '[Count]'),
        item('Cable', u.len, '[Count] * [Cable per Device]', { waste: 10 }),
        item('Programming and test', 'hr', '[Count] * [Test Hours]'),
      ],
    ),
    assembly(
      'Data or voice outlet',
      `Count the outlets. Jacks per Outlet is the number of ports; Cable per Drop is the run from the rack. ${lengths}.`,
      [{ name: 'Jacks per Outlet', value: 2 }, v('Cable per Drop', 150, 46)],
      [
        item('Jacks', 'ea', '[Count] * [Jacks per Outlet]'),
        item('Faceplate', 'ea', '[Count]'),
        item('Box', 'ea', '[Count]'),
        item('Cable', u.len, '[Count] * [Jacks per Outlet] * [Cable per Drop]', { waste: 10 }),
        item('Labels', 'ea', '[Count] * [Jacks per Outlet]'),
        item('Testing', 'ea', '[Count] * [Jacks per Outlet]'),
      ],
    ),
    assembly(
      'Grounding electrode',
      `Count the rods. Cable per Rod is the bonding conductor to each. ${lengths}.`,
      [v('Cable per Rod', 25, 8)],
      [item('Ground rod', 'ea', '[Count]'), item('Rod clamp', 'ea', '[Count]'), item('Bonding cable', u.len, '[Count] * [Cable per Rod]', { waste: 10 }), item('Exothermic welds', 'ea', '[Count] * 2')],
    ),
  ];

  return [
    { discipline: 'Architectural', assemblies: architectural },
    { discipline: 'Civil and site', assemblies: civil },
    { discipline: 'Structural', assemblies: structural },
    { discipline: 'Mechanical', assemblies: mechanical },
    { discipline: 'Electrical', assemblies: electrical },
  ];
}

/** Every example, across disciplines. */
export function starterAssemblies(system: UnitSystem): Assembly[] {
  return starterGroups(system).flatMap((g) => g.assemblies);
}
