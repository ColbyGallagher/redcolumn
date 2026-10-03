import { useEffect, useState } from 'react';
import { canPromptInstall, INSTALL_STEPS, installPlatform, isStandalone, onInstallChange, promptInstall } from '../offline/install';

/**
 * Help › Install App: installs redcolumn as an app. Where the browser offers an install prompt it
 * is shown from here; otherwise (Safari, iOS, Firefox) the dialog gives that platform's steps.
 */
export function InstallDialog({ onClose, onNotice }: { onClose: () => void; onNotice: (text: string) => void }) {
  const [canPrompt, setCanPrompt] = useState(canPromptInstall);
  useEffect(() => onInstallChange(() => setCanPrompt(canPromptInstall())), []);
  const platform = installPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const installed = isStandalone();
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal print-dialog install-dialog" role="dialog" aria-label="Install App" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Install redcolumn</h3>
        {installed ? (
          <p>redcolumn is running as an installed app.</p>
        ) : (
          <>
            <p>Installed, redcolumn opens from its own icon in its own window, opens PDFs from your files, and works with no network: your documents and markups stay on this device.</p>
            {canPrompt ? (
              <p className="print-hint">Your browser can install it now.</p>
            ) : (
              <ol className="install-steps">
                {INSTALL_STEPS[platform].map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </>
        )}
        <div className="actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {canPrompt && !installed ? 'Cancel' : 'Close'}
          </button>
          {canPrompt && !installed && (
            <button
              className="btn primary"
              autoFocus
              onClick={() =>
                void promptInstall().then((ok) => {
                  onClose();
                  if (ok) onNotice('redcolumn is installed. Open it from its icon.');
                })
              }
            >
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
