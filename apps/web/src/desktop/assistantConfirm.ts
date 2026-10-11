/** How long Allow or Deny stays up. The page wait is longer, so this answer wins. */
const CONFIRM_WAIT_MS = 120_000;

/** A second prompt waits, so a double-click on Allow cannot accept the next action. */
const NEXT_PROMPT_DELAY_MS = 350;

interface Prompt {
  message: string;
  resolve: (ok: boolean) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const waiting: Prompt[] = [];
let showing: Prompt | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function showNext() {
  if (showing || waiting.length === 0) return;
  const prompt = waiting.shift();
  if (!prompt) return;
  showing = prompt;
  prompt.timer = setTimeout(() => {
    if (showing === prompt) finish(false);
  }, CONFIRM_WAIT_MS);
}

function finish(ok: boolean) {
  const prompt = showing;
  if (!prompt) return;
  if (prompt.timer) clearTimeout(prompt.timer);
  showing = null;
  prompt.resolve(ok);
  emit();
  setTimeout(() => {
    showNext();
    if (showing) emit();
  }, NEXT_PROMPT_DELAY_MS);
}

/** One confirmation at a time. A second destructive call waits until this dialog closes. */
export function confirmAssistant(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    waiting.push({ message, resolve, timer: null });
    const was = showing;
    showNext();
    if (showing !== was) emit();
  });
}

export function allowAssistant() {
  finish(true);
}

export function denyAssistant() {
  finish(false);
}

export function assistantPrompt(): string | null {
  return showing?.message ?? null;
}

export function subscribeAssistantPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
