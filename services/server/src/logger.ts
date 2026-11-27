import pino, { type Logger } from 'pino';
import type { LogLevel } from './config.ts';

export function createLogger(level: LogLevel = 'info'): Logger {
  return pino({
    level,
    base: { service: 'redcolumn-server' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
        'passwordHash',
        'token',
      ],
      censor: '[REDACTED]',
    },
  });
}
