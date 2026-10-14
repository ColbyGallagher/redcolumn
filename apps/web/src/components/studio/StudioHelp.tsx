import { useState, type ReactNode } from 'react';

const KEY_PREFIX = 'rc.studioHelp.';

const wasClosed = (id: string) => {
  try {
    return localStorage.getItem(KEY_PREFIX + id) === 'closed';
  } catch {
    return false;
  }
};

/**
 * A plain-language "how this works" note for a Studio list. Open until the person closes it, and
 * stays closed on this device after that.
 */
export function StudioHelp({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => !wasClosed(id));
  return (
    <details
      className="rc-help"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        try {
          if (next) localStorage.removeItem(KEY_PREFIX + id);
          else localStorage.setItem(KEY_PREFIX + id, 'closed');
        } catch {
          // Not remembered; it opens again next time.
        }
      }}
    >
      <summary>{title}</summary>
      <div className="rc-help-body">{children}</div>
    </details>
  );
}
