import { hostRefusal } from '../desktop/embedHost';
import { managedRefusal } from '../desktop/policy';
import type { Command } from './appCommands';

/** What `commandPolicy` answers: the run to use in place of the app's own, and why it is refused. */
export interface CommandPolicy {
  /**
   * The run to use in place of `original`: a refusal that says why while the host refuses the id,
   * and `original` itself — the same reference, so it behaves identically — when it does not.
   */
  run(original: () => void): () => void;
  /** The host's reason when the command must not run here, null when it may. */
  disabledReason: string | null;
  /** The organisation's policy removes the command (desktop/policy.ts): menus and the ribbon leave it out. */
  managed: boolean;
}

/**
 * Asks whether the command `id` may run here. Two things can refuse it:
 *   - the organisation's managed policy (desktop/policy.ts), which removes the command entirely;
 *   - the embedding host (window.redcolumn; experimental, see desktop/embedHost.ts). A host that
 *     links its own records to a document's markups can refuse the commands that rewrite the
 *     document under them (Flatten, Unflatten, Reduce File Size, Slip Sheet and their Bulk forms).
 * Whatever route reaches them: `buildCommands` maps its table through `applyCommandPolicy`, which
 * covers every dispatcher that renders or runs a command; a dispatcher that does not (the Bulk
 * dialog's Run, which dispatches by kind) asks this by id. Without a policy or a host hook, or
 * with the experimental setting off, every answer is null.
 */
export function commandPolicy(id: string): CommandPolicy {
  const managed = managedRefusal(id);
  const reason = managed ?? hostRefusal(id);
  return {
    run: (original: () => void): (() => void) => (reason === null ? original : () => console.warn(`${id}: ${reason}`)),
    disabledReason: reason,
    managed: managed !== null,
  };
}

/**
 * `buildCommands`' pass over its table: a command refused comes back disabled, with a run that
 * says why instead of doing it (and marked `managed` when policy removed it); every other command
 * — and every command where there is no policy or host hook — is the very object it was given, so
 * standalone Redcolumn builds the table it always did.
 */
export function applyCommandPolicy(command: Command): Command {
  const policy = commandPolicy(command.id);
  if (policy.disabledReason === null) return command;
  return { ...command, enabled: false, run: policy.run(command.run), ...(policy.managed ? { managed: true, hint: policy.disabledReason } : {}) };
}
