import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { TokenService } from './token.ts';
import { serveTokens, TokenClient, type Child, type Endpoint } from './token-ipc.ts';

const endpoint = (port: MessagePort): Endpoint => ({ post: (m) => port.postMessage(m), onMessage: (l) => void port.on('message', l) });

/** A card service on the far end of a MessageChannel, as the utility process would be. */
function service(fake: Partial<Record<keyof TokenService, (...args: unknown[]) => unknown>>, loading?: Promise<void>) {
  const starts: { hello: unknown; stop: () => void }[] = [];
  const start = (): Child => {
    const { port1, port2 } = new MessageChannel();
    const exits: (() => void)[] = [];
    const entry = { hello: undefined as unknown, stop: () => {
      port1.close();
      port2.close();
      for (const e of exits) e();
    } };
    starts.push(entry);
    let first = true;
    const calls: ((m: unknown) => void)[] = [];
    port2.on('message', (m) => {
      if (first) {
        first = false;
        entry.hello = m;
        return;
      }
      for (const c of calls) c(m);
    });
    const ready = (loading ?? Promise.resolve()).then(() => fake as unknown as TokenService);
    serveTokens(ready, { post: (m) => port2.postMessage(m), onMessage: (l) => void calls.push(l) });
    return { ...endpoint(port1), onExit: (l) => void exits.push(l) };
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

test('only TokenService calls are served', async () => {
  const { port1, port2 } = new MessageChannel();
  serveTokens({ modules: async () => [] } as unknown as TokenService, endpoint(port2));
  const reply = new Promise((r) => port1.once('message', r));
  port1.postMessage({ id: 1, method: 'restore', args: [] });
  assert.deepEqual(await reply, { id: 1, error: 'That is not something the card service does.' });
  port1.close();
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
