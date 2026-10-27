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
 * In the card service: the first message is the `hello` the main process sends (where the drivers
 * the person picked are kept), which `open` turns into the TokenService; every later message is a
 * call, answered with TokenService's result or its error message. Calls wait while it opens.
 */
export function serveTokens(open: (hello: unknown) => TokenService | Promise<TokenService>, port: Endpoint) {
  let service: Promise<TokenService> | null = null;
  port.onMessage((message) => {
    if (!service) {
      service = Promise.resolve().then(() => open(message));
      service.catch(() => {});
      return;
    }
    const call = message as Partial<TokenCall>;
    if (typeof call?.id !== 'number') return;
    const id = call.id;
    if (!call.method || !METHODS.has(call.method) || !Array.isArray(call.args)) {
      port.post({ id, error: 'That is not something the card service does.' } satisfies TokenReply);
      return;
    }
    const method = call.method;
    void service
      .then((s) => (s[method] as (...args: unknown[]) => Promise<unknown>).apply(s, call.args!))
      .then(
        (value) => port.post({ id, value } satisfies TokenReply),
        (err) => port.post({ id, error: err instanceof Error ? err.message : String(err) } satisfies TokenReply),
      );
  });
}

/** A running card service: its channel, a way to hear that it has stopped, and a way to stop it. */
export interface Child extends Endpoint {
  onExit(listener: () => void): void;
  kill(): void;
}

/**
 * How long a call may take before the card service is taken to be stuck (a driver hanging in
 * C_Login, or a PIN pad nobody answers). Signing waits for a person typing the PIN on the reader.
 */
export const CALL_TIMEOUT_MS: Record<TokenMethod, number> = { sign: 180_000, modules: 60_000, addModule: 60_000, removeModule: 60_000, certificates: 60_000 };

const STOPPED = 'The card service stopped. Try again; if it happens again, the card’s driver may not work with this app.';
const STUCK = 'The card did not answer in time. Check it is inserted (and the PIN was entered on its reader), then try again.';

/**
 * In the main process: TokenService's calls, made in the card service. It is started the first time
 * it is needed and again after it stops (a driver that crashes takes only the card service with it);
 * calls waiting when it stops fail. A call that takes too long fails and the card service is
 * stopped, so a stuck driver does not hold up every later call: the next one starts it afresh.
 */
export class TokenClient {
  private child: Child | null = null;
  private next = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly start: () => Child;
  private readonly hello: unknown;
  private readonly timeouts: Record<TokenMethod, number>;

  /** `start` launches the card service; its first message to it is `hello` (where to keep drivers). */
  constructor(start: () => Child, hello: unknown, timeouts: Record<TokenMethod, number> = CALL_TIMEOUT_MS) {
    this.start = start;
    this.hello = hello;
    this.timeouts = timeouts;
  }

  private settle(id: number): { resolve: (v: unknown) => void; reject: (e: Error) => void } | undefined {
    const pending = this.waiting.get(id);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    this.waiting.delete(id);
    return pending;
  }

  private failAll(message: string) {
    for (const id of [...this.waiting.keys()]) this.settle(id)!.reject(new Error(message));
  }

  private connect(): Child {
    if (this.child) return this.child;
    const child = this.start();
    this.child = child;
    child.onMessage((message) => {
      const reply = message as TokenReply;
      const pending = typeof reply?.id === 'number' ? this.settle(reply.id) : undefined;
      if (!pending) return;
      if ('error' in reply) pending.reject(new Error(reply.error));
      else pending.resolve(reply.value);
    });
    child.onExit(() => {
      if (this.child !== child) return;
      this.child = null;
      this.failAll(STOPPED);
    });
    child.post(this.hello);
    return child;
  }

  private call<T>(method: TokenMethod, ...args: unknown[]): Promise<T> {
    const child = this.connect();
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Stuck: this call and any queued behind it fail, and the next call starts a new card service.
        if (this.child === child) this.child = null;
        this.settle(id)?.reject(new Error(STUCK));
        this.failAll(STOPPED);
        child.kill();
      }, this.timeouts[method]);
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      child.post({ id, method, args } satisfies TokenCall);
    });
  }

  modules = () => this.call<Awaited<ReturnType<TokenService['modules']>>>('modules');
  addModule = (file: string) => this.call<Awaited<ReturnType<TokenService['addModule']>>>('addModule', file);
  removeModule = (id: string) => this.call<void>('removeModule', id);
  certificates = () => this.call<Awaited<ReturnType<TokenService['certificates']>>>('certificates');
  sign = (ref: unknown, hash: unknown, data: unknown, pin: unknown) => this.call<Uint8Array>('sign', ref, hash, data, pin);
}
