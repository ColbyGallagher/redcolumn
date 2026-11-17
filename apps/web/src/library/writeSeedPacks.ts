// Writes the community library's seed packs into a folder (the redcolumn-library checkout's
// `packs/`): `pnpm --filter @nb/web library:seed <folder>`. The library's own
// `scripts/build-index.mjs` then lists them in index.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packCounts, parseTradePack, tradePackToJson } from './pack.ts';
import { seedPacks } from './seedPacks.ts';

const out = process.argv[2];
if (!out) {
  console.error('Usage: library:seed <folder>');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const standard = readFileSync(new URL('../../../../docs/demo-sets/kestrel-road.rcstandard', import.meta.url), 'utf8');
for (const { file, pack } of seedPacks(standard)) {
  const text = `${tradePackToJson(pack)}\n`;
  // What the app will read back, so a pack that would be refused is never written.
  const counts = packCounts(parseTradePack(text));
  writeFileSync(join(out, file), text);
  console.log(`${file}: ${JSON.stringify(counts)}`);
}
