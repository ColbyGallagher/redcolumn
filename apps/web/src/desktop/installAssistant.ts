import { assistantCall, type AssistantCommand, type AssistantDocument, type AssistantTools } from './assistant';
import { desktop } from './host';

/** What the open app can answer a tool call with. Read at call time, so a later render is seen. */
export interface AssistantRuntime {
  documents: () => readonly AssistantDocument[];
  commands: () => ReadonlyMap<string, AssistantCommand>;
  toolsFor: (documentId: string) => AssistantTools | null;
  confirm: (message: string) => Promise<boolean>;
}

/** Answers tool calls from the desktop main process. Does nothing in the browser. */
export function installAssistant(runtime: () => AssistantRuntime): () => void {
  const host = desktop();
  if (!host) return () => {};
  return host.onAssistantCall((call) => {
    const env = runtime();
    void assistantCall(env.documents(), call.method, call.params, env)
      .then((result) => host.replyAssistant(call.id, { result }))
      .catch((err: unknown) => {
        host.replyAssistant(call.id, { error: err instanceof Error && err.message ? err.message : 'The assistant could not do that.' });
      });
  });
}
