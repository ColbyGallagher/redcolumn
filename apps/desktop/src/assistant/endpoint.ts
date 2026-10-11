import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A fixed folder, not Electron's user-data path. The assistant process is a separate Node
 * program, so it cannot ask Electron where user data lives. Both sides use this file.
 */
export function endpointFile(): string {
  const dir = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'redcolumn')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'redcolumn')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'redcolumn');
  return path.join(dir, 'assistant.json');
}

export interface AssistantEndpoint {
  enabled: boolean;
  port?: number;
  token?: string;
}

const TOKEN = /^[a-f0-9]{64}$/;

/** A listener the proxy can dial. Missing or half-written files count as off. */
export function parseEndpoint(text: string): AssistantEndpoint {
  try {
    const value = JSON.parse(text) as { enabled?: unknown; port?: unknown; token?: unknown };
    const enabled = value.enabled === true;
    const port = typeof value.port === 'number' && Number.isInteger(value.port) && value.port > 0 && value.port < 65536 ? value.port : undefined;
    const token = typeof value.token === 'string' && TOKEN.test(value.token) ? value.token : undefined;
    if (enabled && port && token) return { enabled, port, token };
    return { enabled };
  } catch {
    return { enabled: false };
  }
}

export function readEndpoint(file: string): AssistantEndpoint {
  try {
    return parseEndpoint(fs.readFileSync(file, 'utf8'));
  } catch {
    return { enabled: false };
  }
}

/** Small enough to write synchronously, including while the app is quitting. */
export function writeEndpoint(file: string, value: AssistantEndpoint) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  try {
    fs.renameSync(temp, file);
  } catch (err) {
    fs.unlinkSync(temp);
    throw err;
  }
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}
