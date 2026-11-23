import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { searchText, type PageText } from '@nb/sheets';
import { splitChrome } from './chrome';
import { bitSet, SearchStore, type DocContent } from './store';
import { DIMS, quantize } from './semantic';

const sqlite3 = await sqlite3InitModule();
const fresh = (now = () => 1) => new SearchStore(new sqlite3.oo1.DB(':memory:'), now);

/** A page with one line of words at `y`, plus a footer line on every page. */
function page(text: string, footer = 'ACME ROADS PROJECT PLAN'): PageText {
  const line = (s: string, y: number) => s.split(' ').map((t, i) => ({ text: t, x0: 200 + i * 60, y0: y, x1: 250 + i * 60, y1: y + 10, size: 10, angle: 0 }));
  return { width: 800, height: 600, words: [...line(text, 200), ...line(footer, 580)] };
}

function doc(texts: string[]): DocContent {
  const pages = texts.map((t) => page(t));
  return { pages, text: splitChrome(pages), info: { title: 'Set' }, notes: [] };
}

test('stores pages and reads them back with their word boxes', () => {
  const s = fresh();
  const d = doc(['TORQUE M12 BOLTS', 'GENERAL NOTES']);
  s.put('a', d);
  const back = s.load('a')!;
  assert.deepEqual(back.info, { title: 'Set' });
  assert.equal(back.pages.length, 2);
  assert.deepEqual(back.pages[0]!.words.map((w) => w.text), d.pages[0]!.words.map((w) => w.text));
  assert.deepEqual(back.pages[1]!.words[0], d.pages[1]!.words[0]);
});

test('text-only entries narrow searches but are not whole documents', () => {
  const s = fresh();
  s.put('a', { ...doc(['TORQUE']), info: null, notes: null });
  assert.equal(s.load('a'), null);
  assert.deepEqual(s.candidates(['a'], 'torque').hits, { a: { pages: [0], rank: s.candidates(['a'], 'torque').hits!.a!.rank } });
});

test('page text alone is only stored when nothing is', () => {
  const s = fresh();
  s.put('a', doc(['TORQUE']));
  s.put('a', { ...doc(['OTHER']), info: null, notes: null });
  assert.deepEqual(s.load('a')!.info, { title: 'Set' });
  assert.equal(s.load('a')!.pages[0]!.words[0]!.text, 'TORQUE');
  s.put('b', { ...doc(['ONE']), info: null, notes: null });
  s.put('b', { ...doc(['TWO']), info: null, notes: null });
  assert.equal(s.pages('b', [0])![0]!.words[0]!.text, 'ONE');
  // A whole document replaces page text.
  s.put('b', doc(['THREE']));
  assert.equal(s.load('b')!.pages[0]!.words[0]!.text, 'THREE');
});

test('candidates: only pages that can hold the query, in the documents asked for', () => {
  const s = fresh();
  s.put('a', doc(['TORQUE M12 BOLTS', 'GENERAL NOTES', 'BOLT TORQUE TABLE']));
  s.put('b', doc(['TORQUE SEQUENCE']));
  const c = s.candidates(['a', 'missing'], 'torque');
  assert.deepEqual(c.indexed, ['a']);
  assert.deepEqual(Object.keys(c.hits!), ['a']);
  assert.deepEqual([...c.hits!.a!.pages].sort(), [0, 2]);
});

test('candidates never miss a page the exact search finds', () => {
  const texts = ['TORQUE M12 BOLTS', 'C-101 SECTION A-A', 'café crème', 'GENERAL NOTES', 'RL 12.500 FSL', 'STORMWATER PIT'];
  const s = fresh();
  const d = doc(texts);
  s.put('a', d);
  // Prefixes, words inside words, phrases over separators, accents, numbers, partial last words.
  for (const q of ['torque', 'orque', 'orque m1', 'm12 bo', 'C-101', '101', 'section a-a', 'cafe', 'café', 'RL 12.5', '12.500 F', 'water', 'TER PIT', 'notes', 'e m1']) {
    for (const wholeWord of [false, true]) {
      const exact = new Set(searchText(d.pages, q, { wholeWord }).map((h) => h.pageIndex));
      const c = s.candidates(['a'], q, wholeWord);
      const pages = new Set(c.hits === null ? texts.map((_, i) => i) : (c.hits.a?.pages ?? []));
      for (const p of exact) assert.ok(pages.has(p), `"${q}"${wholeWord ? ' (whole word)' : ''}: page ${p} found by the exact search was left out`);
    }
  }
});

test('candidates narrow: a word on no page leaves no pages to read', () => {
  const s = fresh();
  s.put('a', doc(['TORQUE M12', 'GENERAL NOTES']));
  assert.deepEqual(s.candidates(['a'], 'window').hits, {});
});

test('a query with no words cannot narrow the pages', () => {
  const s = fresh();
  s.put('a', doc(['TORQUE M12']));
  assert.equal(s.candidates(['a'], '--').hits, null);
});

test('words in the repeated footer rank below the same words in the body', () => {
  const s = fresh();
  // "PLAN" is in every page's footer, and in the body of page 2 only.
  s.put('a', doc(['GENERAL NOTES', 'DRAINAGE PLAN', 'LONG SECTION']));
  const c = s.candidates(['a'], 'plan');
  assert.equal(c.hits!.a!.pages[0], 1);
  assert.equal(c.hits!.a!.pages.length, 3);
});

test('documents are ranked by their best page', () => {
  const s = fresh();
  s.put('notes', doc(['GENERAL NOTES', 'MORE NOTES']));
  s.put('drainage', doc(['DRAINAGE PLAN DRAINAGE PIT', 'LONG SECTION']));
  const c = s.candidates(['notes', 'drainage'], 'plan');
  assert.ok(c.hits!.drainage!.rank < c.hits!.notes!.rank);
});

