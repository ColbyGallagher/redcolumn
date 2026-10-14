import { useEffect, useState } from 'react';
import { PROJECT_URL } from '../help/whatsNew';
import { setFirstUseConfirm, type CloudProviderName } from '../studio/drive/notices';
import { setStepUpConfirm, type StepUp } from '../studio/drive/onedrive';

/** Words for a step up, shown before Microsoft's own sign-in window (docs/SECURITY-HARDENING.md, 1.3). */
export function stepUpText(step: StepUp): { title: string; body: string } {
  if (step.kind === 'share')
    return {
      title: 'Share this folder from your OneDrive?',
      body: `To ${step.what}, Microsoft needs you to allow redcolumn to read and change files in your OneDrive. redcolumn uses it only for this folder's sharing, and the rest of its work keeps asking for its own folder alone.`,
    };
  if (step.level === 1)
    return {
      title: 'Open a folder outside the app folder?',
      body: `To ${step.what}, Microsoft needs you to allow redcolumn to read and change files in your OneDrive. redcolumn uses it only on the folder you opened.`,
    };
  return {
    title: "Open a folder in someone else's OneDrive?",
    body: `To ${step.what}, Microsoft needs you to allow redcolumn to reach files other people have shared with you. redcolumn uses it only on the folder in the invite you opened.`,
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
        <p className="access-note">You can drop back to the smallest access afterwards in Preferences › Account › Access.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => done(false)}>
            Cancel
          </button>
          <button type="button" className="btn primary" autoFocus onClick={() => done(true)}>
            Continue to Microsoft
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
      <div className="modal" role="dialog" aria-label={`Before you sign in to ${name}`} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && done(false)}>
        <h3>Before you sign in to {name}</h3>
        <ul>
          <li>
            <b>What goes to {name}:</b> the PDFs, markups, chat and names in the sessions, Projects and spreadsheets you use, saved in a folder in your {drive} (or the host's) and shared with the people invited.
          </li>
          <li>
            <b>What goes to redcolumn:</b> nothing. There is no redcolumn server; your browser talks to {name} directly.
          </li>
          <li>
            <b>Access:</b>{' '}
            {req.provider === 'microsoft'
              ? "at first only the app's own folder in your OneDrive. If sharing or someone else's folder needs more, the app tells you why first."
              : 'only files and folders the app made or that you pick, never the rest of your Drive.'}
          </li>
        </ul>
        <p className="access-note">
          See Preferences › Account to check what was allowed and what the app did, or read the{' '}
          <a href={`${PROJECT_URL}/blob/master/PRIVACY.md`} target="_blank" rel="noopener noreferrer">
            privacy policy
          </a>
          .
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => done(false)}>
            Cancel
          </button>
          <button type="button" className="btn primary" autoFocus onClick={() => done(true)}>
            Continue to {name}
          </button>
        </div>
      </div>
    </div>
  );
}
