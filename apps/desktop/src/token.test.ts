import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPublicKey, verify, X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ecdsaToDer, TokenService } from './token.ts';

/**
 * Against a real PKCS#11 driver: SoftHSM2, a software token, holding an RSA and an EC key with
 * their certificates. CI installs it (softhsm2, opensc, see .github/workflows/ci.yml); elsewhere
 * these tests are skipped when it is not installed.
 */
const SOFTHSM = ['/usr/lib/softhsm/libsofthsm2.so', '/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so', '/opt/homebrew/lib/softhsm/libsofthsm2.so', '/usr/local/lib/softhsm/libsofthsm2.so'].find((p) => existsSync(p));
const tools = (() => {
  if (!SOFTHSM) return false;
  try {
    execFileSync('softhsm2-util', ['--version'], { stdio: 'ignore' });
    execFileSync('pkcs11-tool', ['--module', SOFTHSM, '--show-info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const ready = !!SOFTHSM && tools;
if (!ready && process.env.CI) throw new Error('SoftHSM2 and OpenSC must be installed in CI for the token tests');
const skip = ready ? false : 'SoftHSM2 and OpenSC (pkcs11-tool) are not installed';

const PIN = '123456';
const TOKEN = 'Test Card';

/** A fresh SoftHSM token with an RSA key (ID 01) and a P-256 key (ID 02), each with a self-signed certificate. */
function provision() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rc-token-'));
  const conf = path.join(dir, 'softhsm2.conf');
  execFileSync('mkdir', ['-p', path.join(dir, 'tokens')]);
  writeFileSync(conf, `directories.tokendir = ${path.join(dir, 'tokens')}\nobjectstore.backend = file\n`);
  process.env.SOFTHSM2_CONF = conf;
  const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: dir, stdio: 'pipe' });
  run('softhsm2-util', ['--init-token', '--free', '--label', TOKEN, '--pin', PIN, '--so-pin', '654321']);
  const certs: Record<string, X509Certificate> = {};
  for (const [name, id, keyArgs] of [
    ['rsa', '01', ['-newkey', 'rsa:2048']],
    ['ec', '02', ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256']],
  ] as const) {
    run('openssl', ['req', '-x509', ...keyArgs, '-nodes', '-keyout', `${name}.key`, '-out', `${name}.pem`, '-days', '2', '-subj', `/CN=Token ${name.toUpperCase()}`]);
    run('openssl', ['pkcs8', '-topk8', '-nocrypt', '-in', `${name}.key`, '-out', `${name}.p8`]);
    run('openssl', ['x509', '-in', `${name}.pem`, '-outform', 'DER', '-out', `${name}.der`]);
    run('softhsm2-util', ['--import', `${name}.p8`, '--token', TOKEN, '--label', name, '--id', id, '--pin', PIN]);
    run('pkcs11-tool', ['--module', SOFTHSM!, '--token-label', TOKEN, '--login', '--pin', PIN, '--write-object', `${name}.der`, '--type', 'cert', '--id', id, '--label', name]);
    certs[name] = new X509Certificate(execFileSync('cat', [path.join(dir, `${name}.pem`)]));
  }
  return { dir, certs };
}

const setup = ready ? provision() : null;
const service = () => new TokenService(path.join(setup!.dir, 'drivers.json'), [['SoftHSM', SOFTHSM!]]);
const toBeSigned = new TextEncoder().encode('the signed attributes of a PDF signature');

test('lists the certificates on the token, each with a reference to its key', { skip }, async () => {
  const { certificates, problems } = await service().certificates();
  assert.deepEqual(problems, []);
  assert.deepEqual(certificates.map((c) => c.label).sort(), ['ec', 'rsa']);
  for (const c of certificates) {
    assert.equal(c.token, TOKEN);
    assert.equal(c.module, 'SoftHSM');
    assert.equal(c.pinPad, false);
    assert.equal(c.others.length, 1, 'the other certificate on the token is offered for the chain');
    assert.equal(new X509Certificate(Buffer.from(c.certificate)).fingerprint256, setup!.certs[c.label]!.fingerprint256);
  }
});

for (const hash of ['SHA-256', 'SHA-384'] as const) {
  test(`the card signs with RSA and with ECDSA (${hash}); the signatures verify against the certificates`, { skip }, async () => {
    const tokens = service();
    const { certificates } = await tokens.certificates();
    assert.equal(certificates.length, 2);
    for (const c of certificates) {
      const signature = await tokens.sign(c.ref, hash, toBeSigned, PIN);
      const key = createPublicKey(setup!.certs[c.label]!.publicKey.export({ type: 'spki', format: 'pem' }));
      const algorithm = hash.replace('-', '').toLowerCase();
      assert.ok(verify(algorithm, toBeSigned, c.label === 'ec' ? { key, dsaEncoding: 'der' } : key, signature), `${c.label} signature`);
    }
  });
}

test('a wrong PIN is said plainly, and nothing is signed', { skip }, async () => {
  const tokens = service();
  const [c] = (await tokens.certificates()).certificates;
  await assert.rejects(tokens.sign(c!.ref, 'SHA-256', toBeSigned, '000000'), /PIN is not right/);
  // The right PIN still works afterwards (the card is not locked by one mistake).
  assert.ok((await tokens.sign(c!.ref, 'SHA-256', toBeSigned, PIN)).length > 0);
});

test('only drivers this computer set up are loaded; references and arguments are checked', { skip }, async () => {
  const tokens = service();
  const [c] = (await tokens.certificates()).certificates;
  const ref = JSON.parse(c!.ref) as { m: string; t: string; k: string };
  await assert.rejects(tokens.sign(JSON.stringify({ ...ref, m: 'known:/tmp/evil.so' }), 'SHA-256', toBeSigned, PIN), /no longer set up/);
  await assert.rejects(tokens.sign('not json', 'SHA-256', toBeSigned, PIN), /not on this computer/);
  await assert.rejects(tokens.sign(JSON.stringify({ ...ref, t: 'Another card' }), 'SHA-256', toBeSigned, PIN), /not inserted/);
  await assert.rejects(tokens.sign(JSON.stringify({ ...ref, k: 'ff' }), 'SHA-256', toBeSigned, PIN), /key for this certificate/);
  await assert.rejects(tokens.sign(c!.ref, 'SHA-1', toBeSigned, PIN), /digest/);
  await assert.rejects(tokens.sign(c!.ref, 'SHA-256', 'text', PIN), /not something to sign/);
  await assert.rejects(tokens.sign(c!.ref, 'SHA-256', toBeSigned, null), /Enter the PIN/);
  await assert.rejects(tokens.sign(c!.ref, 'SHA-256', toBeSigned, ''), /Enter the PIN/);
});

test('a picked driver is checked, kept across restarts, and can be removed', { skip }, async () => {
  const file = path.join(setup!.dir, 'drivers-added.json');
  const tokens = new TokenService(file, []);
  assert.deepEqual(await tokens.modules(), []);
  await assert.rejects(tokens.addModule(path.join(setup!.dir, 'rsa.pem')), /did not load/);
  await assert.rejects(tokens.addModule('relative.so'), /cannot be read/);
  const added = await tokens.addModule(SOFTHSM!);
  assert.equal(added.added, true);
  assert.match(added.name, /SoftHSM/i);
  const again = new TokenService(file, []);
  await again.restore();
  assert.deepEqual(await again.modules(), [added]);
  assert.equal((await again.certificates()).certificates.length, 2);
  await again.removeModule(added.id);
  assert.deepEqual(await again.modules(), []);
});

test('a driver that cannot load is reported, and the others still list', { skip }, async () => {
  const tokens = new TokenService(path.join(setup!.dir, 'drivers-bad.json'), [
    ['Broken', path.join(setup!.dir, 'rsa.pem')],
    ['SoftHSM', SOFTHSM!],
  ]);
  const { certificates, problems } = await tokens.certificates();
  assert.equal(certificates.length, 2);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.module, 'Broken');
});

test('ECDSA r‖s becomes a DER SEQUENCE of two minimal INTEGERs', () => {
  const raw = Buffer.concat([Buffer.alloc(31, 0).fill(0x01, 30), Buffer.from([0x80]), Buffer.alloc(32, 0x7f)]);
  const der = ecdsaToDer(raw);
  assert.equal(der[0], 0x30);
  // r = 0x01 0x80 (leading zeros dropped), s = 32 bytes of 0x7f (no padding needed).
  assert.deepEqual([...der.subarray(2, 6)], [0x02, 0x02, 0x01, 0x80]);
  assert.deepEqual([...der.subarray(6, 8)], [0x02, 0x20]);
  assert.equal(der.length, 2 + 4 + 2 + 32);
});
