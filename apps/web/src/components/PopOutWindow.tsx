import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Names the window, so the same panel always reuses its own window. */
  name: string;
  title: string;
  width?: number;
  height?: number;
  /** The window was closed, or the browser would not open it. */
  onClose: (reason: 'closed' | 'blocked') => void;
  children: ReactNode;
}

/** Copies the app's styles into a new window; it starts with none. */
function copyStyles(from: Document, to: Document) {
  for (const node of from.head.querySelectorAll('link[rel="stylesheet"], style')) to.head.appendChild(node.cloneNode(true));
  to.documentElement.className = from.documentElement.className;
  for (const { name, value } of [...from.documentElement.attributes]) if (name.startsWith('data-')) to.documentElement.setAttribute(name, value);
  to.body.className = from.body.className;
}

/**
 * Shows its children in a separate browser window (a React portal). The panel keeps running in
 * this page, so it stays live with no syncing. It must be opened from a click, or the browser's
 * popup blocker refuses it. The window closes with the app.
 */
export function PopOutWindow({ name, title, width = 900, height = 520, onClose, children }: Props) {
  const [target, setTarget] = useState<{ win: Window; root: HTMLElement } | null>(null);

  useEffect(() => {
    const win = window.open('', name, `popup=yes,width=${width},height=${height},left=${window.screenX + 60},top=${window.screenY + 80}`);
    if (!win) {
      onClose('blocked');
      return;
    }
    win.document.title = title;
    win.document.body.textContent = '';
    copyStyles(document, win.document);
    const root = win.document.createElement('div');
    root.id = 'root';
    win.document.body.appendChild(root);
    setTarget({ win, root });
    let done = false;
    const closed = () => {
      if (done) return;
      done = true;
      onClose('closed');
    };
    // `pagehide` fires when the user closes the window; `beforeunload` here closes it with the app.
    win.addEventListener('pagehide', closed);
    const closeWithApp = () => win.close();
    window.addEventListener('pagehide', closeWithApp);
    return () => {
      done = true;
      win.removeEventListener('pagehide', closed);
      window.removeEventListener('pagehide', closeWithApp);
      win.close();
    };
    // Opened once: the window's name and size only matter at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (target) target.win.document.title = title;
  }, [target, title]);

  return target ? createPortal(children, target.root) : null;
}
