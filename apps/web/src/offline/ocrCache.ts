/**
 * OCR's engine and language data are too large to download with the app (about 4 MB for the
 * engine and 1–3 MB a language), so the service worker caches them the first time OCR uses them
 * (vite.config.ts, runtimeCaching). Preferences › Offline can also download them ahead of time,
 * into the same cache, so OCR works in the field without ever having been used online.
 */

export const OCR_CACHE = 'nb-ocr';

/** Tesseract loads one engine build, picked by the browser's WebAssembly features. */
export function ocrEngineFile(simd: boolean, relaxedSimd: boolean): string {
  return relaxedSimd ? 'tesseract-core-relaxedsimd-lstm.wasm.js' : simd ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
}

/** The same feature tests Tesseract makes (wasm-feature-detect's simd and relaxedSimd modules). */
export function detectOcrEngine(): string {
  const valid = (bytes: number[]) => {
    try {
      return WebAssembly.validate(new Uint8Array(bytes));
    } catch {
      return false;
    }
  };
  const simd = valid([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  const relaxed = valid([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);
  return ocrEngineFile(simd, relaxed);
}

/** What OCR in one language needs: the worker, the engine and the language's data. */
export const ocrFiles = (lang: string, engine: string) => ['worker.min.js', engine, `${lang}.traineddata.gz`];

const url = (name: string) => new URL(`${import.meta.env.BASE_URL}ocr/${name}`, location.href).href;

async function has(cache: Cache, name: string) {
  return !!(await cache.match(url(name)));
}

/** Which languages (and whether the engine) are on this device. */
export async function ocrOffline(langs: readonly string[]): Promise<{ engine: boolean; langs: Record<string, boolean> }> {
  if (typeof caches === 'undefined') return { engine: false, langs: {} };
  const cache = await caches.open(OCR_CACHE);
  const engine = (await has(cache, 'worker.min.js')) && (await has(cache, detectOcrEngine()));
  const out: Record<string, boolean> = {};
  for (const l of langs) out[l] = await has(cache, `${l}.traineddata.gz`);
  return { engine, langs: out };
}

/** Downloads what OCR in `lang` needs into the cache (files already there are kept). */
export async function downloadOcr(lang: string): Promise<void> {
  const cache = await caches.open(OCR_CACHE);
  for (const name of ocrFiles(lang, detectOcrEngine())) {
    if (await has(cache, name)) continue;
    const res = await fetch(url(name));
    if (!res.ok) throw new Error(`Could not download ${name} (${res.status}).`);
    await cache.put(url(name), res);
  }
}

/** Removes a language's data (the engine stays for the other languages). */
export async function removeOcr(lang: string): Promise<void> {
  const cache = await caches.open(OCR_CACHE);
  await cache.delete(url(`${lang}.traineddata.gz`));
}
