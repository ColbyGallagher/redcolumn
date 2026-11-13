// Runs the app's PDFium worker (packages/pdf-core/src/worker.ts) inside Node, so benchmarks read
// text and line work exactly as the app does. Import with the TypeScript loader registered:
//
//   node --experimental-transform-types --import ./apps/web/test/resolve-ts.mjs --import ./scripts/bench/pdf-node.mjs ...
//
// then `const pdf = await globalThis.__pdfNode()` gives open/text/geometry/close.
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Vite's `?url` imports (the wasm file) become a module exporting the file's URL.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('?url')) {
      const { url } = next(specifier.slice(0, -4), context);
      return { url: `rc-url:${url}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('rc-url:')) return { format: 'module', source: `export default ${JSON.stringify(url.slice(7))};`, shortCircuit: true };
    return next(url, context);
  },
});

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('file:')) return new Response(await readFile(fileURLToPath(url)));
  return realFetch(input, init);
};

let started = null;

/** Starts the worker in this process and returns a small client for it. */
globalThis.__pdfNode = function pdfNode() {
  started ??= (async () => {
    const waiting = new Map();
    globalThis.self = globalThis;
    globalThis.location ??= { origin: '' };
    globalThis.postMessage = (msg) => {
      const w = waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      if (msg.ok) w.resolve(msg);
      else w.reject(new Error(msg.error));
    };
    await import(pathToFileURL(join(root, 'packages/pdf-core/src/worker.ts')).href);
    let nextId = 1;
    const call = (req) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        globalThis.onmessage({ data: { ...req, id }, origin: '' });
      });
    return {
      async open(bytes) {
        const res = await call({ type: 'open', bytes });
        return { docId: res.docId, pages: res.pages };
      },
      async text(docId, pageIndex) {
        return (await call({ type: 'text', docId, pageIndex })).words;
      },
      async geometry(docId, pageIndex) {
        return call({ type: 'geometry', docId, pageIndex });
      },
      async close(docId) {
        await call({ type: 'close', docId });
      },
    };
  })();
  return started;
};
