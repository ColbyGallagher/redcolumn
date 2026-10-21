import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCrs, geoAt, gridToLatLon } from '@nb/measure';
import { geoRegionFor, gridToPage, initialPlacement, pageToGrid, placementFromPairs, ratioOfScale, scaleOfRatio } from './align.ts';
import type { StoredStitchGroup } from '@nb/markup';
import { apply } from '@nb/stitch';
import { horizontalSegment } from './ifc.ts';
import { scaleProblems, stitchedSheets, worldBox, worldScale } from './sheets.ts';
import { modelBounds, readModel } from './model.ts';

const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} ≠ ${b} (±${tol})`);

const LANDXML = `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2">
  <Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter"/></Units>
  <CoordinateSystem name="MGA2020" epsgCode="7856" horizontalCoordinateSystemName="GDA2020 / MGA zone 56"/>
  <CgPoints>
    <CgPoint name="P1">6250000.000 330000.000 12.5</CgPoint>
    <CgPoint name="P2">6250100.000 330000.000 12.0</CgPoint>
  </CgPoints>
  <Alignments>
    <Alignment name="MC01" length="178.54">
      <CoordGeom>
        <Line><Start pntRef="P1"/><End pntRef="P2"/></Line>
        <Curve rot="cw" radius="50"><Start>6250100 330000</Start><Center>6250100 330050</Center><End>6250150 330050</End></Curve>
      </CoordGeom>
    </Alignment>
  </Alignments>
  <Surfaces>
    <Surface name="EG">
      <Definition surfType="TIN">
        <Pnts>
          <P id="1">6250000 330000 10</P><P id="2">6250000 330010 10</P><P id="3">6250010 330010 10</P><P id="4">6250010 330000 10</P>
        </Pnts>
        <Faces><F>1 2 3</F><F>1 3 4</F></Faces>
      </Definition>
    </Surface>
  </Surfaces>
</LandXML>`;

test('LandXML: coordinate system, points, alignment and surface outline', () => {
  const m = readModel('design.xml', LANDXML);
  assert.equal(m.format, 'LandXML');
  assert.equal(m.crs?.epsg, 7856);
  assert.deepEqual(m.points.map((p) => p.at), [[330000, 6250000], [330000, 6250100]]);
  // The line and the arc join into one path, from P1 north, then curving east.
  const alignment = m.paths[0]!;
  assert.deepEqual(alignment[0], [330000, 6250000]);
  near(alignment.at(-1)![0], 330050, 1e-6);
  near(alignment.at(-1)![1], 6250150, 1e-6);
  // A clockwise arc about a centre to the east bulges north-west of the chord.
  const mid = alignment[Math.floor((alignment.length + 2) / 2)]!;
  assert.ok(mid[1] > 6250100 && mid[0] < 330050);
  // The two triangles' outline: four edges, not the shared diagonal.
  assert.equal(m.paths.length, 1 + 4);
});

const IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [Alignment-basedView]'),'2;1');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'Site',$,$,$,$,(#20),#10);
#10=IFCUNITASSIGNMENT((#11,#12));
#11=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#12=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);
#20=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#21,$);
#21=IFCAXIS2PLACEMENT3D(#22,$,$);
#22=IFCCARTESIANPOINT((0.,0.,0.));
#30=IFCPROJECTEDCRS('EPSG:7856','GDA2020 / MGA zone 56','GDA2020',$,'Transverse Mercator','56',#31);
#31=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#32=IFCMAPCONVERSION(#20,#30,330000.,6250000.,0.,1.,0.,0.001);
#40=IFCLOCALPLACEMENT($,#41);
#41=IFCAXIS2PLACEMENT3D(#42,$,$);
#42=IFCCARTESIANPOINT((10000.,20000.,0.));
#50=IFCWALL('2O2Fr$t4X7Zf8NOew3FLOH',$,'Wall',$,$,#40,#51,$,$);
#51=IFCPRODUCTDEFINITIONSHAPE($,$,(#52));
#52=IFCSHAPEREPRESENTATION(#20,'Body','SweptSolid',(#53));
#53=IFCEXTRUDEDAREASOLID(#54,#57,#59,3000.);
#54=IFCRECTANGLEPROFILEDEF(.AREA.,$,#55,4000.,200.);
#55=IFCAXIS2PLACEMENT2D(#56,$);
#56=IFCCARTESIANPOINT((2000.,100.));
#57=IFCAXIS2PLACEMENT3D(#58,$,$);
#58=IFCCARTESIANPOINT((0.,0.,0.));
#59=IFCDIRECTION((0.,0.,1.));
#60=IFCALIGNMENT('1F7jbTWXz8DQnL5jpr0BMQ',$,'MC01',$,$,#61,$,$);
#61=IFCLOCALPLACEMENT($,#57);
#62=IFCALIGNMENTHORIZONTAL('3BQpWkhub3eRHmYzwECmEm',$,$,$,$,$,$);
#63=IFCRELNESTS('0kRpX9i6r3cgHXwhXE11Jd',$,$,$,#60,(#62));
#64=IFCALIGNMENTSEGMENT('1Gl5fZ2Ln7YRflrm$vBOfl',$,$,$,$,$,$,#65);
#65=IFCALIGNMENTHORIZONTALSEGMENT($,$,#66,1.5707963267949,0.,0.,100000.,$,.LINE.);
#66=IFCCARTESIANPOINT((0.,0.));
#67=IFCRELNESTS('2Ko9PGgnL1v8cZZxpBvf3J',$,$,$,#62,(#64));
ENDSEC;
END-ISO-10303-21;`;

