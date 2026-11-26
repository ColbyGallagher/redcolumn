import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCrs } from '@nb/measure';
import { CHANGES, DATUM, E0, guid, kestrelIfc, N0 } from '../../../../scripts/roadset/ifc.mjs';
import { applyMatrix, ifcGridTransform, parseIfc, parseStep } from './ifc.ts';

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

/** A minimal IFC file: units, a context, and the given map conversion lines. */
const ifc = (unit: string, conversion: string) => `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'P',$,$,$,$,(#20),#10);
#10=IFCUNITASSIGNMENT((#11,#12));
#11=${unit};
#12=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);
#20=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#21,$);
#21=IFCAXIS2PLACEMENT3D(#22,$,$);
#22=IFCCARTESIANPOINT((0.,0.,0.));
#30=IFCPROJECTEDCRS('Map Grid of Australia',$,'GDA2020','AHD','MGA','56',#31);
#31=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
${conversion}
ENDSEC;
END-ISO-10303-21;`;

test('IfcMapConversion: offset, rotation and scale, by hand', () => {
  // Millimetre model, x axis turned 30° anticlockwise from grid east, scale 0.001 (mm → m) × 0.9996.
  const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
  const t = ifcGridTransform(
    parseStep(ifc('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)', `#32=IFCMAPCONVERSION(#20,#30,318250.,6246900.,10.,${c},${s},0.0009996);`)),
  );
  assert.equal(t.georeferenced, true);
  assert.equal(t.crsName, 'Map Grid of Australia zone 56');
  assert.equal(t.zone, '56');
  assert.equal(t.lengthUnit, 0.001);
  assert.equal(t.mapUnit, 1);
  // (1000, 2000, 3000) mm: rotated → (1000c − 2000s, 1000s + 2000c), scaled, offset.
  const k = 0.0009996;
  const [e, n, h] = applyMatrix(t.matrix, 1000, 2000, 3000);
  near(e, 318250 + k * (1000 * c - 2000 * s));
  near(n, 6246900 + k * (1000 * s + 2000 * c));
  near(h, 10 + k * 3000);
  // The matrix is column-major with translation last.
  assert.deepEqual(t.matrix.slice(12), [318250, 6246900, 10, 1]);
});

test('IfcMapConversionScaled: a factor per axis', () => {
  const t = ifcGridTransform(parseStep(ifc('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)', '#32=IFCMAPCONVERSIONSCALED(#20,#30,500000.,7000000.,-5.,0.,1.,2.,0.5,0.25,4.);')));
  // x axis along grid north: model (1, 0) → north; (0, 1) → west. Easting takes FactorX, northing FactorY.
  const [e, n, h] = applyMatrix(t.matrix, 10, 20, 3);
  near(e, 500000 - 2 * 0.5 * 20);
  near(n, 7000000 + 2 * 0.25 * 10);
  near(h, -5 + 2 * 4 * 3);
});

test('no map conversion: model units taken as grid metres', () => {
  const t = ifcGridTransform(parseStep(ifc('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)', '')));
  assert.equal(t.georeferenced, false);
  assert.equal(t.crsName, null);
  assert.deepEqual(applyMatrix(t.matrix, 1000, 2000, 3000), [1, 2, 3]);
});

test('the Kestrel Road model parses and lands in MGA zone 56', () => {
  const text = kestrelIfc('A');
  const t = ifcGridTransform(parseStep(text));
  assert.deepEqual(t.matrix, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, E0, N0, DATUM, 1]);
  const m = parseIfc(text);
  assert.equal(findCrs(m.crsName)?.epsg, 7856);
  assert.deepEqual(m.warnings, []);
  const pts = m.paths.flat();
  assert.ok(pts.length > 1000);
  // Within the demo set's world extents (1010 × 574 m from the origin).
  for (const [e, n] of pts) {
    assert.ok(e > E0 && e < E0 + 1010, `E ${e}`);
    assert.ok(n > N0 && n < N0 + 574, `N ${n}`);
  }
  // MC00 starts at world (60, 445): its first horizontal segment is drawn from there.
  assert.ok(m.paths.some((p) => Math.hypot(p[0]![0] - (E0 + 60), p[0]![1] - (N0 + 445)) < 1e-3));
});

test('Kestrel Road revision B adds, removes and changes the listed elements', () => {
  const ids = (rev: 'A' | 'B') =>
    new Map(
      [...parseStep(kestrelIfc(rev)).values()]
        .filter((e) => ['IFCPAVEMENT', 'IFCCOURSE', 'IFCKERB'].includes(e.type))
        .map((e) => [e.args[0] as string, e.args[2] as string]),
    );
  const [a, b] = [ids('A'), ids('B')];
  for (const name of CHANGES.added) assert.ok(b.has(guid(name)) && !a.has(guid(name)), name);
  for (const name of CHANGES.removed) assert.ok(a.has(guid(name)) && !b.has(guid(name)), name);
  for (const name of CHANGES.changed) assert.ok(a.has(guid(name)) && b.has(guid(name)), name);
  assert.equal(b.size - a.size, CHANGES.added.length - CHANGES.removed.length);
  // The generator is deterministic, and the committed copies are its output (rerun `node scripts/roadset/ifc.mjs`).
  for (const rev of ['A', 'B'] as const) {
    const file = readFileSync(new URL(`../../../../docs/demo-sets/kestrel-road-rev${rev}.ifc`, import.meta.url), 'utf8');
    assert.equal(file.replace(/\r\n/g, '\n'), kestrelIfc(rev));
  }
});
