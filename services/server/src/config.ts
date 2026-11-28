export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface ServerConfig {
  databaseUrl: string;
  host: string;
  port: number;
  logLevel: LogLevel;
  allowedOrigins: readonly string[];
  cookieSecure: boolean;
  sessionCookieName: string;
  sessionTtlMs: number;
  maxOpBytes: number;
  wsHeartbeatMs: number;
  /** Login attempts allowed per client IP within `loginRateLimitWindowMs`. */
  loginRateLimitMax: number;
  loginRateLimitWindowMs: number;
  autoMigrate: boolean;
  blobDir: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const LOG_LEVEL_SET = new Set<string>(LOG_LEVELS);

function parseBoolean(name: string, raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const lower = raw.trim().toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  throw new ConfigError(`${name} must be a boolean ("true" or "false"), got "${raw}"`);
}

function parseInteger(
  name: string,
  raw: string | undefined,
  defaultValue: number,
  bounds: { min: number; max: number },
): number {
  if (raw === undefined || raw.trim() === '') return defaultValue;
  if (!/^\d+$/.test(raw.trim())) {
    throw new ConfigError(`${name} must be an integer between ${bounds.min} and ${bounds.max}, got "${raw}"`);
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
    throw new ConfigError(`${name} must be an integer between ${bounds.min} and ${bounds.max}, got "${raw}"`);
  }
  return value;
}

export function normalizeOrigin(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(`Invalid origin "${raw}": must be an absolute http(s) URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`Invalid origin "${raw}": protocol must be http or https`);
  }
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new ConfigError(`Invalid origin "${raw}": must not contain path, query, or hash`);
  }
  return parsed.origin;
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const origin = normalizeOrigin(entry);
    if (!seen.has(origin)) {
      seen.add(origin);
      normalized.push(origin);
    }
  }
  return normalized;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ConfigError('DATABASE_URL is required');
  }
  let parsedDbUrl: URL;
  try {
    parsedDbUrl = new URL(databaseUrl);
  } catch {
    throw new ConfigError('DATABASE_URL must be a valid postgres:// or postgresql:// URL');
  }
  if (parsedDbUrl.protocol !== 'postgres:' && parsedDbUrl.protocol !== 'postgresql:') {
    throw new ConfigError('DATABASE_URL must use the postgres:// or postgresql:// scheme');
  }

  const host = env.HOST?.trim() || '127.0.0.1';
  const port = parseInteger('PORT', env.PORT, 3000, { min: 0, max: 65535 });

  const rawLogLevel = env.LOG_LEVEL?.trim().toLowerCase() || 'info';
  if (!LOG_LEVEL_SET.has(rawLogLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${env.LOG_LEVEL}"`);
  }
  const logLevel = rawLogLevel as LogLevel;

  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const cookieSecure = parseBoolean('COOKIE_SECURE', env.COOKIE_SECURE, true);
  const sessionCookieName = env.SESSION_COOKIE_NAME?.trim() || 'rc_session';
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(sessionCookieName)) {
    throw new ConfigError(`SESSION_COOKIE_NAME contains invalid characters: "${sessionCookieName}"`);
  }

  const sessionTtlHours = parseInteger('SESSION_TTL_HOURS', env.SESSION_TTL_HOURS, 24 * 7, { min: 1, max: 24 * 365 });
  const maxOpBytes = parseInteger('MAX_OP_BYTES', env.MAX_OP_BYTES, 256 * 1024, { min: 1024, max: 16 * 1024 * 1024 });
  const wsHeartbeatMs = parseInteger('WS_HEARTBEAT_MS', env.WS_HEARTBEAT_MS, 30_000, { min: 1000, max: 300_000 });
  const loginRateLimitMax = parseInteger('LOGIN_RATE_LIMIT_MAX', env.LOGIN_RATE_LIMIT_MAX, 10, { min: 1, max: 10_000 });
  const loginRateLimitWindowMs = parseInteger('LOGIN_RATE_LIMIT_WINDOW_MS', env.LOGIN_RATE_LIMIT_WINDOW_MS, 60_000, {
    min: 1000,
    max: 24 * 60 * 60 * 1000,
  });
  const autoMigrate = parseBoolean('AUTO_MIGRATE', env.AUTO_MIGRATE, true);
  const blobDir = env.BLOB_DIR?.trim() || './data/blobs';

  return {
    databaseUrl,
    host,
    port,
    logLevel,
    allowedOrigins,
    cookieSecure,
    sessionCookieName,
    sessionTtlMs: sessionTtlHours * 60 * 60 * 1000,
    maxOpBytes,
    wsHeartbeatMs,
    loginRateLimitMax,
    loginRateLimitWindowMs,
    autoMigrate,
    blobDir,
  };
}

/**
 * Checks whether an HTTP/WebSocket Origin header is permitted.
 * - If `origin` is absent (e.g., non-browser CLI or same-origin tool without Origin), callers
 *   decide whether an Origin header is required (e.g., WebSocket upgrades from browsers send it).
 * - If `allowedOrigins` is non-empty, `origin` must match one of the configured origins.
 * - Otherwise, `origin` must match the request's `Host` header (same-origin).
 */
export function isOriginAllowed(
  originHeader: string | undefined,
  allowedOrigins: readonly string[],
  requestHost: string | undefined,
  options: { allowMissingOrigin?: boolean } = {},
): boolean {
  if (!originHeader) return Boolean(options.allowMissingOrigin);
  let parsed: URL;
  try {
    parsed = new URL(originHeader);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const normalized = parsed.origin;
  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(normalized);
  }
  if (!requestHost) return false;
  return parsed.host.toLowerCase() === requestHost.toLowerCase();
}
