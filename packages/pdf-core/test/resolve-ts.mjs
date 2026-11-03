// Lets `node --test --experimental-strip-types` run this package's TypeScript, whose relative imports
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
});
