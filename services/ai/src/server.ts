import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { identifySheet, MODEL, SheetIndexError, SheetRequest } from './sheetIndex.ts';

// Credentials come from the environment (ANTHROPIC_API_KEY, or an `ant auth login` profile) and
// are resolved per request, so the server starts without them and reports 503 until configured.
// The key stays on this server; browsers only ever talk to the endpoints below.
const client = new Anthropic();

/** Whether any credential source the SDK reads is present (env vars or an `ant auth login` profile). */
function credentialsAvailable(): boolean {
  const env = process.env;
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE || env.ANTHROPIC_IDENTITY_TOKEN || env.ANTHROPIC_IDENTITY_TOKEN_FILE) return true;
  return existsSync(join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'anthropic'));
}
const NOT_CONFIGURED = 'AI service is not configured: set ANTHROPIC_API_KEY (or run `ant auth login`) on the server.';

const app = new Hono();

const origins = (process.env.AI_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173').split(',');
app.use('/v1/*', cors({ origin: origins }));

app.get('/health', (c) => c.json({ ok: true, model: MODEL, configured: credentialsAvailable() }));

app.post('/v1/sheet-index', bodyLimit({ maxSize: 12 * 1024 * 1024 }), async (c) => {
  const parsed = SheetRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
  if (!credentialsAvailable()) return c.json({ error: NOT_CONFIGURED }, 503);
  try {
    return c.json(await identifySheet(client, parsed.data));
  } catch (err) {
    if (err instanceof SheetIndexError) return c.json({ error: err.message }, err.status as 422 | 502);
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error('Anthropic credentials rejected:', err.message);
      return c.json({ error: `${NOT_CONFIGURED} (credentials were rejected)` }, 503);
    }
    if (err instanceof Anthropic.RateLimitError) return c.json({ error: 'AI service is busy; try again shortly.' }, 429);
    if (err instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${err.status}:`, err.message);
      return c.json({ error: 'AI request failed.' }, 502);
    }
    console.error(err);
    return c.json({ error: 'Unexpected error.' }, 500);
  }
});

const port = Number(process.env.PORT ?? 8787);
// Bound to localhost by default: the endpoints have no auth yet (added with accounts in phase 3).
const hostname = process.env.HOST ?? '127.0.0.1';
serve({ fetch: app.fetch, port, hostname }, () => console.log(`AI service on http://${hostname}:${port} (${MODEL})`));
