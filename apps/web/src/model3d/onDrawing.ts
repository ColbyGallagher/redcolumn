import { ifcGridTransform, parseStep, type IfcGridTransform } from '../geospatial/ifc';
import { readModel, type GeoModel } from '../geospatial/model';
import { readFile, type StoredFile } from '../storage/fileStore';

/**
 * The open models' linework (IFC read as plan lines, without the 3D viewer), by file hash: read
 * once per file and kept, as reading a big IFC takes a moment.
 */
const linework = new Map<string, Promise<GeoModel>>();

export function modelLinework(file: Pick<StoredFile, 'hash' | 'name'>): Promise<GeoModel> {
  let model = linework.get(file.hash);
  if (!model) {
    model = readFile(file.hash).then((bytes) => readModel(file.name, new TextDecoder().decode(bytes)));
    model.catch(() => linework.delete(file.hash));
    linework.set(file.hash, model);
  }
  return model;
}

/** Where a model's IFC coordinates lie on the map (its IfcMapConversion), by file hash. */
const georeferences = new Map<string, Promise<IfcGridTransform>>();

export function modelGeoreference(file: Pick<StoredFile, 'hash'>): Promise<IfcGridTransform> {
  let geo = georeferences.get(file.hash);
  if (!geo) {
    geo = readFile(file.hash).then((bytes) => ifcGridTransform(parseStep(new TextDecoder().decode(bytes))));
    geo.catch(() => georeferences.delete(file.hash));
    georeferences.set(file.hash, geo);
  }
  return geo;
}
