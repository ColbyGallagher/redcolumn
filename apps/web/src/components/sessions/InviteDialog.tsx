import { useState } from 'react';

/** Splits typed addresses (commas, semicolons, spaces or new lines). */
const parseEmails = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];

/** Invite people to a session by email: Google Drive or OneDrive shares the folder and emails them. */
export function InviteDialog({ title, onSend, onCancel }: { title: string; onSend: (emails: string[]) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emails = parseEmails(text);
  const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <form
        className="modal print-dialog invite-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !busy) onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!emails.length || bad.length || busy) return;
          setBusy(true);
          setError(null);
          onSend(emails).catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
          });
        }}
      >
        <h3>{title}</h3>
        <label>
          Email addresses
          <textarea rows={3} value={text} autoFocus onChange={(e) => setText(e.target.value)} placeholder="ann@example.com, bob@example.com" style={{ width: '100%' }} />
        </label>
        {bad.length > 0 && <p className="print-error">Not an email address: {bad.join(', ')}</p>}
        <p className="print-hint">The session folder is shared with them, and Google Drive or OneDrive emails them the link.</p>
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !emails.length || bad.length > 0}>
            {busy ? 'Sending…' : 'Invite'}
          </button>
        </div>
      </form>
    </div>
  );
}
