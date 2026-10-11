// Lets `node --test --experimental-strip-types` import the app's TypeScript, whose relative
// imports omit the `.ts` extension (as tsc's CommonJS emit expects).
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return next(specifier + '.ts', context);
      } catch {
        // Not a TypeScript file; let the next resolver report the real error.
      }
    }
    return next(specifier, context);
  },
});
