/** Telling CAD drawings apart, without loading the converter (it is a separate chunk). */

export const CAD_EXTENSIONS = ['.dwg', '.dxf'];

/** For file inputs' accept attribute. */
export const CAD_ACCEPT = CAD_EXTENSIONS.join(',');

export function isCadFile(file: { name: string }): boolean {
  return /\.(dwg|dxf)$/i.test(file.name);
}
