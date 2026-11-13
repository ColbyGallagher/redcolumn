import { EMPTY_ESTIMATING, mergeAssemblies, mergeEstimating, referencedRecords, sanitizeEstimating, type Assembly, type Estimating, type EstimatingFile, type MarkupStore } from '@nb/markup';
import { loadLibrary, writeLibrary } from './library';

/**
 * The app-wide estimating library: catalog items, product lists and takeoff templates kept in this
 * browser (beside My Assemblies), to use in any document. Using a library record in a document
 * copies it, and whatever it links to, into the document, so the document stands on its own.
 */
const KEY = 'nb.estimatingLibrary';

export function loadEstimatingLibrary(): Estimating {
  try {
    return sanitizeEstimating(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return EMPTY_ESTIMATING;
  }
}

/** Saves the library; false when the browser would not keep it (private window, storage full). */
export function writeEstimatingLibrary(lib: Estimating): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}

/** Everything in the library, My Assemblies included, as an estimating file's contents. */
export function libraryFile(): EstimatingFile {
  return { assemblies: loadLibrary(), ...loadEstimatingLibrary() };
}

/** Adds `incoming` to the library (matched by id, then name); false when the browser would not keep it. */
export function addToLibrary(incoming: Partial<EstimatingFile>): boolean {
  const ok = incoming.assemblies?.length ? writeLibrary(mergeAssemblies(loadLibrary(), incoming.assemblies)) : true;
  return writeEstimatingLibrary(mergeEstimating(loadEstimatingLibrary(), incoming)) && ok;
}

/** The document's estimating records as one file's contents. */
export function documentFile(store: MarkupStore): EstimatingFile {
  return { assemblies: store.assemblies(), ...store.estimating() };
}

/**
 * Copies into the document the records `assemblyIds` and `itemIds` need from `from` that it lacks
 * (by id): the assemblies, the items they link to and those items' product lists. One undo step.
 */
export function copyIntoDocument(store: MarkupStore, from: EstimatingFile, assemblyIds: Iterable<string>, itemIds: Iterable<string> = []) {
  const need = referencedRecords(from, assemblyIds, itemIds);
  const doc = documentFile(store);
  const missing = <T extends { id: string }>(list: readonly T[], have: readonly T[]) => list.filter((x) => !have.some((h) => h.id === x.id));
  const assemblies: Assembly[] = missing(need.assemblies, doc.assemblies);
  const items = missing(need.items, doc.items);
  const productLists = missing(need.productLists, doc.productLists);
  if (!assemblies.length && !items.length && !productLists.length) return;
  store.batch(() => {
    if (assemblies.length) store.setAssemblies([...doc.assemblies, ...assemblies]);
    if (items.length || productLists.length) store.setEstimating({ ...(items.length ? { items: [...doc.items, ...items] } : {}), ...(productLists.length ? { productLists: [...doc.productLists, ...productLists] } : {}) });
  });
}
