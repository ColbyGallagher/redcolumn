/**
 * Managed deployment policy (issue #361): settings an organisation's IT sets for every person on a
 * computer, read once at startup by the main process. A person cannot change them from inside the
 * app. Policy only ever turns things off.
 *
 * Sources, all optional, merged so that the most restrictive wins (a switch is on when any source
 * turns it on; the disabled features are the union of every source's list):
 *   - Windows: the registry key HKLM\SOFTWARE\Policies\redcolumn (Group Policy, Intune, any
 *     configuration tool), read with reg.exe so the app needs no native module.
 *   - A JSON file in a machine-wide folder: %ProgramData%\redcolumn\policy.json on Windows,
 *     /Library/Application Support/redcolumn/policy.json on macOS, /etc/redcolumn/policy.json on Linux.
 *
 * Validation is strict. Unknown keys are ignored and logged (a newer policy on an older app). A
 * known switch with a value of the wrong type counts as on, and a policy file that exists but
 * cannot be read or parsed turns every switch on: the policy's presence says the organisation meant
 * to restrict the app, a switch only ever removes a feature, and every switch leaves the core
 * PDF work alone, so failing closed never grants anything and never stops someone working. Each
 * problem is logged and handed to the page, which writes it into the log Help › Send Log Files saves.
 *
 * Policy is a management control for the installed app, not a boundary against a person who can
 * run software of their choosing: pair it with application control (AppLocker, WDAC) for that.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/** What the page and the main process act on. */
export interface ManagedPolicy {
  /** Some source supplied a policy, so Preferences says settings are managed. */
  managed: boolean;
  /** No update checks, no downloads, and the update UI is hidden. */
  disableAutoUpdate: boolean;
  /** The local MCP server (AI assistant access) is off and cannot be turned on. */
  disableAssistant: boolean;
  /** Tools › Browse Library, which lists and downloads packs from the public library on GitHub. */
  disableCommunityLibrary: boolean;
  /** Microsoft sign-in and everything that needs it (OneDrive projects, sessions, profile backup). */
  disableMicrosoftSignIn: boolean;
  /** Sync to Excel on this computer (Windows; drives Excel through COM). */
  disableExcelSync: boolean;
  /** Command ids (as menus, the ribbon, shortcuts and the command palette use them) to remove. `prefix.*` removes a group. */
  disabledFeatures: string[];
  /** What was wrong with the policy, for the log. */
  problems: string[];
}

export type PolicySwitch = 'disableAutoUpdate' | 'disableAssistant' | 'disableCommunityLibrary' | 'disableMicrosoftSignIn' | 'disableExcelSync';

export const SWITCHES: readonly PolicySwitch[] = ['disableAutoUpdate', 'disableAssistant', 'disableCommunityLibrary', 'disableMicrosoftSignIn', 'disableExcelSync'];

export const NO_POLICY: ManagedPolicy = Object.freeze({
  managed: false,
  disableAutoUpdate: false,
  disableAssistant: false,
  disableCommunityLibrary: false,
  disableMicrosoftSignIn: false,
  disableExcelSync: false,
  disabledFeatures: [],
  problems: [],
}) as ManagedPolicy;

/** One source's contribution. Switches it does not mention are left to the others. */
export interface PolicyPart {
  source: string;
  switches: Partial<Record<PolicySwitch, boolean>>;
  disabledFeatures: string[];
  problems: string[];
}

/** A command id, or a group of them (`takeoff.*`). Anything else is not a feature name. */
const FEATURE = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*(?:\.\*)?$/;
const MAX_FEATURES = 500;
/** A policy file is a few hundred bytes; anything this size is not one. */
const MAX_FILE = 64 * 1024;

const lowerSwitch = new Map(SWITCHES.map((s) => [s.toLowerCase(), s]));
const FEATURES_KEY = 'disabledfeatures';

function features(source: string, list: unknown[], problems: string[]): string[] {
  const out: string[] = [];
  for (const item of list.slice(0, MAX_FEATURES)) {
    if (typeof item === 'string' && FEATURE.test(item.trim())) out.push(item.trim());
    else problems.push(`${source}: ${JSON.stringify(item)} in DisabledFeatures is not a command id; it is ignored.`);
  }
  if (list.length > MAX_FEATURES) problems.push(`${source}: DisabledFeatures has more than ${MAX_FEATURES} entries; the rest are ignored.`);
  return out;
}

