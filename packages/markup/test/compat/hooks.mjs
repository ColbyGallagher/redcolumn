import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('?url')) {
      const r = next(specifier.slice(0, -4), context);
      return { ...r, url: r.url + '?url', shortCircuit: true };
    }
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      for (const ext of ['.ts', '.tsx', '/index.ts']) { try { return next(specifier + ext, context); } catch {} }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('?url')) return { format: 'module', source: `export default ${JSON.stringify(url.slice(0,-4))};`, shortCircuit: true };
    return next(url, context);
  },
});
