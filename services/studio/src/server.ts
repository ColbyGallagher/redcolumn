import { readFile } from 'node:fs/promises';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { WebSocketServer } from 'ws';
import { CLOSE_DENIED, CLOSE_SIGN_IN, SESSION_ROOM, cleanPolicy, parseSessionId, type Access, type Permissions } from './protocol.ts';
import { bearer, googleVerifier, socketToken, type TokenVerifier } from './auth.ts';
import { SessionRegistry, type Session } from './sessions.ts';
import type { Conn } from './room.ts';
import { pkiRelay } from './pki.ts';
import { mountProjects, ProjectRegistry, sendInvites } from './projects.ts';
import { cleanEmails, InviteLimit, mailerFromEnv, type Mailer } from './mailer.ts';
import { join } from 'node:path';

const MAX_PDF_BYTES = 250 * 1024 * 1024;

/** Attendee names are free text (there are no accounts yet); keep them short and printable. */
function cleanName(raw: string | null | undefined): string {
  const name = (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return name || 'Guest';
}

function hostKeyOf(c: Context) {
  return c.req.header('x-studio-host-key') ?? null;
}

/** The attendee making a request (self-declared until accounts exist). */
function attendeeOf(c: Context) {
  return cleanName(c.req.header('x-studio-attendee') ?? c.req.query('attendee'));
}

const NO_ACCESS = 'You do not have access to this session. Ask the host to add you.';
const SIGN_IN = 'This session is for people signed in with Google. Sign in with Google to join.';

/** Google sign-in: whether it is set up (STUDIO_GOOGLE_CLIENT_ID), and how tokens are checked. */
export interface Auth {
  enabled: boolean;
  verify: TokenVerifier;
}

/** An end date from a client: null for none, a future time, or 'invalid'. */
function cleanExpiry(v: unknown): number | null | 'invalid' {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= Date.now()) return 'invalid';
  return Math.round(v);
}

/** Only known permission switches, as booleans. */
function cleanPermissions(p: Partial<Permissions>): Partial<Permissions> {
  const out: Partial<Permissions> = {};
  for (const k of ['markup', 'addDocuments', 'saveCopy', 'invite'] as const) if (typeof p[k] === 'boolean') out[k] = p[k];
  return out;
}

