import type { TokenService } from './token';

/**
 * The card service runs in its own process (token-host.ts, an Electron utility process): PKCS#11
 * calls block until they return, and on a reader with its own keypad C_Login waits for the person
 * to type the PIN there. In the main process that froze every window. Here the main process sends
 * each call as a message and gets the answer back; the driver, the card and the PIN stay in the
 * card service.
 */

/** The calls the main process makes; the same as TokenService's. */
export type TokenMethod = 'modules' | 'addModule' | 'removeModule' | 'certificates' | 'sign';
const METHODS = new Set<TokenMethod>(['modules', 'addModule', 'removeModule', 'certificates', 'sign']);

export interface TokenCall {
  id: number;
  method: TokenMethod;
  args: unknown[];
}
export type TokenReply = { id: number; value: unknown } | { id: number; error: string };

/** One end of the channel: a utility process child, its parentPort, or a MessagePort in tests. */
export interface Endpoint {
  post(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
}

/**
 * In the card service: answers each call with TokenService's result or its error message. `service`
 * may still be loading its saved drivers: calls wait for it.
 */
export function serveTokens(service: TokenService | Promise<TokenService>, port: Endpoint) {
  port.onMessage((message) => {
    const call = message as Partial<TokenCall>;
    if (typeof call?.id !== 'number') return;
    const id = call.id;
    if (!call.method || !METHODS.has(call.method) || !Array.isArray(call.args)) {
      port.post({ id, error: 'That is not something the card service does.' } satisfies TokenReply);
      return;
    }
    const method = call.method;
    void Promise.resolve(service)
      .then((s) => (s[method] as (...args: unknown[]) => Promise<unknown>).apply(s, call.args!))
      .then(
        (value) => port.post({ id, value } satisfies TokenReply),
        (err) => port.post({ id, error: err instanceof Error ? err.message : String(err) } satisfies TokenReply),
      );
  });
}

/** A running card service: its channel, and a way to hear that it has stopped. */
export interface Child extends Endpoint {
  onExit(listener: () => void): void;
}

/**
 * In the main process: TokenService's calls, made in the card service. It is started the first time
 * it is needed and again after it stops (a driver that crashes takes only the card service with it);
 * calls waiting when it stops fail.
 */
export class TokenClient {
  private child: Child | null = null;
  private next = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly start: () => Child;
  private readonly hello: unknown;

  /** `start` launches the card service; its first message to it is `hello` (where to keep drivers). */
  constructor(start: () => Child, hello: unknown) {
    this.start = start;
    this.hello = hello;
  }

  private connect(): Child {
    if (this.child) return this.child;
    const child = this.start();
    this.child = child;
    child.onMessage((message) => {
      const reply = message as TokenReply;
      const pending = typeof reply?.id === 'number' ? this.waiting.get(reply.id) : undefined;
      if (!pending) return;
      this.waiting.delete(reply.id);
      if ('error' in reply) pending.reject(new Error(reply.error));
      else pending.resolve(reply.value);
    });
    child.onExit(() => {
      if (this.child === child) this.child = null;
      for (const [, pending] of this.waiting) pending.reject(new Error('The card service stopped. Try again; if it happens again, the card’s driver may not work with this app.'));
      this.waiting.clear();
    });
    child.post(this.hello);
    return child;
  }

  private call<T>(method: TokenMethod, ...args: unknown[]): Promise<T> {
    const child = this.connect();
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      child.post({ id, method, args } satisfies TokenCall);
    });
  }

  modules = () => this.call<Awaited<ReturnType<TokenService['modules']>>>('modules');
  addModule = (file: string) => this.call<Awaited<ReturnType<TokenService['addModule']>>>('addModule', file);
  removeModule = (id: string) => this.call<void>('removeModule', id);
  certificates = () => this.call<Awaited<ReturnType<TokenService['certificates']>>>('certificates');
  sign = (ref: unknown, hash: unknown, data: unknown, pin: unknown) => this.call<Uint8Array>('sign', ref, hash, data, pin);
}
