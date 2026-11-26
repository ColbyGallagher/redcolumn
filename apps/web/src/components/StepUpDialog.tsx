import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useEffect, useState } from 'react';
import { PROJECT_URL } from '../help/whatsNew';
import { setFirstUseConfirm, type CloudProviderName } from '../studio/drive/notices';
import { setStepUpConfirm, type StepUp } from '../studio/drive/onedrive';

/** Words for a step up, shown before Microsoft's own sign-in window (docs/SECURITY-HARDENING.md, 1.3). */
export function stepUpText(step: StepUp): { title: string; body: string } {
  if (step.kind === 'share')
    return {
      title: msg('Share this folder from your OneDrive?'),
      body: msg('To {what}, Microsoft needs you to allow redcolumn to read and change files in your OneDrive. redcolumn uses it only for this folder\'s sharing, and the rest of its work keeps asking for its own folder alone.', { what: step.what }),
    };
  if (step.level === 1)
    return {
      title: msg('Open a folder outside the app folder?'),
      body: msg('To {what}, Microsoft needs you to allow redcolumn to read and change files in your OneDrive. redcolumn uses it only on the folder you opened.', { what: step.what }),
    };
  return {
    title: msg('Open a folder in someone else\'s OneDrive?'),
    body: msg('To {what}, Microsoft needs you to allow redcolumn to reach files other people have shared with you. redcolumn uses it only on the folder in the invite you opened.', { what: step.what }),
  };
}

/** Explains a OneDrive step up before Microsoft's window opens; mount once near the root. */
export function StepUpHost() {
  const [req, setReq] = useState<{ step: StepUp; resolve: (ok: boolean) => void } | null>(null);
  useEffect(() => {
    setStepUpConfirm((step) => new Promise<boolean>((resolve) => setReq((prev) => (prev?.resolve(false), { step, resolve }))));
    return () => setStepUpConfirm(null);
  }, []);
  if (!req) return null;
  const done = (ok: boolean) => {
    setReq(null);
    req.resolve(ok);
  };
  const { title, body } = stepUpText(req.step);
  return (
    <div className="modal-backdrop" onMouseDown={() => done(false)}>
      <div className="modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && done(false)}>
        <h3>{title}</h3>
        <p>{body}</p>
        <p className="access-note">{msg('You can drop back to the smallest access afterwards in Preferences › Account › Access.')}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => done(false)}>
            {msg('Cancel')}
          </button>
          <button type="button" className="btn primary" autoFocus onClick={() => done(true)}>
            {msg('Continue to Microsoft')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The summary before the first sign-in to a provider on this browser (docs/SECURITY-HARDENING.md, 1.5); mount once. */
export function FirstUseHost() {
  const [req, setReq] = useState<{ provider: CloudProviderName; resolve: (ok: boolean) => void } | null>(null);
  useEffect(() => {
    setFirstUseConfirm((provider) => new Promise<boolean>((resolve) => setReq((prev) => (prev?.resolve(false), { provider, resolve }))));
    return () => setFirstUseConfirm(null);
  }, []);
  if (!req) return null;
  const done = (ok: boolean) => {
    setReq(null);
    req.resolve(ok);
  };
  const name = 'Microsoft';
  const drive = 'OneDrive';
  return (
    <div className="modal-backdrop" onMouseDown={() => done(false)}>
      <div className="modal" role="dialog" aria-label={msg('Before you sign in to {name}', { name })} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && done(false)}>
        <h3>{msg('Before you sign in to {name}', { name })}</h3>
        <ul>
          <li>
            {keyed(msgParts('{b} the PDFs, markups, chat and names in the sessions, Projects and spreadsheets you use, saved in a folder in your {drive} (or the host\'s) and shared with the people invited.', { b: <b>{msg('What goes to {name}:', { name })}</b>, drive }))}
          </li>
          <li>
            {keyed(msgParts('{b} nothing. There is no redcolumn server; your browser talks to {name} directly.', { b: <b>{msg('What goes to redcolumn:')}</b>, name }))}
          </li>
          <li>
            <b>{msg('Access:')}</b>{' '}
            {req.provider === 'microsoft'
              ? msg('at first only the app\'s own folder in your OneDrive. If sharing or someone else\'s folder needs more, the app tells you why first.')
              : msg('only files and folders the app made or that you pick, never the rest of your Drive.')}
          </li>
        </ul>
        <p className="access-note">
          {keyed(
            msgParts('See Preferences › Account to check what was allowed and what the app did, or read the {link}.', {
              link: (
                <a href={`${PROJECT_URL}/blob/master/PRIVACY.md`} target="_blank" rel="noopener noreferrer">
                  {msg('privacy policy')}
                </a>
              ),
            }),
          )}
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => done(false)}>
            {msg('Cancel')}
          </button>
          <button type="button" className="btn primary" autoFocus onClick={() => done(true)}>
            {msg('Continue to {name}', { name })}
          </button>
        </div>
      </div>
    </div>
  );
}
