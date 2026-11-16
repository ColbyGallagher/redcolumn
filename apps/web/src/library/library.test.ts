import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fetchIndex, fetchPack, filterEntries, isPackPath, LIBRARY_BASE, parseIndex, tradesOf, type LibraryEntry } from './catalog.ts';
import { describeCounts, packCounts, parseTradePack, tradePackToJson } from './pack.ts';
import { seedPacks } from './seedPacks.ts';

const standard = JSON.parse(readFileSync(new URL('../../../../docs/demo-sets/kestrel-road.rcstandard', import.meta.url), 'utf8')) as { standard: unknown };

const packJson = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'redcolumn.trade-pack',
    version: 1,
    name: 'Roads starter',
    trade: 'Civil / Roads',
    description: 'Kerbs and pavement.',
    author: 'Someone',
    units: 'metric',
    assemblies: [{ id: 'kerb', name: 'Kerb and gutter', description: '', variables: [{ name: 'Width', value: 0.45 }], items: [{ id: 'conc', name: 'Concrete', unit: 'm³', formula: '[Length] * [Width] * 0.15' }] }],
    toolSets: [{ name: 'Road takeoff', items: [{ type: 'length', label: 'Kerb', style: { stroke: '#ff0000', fill: '#00ff00', width: 'thick', bogus: { nested: 1 } } }, { type: 'area', label: 'Pavement' }] }],
    standards: [standard.standard],
    ...extra,
  });

test('a pack is read with its assemblies, tool sets and standards', () => {
  const pack = parseTradePack(packJson());
  assert.equal(pack.name, 'Roads starter');
  assert.equal(pack.trade, 'Civil / Roads');
  assert.equal(pack.units, 'metric');
  assert.equal(pack.estimating.assemblies[0]!.name, 'Kerb and gutter');
  assert.equal(pack.toolSets[0]!.items.length, 2);
  assert.equal(pack.standards[0]!.id, 'kestrel-road-demo');
  assert.equal(describeCounts(packCounts(pack)), '1 assembly, 1 tool set (2 tools), 1 drawing standard');
});

test("a tool's style keeps known values of the right kind and drops the rest", () => {
  const tool = parseTradePack(packJson()).toolSets[0]!.items[0]!;
  assert.equal(tool.style.stroke, '#ff0000');
  assert.equal(tool.style.fill, '#00ff00');
  // `width` is a number in the defaults: a string is not kept.
  assert.equal(typeof tool.style.width, 'number');
  assert.ok(!('bogus' in tool.style));
});

test('a pack round-trips through its file', () => {
  const pack = parseTradePack(packJson());
  const again = parseTradePack(tradePackToJson(pack));
  assert.deepEqual(packCounts(again), packCounts(pack));
  assert.equal(again.toolSets[0]!.items[0]!.label, 'Kerb');
  assert.equal(again.standards[0]!.name, pack.standards[0]!.name);
});

test('packs that are not packs, or carry what redcolumn does not know, are refused', () => {
  assert.throws(() => parseTradePack('{'), /not JSON/);
  assert.throws(() => parseTradePack(JSON.stringify({ format: 'redcolumn-estimating', version: 1 })), /another kind of file/);
  assert.throws(() => parseTradePack(packJson({ version: 99 })), /newer version/);
  assert.throws(() => parseTradePack(packJson({ toolSets: [{ name: 'X', items: [{ type: 'script', label: 'Bad' }] }] })), /markup type/);
  assert.throws(() => parseTradePack(packJson({ toolSets: [{ name: 'X', items: [{ type: 'image', label: 'Pic', image: 'javascript:alert(1)' }] }] })), /not an image/);
  assert.throws(() => parseTradePack(packJson({ assemblies: [], toolSets: [], standards: [] })), /nothing in it/);
  assert.throws(() => parseTradePack(packJson({ standards: [{ id: 'x' }] })), /drawing standard/);
});

