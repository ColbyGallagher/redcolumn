// Lets `node --test --experimental-strip-types` run the app's TypeScript, whose relative imports
// omit the `.ts` extension (as Vite allows). Registered with `node --import`.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        try {
          return next(specifier + ext, context);
        } catch {
          // Try the next extension.
        }
      }
    }
    return next(specifier, context);
  },
  // Vite fills in `import.meta.env` at build time; under node it is undefined, so give the app's
  // modules an empty one (on the first line, so line numbers stay the same).
  load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith('file:') || url.includes('/node_modules/') || !/\.tsx?$/.test(url)) return result;
    const source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source);
    return source.includes('import.meta.env') ? { ...result, source: `import.meta.env ??= {}; ${source}` } : result;
  },
});
