import pino, { type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config.ts';

export function createLogger(level: LogLevel = 'info', destination?: DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    level,
    base: { service: 'redcolumn-server' },
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