export function authFromEnv(): Auth {
  const ids = (process.env.STUDIO_GOOGLE_CLIENT_ID ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { enabled: ids.length > 0, verify: ids.length ? googleVerifier(ids) : async () => null };
}

interface Who {
  name: string;
  email: string | null;
  isHost: boolean;
  access: Access;
}

/**
 * The app's address for links in emails: STUDIO_APP_URL, else the request's Origin when it is one
 * of STUDIO_ALLOWED_ORIGINS (never an arbitrary Origin, so emails cannot point elsewhere).
 */
function appUrlOf(c: Context): string | null {
  if (process.env.STUDIO_APP_URL) return process.env.STUDIO_APP_URL;
  const allowed = process.env.STUDIO_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? [];
  const origin = c.req.header('origin');
  return origin && allowed.includes(origin) ? origin : null;
}

export function createApp(registry: SessionRegistry, auth: Auth = authFromEnv(), projects?: ProjectRegistry, mailer: Mailer | null = mailerFromEnv()) {
  const app = new Hono();
  const origins = process.env.STUDIO_ALLOWED_ORIGINS?.split(',') ?? '*';
  app.use('/v1/*', cors({ origin: origins, allowHeaders: ['content-type', 'authorization', 'x-studio-host-key', 'x-studio-attendee', 'x-studio-project-key'], exposeHeaders: ['content-length', 'x-revision'] }));

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/v1/config', (c) => c.json({ google: auth.enabled }));

  // Time stamps and revocation checks for signatures (browsers cannot reach these services).
  app.post('/v1/pki', bodyLimit({ maxSize: 16 * 1024 }), (c) => pkiRelay(c));
  app.get('/v1/pki', (c) => pkiRelay(c));

  const emailOf = async (c: Context) => {
    const token = bearer(c.req.header('authorization'));
    return token && auth.enabled ? ((await auth.verify(token))?.email ?? null) : null;
  };

  /** Who is asking, and what they may do in session `s`. */
  const whoIs = async (c: Context, s: Session): Promise<Who> => {
    const email = await emailOf(c);
    const isHost = s.isHost(hostKeyOf(c), email);
    const name = attendeeOf(c);
    return { name, email, isHost, access: s.accessOf(name, isHost, email) };
  };

  /** 401 (sign in) or 403 (no access) for someone with no access, else null. */
  const refuse = (c: Context, s: Session, who: Who) => {
    if (who.access !== 'none') return null;
    return s.meta.requireGoogle && !who.email ? c.json({ error: SIGN_IN }, 401) : c.json({ error: NO_ACCESS }, 403);
  };

  const load = async (c: Context): Promise<Session | Response> => {
    const id = parseSessionId(c.req.param('id') ?? '');
    const session = id ? await registry.get(id) : null;
    // A session past its end date finishes the first time anyone asks for it.
    if (session) await session.checkExpiry();
    return session ?? c.json({ error: 'No session with that ID.' }, 404);
  };

  app.post('/v1/sessions', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: string; host?: string; permissions?: Partial<Permissions>; access?: unknown; requireGoogle?: boolean; expiresAt?: unknown } | null;
    const name = (body?.name ?? '').trim().slice(0, 120);
    if (!name) return c.json({ error: 'A session needs a name.' }, 400);
    const email = await emailOf(c);
    const requireGoogle = body?.requireGoogle === true;
    if (requireGoogle && !auth.enabled) return c.json({ error: 'This redcolumn server is not set up for Google sign-in (STUDIO_GOOGLE_CLIENT_ID).' }, 400);
    if (requireGoogle && !email) return c.json({ error: 'Sign in with Google to start a session for Google accounts.' }, 401);
    const permissions: Permissions = { markup: body?.permissions?.markup ?? true, addDocuments: body?.permissions?.addDocuments ?? true, saveCopy: body?.permissions?.saveCopy ?? true, invite: body?.permissions?.invite ?? true };
    const expiresAt = cleanExpiry(body?.expiresAt);
    if (expiresAt === 'invalid') return c.json({ error: 'The end date must be in the future.' }, 400);
    const { session, hostKey } = await registry.create(name, cleanName(body?.host), permissions, cleanPolicy(body?.access), { requireGoogle, hostEmail: email }, expiresAt);
    return c.json({ session: session.meta, hostKey }, 201);
  });

  app.get('/v1/sessions/:id', async (c) => {
    const s = await load(c);
    if (s instanceof Response) return s;
    const who = await whoIs(c, s);
    return refuse(c, s, who) ?? c.json({ session: s.meta, isHost: who.isHost, email: who.email });
  });

  app.patch('/v1/sessions/:id', async (c) => {
    const s = await load(c);
    if (s instanceof Response) return s;
    if (!s.isHost(hostKeyOf(c), await emailOf(c))) return c.json({ error: 'Only the session host can change the session.' }, 403);
    const body = (await c.req.json().catch(() => null)) as { name?: string; permissions?: Partial<Permissions>; access?: unknown; status?: 'finished'; expiresAt?: unknown } | null;
    const host = s.meta.host;
    if (body && 'expiresAt' in body) {
      const expiresAt = cleanExpiry(body.expiresAt);
      if (expiresAt === 'invalid') return c.json({ error: 'The end date must be in the future.' }, 400);
      if (s.meta.status === 'active') await s.setExpiry(expiresAt, host);
    }
    if (body?.permissions) await s.setPermissions(cleanPermissions(body.permissions), host);
    const access = cleanPolicy(body?.access);
    if (access) await s.setAccess(access, host);
    if (body?.name?.trim()) await s.rename(body.name.trim().slice(0, 120), host);
    if (body?.status === 'finished') await s.finish(host);
    return c.json({ session: s.meta });
  });

  app.post('/v1/sessions/:id/documents', bodyLimit({ maxSize: MAX_PDF_BYTES, onError: (c) => c.json({ error: 'That PDF is too large for a session.' }, 413) }), async (c) => {
    const s = await load(c);
    if (s instanceof Response) return s;
    if (s.meta.status !== 'active') return c.json({ error: 'This session has finished.' }, 409);
    const who = await whoIs(c, s);
    const refused = refuse(c, s, who);
    if (refused) return refused;
    const { isHost, access } = who;
    if (!isHost && access !== 'markup') return c.json({ error: 'You have view-only access to this session.' }, 403);
    if (!isHost && !s.meta.permissions.addDocuments) return c.json({ error: 'The host has not allowed attendees to add documents.' }, 403);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') return c.json({ error: 'Only PDF files can be added.' }, 415);
    const name = (c.req.query('name') ?? 'Document.pdf').slice(0, 200);
    const doc = await s.addDocument(name, bytes, cleanName(c.req.header('x-studio-attendee')));
    return c.json({ document: doc }, 201);
  });

  app.put('/v1/sessions/:id/documents/:doc', bodyLimit({ maxSize: MAX_PDF_BYTES, onError: (c) => c.json({ error: 'That PDF is too large for a session.' }, 413) }), async (c) => {
    const s = await load(c);
    if (s instanceof Response) return s;
    if (s.meta.status !== 'active') return c.json({ error: 'This session has finished.' }, 409);
    if (!s.isHost(hostKeyOf(c), await emailOf(c))) return c.json({ error: 'Only the session host can update documents.' }, 403);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') return c.json({ error: 'Only PDF files can be added.' }, 415);
    const name = c.req.query('name')?.slice(0, 200);
    const doc = await s.updateDocument(c.req.param('doc'), bytes, s.meta.host, name || undefined);
    if (!doc) return c.json({ error: 'No such document in this session.' }, 404);
    return c.json({ document: doc });
  });

  app.get('/v1/sessions/:id/documents/:doc', async (c) => {
    const s = await load(c);
    if (s instanceof Response) return s;
    const refused = refuse(c, s, await whoIs(c, s));
    if (refused) return refused;
    const path = s.documentPath(c.req.param('doc'));
    if (!path) return c.json({ error: 'No such document in this session.' }, 404);
    const bytes = await readFile(path);
    return c.body(bytes, 200, { 'content-type': 'application/pdf', 'cache-control': 'private, max-age=31536000, immutable' });
  });

  const inviteLimit = new InviteLimit();

  /** Invites people by email: they are added to a private session's list, and emailed if the server can send mail. */
  app.post('/v1/sessions/:id/invite', async (c) => {
    const s = await load(c);
    if (s instanceof Response) return s;
    const who = await whoIs(c, s);
    const refused = refuse(c, s, who);
    if (refused) return refused;
    const policy = s.meta.access ?? null;
    const isPrivate = !!policy && policy.default === 'none';
    if (!who.isHost && (s.meta.permissions.invite === false || isPrivate)) return c.json({ error: 'Only the host can invite people to this session.' }, 403);
    const body = (await c.req.json().catch(() => null)) as { emails?: unknown; note?: string } | null;
    const emails = cleanEmails(body?.emails);
    if (!emails) return c.json({ error: 'Give up to 20 email addresses.' }, 400);
    if (mailer && !inviteLimit.take(`session:${s.id}`, emails.length)) return c.json({ error: 'Too many invitations today.' }, 429);
    if (isPrivate && policy) {
      const people = [...policy.people.filter((p) => !emails.some((e) => e === p.name.toLowerCase())), ...emails.map((name) => ({ name, access: 'markup' as const }))];
      await s.setAccess({ ...policy, people }, who.name);
    } else s.note(who.name, 'session', `invited ${emails.join(', ')}`);
    const sent = await sendInvites(c, { mailer, appUrl: appUrlOf }, emails, { from: who.name, what: 'Session', name: s.meta.name, id: s.id, note: body?.note, query: 'studio' });
    return c.json({ session: s.meta, ...sent });
  });

  if (projects) mountProjects(app, projects, { emailOf, attendeeOf, mailer, appUrl: appUrlOf });

  app.delete('/v1/sessions/:id/documents/:doc', async (c) => {
    const s = await load(c);
    if (s instanceof Response) return s;
    if (!s.isHost(hostKeyOf(c), await emailOf(c))) return c.json({ error: 'Only the session host can remove documents.' }, 403);
    await s.removeDocument(c.req.param('doc'), s.meta.host);
    return c.json({ session: s.meta });
  });

  return app;
}

