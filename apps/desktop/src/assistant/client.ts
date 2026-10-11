import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { readEndpoint } from './endpoint';
import { CLIENT_WAIT_MS, OFFLINE } from './message';

/** One tool call to the running app. A closed app or a bad token is the same message the tool returns. */
export function requestAssistant(port: number, token: string, method: string, params: unknown, timeoutMs = CLIENT_WAIT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const decoder = new StringDecoder('utf8');
    let buf = '';
    let done = false;
    const finish = (err: Error | null, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(OFFLINE)), timeoutMs);
    socket.on('error', () => finish(new Error(OFFLINE)));
    socket.on('end', () => finish(new Error(OFFLINE)));
    socket.on('data', (chunk) => {
      buf += decoder.write(chunk);
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      try {
        const msg = JSON.parse(buf.slice(0, nl)) as { result?: unknown; error?: unknown };
        if (typeof msg.error === 'string') finish(new Error(msg.error === 'Denied' ? OFFLINE : msg.error));
        else finish(null, msg.result);
      } catch {
        finish(new Error(OFFLINE));
      }
    });
    socket.on('connect', () => {
      socket.write(JSON.stringify({ id: '1', token, method, params: params ?? {} }) + '\n');
    });
  });
}

export function callAssistant(file: string, method: string, params: unknown): Promise<unknown> {
  const endpoint = readEndpoint(file);
  if (!endpoint.enabled || !endpoint.port || !endpoint.token) return Promise.reject(new Error(OFFLINE));
  return requestAssistant(endpoint.port, endpoint.token, method, params);
}
