import { useEffect, useState, useSyncExternalStore } from 'react';

interface Request {
  title: string;
  label?: string;
  initial: string;
  confirm: string;
  password?: boolean;
  /** Pick one of these (value, label) instead of typing. */
  choices?: { value: string; label: string }[];
  resolve: (value: string | null) => void;
}

let current: Request | null = null;
const listeners = new Set<() => void>();
const set = (r: Request | null) => {
  current = r;
  listeners.forEach((l) => l());
};

/** Asks for a short piece of text (a name) in an in-app dialog; resolves null if cancelled. */
export function askText(title: string, initial = '', options: { label?: string; confirm?: string; password?: boolean; choices?: { value: string; label: string }[] } = {}): Promise<string | null> {
  current?.resolve(null);
  return new Promise((resolve) => set({ title, initial, label: options.label, confirm: options.confirm ?? 'OK', password: options.password, choices: options.choices, resolve }));
}

/** Renders the dialog for `askText`; mount once near the root. */
export function AskTextHost() {
  const req = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const [value, setValue] = useState('');
  useEffect(() => setValue(req?.initial ?? ''), [req]);
  if (!req) return null;
  const done = (v: string | null) => {
    set(null);
    req.resolve(v);
  };
  return (
    <div className="modal-backdrop" onMouseDown={() => done(null)}>
      <form
        className="modal"
        role="dialog"
        aria-label={req.title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          // Passwords are taken exactly as typed; names are trimmed.
          if (req.password ? value : value.trim()) done(req.password ? value : value.trim());
        }}
      >
        <h3>{req.title}</h3>
        {req.label && <p>{req.label}</p>}
        <div className={req.choices ? 'choice-list' : 'row'} role={req.choices ? 'radiogroup' : undefined} aria-label={req.choices ? req.title : undefined}>
          {req.choices ? (
            req.choices.map((c, i) => {
              const [head, ...rest] = c.label.split(': ');
              return (
                <label key={c.value} className={`choice ${value === c.value ? 'selected' : ''}`}>
                  <input type="radio" name="ask-choice" value={c.value} checked={value === c.value} autoFocus={i === 0} onChange={() => setValue(c.value)} />
                  <span>
                    <b>{head}</b>
                    {rest.length > 0 && <small>{rest.join(': ')}</small>}
                  </span>
                </label>
              );
            })
          ) : (
          <input
            autoFocus
            type={req.password ? 'password' : 'text'}
            autoComplete={req.password ? 'off' : undefined}
            value={value}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') done(null);
            }}
          />
          )}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => done(null)}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={req.password ? !value : !value.trim()}>
            {req.confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
