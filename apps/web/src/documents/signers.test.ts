import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { binaryToBytes, certificateOf, createSelfSignedId, digitalIds, restoreIdBackup, tokenChain, tokenDigitalId, unlockId } from './digitalIds.ts';
import { checkSignatures, signPdf } from './pdfSign.ts';
import { signerFor } from './signers.ts';

const subtle = globalThis.crypto.subtle;
const idPromise = createSelfSignedId({ name: 'Card Holder', email: 'card@example.com', org: 'Acme', password: 'pw' });

/** A fake desktop bridge whose "card" holds the ID's key, non-extractable, and records what it was asked. */
async function fakeCard() {
  const unlocked = unlockId(await idPromise, 'pw');
  const pkcs8 = binaryToBytes(forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(unlocked.key))).getBytes());
  const calls: { ref: string; hash: string; pin: string | null }[] = [];
  const tokens = {
    sign: async (ref: string, hash: string, data: Uint8Array, pin: string | null) => {
      calls.push({ ref, hash, pin });
      const key = await subtle.importKey('pkcs8', pkcs8 as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['sign']);
      return new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', key, data as BufferSource));
    },
  };
  (globalThis as { window?: unknown }).window = { redcolumn: { tokens } };
  return { calls, chainDer: unlocked.chainDer };
}

async function sample() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  return doc.save();
}

test('an ID on a card keeps only its certificate, and signs through the card with the PIN', async (t) => {
  t.after(() => delete (globalThis as { window?: unknown }).window);
  const { calls, chainDer } = await fakeCard();
  const record = await tokenDigitalId({ ref: 'card-key-1', label: 'Signature key', token: 'My Card', pinPad: false, chainDer });
  assert.equal(record.p12, '', 'no key is kept here');
  assert.equal(record.name, 'Card Holder');
  assert.equal(record.fingerprint, (await idPromise).fingerprint);
  assert.deepEqual(tokenChain(record), chainDer);
  // Its certificate can be given out without a password; it cannot be "unlocked".
  assert.deepEqual(certificateOf(record, ''), chainDer[0]);
  assert.throws(() => unlockId(record, 'pw'), /on a card/);

  const signed = await signPdf(await sample(), signerFor(record, '123456'), { reason: 'Approved', digest: 'SHA-384' });
  assert.deepEqual(calls, [{ ref: 'card-key-1', hash: 'SHA-384', pin: '123456' }]);
  const [check] = await checkSignatures(signed);
  assert.equal(check?.problem, null);
  assert.equal(check?.intact, true);
  assert.equal(check?.signer, 'Card Holder');
});

test('a reader with its own keypad gets no PIN from the app', async (t) => {
  t.after(() => delete (globalThis as { window?: unknown }).window);
  const { calls, chainDer } = await fakeCard();
  const record = await tokenDigitalId({ ref: 'pad', label: 'k', token: 'Pad Card', pinPad: true, chainDer });
  await signPdf(await sample(), signerFor(record, 'typed anyway'), {});
  assert.equal(calls[0]?.pin, null);
});

test('once the card refuses the PIN, a Bulk Sign does not try it again (cards lock after a few)', async (t) => {
  t.after(() => delete (globalThis as { window?: unknown }).window);
  const { chainDer } = await fakeCard();
  let asked = 0;
  (globalThis as { window?: unknown }).window = {
    redcolumn: {
      tokens: {
        sign: async () => {
          asked++;
          throw new Error('The PIN is not right.');
        },
      },
    },
  };
  const record = await tokenDigitalId({ ref: 'r', label: 'k', token: 'C', pinPad: false, chainDer });
  const signer = signerFor(record, '000000');
  for (let k = 0; k < 3; k++) await assert.rejects(signPdf(await sample(), signer, {}), /PIN is not right/);
  assert.equal(asked, 1);
});

test('adding the card copy of a .p12 certificate keeps the .p12 (and its key), and the other way round', async (t) => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  t.after(() => delete (globalThis as { localStorage?: unknown }).localStorage);
  const p12 = await idPromise;
  const card = await tokenDigitalId({ ref: 'r', label: 'k', token: 'C', pinPad: false, chainDer: unlockId(p12, 'pw').chainDer });
  digitalIds.add(p12);
  digitalIds.add(card);
  assert.deepEqual(digitalIds.list().map((r) => !!r.token), [false, true]);
  // The same kind again still replaces.
  digitalIds.add({ ...p12, id: 'again' });
  assert.deepEqual(digitalIds.list().map((r) => r.id).sort(), [card.id, 'again'].sort());
  // A backup's .p12 is restored next to the card ID for the same certificate.
  digitalIds.remove('again');
  assert.equal(restoreIdBackup(JSON.stringify({ app: 'RedColumn', kind: 'digital-ids', ids: [p12] }), 'digital-ids'), 1);
  assert.deepEqual(digitalIds.list().map((r) => !!r.token).sort(), [false, true]);
});

test('a blank PIN is asked for before anything is signed', async (t) => {
  t.after(() => delete (globalThis as { window?: unknown }).window);
  const { chainDer } = await fakeCard();
  const record = await tokenDigitalId({ ref: 'r', label: 'k', token: 'C', pinPad: false, chainDer });
  assert.throws(() => signerFor(record, ''), /PIN/);
});

test('an ID on a card needs the desktop app; a .p12 ID still needs its password', async () => {
  delete (globalThis as { window?: unknown }).window;
  const unlocked = unlockId(await idPromise, 'pw');
  const record = await tokenDigitalId({ ref: 'r', label: 'k', token: 'C', pinPad: false, chainDer: unlocked.chainDer });
  assert.throws(() => signerFor(record, '1234'), /only the desktop app/);
  // A .p12 ID is unchanged: unlocked with its password.
  const id = await idPromise;
  assert.ok('key' in signerFor(id, 'pw'));
  assert.throws(() => signerFor(id, 'wrong'), /Wrong password/);
});
