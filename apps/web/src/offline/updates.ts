/**
 * New versions of the app install in the background (the service worker waits with them) and are
 * applied, which reloads the page, only when nothing is in progress: no gesture, no open dialog,
 * no typing, no job, no markup being drawn. Anything can register a check that names what it is
 * busy with. Help › Check for Updates and the notice's Reload apply a waiting version at once.
 */

export type BusyCheck = () => string | null;

export interface UpdateGateOptions {
  /** Reasons not to reload now (empty: safe). */
  busy: () => string[];
  /** Activates the waiting version and reloads. */
  apply: () => void;
  /** Tells the app a version is waiting, and why it is not applied yet (empty: about to apply). */
  onWaiting?: (reasons: string[]) => void;
}

export class UpdateGate {
  waiting = false;
  private applied = false;
  private opts: UpdateGateOptions;
  constructor(opts: UpdateGateOptions) {
    this.opts = opts;
  }
  /** A new version finished installing. */
  ready() {
    this.waiting = true;
    this.poke();
  }
  /** Something finished (a gesture, a dialog, a job): applies a waiting version if nothing else is going on. */
  poke(): boolean {
    if (!this.waiting || this.applied) return false;
    const reasons = this.opts.busy();
    this.opts.onWaiting?.(reasons);
    if (reasons.length) return false;
    this.applyNow();
    return true;
  }
  /** Applies the waiting version whatever is going on (the person asked). */
  applyNow() {
    if (!this.waiting || this.applied) return;
    this.applied = true;
    this.opts.apply();
  }
}

const checks = new Map<string, BusyCheck>();

/** Registers what could make a reload lose work; returns a function that removes it. */
export function addBusyCheck(name: string, check: BusyCheck) {
  checks.set(name, check);
  return () => void checks.delete(name);
}

export function busyReasons(): string[] {
  const out: string[] = [];
  for (const check of checks.values()) {
    try {
      const r = check();
      if (r && !out.includes(r)) out.push(r);
    } catch {
      // A check that fails does not block updates.
    }
  }
  return out;
}

/** The checks every page has: a pointer held down, a dialog open, text being typed. */
export function addDomBusyChecks(): () => void {
  let pointers = 0;
  const down = () => void pointers++;
  const up = () => void (pointers = Math.max(0, pointers - 1));
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  const offs = [
    addBusyCheck('gesture', () => (pointers > 0 ? 'a gesture is in progress' : null)),
    addBusyCheck('dialog', () => (document.querySelector('.modal-backdrop, .modal[role=dialog]') ? 'a dialog is open' : null)),
    addBusyCheck('typing', () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const text = el.isContentEditable || (el instanceof HTMLTextAreaElement && !!el.value) || (el instanceof HTMLInputElement && /^(text|search|email|url|number|)$/.test(el.type) && !!el.value);
      return text ? 'you are typing' : null;
    }),
  ];
  return () => {
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    offs.forEach((o) => o());
  };
}

let gate: UpdateGate | null = null;
export const setUpdateGate = (g: UpdateGate) => void (gate = g);
export const updateGate = () => gate;
