// Fails if the shipped web build (apps/web/dist) contains the end-to-end test hook (window.__nb),
// which only development and VITE_E2E builds may have. Run after `pnpm build`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/web/dist');
const hits = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.js'))
  .filter((f) => readFileSync(join(dist, 'assets', f), 'utf8').includes('__nb'));
if (hits.length) {
  console.error(`The test hook (__nb) is in the release build: ${hits.join(', ')}`);
  process.exit(1);
}
console.log('Release build has no test hook.');
