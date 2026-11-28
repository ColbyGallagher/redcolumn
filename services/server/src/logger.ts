import pino, { type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config.ts';

// An invite token is a bearer credential. It appears in URLs as /api/invites/<token>, and in links
// shaped /invite/<token> or ?invite=<token>.
const INVITE_TOKEN_IN_URL = /(\/(?:api\/invites|invite)\/|[?&]invite=)[^/?#&\s'"]+/gi;

export function redactInviteTokens(text: string): string {
  return text.replace(INVITE_TOKEN_IN_URL, '$1[REDACTED]');
}

/** The part of a Fastify request that its request log records. */
interface LoggedRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

/** Fastify's default `req` serializer, with invite tokens masked in the URL. */
function serializeRequest(req: LoggedRequest) {
  return {
    method: req.method,
    url: typeof req.url === 'string' ? redactInviteTokens(req.url) : req.url,
    version: req.headers?.['accept-version'],
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

export function createLogger(level: LogLevel = 'info', destination?: DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    level,
    base: { service: 'redcolumn-server' },
    // Fastify lets a logger instance's serializers override its own.
    serializers: { req: serializeRequest },
    hooks: {
      // Some messages quote the URL, such as Fastify's "Route GET:<url> not found".
      logMethod(args, method) {
        const masked = args.map((arg: unknown) => (typeof arg === 'string' ? redactInviteTokens(arg) : arg));
        method.apply(this, masked as Parameters<typeof method>);
      },
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'req.body.password',
        'password',
        'passwordHash',
        'token',
        '*.password',
        '*.passwordHash',
        '*.password_hash',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