test('pages() reads only the pages asked for', () => {
  const s = fresh();
  s.put('a', doc(['ONE', 'TWO', 'THREE']));
  const p = s.pages('a', [1])!;
  assert.equal(p.length, 3);
  assert.equal(p[0]!.words.length, 0);
  assert.equal(p[1]!.words[0]!.text, 'TWO');
  assert.equal(p[0]!.width, 800);
  assert.equal(s.pages('nope', [0]), null);
});

test('suggests a respelling that matches pages in the documents searched', () => {
  const s = fresh();
  s.put('a', doc(['TORQUE M12 BOLTS', 'FLANGE TORQUE SEQUENCE']));
  s.put('b', doc(['DRAINAGE PIT']));
  assert.equal(s.suggest(['a'], 'torqe m12'), 'torque m12');
  assert.equal(s.suggest(['a'], 'flnage'), 'flange');
  // Only words in the searched documents can be offered.
  assert.equal(s.suggest(['a'], 'drianage'), null);
  assert.equal(s.suggest(['a'], 'torque'), null);
});

test('dropping and pruning forget documents', () => {
  let t = 0;
  const s = fresh(() => ++t);
  s.put('a', doc(['TORQUE']));
  s.drop('a');
  assert.deepEqual(s.candidates(['a'], 'torque').indexed, []);
  assert.equal(s.suggest(['a'], 'torqe'), null);
});

test('form fields are kept with an indexed document', () => {
  const s = fresh();
  assert.equal(s.fields('a'), null);
  s.put('a', doc(['ONE']));
  assert.equal(s.fields('a'), null);
  const f = [{ pageIndex: 0, rect: { x: 1, y: 2, w: 3, h: 4 }, label: 'Job', text: '42' }];
  s.setFields('a', f);
  assert.deepEqual(s.fields('a'), f);
});

test('clear empties the index', () => {
  const s = fresh();
  s.put('a', doc(['ONE']));
  s.clear();
  assert.deepEqual(s.candidates(['a'], 'one').indexed, []);
});

/** A stored vector pointing mostly along dimension `d`. */
const along = (d: number) => {
  const v = new Float32Array(DIMS).fill(0.01);
  v[d] = 1;
  return quantize(v);
};

test('pages wait for vectors, recently used documents first, and the chrome is marked', () => {
  let t = 0;
  const s = fresh(() => ++t);
  s.put('old', doc(['ONE TWO THREE', 'SEVEN']));
  s.put('new', doc(['FOUR FIVE SIX', 'EIGHT']));
  const todo = s.unembedded('m', 10);
  assert.equal(todo.length, 4);
  assert.deepEqual(todo[0]!.words.slice(0, 3), ['FOUR', 'FIVE', 'SIX']);
  // The footer (on both pages) is chrome; the body is not.
  assert.equal(bitSet(todo[0]!.chrome, 0), false);
  assert.equal(bitSet(todo[0]!.chrome, todo[0]!.words.length - 1), true);
  s.setVectors('m', todo[0]!.id, []);
  assert.deepEqual(s.unembedded('m', 10).map((p) => p.id), todo.slice(1).map((p) => p.id));
  // Another model starts again.
  assert.equal(s.unembedded('other', 10).length, 4);
  assert.deepEqual(s.embedded(['old', 'new'], 'm'), { done: 1, total: 4 });
});

test('related: pages whose passages point like the query, best first, above the cut-off', () => {
  const s = fresh();
  s.put('a', doc(['TEMPERATURE OF THE PIPE', 'DOOR SCHEDULE', 'GENERAL NOTES']));
  s.put('b', doc(['PIPE TEMPERATURE AGAIN']));
  const pages = s.unembedded('m', 10);
  const [a0, a1, a2, b0] = pages.sort((x, y) => x.id - y.id);
  s.setVectors('m', a0!.id, [{ first: 0, last: 3, vec: along(1) }]);
  s.setVectors('m', a1!.id, [{ first: 0, last: 1, vec: along(2) }]);
  s.setVectors('m', a2!.id, [{ first: 0, last: 1, vec: along(3) }]);
  s.setVectors('m', b0!.id, [{ first: 1, last: 2, vec: along(1) }]);
  const found = s.related(['a', 'b'], 'm', along(1), 10, 0.5);
  assert.deepEqual(found.map((r) => [r.key, r.pageIndex]).sort(), [['a', 0], ['b', 0]]);
  assert.deepEqual(found.find((r) => r.key === 'b')!.words.map((w) => w.text), ['TEMPERATURE', 'AGAIN']);
  // Only the documents searched, and only vectors from the model asked for.
  assert.deepEqual(s.related(['a'], 'm', along(1), 10, 0.5).map((r) => r.key), ['a']);
  assert.deepEqual(s.related(['a', 'b'], 'other', along(1), 10, 0.5), []);
  // Replacing a document drops its vectors.
  s.put('b', doc(['SOMETHING ELSE']));
  assert.deepEqual(s.related(['b'], 'm', along(1), 10, 0.5), []);
});

test('an index laid out by another version is emptied and laid out again', () => {
  const db = new sqlite3.oo1.DB(':memory:');
  new SearchStore(db).put('a', doc(['ONE']));
  db.exec('PRAGMA user_version = 1');
  const s = new SearchStore(db);
  assert.deepEqual(s.candidates(['a'], 'one').indexed, []);
  s.put('a', doc(['ONE']));
  assert.deepEqual(s.candidates(['a'], 'one').indexed, ['a']);
});
