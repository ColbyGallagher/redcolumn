import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, type PDFContext } from 'pdf-lib';
import { calibratedScale, crsProjection, crsWkt, findCrs, geoAt, gridToLatLon, type GeoRegion } from '@nb/measure';
import { exportWithAnnotations } from './export.ts';
import { importGeoRegions, projectionOfWkt } from './geo.ts';
import { readPdfExtras } from './pdfExtras.ts';

type LiteralObject = NonNullable<Parameters<PDFContext['flateStream']>[1]>;

const MGA56 =
  'PROJCS["GDA94 / MGA zone 56",GEOGCS["GDA94",DATUM["Geocentric_Datum_of_Australia_1994",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",153],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]';

/** A letter page whose map (inset 36 pt) is registered as GDAL and Acrobat write it. */
async function geoPdf(gcs: LiteralObject) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(
    PDFName.of('VP'),
    doc.context.obj([
      {
        Type: 'Viewport',
        BBox: [36, 36, 576, 756],
        Name: 'Layers',
        Measure: {
          Type: 'Measure',
          Subtype: 'GEO',
          Bounds: [0, 0, 0, 1, 1, 1, 1, 0],
          GPTS: [-33.95, 151.1, -33.8, 151.1, -33.8, 151.3, -33.95, 151.3],
          LPTS: [0, 0, 0, 1, 1, 1, 1, 0],
          GCS: doc.context.obj(gcs),
        },
      },
    ]),
  );
  return doc.save();
}

test('a geospatial PDF’s map gives the latitude and longitude of page points', async () => {
  const extras = await readPdfExtras(await geoPdf({ Type: 'PROJCS', EPSG: 28356, WKT: PDFString.of(MGA56) }));
  const regions = importGeoRegions(0, extras!.pages[0]!);
  assert.equal(regions.length, 1);
  assert.equal(regions[0]!.crs, 'GDA94 / MGA zone 56');
  assert.equal(regions[0]!.projection.kind, 'transverseMercator');
  // Page space is from the top-left: the map's top-left corner is its north-west corner.
  // A point in from each corner (a corner itself is on the outline).
  const nw = geoAt(regions, 0, [36.01, 36.01])!;
  assert.ok(Math.abs(nw.lat - -33.8) < 1e-4 && Math.abs(nw.lon - 151.1) < 1e-4);
  const se = geoAt(regions, 0, [575.99, 755.99])!;
  assert.ok(Math.abs(se.lat - -33.95) < 1e-4 && Math.abs(se.lon - 151.3) < 1e-4);
  // Outside the map's bounds (in the page margin) there are no coordinates.
  assert.equal(geoAt(regions, 0, [10, 10]), null);
});

test('a coordinate system given only by EPSG code is understood', async () => {
  const extras = await readPdfExtras(await geoPdf({ Type: 'PROJCS', EPSG: 7856 }));
  const [region] = importGeoRegions(0, extras!.pages[0]!);
  assert.deepEqual(region!.projection, { kind: 'transverseMercator', lon0: 153, ellipsoid: region!.projection.kind === 'transverseMercator' ? region!.projection.ellipsoid : null });
  assert.equal(region!.crs, 'EPSG:7856');
});

test('WKT projections', () => {
  assert.equal(projectionOfWkt('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]]]')?.kind, 'geographic');
  const lcc = projectionOfWkt('PROJCS["x",GEOGCS["y"],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",-18],PARAMETER["standard_parallel_2",-36],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",134]]');
  assert.deepEqual(lcc && { ...lcc, ellipsoid: undefined }, { kind: 'lambertConic', lon0: 134, lat0: 0, lat1: -18, lat2: -36, ellipsoid: undefined });
  assert.equal(projectionOfWkt('PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84"],PROJECTION["Mercator_1SP"]]')?.kind, 'mercator');
  assert.equal(projectionOfWkt('PROJCS["x",PROJECTION["Polyconic"]]'), null);
});

test('setting a page scale keeps the page’s map registration', async () => {
  const bytes = await exportWithAnnotations((await geoPdf({ Type: 'PROJCS', EPSG: 28356 })).buffer as ArrayBuffer, [], { pageScales: { 0: calibratedScale(10, 1, 'm') } });
  const out = await PDFDocument.load(bytes);
  const vp = out.getPage(0).node.lookup(PDFName.of('VP'), PDFArray);
  const subtypes = vp.asArray().map((v) => out.context.lookup(v, PDFDict).lookup(PDFName.of('Measure'), PDFDict).get(PDFName.of('Subtype'))?.toString());
  assert.deepEqual(subtypes.sort(), ['/GEO', '/RL']);
});

/** A page registered in the app: grid metres = (x, -y) × 2 + (330000, 6250000), in MGA zone 56. */
function appRegion(): GeoRegion {
  const crs = findCrs('EPSG:7856')!;
  const grid = ([x, y]: [number, number]) => gridToLatLon(crs, 330000 + 2 * x, 6250000 - 2 * y);
  const at: [number, number][] = [[0, 0], [612, 0], [612, 792], [0, 792], [306, 396]];
  return {
    id: 'geo-test',
    pageIndex: 0,
    name: 'Site',
    bounds: [[0, 0], [612, 0], [612, 792], [0, 792]],
    points: at.map((p) => ({ at: p, ...grid(p) })),
    projection: crsProjection(crs),
    crs: crs.name,
    epsg: crs.epsg,
    wkt: crsWkt(crs),
  };
}

test('a page registered in the app is written as a geospatial viewport and reads back', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const region = appRegion();
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [], { geo: { 0: [region] } });
  const regions = importGeoRegions(0, (await readPdfExtras(bytes))!.pages[0]!);
  assert.equal(regions.length, 1);
  assert.equal(regions[0]!.crs, 'GDA2020 / MGA zone 56');
  assert.equal(regions[0]!.epsg, 7856);
  assert.equal(regions[0]!.name, 'Site');
  const expected = gridToLatLon(findCrs(7856)!, 330000 + 2 * 100, 6250000 - 2 * 200);
  const got = geoAt(regions, 0, [100, 200])!;
  assert.ok(Math.abs(got.lat - expected.lat) < 1e-8 && Math.abs(got.lon - expected.lon) < 1e-8, `${got.lat},${got.lon}`);
});

test('a registration made in the app replaces the file’s, and an empty one removes it', async () => {
  const source = (await geoPdf({ Type: 'PROJCS', EPSG: 28356, WKT: PDFString.of(MGA56) })).buffer as ArrayBuffer;
  const replaced = importGeoRegions(0, (await readPdfExtras(await exportWithAnnotations(source, [], { geo: { 0: [appRegion()] } })))!.pages[0]!);
  assert.deepEqual(replaced.map((r) => r.crs), ['GDA2020 / MGA zone 56']);
  const removed = await PDFDocument.load(await exportWithAnnotations(source, [], { geo: { 0: [] } }));
  assert.equal(removed.getPage(0).node.get(PDFName.of('VP')), undefined);
});
