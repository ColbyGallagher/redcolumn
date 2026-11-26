import { msg } from '@nb/i18n';
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
      <div className="modal print-dialog install-dialog" role="dialog" aria-label={msg('Install App')} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{msg('Install redcolumn')}</h3>
        {installed ? (
          <p>{msg('redcolumn is running as an installed app.')}</p>
        ) : (
          <>
            <p>{msg('The desktop app opens from its own icon, opens PDFs from your files, saves straight back to them and works with no network. Your documents and markups stay on this computer.')}</p>
            {platform ? (
              <ol className="install-steps">
                {INSTALL_STEPS[platform].map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="print-hint">{msg('The desktop app is for Windows and macOS only for now.')}</p>
            )}
          </>
        )}
        <div className="actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {msg('Close')}
          </button>
          {!installed && (
            <a className="btn" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
              {msg('All releases')}
            </a>
          )}
          {!installed && platform === 'windows' && (
            <a className="btn primary" href={INSTALLER_URL} onClick={onClose}>
              {msg('Download for Windows')}
            </a>
          )}
          {!installed && platform === 'mac' && (
            <>
              <a className="btn" href={MAC_X64_URL} onClick={onClose}>
                {msg('Intel')}
              </a>
              <a className="btn primary" href={MAC_ARM64_URL} onClick={onClose}>
                {msg('Apple Silicon')}
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