/**
 * Live rooms at `/v1/sessions/:id/ws?room=session|<docId>&name=…&key=…`. The session room carries
 * the Record, chat and presence; each document room carries that document's markups.
 */
export function attachSockets(server: Server, registry: SessionRegistry, auth: Auth = authFromEnv()) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/v1\/sessions\/([^/]+)\/ws$/.exec(url.pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    void (async () => {
      const id = parseSessionId(decodeURIComponent(match[1]!));
      const session = id ? await registry.get(id) : null;
      if (session) await session.checkExpiry();
      const roomName = url.searchParams.get('room') ?? SESSION_ROOM;
      if (!session || (roomName !== SESSION_ROOM && !session.documentPath(roomName))) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const room = await session.room(roomName);
      const token = auth.enabled ? socketToken(req.headers['sec-websocket-protocol']) : null;
      const email = token ? ((await auth.verify(token))?.email ?? null) : null;
      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn: Conn = { ws, name: cleanName(url.searchParams.get('name')), email, isHost: session.isHost(url.searchParams.get('key'), email), clients: new Set() };
        if (session.accessOf(conn.name, conn.isHost, conn.email) === 'none') {
          if (session.meta.requireGoogle && !email) ws.close(CLOSE_SIGN_IN, 'Sign in with Google');
          else ws.close(CLOSE_DENIED, 'No access');
          return;
        }
        const isSessionRoom = roomName === SESSION_ROOM;
        const firstTab = isSessionRoom && !session.present(conn.name);
        session.attach(room, conn);
        if (firstTab) void session.attendeeJoined(conn.name, conn.email);
        ws.binaryType = 'nodebuffer';
        ws.on('message', (data: Buffer, isBinary) => {
          if (!isBinary) return;
          try {
            room.receive(conn, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          } catch (err) {
            console.error(`Bad message from ${conn.name} in ${session.id}/${roomName}:`, err);
          }
        });
        // Dead connections (sleeping laptops) are dropped so presence stays accurate.
        let alive = true;
        ws.on('pong', () => (alive = true));
        const ping = setInterval(() => {
          if (!alive) ws.terminate();
          alive = false;
          ws.ping();
        }, 30_000);
        ws.on('close', () => {
          clearInterval(ping);
          session.detach(room, conn);
          if (isSessionRoom && !session.present(conn.name)) void session.attendeeLeft(conn.name);
        });
      });
    })().catch((err) => {
      console.error(err);
      socket.destroy();
    });
  });
  return wss;
}

export function start(opts: { port: number; hostname: string; dataDir: string; auth?: Auth; mailer?: Mailer | null }) {
  const registry = new SessionRegistry(opts.dataDir);
  const auth = opts.auth ?? authFromEnv();
  const app = createApp(registry, auth, new ProjectRegistry(join(opts.dataDir, 'projects')), opts.mailer === undefined ? mailerFromEnv() : opts.mailer);
  return new Promise<{ server: Server; registry: SessionRegistry; port: number; close: () => Promise<void> }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: opts.port, hostname: opts.hostname }, (info) => {
      resolve({
        server,
        registry,
        port: info.port,
        close: async () => {
          wss.close();
          await registry.close();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    }) as Server;
    const wss = attachSockets(server, registry, auth);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 8788);
  // Bound to localhost by default: sessions are protected only by their ID until accounts exist.
  const hostname = process.env.HOST ?? '127.0.0.1';
  const dataDir = process.env.STUDIO_DATA ?? fileURLToPath(new URL('../data', import.meta.url));
  const running = await start({ port, hostname, dataDir });
  console.log(`redcolumn server on http://${hostname}:${running.port} (data in ${dataDir})`);
  const stop = () => void running.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
