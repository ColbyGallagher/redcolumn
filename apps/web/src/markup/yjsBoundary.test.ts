import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A markup store keeps its contents in a Yjs document, but only the markup package and the code
// that syncs stores with other copies (`apps/web/src/studio/`) may reach into it. Everything else
// goes through the store's methods, so another kind of store can stand in for it.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCANNED = ['apps', 'packages', 'e2e', 'scripts'];
/** Build output, installed packages, test reports and static assets, none of it written here. */
const SKIPPED_DIR = /^(node_modules|dist.*|build|out|release|public|test-results|playwright-report|\..+)$/;
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
/** Where a store's Yjs internals may be used. */
const INSIDE = ['packages/markup/', 'apps/web/src/studio/'];
const THIS_FILE = 'apps/web/src/markup/yjsBoundary.test.ts';

type Rule = { what: string; pattern: RegExp; allowed?: Record<string, string> };

const RULES: Rule[] = [
  {
    what: 'imports Yjs',
    pattern: /\bfrom\s+['"](yjs|y-[\w-]+)['"]|\bimport\(\s*['"](yjs|y-[\w-]+)['"]\s*\)|\brequire\(\s*['"](yjs|y-[\w-]+)['"]\s*\)/,
    // Device storage for markups: `setMarkupPersistence` hands it the store's Y.Doc to save.
    allowed: { 'apps/web/src/storage/localCrypto.ts': 'the markup persistence adapter' },
  },
  { what: "uses a store's undo manager (call undo(), redo() or checkpoint())", pattern: /\.undoManager\b/ },
  {
    what: "reaches into a store's Yjs document or maps (use the store's methods)",
    pattern: /\b\w*[sS]tore\??\.(doc|map|scales|sheets|links|viewports|outline|meta|aiReviewMap|files)\b(?!\s*\()/,
  },
  {
    what: "uses a store's Yjs facet",
    pattern: /\.yjs\b/,
    // Seeding a new Live Session with the markups a document already has.
    allowed: { 'apps/web/src/App.tsx': 'Live Session seeding' },
  },
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIR.test(entry.name)) out.push(...sources(rel));
    } else if (SOURCE.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Each use of a store's Yjs internals in `text` (from the file at `rel`) that the rules forbid. */
function violations(rel: string, text: string): string[] {
  if (INSIDE.some((dir) => rel.startsWith(dir))) return [];
  const found: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const rule of RULES) if (rule.pattern.test(line) && !rule.allowed?.[rel]) found.push(`${rel}:${i + 1} ${rule.what}: ${line.trim().slice(0, 160)}`);
  });
  return found;
}

test("only the markup package and studio/ use a markup store's Yjs internals", () => {
  const files = SCANNED.flatMap(sources).filter((f) => f !== THIS_FILE);
  assert.ok(files.length > 500, `found only ${files.length} source files under ${root}`);
  const found = files.flatMap((f) => violations(f, readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(found, []);
});

test('the boundary rules catch each kind of reach-in, and leave alike names alone', () => {
  const at = (text: string, rel = 'apps/web/src/viewer/x.ts') => violations(rel, text).length;
  assert.equal(at("import * as Y from 'yjs';"), 1);
  assert.equal(at("const { Doc } = await import('yjs');"), 1);
  assert.equal(at("import { IndexeddbPersistence } from 'y-indexeddb';"), 1);
  assert.equal(at('Y.applyUpdate(store.doc, seed);'), 1);
  assert.equal(at('open.store.doc.on("update", f);'), 1);
  assert.equal(at('cur.store.map.get(id);'), 1);
  assert.equal(at('markupStore?.meta.get("seq");'), 1);
  assert.equal(at('doc.store.undoManager.undo();'), 1);
  assert.equal(at('const seed = store.yjs.encodeState();'), 1);
  assert.equal(at('const seed = store.yjs.encodeState();', 'apps/web/src/App.tsx'), 0);
  assert.equal(at("import * as Y from 'yjs';", 'apps/web/src/studio/drive/rooms.ts'), 0);
  assert.equal(at('store.undoManager.undo();', 'packages/markup/src/store.test.ts'), 0);
  // An open file's PDF document, a store's own methods, and array map are not a store's internals.
  assert.equal(at('cur.doc.pages.map((_, i) => cur.store.allSheets()[i]);'), 0);
  assert.equal(at('await hideImported(cur.doc, cur.store);'), 0);
  assert.equal(at('store.all().map((m) => m.id); store.allLinks();'), 0);
});