/** Every switch on: what a policy file that exists but cannot be used stands for. */
function lockedDown(source: string, problem: string): PolicyPart {
  return { source, switches: Object.fromEntries(SWITCHES.map((s) => [s, true])), disabledFeatures: [], problems: [`${source}: ${problem} Every policy switch is treated as on until it is fixed.`] };
}

/** The JSON policy file's text. Keys match without regard to case, as the registry's do. */
export function parsePolicyJson(source: string, text: string): PolicyPart {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    return lockedDown(source, `the file is not valid JSON (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return lockedDown(source, 'the file does not hold a JSON object.');
  const part: PolicyPart = { source, switches: {}, disabledFeatures: [], problems: [] };
  for (const [key, v] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const name = lowerSwitch.get(lower);
    if (name) {
      if (typeof v === 'boolean') part.switches[name] = v;
      else {
        part.switches[name] = true;
        part.problems.push(`${source}: ${key} must be true or false; it is treated as true.`);
      }
    } else if (lower === FEATURES_KEY) {
      if (Array.isArray(v)) part.disabledFeatures = features(source, v, part.problems);
      else part.problems.push(`${source}: ${key} must be a list of command ids; it is ignored.`);
    } else if (lower !== 'version' && lower !== '$schema' && lower !== 'comment') {
      part.problems.push(`${source}: ${key} is not a policy this version knows; it is ignored.`);
    }
  }
  return part;
}

/** A registry value as reg.exe (or PowerShell) reports it. */
export type RegValue = { type: 'dword'; value: number } | { type: 'multi'; value: string[] } | { type: 'string'; value: string } | { type: 'other'; kind: string };

/** The policy key's values (by name, lower case) and, for the Group Policy list form, the DisabledFeatures subkey's values. */
export interface RegistryPolicy {
  values: Map<string, RegValue>;
  list: RegValue[] | null;
}

export function parsePolicyRegistry(source: string, reg: RegistryPolicy): PolicyPart {
  const part: PolicyPart = { source, switches: {}, disabledFeatures: [], problems: [] };
  for (const [lower, v] of reg.values) {
    if (!lower) continue; // The key's (Default) value.
    const name = lowerSwitch.get(lower);
    if (name) {
      if (v.type === 'dword' && (v.value === 0 || v.value === 1)) part.switches[name] = v.value === 1;
      else {
        part.switches[name] = true;
        part.problems.push(`${source}: ${name} must be a REG_DWORD of 0 or 1; it is treated as 1.`);
      }
    } else if (lower === FEATURES_KEY) {
      if (v.type === 'multi') part.disabledFeatures.push(...features(source, v.value, part.problems));
      else if (v.type === 'string') part.disabledFeatures.push(...features(source, v.value.split(/[;,\s]+/).filter(Boolean), part.problems));
      else part.problems.push(`${source}: DisabledFeatures must be REG_MULTI_SZ or REG_SZ; it is ignored.`);
    } else part.problems.push(`${source}: ${lower} is not a policy this version knows; it is ignored.`);
  }
  if (reg.list) {
    const names: unknown[] = [];
    for (const v of reg.list) {
      if (v.type === 'string') names.push(v.value);
      else if (v.type === 'multi') names.push(...v.value);
      else part.problems.push(`${source}: values under the DisabledFeatures key must be strings; one is ignored.`);
    }
    part.disabledFeatures.push(...features(source, names, part.problems));
  }
  return part;
}

/** Most restrictive wins. `managed` is set when any source exists, even one that sets nothing. */
export function mergePolicy(parts: readonly PolicyPart[], extraProblems: readonly string[] = []): ManagedPolicy {
  const out: ManagedPolicy = { ...NO_POLICY, managed: parts.length > 0, disabledFeatures: [], problems: [...extraProblems] };
  const seen = new Set<string>();
  for (const part of parts) {
    for (const s of SWITCHES) if (part.switches[s] === true) out[s] = true;
    for (const f of part.disabledFeatures)
      if (!seen.has(f)) {
        seen.add(f);
        out.disabledFeatures.push(f);
      }
    out.problems.push(...part.problems);
  }
  return out;
}

/** reg.exe's output for `reg query <key> /s`: each key's values, by key path (lower case). */
export function parseRegQuery(stdout: string): Map<string, Map<string, RegValue>> {
  const keys = new Map<string, Map<string, RegValue>>();
  let current: Map<string, RegValue> | null = null;
  for (const raw of stdout.split(/\r?\n/)) {
    if (/^HKEY_/i.test(raw)) {
      current = new Map();
      keys.set(raw.trim().toLowerCase(), current);
      continue;
    }
    const m = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*?))?\s*$/.exec(raw);
    if (!m || !current) continue;
    const name = m[1]!.toLowerCase();
    const kind = m[2]!;
    const data = m[3] ?? '';
    // reg.exe shows the unnamed value as "(Default)" (translated); it is never a policy.
    if (/^\(.*\)$/.test(name)) continue;
    if (kind === 'REG_DWORD') current.set(name, { type: 'dword', value: Number.parseInt(data, 16) });
    else if (kind === 'REG_MULTI_SZ') current.set(name, { type: 'multi', value: data ? data.split('\\0').filter(Boolean) : [] });
    else if (kind === 'REG_SZ' || kind === 'REG_EXPAND_SZ') current.set(name, { type: 'string', value: data });
    else current.set(name, { type: 'other', kind });
  }
  return keys;
}

export const REGISTRY_KEY = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\redcolumn';
const REG_PARENT = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies';

/** What PowerShell's fallback reports, turned into the shape reg.exe's output gives. */
export function parsePowerShellRegistry(stdout: string): RegistryPolicy | null {
  const value = JSON.parse(stdout.trim() || 'null') as { main?: Record<string, { kind?: unknown; value?: unknown }> | null; list?: Record<string, { kind?: unknown; value?: unknown }> | null } | null;
  if (!value || !value.main) return null;
  const convert = (v: { kind?: unknown; value?: unknown }): RegValue => {
    const kind = String(v.kind);
    if (kind === 'DWord' && typeof v.value === 'number') return { type: 'dword', value: v.value };
    if (kind === 'MultiString') return { type: 'multi', value: (Array.isArray(v.value) ? v.value : v.value == null ? [] : [v.value]).map(String) };
    if ((kind === 'String' || kind === 'ExpandString') && typeof v.value === 'string') return { type: 'string', value: v.value };
    return { type: 'other', kind };
  };
  const values = new Map(Object.entries(value.main).map(([k, v]) => [k.toLowerCase(), convert(v)] as const));
  const list = value.list ? Object.entries(value.list).filter(([k]) => k !== '').map(([, v]) => convert(v)) : null;
  return { values, list };
}

export type Run = (file: string, args: string[]) => Promise<{ code: number; stdout: string }>;

const run: Run = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : -1) : 0;
      resolve({ code, stdout: stdout ?? '' });
    });
  });

/** System tools by their fixed paths, not PATH, so a folder earlier on PATH cannot stand in for them. */
function systemTool(relative: string): string {
  const root = process.env.SystemRoot && /^[A-Za-z]:\\/.test(process.env.SystemRoot) ? process.env.SystemRoot : 'C:\\Windows';
  return path.win32.join(root, 'System32', relative);
}

const PS_SCRIPT = `$ErrorActionPreference='Stop'
function Read-PolicyKey($p){ if(-not (Test-Path -LiteralPath $p)){ return $null }; $k=Get-Item -LiteralPath $p; $o=@{}; foreach($n in $k.GetValueNames()){ $o[$n]=@{kind=[string]$k.GetValueKind($n); value=$k.GetValue($n)} }; return $o }
$root='Registry::${REGISTRY_KEY}'
@{ main=(Read-PolicyKey $root); list=(Read-PolicyKey "$root\\DisabledFeatures") } | ConvertTo-Json -Depth 4 -Compress`;

/**
 * The registry policy, or null when there is none. reg.exe first: listing HKLM\SOFTWARE\Policies
 * (which always exists) tells "no redcolumn key" from "reg.exe cannot run here". Organisations that
 * turn on "Prevent access to registry editing tools" stop reg.exe; PowerShell reads the key then.
 */
export async function readRegistryPolicy(exec: Run = run): Promise<{ reg: RegistryPolicy | null; problem?: string }> {
  const reg = systemTool('reg.exe');
  const parent = await exec(reg, ['query', REG_PARENT, '/reg:64']);
  if (parent.code === 0) {
    const has = parent.stdout.split(/\r?\n/).some((l) => l.trim().toLowerCase() === REGISTRY_KEY.toLowerCase());
    if (!has) return { reg: null };
    const key = await exec(reg, ['query', REGISTRY_KEY, '/s', '/reg:64']);
    if (key.code === 0) {
      const keys = parseRegQuery(key.stdout);
      const values = keys.get(REGISTRY_KEY.toLowerCase()) ?? new Map<string, RegValue>();
      const sub = keys.get(`${REGISTRY_KEY}\\DisabledFeatures`.toLowerCase());
      return { reg: { values, list: sub ? [...sub.values()] : null } };
    }
  }
  const ps = await exec(systemTool('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')]);
  if (ps.code === 0) {
    try {
      return { reg: parsePowerShellRegistry(ps.stdout) };
    } catch {
      // Falls through to the problem below.
    }
  }
  return { reg: null, problem: `${REGISTRY_KEY} could not be read (reg.exe and PowerShell both failed); registry policy is not applied.` };
}

/** The machine-wide policy file for this platform. */
export function policyFilePath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    const data = process.env.ProgramData && /^[A-Za-z]:\\/.test(process.env.ProgramData) ? process.env.ProgramData : 'C:\\ProgramData';
    return path.win32.join(data, 'redcolumn', 'policy.json');
  }
  if (platform === 'darwin') return '/Library/Application Support/redcolumn/policy.json';
  return '/etc/redcolumn/policy.json';
}

/** The file's part, or null when there is no file. */
export async function readPolicyFile(file: string): Promise<PolicyPart | null> {
  const source = file;
  try {
    const stat = await fs.stat(file).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
      throw err;
    });
    if (!stat) return null;
    if (!stat.isFile()) return lockedDown(source, 'it is not a file.');
    if (stat.size > MAX_FILE) return lockedDown(source, `it is larger than ${MAX_FILE / 1024} KB.`);
    return parsePolicyJson(source, await fs.readFile(file, 'utf8'));
  } catch (err) {
    return lockedDown(source, `it could not be read (${err instanceof Error ? err.message : String(err)}).`);
  }
}

/**
 * Reads every source for this platform. `extraFile` is a further file (the e2e suite's
 * RECOLUMN_POLICY_FILE); since sources only ever add restrictions, it can never loosen a policy.
 */
export async function loadPolicy(options: { platform?: NodeJS.Platform; files?: string[]; extraFile?: string; exec?: Run } = {}): Promise<ManagedPolicy> {
  const platform = options.platform ?? process.platform;
  const problems: string[] = [];
  const parts: PolicyPart[] = [];
  const reading: Promise<void>[] = [];
  if (platform === 'win32')
    reading.push(
      readRegistryPolicy(options.exec).then(({ reg, problem }) => {
        if (problem) problems.push(problem);
        if (reg) parts.push(parsePolicyRegistry(REGISTRY_KEY, reg));
      }),
    );
  for (const file of [...(options.files ?? [policyFilePath(platform)]), options.extraFile].filter((f): f is string => !!f))
    reading.push(
      readPolicyFile(file).then((part) => {
        if (part) parts.push(part);
      }),
    );
  await Promise.all(reading);
  // Same order whichever source answered first.
  parts.sort((a, b) => a.source.localeCompare(b.source));
  return mergePolicy(parts, problems);
}

/** What stands in when reading the policy failed outright (a bug, not a bad policy): every switch on. */
export function failedPolicy(err: unknown): ManagedPolicy {
  return mergePolicy([lockedDown('policy', `reading the policy failed (${err instanceof Error ? err.message : String(err)}).`)]);
}

/**
 * Requests the page may not make under this policy (Electron webRequest URL patterns), so a switch
 * holds even for a request the page's own checks missed. Calls the main process makes for the page
 * (sign-in, Graph, updates) are refused where they are handled instead.
 */
export function blockedRequests(policy: ManagedPolicy): string[] {
  const urls: string[] = [];
  if (policy.disableCommunityLibrary) urls.push('https://raw.githubusercontent.com/ColbyGallagher/redcolumn-library/*');
  if (policy.disableMicrosoftSignIn)
    urls.push(
      '*://login.microsoftonline.com/*',
      '*://login.live.com/*',
      '*://graph.microsoft.com/*',
      '*://*.sharepoint.com/*',
      '*://*.1drv.com/*',
      '*://*.livefilestore.com/*',
      '*://my.microsoftpersonalcontent.com/*',
    );
  return urls;
}

/** One line for the log: what this computer's policy turns off. */
export function describePolicy(policy: ManagedPolicy): string {
  if (!policy.managed) return 'No managed policy.';
  const on = SWITCHES.filter((s) => policy[s]);
  return `Managed policy: ${on.length ? on.join(', ') : 'no switches on'}${policy.disabledFeatures.length ? `; disabled features: ${policy.disabledFeatures.join(', ')}` : ''}.`;
}
