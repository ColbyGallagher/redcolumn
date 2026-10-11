import { DriveAuthError } from './DriveApi';

/**
 * A one-screen summary before the first Microsoft or Google sign-in on this browser: what goes to
 * the provider, and that nothing goes to redcolumn (docs/SECURITY-HARDENING.md, 1.5).
 */
export type CloudProviderName = 'microsoft' | 'google';
export type FirstUseConfirm = (provider: CloudProviderName) => Promise<boolean>;

const KEY = 'nb.cloud.firstUseSeen';
let confirm: FirstUseConfirm | null = null;

/** Registers the dialog that shows the summary (FirstUseHost does this once mounted). */
export function setFirstUseConfirm(fn: FirstUseConfirm | null) {
  confirm = fn;
}

function seen(): CloudProviderName[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as CloudProviderName[]) : [];
  } catch {
    return [];
  }
}

/**
 * Shows the summary the first time this provider's sign-in window is about to open, and throws a
 * DriveAuthError if the person cancels. Call right before the window opens, from a click.
 */
export async function firstUse(provider: CloudProviderName): Promise<void> {
  const before = seen();
  if (before.includes(provider) || !confirm) return;
  if (!(await confirm(provider))) throw new DriveAuthError(`${provider === 'microsoft' ? 'Microsoft' : 'Google'} sign-in was cancelled.`);
  try {
    localStorage.setItem(KEY, JSON.stringify([...before, provider]));
  } catch {
    // Shown again next time.
  }
}
