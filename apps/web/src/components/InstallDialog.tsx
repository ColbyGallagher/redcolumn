import { INSTALL_STEPS, INSTALLER_URL, installerSupported, isStandalone, RELEASES_URL } from '../offline/install';

/**
 * Help › Install App: downloads the Windows desktop app, which opens PDFs from real file paths,
 * saves straight back to them and works with no network.
 */
export function InstallDialog({ onClose }: { onClose: () => void }) {
  const installed = isStandalone();
  const supported = installerSupported(navigator.userAgent);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal print-dialog install-dialog" role="dialog" aria-label="Install App" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Install redcolumn</h3>
        {installed ? (
          <p>redcolumn is running as an installed app.</p>
        ) : (
          <>
            <p>The desktop app opens from its own icon, opens PDFs from your files, saves straight back to them and works with no network. Your documents and markups stay on this computer.</p>
            {supported ? (
              <ol className="install-steps">
                {INSTALL_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="print-hint">The desktop app is for Windows only for now.</p>
            )}
          </>
        )}
        <div className="actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {!installed && (
            <a className="btn" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
              All releases
            </a>
          )}
          {!installed && supported && (
            <a className="btn primary" href={INSTALLER_URL} onClick={onClose}>
              Download for Windows
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
