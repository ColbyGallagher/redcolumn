/**
 * Tab stays inside the open dialog. One document-level listener covers every `.modal-backdrop`,
 * so dialogs need no code of their own. When a dialog opens with focus still on the page behind
 * it, focus moves into the dialog; Tab and Shift+Tab then wrap at its first and last controls.
 */
const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

function topDialog(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('.modal-backdrop');
  return all.length ? all[all.length - 1]! : null;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('tabindex') !== '-1' &&
      !(el instanceof HTMLInputElement && el.type === 'hidden') &&
      el.getClientRects().length > 0,
  );
}

function enter(dialog: HTMLElement) {
  if (dialog.contains(document.activeElement)) return;
  const first = focusables(dialog)[0];
  (first ?? (dialog.querySelector<HTMLElement>('.modal') ?? dialog)).focus({ preventScroll: true });
}

export function installDialogFocus() {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
      const dialog = topDialog();
      if (!dialog) return;
      const items = focusables(dialog);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!active || !dialog.contains(active)) {
        e.preventDefault();
        e.stopPropagation();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    true,
  );

  // Move focus into a dialog as it opens (dialogs that autofocus a control are left alone).
  let seen: HTMLElement | null = null;
  new MutationObserver(() => {
    const dialog = topDialog();
    if (dialog === seen) return;
    seen = dialog;
    if (dialog) queueMicrotask(() => enter(dialog));
  }).observe(document.body, { childList: true, subtree: true });
}