test('IFC 4.3: map conversion, millimetre units, an extruded wall and an alignment', () => {
  const m = readModel('bridge.ifc', IFC);
  assert.equal(m.format, 'IFC');
  assert.equal(m.crs?.epsg, 7856);
  const wall = m.paths.find((p) => p.length === 5)!;
  // The wall's 4 m × 0.2 m outline starts 10 m east, 20 m north of the map origin.
  const b = modelBounds({ paths: [wall], points: [] })!;
  near(b.minE, 330010, 1e-6, 'minE');
  near(b.maxE, 330014, 1e-6, 'maxE');
  near(b.minN, 6250020, 1e-6, 'minN');
  near(b.maxN, 6250020.2, 1e-6, 'maxN');
  // The alignment: 100 m due north (direction π/2) from the map origin.
  const line = m.paths.find((p) => p.length === 2)!;
  near(line[0]![0], 330000, 1e-6);
  near(line[1]![1], 6250100, 1e-4);
});

test('IFC 4.3 horizontal segments: arcs and clothoids', () => {
  // A quarter circle of radius 100 turning left from east.
  const arc = horizontalSegment([0, 0], 0, 100, 100, (Math.PI / 2) * 100, 'CIRCULARARC').at(-1)!;
  near(arc[0]!, 100, 1e-6);
  near(arc[1]!, 100, 1e-6);
  // A clothoid from straight to radius 200 over 100 m turns through L / 2R = 0.25 rad.
  const pts = horizontalSegment([0, 0], 0, 0, 200, 100, 'CLOTHOID');
  const [a, b] = pts.slice(-2) as [number[], number[]];
  near(Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!), 0.25, 0.01);
  // Its end: x ≈ L − L⁵/(40 R² L²) and y ≈ L³/(6 R L) − L⁷/(336 R³ L³).
  near(pts.at(-1)![0]!, 100 - 100 ** 5 / (40 * 200 ** 2 * 100 ** 2), 0.01);
  near(pts.at(-1)![1]!, 100 ** 3 / (6 * 200 * 100) - 100 ** 7 / (336 * 200 ** 3 * 100 ** 3), 0.001);
});

test('DXF: lines and polylines, in the drawing unit', () => {
  const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '330000', '20', '6250000', '11', '330010', '21', '6250000', '0', 'LWPOLYLINE', '90', '3', '70', '1', '10', '1', '20', '2', '10', '3', '20', '4', '10', '5', '20', '6', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const m = readModel('site.dxf', dxf);
  assert.equal(m.format, 'DXF');
  assert.equal(m.crs, null);
  assert.deepEqual(m.paths[0], [[330000, 6250000], [330010, 6250000]]);
  assert.deepEqual(m.paths[1], [[1, 2], [3, 4], [5, 6], [1, 2]]);
});

