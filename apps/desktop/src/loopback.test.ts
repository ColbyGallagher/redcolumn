import assert from 'node:assert/strict';
import test from 'node:test';
import { listenForCode, SignInClosed, validTenant } from './loopback.ts';

test('a callback without the expected state is ignored', async () => {
  const loop = await listenForCode('expected');
  assert.match(loop.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  const wrong = await fetch(`${loop.redirectUri}/?state=other&code=evil`);
  assert.equal(wrong.status, 404);
  const right = await fetch(`${loop.redirectUri}/?state=expected&code=good`);
  assert.equal(right.status, 200);
  assert.equal(await loop.code, 'good');
});

test('closing the listener ends the wait as closed', async () => {
  const loop = await listenForCode('s');
  loop.close();
  await assert.rejects(loop.code, SignInClosed);
});

test('a refused consent reads as closed', async () => {
  const loop = await listenForCode('s');
  await fetch(`${loop.redirectUri}/?state=s&error=access_denied`);
  await assert.rejects(loop.code, SignInClosed);
});

test('tenants are names, never paths', () => {
  assert.equal(validTenant('common'), true);
  assert.equal(validTenant('contoso.onmicrosoft.com'), true);
  assert.equal(validTenant('72f988bf-86f1-41af-91ab-2d7cd011db47'), true);
  assert.equal(validTenant('../evil'), false);
  assert.equal(validTenant('a/b'), false);
  assert.equal(validTenant(''), false);
});
