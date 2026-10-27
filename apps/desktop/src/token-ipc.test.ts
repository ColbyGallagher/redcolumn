import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { TokenService } from './token.ts';
import { CALL_TIMEOUT_MS, serveTokens, TokenClient, type Child, type Endpoint } from './token-ipc.ts';

const endpoint = (port: MessagePort): Endpoint => ({ post: (m) => port.postMessage(m), onMessage: (l) => void port.on('message', l) });
type Fake = Partial<Record<keyof TokenService, (...args: unknown[]) => unknown>>;

/** A card service on the far end of a MessageChannel, served by serveTokens as the utility process is. */
function service(fake: Fake, loading?: Promise<void>) {
  const starts: { hello: unknown; stop: () => void; killed: boolean }[] = [];
  const start = (): Child => {
    const { port1, port2 } = new MessageChannel();
    const exits: (() => void)[] = [];
    const entry = {
      hello: undefined as unknown,
      killed: false,
      stop: () => {
        port1.close();
        port2.close();
        for (const e of exits.splice(0)) e();
      },
    };
    starts.push(entry);
    serveTokens(async (hello) => {
      entry.hello = hello;
      await loading;
      return fake as unknown as TokenService;
    }, endpoint(port2));
    return {
      ...endpoint(port1),
      onExit: (l) => void exits.push(l),
      kill: () => {
        entry.killed = true;
        entry.stop();
      },
    };
  };
  return { starts, start };
}

test('calls go to the card service and come back, bytes and errors included', async (t) => {
  const s = service({
    modules: async () => [{ id: 'known:x', name: 'OpenSC', added: false }],
    sign: async (ref, hash, data, pin) => {
      assert.deepEqual([ref, hash, [...(data as Uint8Array)], pin], ['r', 'SHA-256', [1, 2], '1234']);
      return new Uint8Array([9, 8, 7]);
    },
    removeModule: async () => {
      throw new Error('The PIN is not right.');
    },
  });
  const client = new TokenClient(s.start, { storeFile: '/x/token-drivers.json' });
  t.after(() => s.starts.forEach((c) => c.stop()));
  assert.deepEqual(await client.modules(), [{ id: 'known:x', name: 'OpenSC', added: false }]);
  const signature = await client.sign('r', 'SHA-256', new Uint8Array([1, 2]), '1234');
  assert.ok(signature instanceof Uint8Array);
  assert.deepEqual([...signature], [9, 8, 7]);
  await assert.rejects(client.removeModule('a'), /^Error: The PIN is not right\.$/);
  assert.equal(s.starts.length, 1, 'one card service for every call');
  assert.deepEqual(s.starts[0]!.hello, { storeFile: '/x/token-drivers.json' });
});

test('calls made while the saved drivers load wait for them', async (t) => {
  let loaded!: () => void;
  const s = service({ certificates: async () => ({ certificates: [], problems: [] }) }, new Promise<void>((r) => (loaded = r)));
  const client = new TokenClient(s.start, {});
  t.after(() => s.starts.forEach((c) => c.stop()));
  let answered = false;
  const pending = client.certificates().then((v) => ((answered = true), v));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(answered, false);
  loaded();
  assert.deepEqual(await pending, { certificates: [], problems: [] });
});

test('only TokenService calls are served, and a service that cannot open says why', async () => {
  const { port1, port2 } = new MessageChannel();
  serveTokens(() => ({ modules: async () => [] }) as unknown as TokenService, endpoint(port2));
  const reply = new Promise((r) => port1.once('message', r));
  port1.postMessage({ storeFile: '/x' });
  port1.postMessage({ id: 1, method: 'restore', args: [] });
  assert.deepEqual(await reply, { id: 1, error: 'That is not something the card service does.' });
  port1.close();

  const bad = new MessageChannel();
  serveTokens(() => {
    throw new Error('The card service was not told where its drivers are kept.');
  }, endpoint(bad.port2));
  const answer = new Promise((r) => bad.port1.once('message', r));
  bad.port1.postMessage({});
  bad.port1.postMessage({ id: 2, method: 'modules', args: [] });
  assert.deepEqual(await answer, { id: 2, error: 'The card service was not told where its drivers are kept.' });
  bad.port1.close();
});

test('if the card service stops, waiting calls fail and the next call starts it again', async (t) => {
  const s = service({ sign: () => new Promise(() => {}), modules: async () => [] });
  const client = new TokenClient(s.start, { storeFile: '/x' });
  t.after(() => s.starts.forEach((c) => c.stop()));
  const waiting = client.sign('r', 'SHA-256', new Uint8Array([1]), null);
  await new Promise((r) => setTimeout(r, 20));
  s.starts[0]!.stop();
  await assert.rejects(waiting, /card service stopped/);
  assert.deepEqual(await client.modules(), []);
  assert.equal(s.starts.length, 2);
  assert.deepEqual(s.starts[1]!.hello, { storeFile: '/x' });
});

test('a call that never answers fails in time, and the stuck card service is replaced', async (t) => {
  const s = service({ sign: () => new Promise(() => {}), certificates: () => new Promise(() => {}), modules: async () => [] });
  const client = new TokenClient(s.start, {}, { ...CALL_TIMEOUT_MS, sign: 50, certificates: 10_000 });
  t.after(() => s.starts.forEach((c) => c.stop()));
  const stuck = client.sign('r', 'SHA-256', new Uint8Array([1]), null);
  const behind = client.certificates();
  await assert.rejects(stuck, /did not answer in time/);
  await assert.rejects(behind, /card service stopped/);
  assert.equal(s.starts[0]!.killed, true);
  assert.deepEqual(await client.modules(), []);
  assert.equal(s.starts.length, 2);
  // Signing waits minutes for a PIN typed on the reader; the rest a minute.
  assert.ok(CALL_TIMEOUT_MS.sign >= 120_000 && CALL_TIMEOUT_MS.modules >= 30_000);
});
