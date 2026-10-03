import { useCallback, useEffect, useState } from 'react';
import { OCR_LANGUAGES } from '../documents/ocr';
import { useOnline } from '../offline/network';
import { downloadOcr, ocrOffline, removeOcr } from '../offline/ocrCache';
import { describeStorage, readStorage, requestPersistence, type StorageState } from '../offline/storage';

/**
 * Preferences › Offline: whether the app and its data are on this device, how much space they use,
 * whether the browser may clear them, and OCR languages to download for use without a network.
 */
export function OfflinePrefs() {
  const online = useOnline();
  const [storage, setStorage] = useState<StorageState | null>(null);
  const [ocr, setOcr] = useState<{ engine: boolean; langs: Record<string, boolean> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const langs = Object.keys(OCR_LANGUAGES);

  const refresh = useCallback(async () => {
    setStorage(await readStorage());
    setOcr(await ocrOffline(langs).catch(() => null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const d = storage ? describeStorage(storage) : null;
  const appCached = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
  return (
    <>
      <h4>This device</h4>
      <p className="pref-hint">
        {online ? 'Online.' : 'Offline: documents, markups, measurements and everything else on this device keep working; Live Sessions, AI indexing, signatures’ time stamps and cloud storage wait for the network.'}{' '}
        {appCached ? 'The app is saved on this device and opens without a network.' : 'The app is not saved for offline use yet (it is once it has loaded from the web, not from a development server).'}
      </p>
      <h4>Storage</h4>
      {d && (
        <div className="storage-use">
          <span className="pref-label">{d.summary}</span>
          {d.percent !== null && (
            <div className="storage-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(d.percent)} aria-label="Storage used">
              <span style={{ width: `${Math.max(1, d.percent)}%` }} />
            </div>
          )}
          {d.parts.length > 0 && (
            <ul className="storage-parts">
              {d.parts.map((p) => (
                <li key={p.label}>
                  {p.label}: {p.size}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="pref-field">
        <span className="pref-label">{storage?.persisted ? 'Kept: the browser will not clear redcolumn’s documents to free space.' : 'Not protected: the browser may clear documents and markups if the device runs short of space.'}</span>
        {storage && !storage.persisted && (
          <button
            className="btn small"
            onClick={() =>
              void requestPersistence().then(async (ok) => {
                await refresh();
                setError(ok ? null : 'The browser declined. Installing the app (Help › Install App) or bookmarking it usually lets it keep the data.');
              })
            }
          >
            Keep on This Device
          </button>
        )}
      </div>
      <h4>OCR languages</h4>
      <p className="pref-hint">OCR data downloads the first time a language is used. Download languages here to use OCR offline from the start (1–3 MB each, plus the 4 MB engine once).</p>
      <ul className="ocr-offline">
        {langs.map((l) => {
          const have = ocr?.langs[l] && ocr.engine;
          return (
            <li key={l} className="row">
              <span style={{ flex: 1 }}>{OCR_LANGUAGES[l]}</span>
              <span className="pref-hint">{busy === l ? 'Downloading…' : have ? 'On this device' : ocr?.langs[l] ? 'Needs the engine' : 'Not downloaded'}</span>
              {have ? (
                <button className="btn small flat" disabled={!!busy} onClick={() => void removeOcr(l).then(refresh)}>
                  Remove
                </button>
              ) : (
                <button
                  className="btn small"
                  disabled={!!busy || !online}
                  title={online ? undefined : 'Downloading needs a network connection.'}
                  onClick={() => {
                    setBusy(l);
                    setError(null);
                    void downloadOcr(l)
                      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                      .finally(() => {
                        setBusy(null);
                        void refresh();
                      });
                  }}
                >
                  Download
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="print-error">{error}</p>}
    </>
  );
}
