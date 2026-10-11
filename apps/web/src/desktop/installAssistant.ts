import { assistantCall, type AssistantDocument } from './assistant';
import { desktop } from './host';

/** Answers tool calls from the desktop main process. Does nothing in the browser. */
export function installAssistant(documents: () => readonly AssistantDocument[]): () => void {
  const host = desktop();
  if (!host) return () => {};
  return host.onAssistantCall((call) => {
    try {
      host.replyAssistant(call.id, { result: assistantCall(documents(), call.method, call.params) });
    } catch (err) {
      host.replyAssistant(call.id, { error: err instanceof Error && err.message ? err.message : 'The assistant could not do that.' });
    }
  });
}
