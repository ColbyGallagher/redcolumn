import { timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { isAssistantMethod } from './message';

export type AssistantHandler = (method: string, params: unknown) => Promise<unknown>;

/**
 * The running app's side of the assistant. Loopback only, and every request carries the token
 * written into user data for this launch. The page never dials this port.
 */
export function listenForAssistant(token: string, handler: AssistantHandler): Promise<{ port: number; close: () => Promise<void> }> {
  const expected = Buffer.from(token);
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      const remote = socket.remoteAddress;
      if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1') {
        socket.destroy();
        return;
      }
      const decoder = new StringDecoder('utf8');
      let buf = '';
      let handled = false;
      const reply = (body: unknown) => {
        if (socket.destroyed) return;
        socket.end(JSON.stringify(body) + '\n');
      };
      socket.on('data', (chunk) => {
        if (handled) return;
        buf += decoder.write(chunk);
        if (buf.length > 1_000_000) {
          handled = true;
          socket.destroy();
          return;
        }
        const nl = buf.indexOf('\n');
        if (nl < 0) return;
        handled = true;
        let msg: { id?: unknown; token?: unknown; method?: unknown; params?: unknown };
        try {
          msg = JSON.parse(buf.slice(0, nl)) as typeof msg;
        } catch {
          socket.destroy();
          return;
        }
        const given = typeof msg.token === 'string' ? Buffer.from(msg.token) : Buffer.alloc(0);
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
          reply({ id: msg.id ?? null, error: 'Denied' });
          return;
        }
        if (typeof msg.method !== 'string' || !isAssistantMethod(msg.method)) {
          reply({ id: msg.id ?? null, error: 'Unknown tool.' });
          return;
        }
        void handler(msg.method, msg.params ?? {})
          .then((result) => reply({ id: msg.id ?? null, result }))
          .catch((err: unknown) => reply({ id: msg.id ?? null, error: err instanceof Error && err.message ? err.message : 'The assistant could not do that.' }));
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        port,
        close: () =>
          new Promise((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}
