import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../../i18n/keyed';
import { useState } from 'react';

/** Splits typed addresses (commas, semicolons, spaces or new lines). */
const parseEmails = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];

const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/**
 * Share Session Invitations. Emails are shared through the session folder.
 * There is no address book in this app, so that option is not shown.
 */
export function InviteDialog({
  link,
  groups,
  onSend,
  onCancel,
}: {
  link: string;
  /** Groups already on the session. Only members that are email addresses can be invited. */
  groups: { name: string; emails: string[] }[];
  onSend: (emails: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'pick' | 'emails'>('pick');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const emails = parseEmails(text);
  const bad = emails.filter((e) => !isEmail(e));
  const groupEmails = [...new Set(groups.flatMap((g) => g.emails.map((e) => e.trim().toLowerCase()).filter(isEmail)))];

  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <form
        className="modal session-dialog rc-share"
        role="dialog"
        aria-modal="true"
        aria-label={msg('Share Session Invitations')}
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
        <div className="rc-share-top">
          <h3>{msg('Share Session Invitations')}</h3>
          <span>
            <button type="button" className="rc-share-copy" onClick={copy}>
              {copied ? msg('Copied') : msg('Copy Session Invitation Link')}
            </button>
            <button type="button" className="rc-dialog-x" aria-label={msg('Close')} disabled={busy} onClick={onCancel}>
              ×
            </button>
          </span>
        </div>
        <div className="rc-share-body">
          {mode === 'pick' ? (
            <>
              <p className="rc-share-lead">{msg('Get Started with one of these options:')}</p>
              <button type="button" className="rc-share-opt" onClick={() => setMode('emails')}>
                {keyed(msgParts('Type or Paste Emails {span}', { span: <span aria-hidden="true">{msg('Ab')}</span> }))}
              </button>
              <button
                type="button"
                className="rc-share-opt"
                onClick={() => {
                  if (!groupEmails.length) {
                    setNote(groups.length ? msg('Those groups have no email addresses yet.') : msg('This session has no groups yet. Add them in Session Settings → Attendees.'));
                    return;
                  }
                  setText((prev) => [...new Set([...parseEmails(prev), ...groupEmails])].join(', '));
                  setNote(null);
                  setMode('emails');
                }}
              >
                {keyed(msgParts('Add Emails from Groups {span}', { span: <span aria-hidden="true">☺</span> }))}
              </button>
              {note && <p className="print-hint">{note}</p>}
            </>
          ) : (
            <div className="rc-share-form">
              <label>
                {keyed(msgParts('Email addresses{textarea}', { textarea: <textarea rows={4} value={text} autoFocus onChange={(e) => setText(e.target.value)} placeholder={msg('ann@example.com, bob@example.com')} /> }))}
              </label>
              <button type="button" className="rc-set-link" onClick={() => setMode('pick')}>
                {msg('Other options')}
              </button>
            </div>
          )}
        </div>
        {bad.length > 0 && <p className="print-error">{msg('Not an email address: {bad}', { bad: bad.join(', ') })}</p>}
        {mode === 'emails' && <p className="print-hint">{msg('The session folder is shared with them, and OneDrive emails them the link.')}</p>}
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !emails.length || bad.length > 0}>
            {busy ? msg('Sending…') : msg('Invite Participants')}
          </button>
        </div>
      </form>
    </div>
  );
}
