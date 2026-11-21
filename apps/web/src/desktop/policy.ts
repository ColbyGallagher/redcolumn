import { desktop } from './host';

/**
 * The organisation's policy for the desktop app (apps/desktop/src/policy.ts), read by the main
 * process at startup from the registry or a machine-wide file. The main process enforces the
 * switches itself; here they hide what is turned off, and say so where a setting is locked. The
 * web app has no policy: every answer is "not managed".
 */
export interface ManagedPolicy {
  managed: boolean;
  disableAutoUpdate: boolean;
  disableAssistant: boolean;
  disableCommunityLibrary: boolean;
  disableMicrosoftSignIn: boolean;
  disableExcelSync: boolean;
  /** Command ids, or `prefix.*` for a group, to remove from menus, the ribbon, shortcuts, the palette and the MCP server. */
  disabledFeatures: string[];
  problems: string[];
}

const NONE: ManagedPolicy = {
  managed: false,
  disableAutoUpdate: false,
  disableAssistant: false,
  disableCommunityLibrary: false,
  disableMicrosoftSignIn: false,
  disableExcelSync: false,
  disabledFeatures: [],
  problems: [],
};

/** What a locked setting says. */
export const MANAGED_NOTE = 'Managed by your organisation.';
/** The hint on a command policy removes (seen only where a disabled command is still shown). */
export const MANAGED_HINT = 'Turned off by your organisation.';

/** Only a well-formed copy is used: the preload hands over what the main process read. */
function sanitize(raw: unknown): ManagedPolicy {
  if (!raw || typeof raw !== 'object') return NONE;
  const p = raw as Record<string, unknown>;
  const flag = (k: keyof ManagedPolicy) => p[k] === true;
  const list = (k: keyof ManagedPolicy) => (Array.isArray(p[k]) ? (p[k] as unknown[]).filter((v): v is string => typeof v === 'string') : []);
  return {
    managed: flag('managed'),
    disableAutoUpdate: flag('disableAutoUpdate'),
    disableAssistant: flag('disableAssistant'),
    disableCommunityLibrary: flag('disableCommunityLibrary'),
    disableMicrosoftSignIn: flag('disableMicrosoftSignIn'),
    disableExcelSync: flag('disableExcelSync'),
    disabledFeatures: list('disabledFeatures'),
    problems: list('problems'),
  };
}

let cached: { from: unknown; policy: ManagedPolicy } | null = null;

/** This computer's policy. It is fixed for the life of the app, so this is cheap to ask on every render. */
export function managedPolicy(): ManagedPolicy {
  const raw = desktop()?.policy;
  if (!cached || cached.from !== raw) cached = { from: raw, policy: sanitize(raw) };
  return cached.policy;
}

/** Commands each switch takes away with it, beyond what the switch already stops elsewhere. */
const SWITCH_COMMANDS: [keyof ManagedPolicy, string[]][] = [
  ['disableAutoUpdate', ['help.updates']],
  ['disableCommunityLibrary', ['tools.library']],
];

/** Whether policy removes the command `id`: listed by id, by a `prefix.*` group, or with a switch. */
export function managedRefusal(id: string, policy: ManagedPolicy = managedPolicy()): string | null {
  if (!policy.managed) return null;
  for (const [key, ids] of SWITCH_COMMANDS) if (policy[key] === true && ids.includes(id)) return MANAGED_HINT;
  for (const f of policy.disabledFeatures) {
    if (f === id) return MANAGED_HINT;
    if (f.endsWith('.*') && id.startsWith(f.slice(0, -1))) return MANAGED_HINT;
  }
  return null;
}

/** What Preferences lists as turned off. */
export function managedSummary(policy: ManagedPolicy = managedPolicy()): string[] {
  const out: string[] = [];
  if (policy.disableAutoUpdate) out.push('Automatic updates');
  if (policy.disableAssistant) out.push('The MCP server (AI assistant access)');
  if (policy.disableCommunityLibrary) out.push('The community library');
  if (policy.disableMicrosoftSignIn) out.push('Microsoft sign-in and OneDrive');
  if (policy.disableExcelSync) out.push('Sync to Excel');
  if (policy.disabledFeatures.length) out.push(`${policy.disabledFeatures.length} command${policy.disabledFeatures.length === 1 ? '' : 's'} or command group${policy.disabledFeatures.length === 1 ? '' : 's'}`);
  return out;
}

/** Once at startup: the policy and anything wrong with it go into the log Help › Send Log Files saves. */
export function logManagedPolicy(policy: ManagedPolicy = managedPolicy()) {
  if (!policy.managed) return;
  console.info(`Managed by your organisation: ${managedSummary(policy).join('; ') || 'nothing is turned off'}${policy.disabledFeatures.length ? ` (${policy.disabledFeatures.join(', ')})` : ''}.`);
  for (const problem of policy.problems) console.warn(`Managed policy: ${problem}`);
}
