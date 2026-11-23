import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemCount, matchesCategory, paletteColour, parseSearchSets, searchable, type SearchSet } from './controls.ts';
import { attrText, flatProperties, groupKey, matchesProperty, propertyGroups, quantitiesOf } from './items.ts';

// An element as the fragments worker returns it with its property and quantity sets.
const KERB = {
  _localId: { value: 42 },
  _category: { value: 'IFCCOURSE' },
  _guid: { value: '2O2Fr$t4X7Zf8NOew3FLOH' },
  Name: { value: 'Kerb CH0-200' },
  ObjectType: { value: 'Kerb' },
  Tag: { value: null },
  IsDefinedBy: [
    {
      Name: { value: 'Pset_Status' },
      HasProperties: [
        { Name: { value: 'Status' }, NominalValue: { value: 'New', type: 'IFCLABEL' } },
        { Name: { value: 'Width' }, NominalValue: { value: 0.15000000001 } },
      ],
    },
    { Name: { value: 'Qto_CourseBaseQuantities' }, Quantities: [{ Name: { value: 'Length' }, LengthValue: { value: 200 } }] },
    { Name: { value: 'Empty' }, HasProperties: [] },
  ],
};

const set = (patch: Partial<SearchSet>): SearchSet => ({ id: 's', name: 'Set', category: '', property: '', value: '', ...patch });

test('attribute values read as text: numbers rounded, booleans worded, missing values empty', () => {
  assert.equal(attrText({ value: 'A' }), 'A');
  assert.equal(attrText({ value: 0.15000000001 }), '0.15');
  assert.equal(attrText({ value: 3 }), '3');
  assert.equal(attrText({ value: true }), 'True');
  assert.equal(attrText({ value: null }), '');
  assert.equal(attrText(undefined), '');
  assert.equal(attrText([{ value: 'x' }]), '');
});

test("an element's properties: attributes first, then its sets by name, quantities included", () => {
  const groups = propertyGroups(KERB);
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Attributes', 'Pset_Status', 'Qto_CourseBaseQuantities'],
  );
  // Internal keys and empty attributes stay out.
  assert.deepEqual(groups[0]!.rows, [
    ['Name', 'Kerb CH0-200'],
    ['ObjectType', 'Kerb'],
  ]);
  assert.deepEqual(groups[1]!.rows, [
    ['Status', 'New'],
    ['Width', '0.15'],
  ]);
  assert.deepEqual(groups[2]!.rows, [['Length', '200']]);
});

test('a search set matches a property by whole name and a value it contains, ignoring case', () => {
  const groups = propertyGroups(KERB);
  assert.ok(matchesProperty(set({ property: 'status', value: 'NEW' }), groups));
  assert.ok(matchesProperty(set({ property: 'Status' }), groups));
  assert.ok(matchesProperty(set({ property: 'objecttype', value: 'ker' }), groups));
  assert.ok(!matchesProperty(set({ property: 'Stat', value: 'New' }), groups));
  assert.ok(!matchesProperty(set({ property: 'Status', value: 'Existing' }), groups));
  assert.ok(matchesProperty(set({ category: 'IFCCOURSE' }), groups), 'no property: passes');
});

test('a search set needs a class or a property; the class matches whole, ignoring case', () => {
  assert.ok(!searchable(set({ value: 'New' })));
  assert.ok(searchable(set({ category: 'ifcwall' })));
  assert.ok(matchesCategory(set({ category: 'ifcwall' }), 'IFCWALL'));
  assert.ok(!matchesCategory(set({ category: 'ifcwall' }), 'IFCWALLSTANDARDCASE'));
  assert.ok(matchesCategory(set({ property: 'Status' }), 'IFCSLAB'));
});

test('search sets read back from an exported file; malformed and empty ones are skipped', () => {
  const sets = parseSearchSets(
    JSON.stringify({ sets: [{ id: 'a', name: 'Walls', category: 'IFCWALL' }, { name: 'Nothing' }, 'junk', { property: 'Status', value: 'New' }] }),
  );
  assert.equal(sets.length, 2);
  assert.deepEqual(sets[0], { id: 'a', name: 'Walls', category: 'IFCWALL', property: '', value: '' });
  assert.equal(sets[1]!.name, 'Search set');
  assert.ok(sets[1]!.id);
  assert.equal(parseSearchSets(JSON.stringify({ category: 'IFCSLAB' })).length, 1, 'one set on its own');
  assert.throws(() => parseSearchSets('not json'));
});

test('counting elements and picking class colours', () => {
  assert.equal(itemCount({ a: [1, 2], b: [3] }), 3);
  assert.equal(itemCount({}), 0);
  const colours = new Set(Array.from({ length: 12 }, (_, i) => paletteColour(i)));
  assert.equal(colours.size, 12);
  assert.match(paletteColour(0), /^hsl\(\d+, 65%, 50%\)$/);
});

test('quantities come from quantity sets only, net before gross, and an element groups by class or any property', () => {
  const groups = propertyGroups({
    ...KERB,
    IsDefinedBy: [
      ...KERB.IsDefinedBy,
      {
        Name: { value: 'Qto_More' },
        Quantities: [
          { Name: { value: 'GrossVolume' }, VolumeValue: { value: 9 } },
          { Name: { value: 'NetVolume' }, VolumeValue: { value: 7.5 } },
          { Name: { value: 'NetSideArea' }, AreaValue: { value: 30 } },
        ],
      },
    ],
  });
  assert.equal(groups.find((g) => g.title === 'Qto_More')?.quantities, true);
  assert.equal(groups.find((g) => g.title === 'Pset_Status')?.quantities, undefined);
  // Width is a property, not a quantity: no length from it.
  assert.deepEqual(quantitiesOf(groups), { length: 200, area: 30, volume: 7.5 });
  assert.deepEqual(quantitiesOf(propertyGroups({ Name: { value: 'Bare' } })), { length: 0, area: 0, volume: 0 });
  assert.equal(groupKey(groups, 'IFCKERB', 'Class'), 'IFCKERB');
  assert.equal(groupKey(groups, 'IFCKERB', 'status'), 'New');
  assert.equal(groupKey(groups, 'IFCKERB', 'Material'), '');
  assert.equal(flatProperties(groups)['Pset_Status.Status'], 'New');
});