test('pack paths stay inside the repository', () => {
  assert.ok(isPackPath('packs/civil-roads.rctrade'));
  assert.ok(!isPackPath('../evil.rctrade'));
  assert.ok(!isPackPath('packs/../../x.rctrade'));
  assert.ok(!isPackPath('/abs.rctrade'));
  assert.ok(!isPackPath('https://example.com/x.rctrade'));
  assert.ok(!isPackPath('packs/x.json'));
  assert.ok(!isPackPath('.github/x.rctrade'));
});

const entry = (over: Partial<LibraryEntry> & Record<string, unknown> = {}) => ({ id: 'civil-roads', name: 'Civil / Roads', trade: 'Civil / Roads', path: 'packs/civil-roads.rctrade', sha256: 'a'.repeat(64), size: 100, ...over });

test('the index keeps entries it can use and leaves out the rest', () => {
  const index = parseIndex(
    JSON.stringify({
      format: 'redcolumn.library-index',
      version: 1,
      updated: '2026-11-15',
      entries: [entry({ contents: { assemblies: 9, tools: -1 }, tags: ['kerb'] }), entry({ id: 'civil-roads' }), entry({ id: 'bad-path', path: '../x.rctrade' }), entry({ id: 'bad-hash', sha256: 'nope' }), entry({ id: 'interiors', name: 'Partitions', trade: 'Interiors' })],
    }),
  );
  assert.deepEqual(
    index.entries.map((e) => e.id),
    ['civil-roads', 'interiors'],
  );
  assert.deepEqual(index.entries[0]!.contents, { assemblies: 9 });
  assert.deepEqual(tradesOf(index), ['Civil / Roads', 'Interiors']);
  assert.deepEqual(
    filterEntries(index.entries, null, 'KERB').map((e) => e.id),
    ['civil-roads'],
  );
  assert.deepEqual(
    filterEntries(index.entries, 'Interiors', '').map((e) => e.id),
    ['interiors'],
  );
  assert.throws(() => parseIndex(JSON.stringify({ format: 'other' })), /another kind/);
});

test('the index and packs are fetched from the library without credentials, and a pack must match its hash', async () => {
  const body = packJson();
  const sha256 = createHash('sha256').update(body).digest('hex');
  const asked: { url: string; init?: RequestInit }[] = [];
  const index = JSON.stringify({ format: 'redcolumn.library-index', version: 1, entries: [entry({ sha256, size: body.length })] });
  const fake = (async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    return new Response(url.endsWith('index.json') ? index : body);
  }) as typeof fetch;
  const list = await fetchIndex(fake);
  const pack = await fetchPack(list.entries[0]!, fake);
  assert.equal(pack.name, 'Roads starter');
  assert.deepEqual(
    asked.map((a) => a.url),
    [`${LIBRARY_BASE}index.json`, `${LIBRARY_BASE}packs/civil-roads.rctrade`],
  );
  for (const a of asked) {
    assert.equal(a.init?.credentials, 'omit');
    assert.equal(a.init?.referrerPolicy, 'no-referrer');
  }
  await assert.rejects(fetchPack({ ...list.entries[0]!, sha256: 'b'.repeat(64) }, fake), /does not match/);
  const down = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(fetchIndex(down), /404/);
});

test('the seed packs are packs the app reads, with the same ids every time they are built', () => {
  const file = readFileSync(new URL('../../../../docs/demo-sets/kestrel-road.rcstandard', import.meta.url), 'utf8');
  const ids = (built: ReturnType<typeof seedPacks>) => built.map(({ pack }) => [...pack.estimating.assemblies.flatMap((a) => [a.id, ...a.items.map((i) => i.id)]), ...pack.estimating.templates.map((t) => t.id)]);
  const first = seedPacks(file);
  assert.deepEqual(ids(first), ids(seedPacks(file)));
  for (const { pack } of first) {
    const read = parseTradePack(tradePackToJson(pack));
    assert.deepEqual(packCounts(read), packCounts(pack));
    // Every template measures with an assembly that is in the pack.
    for (const t of read.estimating.templates) assert.ok(read.estimating.assemblies.some((a) => a.id === t.assemblyId), t.name);
  }
  const civil = first.find((s) => s.id === 'civil-roads')!.pack;
  assert.equal(civil.standards[0]!.id, 'kestrel-road-demo');
  assert.ok(civil.estimating.assemblies.length >= 9);
});
