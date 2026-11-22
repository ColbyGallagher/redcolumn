/** Telling 3D model files apart, without loading the 3D viewer (it is a separate chunk). */

export const MODEL_EXTENSIONS = ['.ifc'];

/** For file inputs' accept attribute. */
export const MODEL_ACCEPT = MODEL_EXTENSIONS.join(',');

export function isModelFile(file: { name: string }): boolean {
  return /\.ifc$/i.test(file.name);
}
