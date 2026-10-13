import { INSTALL_STEPS, INSTALLER_URL, installerPlatform, isStandalone, MAC_ARM64_URL, MAC_X64_URL, RELEASES_URL } from '../offline/install';

/**
 * Help › Install App: downloads the Windows or macOS desktop app, which opens PDFs from real file
 * paths, saves straight back to them and works with no network.
 */
export function InstallDialog({ onClose }: { onClose: () => void }) {
  const installed = isStandalone();
  const platform = installerPlatform(navigator.userAgent, navigator.maxTouchPoints);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal print-dialog install-dialog" role="dialog" aria-label="Install App" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Install redcolumn</h3>
        {installed ? (
          <p>redcolumn is running as an installed app.</p>
        ) : (
          <>
            <p>The desktop app opens from its own icon, opens PDFs from your files, saves straight back to them and works with no network. Your documents and markups stay on this computer.</p>
            {platform ? (
              <ol className="install-steps">
                {INSTALL_STEPS[platform].map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="print-hint">The desktop app is for Windows and macOS only for now.</p>
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
          {!installed && platform === 'windows' && (
            <a className="btn primary" href={INSTALLER_URL} onClick={onClose}>
              Download for Windows
            </a>
          )}
          {!installed && platform === 'mac' && (
            <>
              <a className="btn" href={MAC_X64_URL} onClick={onClose}>
                Intel
              </a>
              <a className="btn primary" href={MAC_ARM64_URL} onClick={onClose}>
                Apple Silicon
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
