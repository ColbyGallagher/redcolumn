import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.aff': 'text/plain; charset=utf-8',
  '.dic': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip',
};

const RESERVED_PREFIXES = ['/api/', '/auth/', '/ws/'];
const RESERVED_EXACT = new Set(['/api', '/auth', '/ws', '/healthz', '/readyz', '/config.json']);

export type StaticResolveResult =
  | { ok: true; filePath: string; relativePath: string }
  | { ok: false; reason: 'traversal' | 'invalid' };

/**
 * Resolves a URL pathname against `rootDir`, refusing path traversal, null bytes,
 * backslashes, and symlink escapes.
 */
export function resolveStaticPath(rootDir: string, rawUrlPath: string): StaticResolveResult {
  const pathOnly = rawUrlPath.split('?')[0]?.split('#')[0] ?? '/';
  if (pathOnly.includes('\0') || pathOnly.includes('\\')) {
    return { ok: false, reason: 'traversal' };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (decoded.includes('\0') || decoded.includes('\\')) {
    return { ok: false, reason: 'traversal' };
  }

  const segments = decoded.split('/').filter((seg) => seg.length > 0);
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      return { ok: false, reason: 'traversal' };
    }
  }

  const resolvedRoot = resolve(rootDir);
  const relativePath = segments.join('/');
  const candidate = resolve(resolvedRoot, relativePath);
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + sep)) {
    return { ok: false, reason: 'traversal' };
  }

  return { ok: true, filePath: candidate, relativePath };
}

export function isReservedServerPath(rawUrlPath: string): boolean {
  const pathOnly = rawUrlPath.split('?')[0]?.split('#')[0] ?? '/';
  if (RESERVED_EXACT.has(pathOnly)) return true;
  return RESERVED_PREFIXES.some((prefix) => pathOnly.startsWith(prefix));
}

export function contentTypeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

function cacheControlForRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, '');
  if (normalized.startsWith('assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  if (
    normalized === '' ||
    normalized === 'index.html' ||
    normalized.endsWith('/index.html') ||
    normalized === 'sw.js' ||
    normalized === 'registerSW.js'
  ) {
    return 'no-cache';
  }
  return 'public, max-age=3600';
}

function isWithinRealRoot(realRoot: string, filePath: string): boolean {
  try {
    const realFile = realpathSync(filePath);
    return realFile === realRoot || realFile.startsWith(realRoot + sep);
  } catch {
    return false;
  }
}

function sendStaticFile(
  reply: FastifyReply,
  realRoot: string,
  filePath: string,
  relativePath: string,
  headOnly: boolean,
): FastifyReply {
  if (!isWithinRealRoot(realRoot, filePath)) {
    return reply.code(403).send({ error: 'forbidden' });
  }
  const stat = statSync(filePath);
  reply.header('Content-Type', contentTypeForPath(filePath));
  reply.header('Content-Length', String(stat.size));
  reply.header('Cache-Control', cacheControlForRelativePath(relativePath));
  if (headOnly) {
    return reply.code(200).send();
  }
  return reply.code(200).send(createReadStream(filePath));
}

/**
 * Registers static file serving and SPA fallback for a built web app directory.
 * Uses only Node's built-in filesystem APIs with strict path-traversal guards.
 */
export function registerStaticWebApp(
  app: FastifyInstance<HttpServer, IncomingMessage, ServerResponse, Logger>,
  webDistDir: string,
): boolean {
  const resolvedRoot = resolve(webDistDir);
  if (!existsSync(resolvedRoot)) {
    return false;
  }
  let realRoot: string;
  try {
    if (!statSync(resolvedRoot).isDirectory()) return false;
    realRoot = realpathSync(resolvedRoot);
  } catch {
    return false;
  }

  const indexHtmlPath = resolve(resolvedRoot, 'index.html');

  const handleStatic = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.code(404).send({ error: 'not_found' });
    }

    const rawUrl = request.raw.url ?? request.url;
    if (isReservedServerPath(rawUrl)) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const resolved = resolveStaticPath(resolvedRoot, rawUrl);
    if (!resolved.ok) {
      return reply.code(resolved.reason === 'traversal' ? 403 : 400).send({ error: 'invalid_path' });
    }

    const headOnly = request.method === 'HEAD';

    if (existsSync(resolved.filePath)) {
      try {
        const stat = statSync(resolved.filePath);
        if (stat.isFile()) {
          return sendStaticFile(reply, realRoot, resolved.filePath, resolved.relativePath, headOnly);
        }
        if (stat.isDirectory()) {
          const dirIndex = resolve(resolved.filePath, 'index.html');
          if (existsSync(dirIndex) && statSync(dirIndex).isFile()) {
            const rel = resolved.relativePath ? `${resolved.relativePath}/index.html` : 'index.html';
            return sendStaticFile(reply, realRoot, dirIndex, rel, headOnly);
          }
        }
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    }

    // Missing file with an explicit extension (e.g., /assets/missing.js) should 404, not return HTML.
    if (extname(resolved.relativePath) !== '') {
      return reply.code(404).send({ error: 'not_found' });
    }

    // SPA fallback to index.html for client-side routes.
    if (existsSync(indexHtmlPath) && statSync(indexHtmlPath).isFile()) {
      return sendStaticFile(reply, realRoot, indexHtmlPath, 'index.html', headOnly);
    }

    return reply.code(404).send({ error: 'not_found' });
  };

  app.setNotFoundHandler(handleStatic);
  app.get('/', handleStatic);

  return true;
}
