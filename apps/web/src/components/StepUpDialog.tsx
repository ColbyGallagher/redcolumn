import { useEffect, useState } from 'react';
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
        <p className="hint">You can drop back to the smallest access afterwards by signing out of Microsoft in the Sessions panel.</p>
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
