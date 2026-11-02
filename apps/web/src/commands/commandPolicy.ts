import { desktop } from '../desktop/host';
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
}

/**
 * Asks the embedding host (window.redcolumn) whether the command `id` may run here. A host that
 * links its own records to a document's markups can refuse the commands that rewrite the document
 * under them (Flatten, Unflatten, Reduce File Size, Slip Sheet and their Bulk forms), whatever
 * route reaches them: `buildCommands` maps its table through `applyCommandPolicy`, which covers
 * every dispatcher that renders or runs a command; a dispatcher that does not (the Bulk dialog's
 * Run, which dispatches by kind) asks this by id. Without a host hook every answer is null.
 */
export function commandPolicy(id: string): CommandPolicy {
  const reason = desktop()?.commandPolicy?.(id)?.disabledReason ?? null;
  return {
    run: (original: () => void): (() => void) => (reason === null ? original : () => console.warn(`${id}: ${reason}`)),
    disabledReason: reason,
  };
}

/**
 * `buildCommands`' pass over its table: a command the host refuses comes back disabled, with a run
 * that says why instead of doing it; every other command — and every command where there is no
 * host hook — is the very object it was given, so standalone Redcolumn builds the table it always
 * did.
 */
export function applyCommandPolicy(command: Command): Command {
  const policy = commandPolicy(command.id);
  return policy.disabledReason === null ? command : { ...command, enabled: false, run: policy.run(command.run) };
}
