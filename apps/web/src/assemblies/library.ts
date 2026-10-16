import { sanitizeAssemblies, type Assembly } from '@nb/markup';

/** My Assemblies: assemblies kept in this browser, to bring into any document. */
const LIBRARY_KEY = 'nb.assemblyLibrary';

export function loadLibrary(): Assembly[] {
  try {
    return sanitizeAssemblies(JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

/** Saves the library; false when the browser would not keep it (private window, storage full). */
export function writeLibrary(list: readonly Assembly[]): boolean {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
