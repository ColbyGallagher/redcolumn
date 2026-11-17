import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { OpenFileRouter, openIntoWindow } from './open-file.ts';

const accepts = () => true;

test('paths before start wait, then are delivered in order', () => {
  const router = new OpenFileRouter(accepts);
  router.handle('/a.pdf');
  router.handle('/b.pdf');
  const got: string[] = [];
  router.start((p) => got.push(p));
  assert.deepEqual(got, ['/a.pdf', '/b.pdf']);
});

test('paths after start are delivered at once (Open With on a running app)', () => {
  const router = new OpenFileRouter(accepts);
  const got: string[] = [];
  router.start((p) => got.push(p));
  router.handle('/late.pdf');
  assert.deepEqual(got, ['/late.pdf']);
});

test('early paths are not delivered again by a second start', () => {
  const router = new OpenFileRouter(accepts);
  router.handle('/a.pdf');
  const first: string[] = [];
  router.start((p) => first.push(p));
  const second: string[] = [];
  router.start((p) => second.push(p));
  assert.deepEqual(first, ['/a.pdf']);
  assert.deepEqual(second, []);
});

test('one failing early delivery does not lose the rest', () => {
  const router = new OpenFileRouter(accepts);
  router.handle('/a.pdf');
  router.handle('/b.pdf');
  const got: string[] = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    router.start((p) => {
      if (p === '/a.pdf') throw new Error('no window');
      got.push(p);
    });
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(got, ['/b.pdf']);
});

test('unsupported files are dropped with a warning', () => {
  const router = new OpenFileRouter((p) => p.endsWith('.pdf'));
  const got: string[] = [];
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => warned.push(m);
  try {
    router.start((p) => got.push(p));
    router.handle('/notes.txt');
    router.handle('/x.pdf');
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(got, ['/x.pdf']);
  assert.equal(warned.length, 1);
  assert.match(warned[0]!, /notes\.txt/);
});

test('the default rule takes an existing pdf and drops a missing or other file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfile-'));
  const pdf = path.join(dir, 'a.pdf');
  const txt = path.join(dir, 'a.txt');
  fs.writeFileSync(pdf, '%PDF-1.4');
  fs.writeFileSync(txt, 'x');
  const router = new OpenFileRouter();
  const got: string[] = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    router.start((p) => got.push(p));
    router.handle(pdf);
    router.handle(txt);
    router.handle(path.join(dir, 'missing.pdf'));
  } finally {
    console.warn = warn;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(got, [pdf]);
});

function fakeWindows() {
  const noted: string[] = [];
  let queue: { note(p: string): void } | undefined;
  let created = 0;
  return {
    noted,
    get created() {
      return created;
    },
    find: () => queue,
    create: () => {
      created++;
      queue = { note: (p: string) => noted.push(p) };
    },
  };
}

test('no window: one is created, then the file is noted (all windows closed)', () => {
  const w = fakeWindows();
  openIntoWindow(w.find, w.create, () => false, '/a.pdf');
  assert.equal(w.created, 1);
  assert.deepEqual(w.noted, ['/a.pdf']);
});

test('a window exists: none is created', () => {
  const w = fakeWindows();
  w.create();
  openIntoWindow(w.find, w.create, () => false, '/a.pdf');
  assert.equal(w.created, 1);
  assert.deepEqual(w.noted, ['/a.pdf']);
});

test('two files with no window make one window', () => {
  const w = fakeWindows();
  openIntoWindow(w.find, w.create, () => false, '/a.pdf');
  openIntoWindow(w.find, w.create, () => false, '/b.pdf');
  assert.equal(w.created, 1);
  assert.deepEqual(w.noted, ['/a.pdf', '/b.pdf']);
});

test('no window while quitting: nothing is created', () => {
  const w = fakeWindows();
  openIntoWindow(w.find, w.create, () => true, '/a.pdf');
  assert.equal(w.created, 0);
  assert.deepEqual(w.noted, []);
});
