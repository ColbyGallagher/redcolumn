import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenFileRouter } from './open-file.ts';

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

test('early paths are delivered once only', () => {
  const router = new OpenFileRouter(accepts);
  router.handle('/a.pdf');
  const got: string[] = [];
  router.start((p) => got.push(p));
  router.handle('/b.pdf');
  assert.deepEqual(got, ['/a.pdf', '/b.pdf']);
});

test('unsupported files are dropped', () => {
  const router = new OpenFileRouter((p) => p.endsWith('.pdf'));
  const got: string[] = [];
  router.start((p) => got.push(p));
  router.handle('/notes.txt');
  router.handle('/x.pdf');
  assert.deepEqual(got, ['/x.pdf']);
});

test('the default rule drops files that do not exist', () => {
  const router = new OpenFileRouter();
  const got: string[] = [];
  router.start((p) => got.push(p));
  router.handle('/definitely/not/here.pdf');
  assert.deepEqual(got, []);
});
