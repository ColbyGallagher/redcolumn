import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aesKey, canonical, newIdentity, newKeyBytes, parseSecret, seal, sealedEpoch, secretFragment, signed, toB64url, unseal, unwrapFrom, verified, wrapFor } from './keys';

test('sealed bytes open only with their key, and keep their epoch', async () => {
  const key = await aesKey(newKeyBytes());
  const sealed = await seal(key, 3, new TextEncoder().encode('markups'));
  assert.equal(sealedEpoch(sealed), 3);
  assert.equal(new TextDecoder().decode(await unseal(key, sealed)), 'markups');
  await assert.rejects(unseal(await aesKey(newKeyBytes()), sealed));
  sealed[5] = sealed[5]! ^ 1;
  await assert.rejects(unseal(key, sealed), 'the epoch is authenticated');
});

test('signatures, key wrapping and the link secret', async () => {
  const host = await newIdentity(true);
  const sam = await newIdentity();
  const body = await signed(sam, new TextEncoder().encode('delta'));
  assert.ok(await verified(sam.pub.sign, body));
  assert.equal(await verified(host.pub.sign, body), null);
  const raw = newKeyBytes();
  const w = await wrapFor(host.dh, sam.pub.dh, raw, 'epoch-1');
  assert.deepEqual(await unwrapFrom(sam.dh, host.pub.dh, w, 'epoch-1'), raw);
  const secret = { key: toB64url(raw), host: host.fp };
  assert.deepEqual(parseSecret(`https://x/?onedrive=u!abc#${secretFragment(secret)}`), secret);
  assert.equal(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
});
