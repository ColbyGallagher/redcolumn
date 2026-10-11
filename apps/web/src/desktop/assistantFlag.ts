/** Whether the desktop assistant is listening. The status bar reads this; the dialog writes it. */
let on = false;
const listeners = new Set<() => void>();

export const assistantIsOn = () => on;

export function setAssistantOn(next: boolean) {
  if (on === next) return;
  on = next;
  for (const listener of listeners) listener();
}

export function subscribeAssistant(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
