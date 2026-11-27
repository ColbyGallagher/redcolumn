import pino, { type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config.ts';

export function createLogger(level: LogLevel = 'info', destination?: DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    level,
    base: { service: 'redcolumn-server' },
    serializers: {
      req(req: { method?: string; url?: string; hostname?: string; remoteAddress?: string }) {
        const rawUrl = typeof req.url === 'string' ? req.url : '';
        const qIndex = rawUrl.indexOf('?');
        const pathname = (qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl)
          .replace(/\/items\/[^/]+\/[^/]+$/, '/items/:kind/:id')
          .replace(/\/assets\/[^/]+$/, '/assets/:sha256');
        return {
          method: req.method,
          // Strip query strings and dynamic resource ids from info-level request logs.
          url: pathname,
          hostname: req.hostname,
          remoteAddress: req.remoteAddress,
        };
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