test('GeoJSON in longitude and latitude is projected into its MGA zone', () => {
  const m = readModel('sites.geojson', JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Point', coordinates: [151.2, -33.87] } }] }));
  assert.equal(m.crs?.epsg, 7856);
  const back = gridToLatLon(m.crs!, ...m.points[0]!.at);
  near(back.lat, -33.87, 1e-9);
  near(back.lon, 151.2, 1e-9);
});

test('placements: page ↔ grid, two-point alignment, and paper scale', () => {
  const p = placementFromPairs([330000, 6250000], [100, 700], [330100, 6250100], [300, 500])!;
  // 100 m east and north is 200 pt right and up: 45° from east either way, so no turn.
  near(p.rotation, 0, 1e-12);
  near(p.scale, 2, 1e-12);
  const at = gridToPage(p, [330050, 6250050]);
  near(at[0], 200, 1e-9);
  near(at[1], 600, 1e-9);
  const g = pageToGrid(p, at);
  near(g[0], 330050, 1e-9);
  near(g[1], 6250050, 1e-9);
  // Turned: the model's north is the sheet's left.
  const turned = placementFromPairs([0, 0], [100, 100], [0, 10], [90, 100])!;
  near(turned.rotation, Math.PI / 2, 1e-12);
  const back = pageToGrid(turned, gridToPage(turned, [3, 7]));
  near(back[0], 3, 1e-9);
  near(back[1], 7, 1e-9);
  near(ratioOfScale(scaleOfRatio(500)), 500, 1e-9);
  // A page drawn at 1:500 is 1/500 m of paper per metre.
  near(initialPlacement({ paths: [[[0, 0], [10, 10]]], points: [] }, { x: 0, y: 0, width: 612, height: 792 }, scaleOfRatio(500)).scale, scaleOfRatio(500), 1e-9);
});

test('a placed model registers the page: its points read back as their latitudes and longitudes', () => {
  const crs = findCrs('EPSG:7855')!;
  const placement = placementFromPairs([273000, 5796000], [100, 700], [273800, 5796600], [500, 400])!;
  const region = geoRegionFor({ toGrid: (p) => pageToGrid(placement, p), crs, pageIndex: 0, bounds: [[0, 0], [612, 0], [612, 792], [0, 792]], name: 'Test' });
  const page = gridToPage(placement, [273741.297, 5796489.777]);
  const got = geoAt([region], 0, page)!;
  // Flinders Peak (ICSM's example point).
  near(got.lat, -(37 + 57 / 60 + 3.7203 / 3600), 1e-8, 'lat');
  near(got.lon, 144 + 25 / 60 + 29.5244 / 3600, 1e-8, 'lon');
});

test('two-point alignment at the sheet’s scale only moves and turns the model', () => {
  // The sheet points are 10% further apart than the model at 2 pt/m: the scale holds, centred between them.
  const p = placementFromPairs([0, 0], [100, 100], [100, 0], [320, 100], 2)!;
  near(p.scale, 2, 1e-12);
  near(p.rotation, 0, 1e-12);
  const mid = gridToPage(p, [50, 0]);
  near(mid[0], 210, 1e-9);
  near(mid[1], 100, 1e-9);
});

test('a model aligned over a stitch registers each sheet through where it sits', () => {
  // Two A3 sheets at 1:500, side by side: sheet 1 is 1000 pt right of sheet 0 in the stitch, and its drawing area is its left half.
  const toWorld0 = [1, 0, 0, 1, 0, 0] as const;
  const toWorld1 = [1, 0, 0, 1, 1000, 0] as const;
  const group = {
    placements: [
      { pageIndex: 0, toWorld: toWorld0, clips: [] },
      { pageIndex: 1, toWorld: toWorld1, clips: [], region: [[0, 0], [600, 0], [600, 842], [0, 842]] as [number, number][] },
    ],
    edges: [],
  } as unknown as StoredStitchGroup;
  const sheets = stitchedSheets(group, () => ({ width: 1191, height: 842 }));
  assert.deepEqual(sheets.map((s) => s.bounds.length), [4, 4]);
  const mpp = 500 * (0.0254 / 72);
  const scale = worldScale(sheets[0]!, mpp)!;
  assert.deepEqual(scaleProblems(sheets, scale, () => mpp), []);
  assert.deepEqual(scaleProblems(sheets, scale, (p) => (p ? null : mpp)), [{ pageIndex: 1, problem: 'none' }]);
  const box = worldBox(sheets);
  assert.deepEqual([box.x, box.width], [0, 1600]);
  // The model, placed in the stitch's world.
  const placement = placementFromPairs([330000, 6250000], [100, 700], [330100, 6250000], [100 + 100 * scale, 700], scale)!;
  const crs = findCrs(7856)!;
  const regions = sheets.map((s) => geoRegionFor({ toGrid: (p) => pageToGrid(placement, apply(s.toWorld, p)), crs, pageIndex: s.pageIndex, bounds: s.bounds, name: 'Plans' }));
  // A grid point on sheet 1 reads back its own latitude and longitude there.
  const grid: [number, number] = [330000 + 1100 / scale, 6250000];
  const onSheet1 = apply(sheets[1]!.fromWorld, gridToPage(placement, grid));
  assert.ok(onSheet1[0] > 0 && onSheet1[0] < 600);
  const got = geoAt(regions, 1, onSheet1)!;
  const want = gridToLatLon(crs, ...grid);
  near(got.lat, want.lat, 1e-9, 'lat');
  near(got.lon, want.lon, 1e-9, 'lon');
});
