// On Linux a middle click pastes the last text selected anywhere (the "primary selection"), which the
// app takes as Paste. The middle button pans the drawing, so outside text fields a middle click never
// pastes. In text fields it still does, as Linux users expect.

function editable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
}

/** How long after a middle button release a paste is taken as that click's own. */
const PASTE_WINDOW_MS = 500;

export function installNoMiddleClickPaste(win: Window = window) {
  let releasedAt = -Infinity;
  win.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 1 || editable(e.target)) return;
      releasedAt = e.timeStamp;
      // A handled release is not followed by the selection paste.
      e.preventDefault();
    },
    true,
  );
  win.addEventListener(
    'paste',
    (e) => {
      if (editable(e.target) || e.timeStamp - releasedAt > PASTE_WINDOW_MS) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
}
