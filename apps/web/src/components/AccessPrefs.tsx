import { useState, useSyncExternalStore } from 'react';
import { clearCloudLog, cloudLog, subscribeCloudLog, type CloudLogEntry } from '../studio/drive/cloudLog';
import {
  dropMicrosoftStepUps,
  microsoftAccess,
  microsoftSignedInSince,
  microsoftTokenPlace,
  microsoftUser,
  oneDriveConfigured,
  setStaySignedInToMicrosoft,
  signOutOfMicrosoft,
  staySignedInToMicrosoft,
  subscribeMicrosoftAccess,
  subscribeMicrosoftUser,
} from '../studio/drive/onedrive';
import { desktop } from '../desktop/host';
import { checkLocalKey, localEncryptionAvailable, localEncryptionOn, requestLocalEncryption } from '../storage/localCrypto';

/** What each OneDrive access level lets the app do, in the words PRIVACY.md uses. */
export const MICROSOFT_LEVELS = [
  {
    name: "The app's own folder (Apps/redcolumn)",
    allows: 'Read and change files in Apps/redcolumn only.',
    usedFor: 'Session and Project folders and their files, settings backup, spreadsheet sync.',
  },
  {
    name: 'Your OneDrive',
    allows: 'Read and change any file in your OneDrive.',
    usedFor: 'Only sharing a session or Project folder by link or by email, and who it is shared with.',
  },
  {
    name: 'Your OneDrive and files shared with you',
    allows: 'Also reach files other people have shared with you.',
    usedFor: "Only the folder in an invite to someone else's session or Project.",
  },
];

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** Preferences › Account › Access: who is signed in, what access, where the sign-in is kept (docs/SECURITY-HARDENING.md, 1.2). */
export function AccessPrefs() {
  const ms = useSyncExternalStore(subscribeMicrosoftUser, microsoftUser);
  const access = useSyncExternalStore(subscribeMicrosoftAccess, microsoftAccess);
  const [stay, setStay] = useState(staySignedInToMicrosoft);
  const [, refresh] = useState(0);
  const onDesktop = !!desktop();
  const since = ms ? microsoftSignedInSince() : null;

  return (
    <div className="access-prefs">
      <section>
        <h4>Microsoft (OneDrive)</h4>
        {!oneDriveConfigured ? (
          <p className="access-note">Microsoft sign-in is not set up for this site.</p>
        ) : ms ? (
          <>
            <p>
              Signed in as <b>{ms.email}</b>
              {since ? `, since ${when(since)}` : ''}.
            </p>
            <p>
              <b>Access in use:</b> {MICROSOFT_LEVELS[access.level]!.name}. {MICROSOFT_LEVELS[access.level]!.allows} redcolumn uses it for: {MICROSOFT_LEVELS[access.level]!.usedFor}
            </p>
            {access.pending && (
              <p className="access-note">
                The next sign-in will ask Microsoft for: {MICROSOFT_LEVELS[access.pending.level]!.name}, to {access.pending.what}.
              </p>
            )}
            <p>
              <b>Where the sign-in is kept:</b> {microsoftTokenPlace()}
            </p>
            <div className="pref-row">
              <button type="button" className="btn" disabled={access.level === 0 && !access.pending} onClick={dropMicrosoftStepUps} title="Every call asks for the app folder alone again">
                Use the smallest access again
              </button>
              <button type="button" className="btn" onClick={() => void signOutOfMicrosoft().then(() => refresh((n) => n + 1))}>
                Sign out
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void signOutOfMicrosoft({ everywhere: true }).then(() => refresh((n) => n + 1))}
                title="Also end the Microsoft session in this browser"
              >
                Sign out everywhere
              </button>
            </div>
          </>
        ) : (
          <p className="access-note">Not signed in. Sessions and Projects in OneDrive ask you to sign in when you open them.</p>
        )}
        {oneDriveConfigured && !onDesktop && (
          <label className="pref-check" title="Takes effect the next time you sign in">
            <input
              type="checkbox"
              checked={stay}
              onChange={(e) => {
                setStaySignedInToMicrosoft(e.target.checked);
                setStay(e.target.checked);
              }}
            />{' '}
            Stay signed in on this device{ms ? ' (from the next sign-in)' : ''}
          </label>
        )}
        {oneDriveConfigured && (
          <details>
            <summary>What each level allows</summary>
            <ul>
              {MICROSOFT_LEVELS.map((l) => (
                <li key={l.name}>
                  <b>{l.name}.</b> {l.allows} Used for: {l.usedFor}
                </li>
              ))}
            </ul>
          </details>
        )}
        {oneDriveConfigured && (
          <p className="access-note">
            Microsoft remembers what you allowed until you withdraw it:{' '}
            <a href="https://account.live.com/consent/Manage" target="_blank" rel="noopener noreferrer">
              personal accounts
            </a>
            ,{' '}
            <a href="https://myapps.microsoft.com" target="_blank" rel="noopener noreferrer">
              work or school accounts
            </a>
            .
          </p>
        )}
      </section>

      {localEncryptionAvailable() && <LocalDataSection />}
    </div>
  );
}

/** The desktop app's "Encrypt local data", for shared computers (docs/SECURITY-HARDENING.md, E4). */
function LocalDataSection() {
  const [on, setOn] = useState(localEncryptionOn);
  const [busy, setBusy] = useState<string | null>(null);
  const change = async (next: boolean) => {
    const what = next
      ? 'Encrypt the library and markups on this computer? Every document is rewritten; this can take a while for a large library. The app restarts afterwards.'
      : 'Store the library and markups on this computer unencrypted again? The app restarts afterwards.';
    if (!confirm(what)) return;
    setBusy(next ? 'Encrypting as the app restarts…' : 'Decrypting as the app restarts…');
    try {
      if (next) await checkLocalKey();
      setOn(next);
      requestLocalEncryption(next);
    } catch (err) {
      setBusy(null);
      alert(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <section>
      <h4>This computer</h4>
      <label className="pref-check">
        <input type="checkbox" checked={on} disabled={!!busy} onChange={(e) => void change(e.target.checked)} /> Encrypt local data
      </label>
      <p className="access-note">
        {busy ??
          "Seals the library's PDFs, its list and every document's markups on this computer, with a key the system key store protects (Windows: your account's DPAPI). Someone who copies the files, or uses another account here, cannot read them. Preferences and collaboration lists are not encrypted."}
      </p>
    </section>
  );
}

const ACTION_WORDS: Record<CloudLogEntry['action'], string> = {
  'create folder': 'Created folder',
  upload: 'Uploaded',
  replace: 'Saved',
  'share by link': 'Shared by link',
  invite: 'Invited',
  'change access': 'Changed access to',
  'stop sharing': 'Stopped sharing',
  delete: 'Deleted',
  'delete folder': 'Deleted folder',
  'save app file': 'Saved app file',
};

/** Preferences › Account › Activity: what the app did in the cloud, kept in this browser only (1.4). */
export function ActivityPrefs() {
  const entries = useSyncExternalStore(subscribeCloudLog, cloudLog);
  return (
    <div className="access-prefs">
      <p className="access-note">
        What redcolumn did in your OneDrive from this browser, newest first. This list stays in this browser and is never sent anywhere. Saves to the same file are counted on one
        line.
      </p>
      {entries.length === 0 ? (
        <p className="access-note">Nothing yet.</p>
      ) : (
        <div className="pref-table" role="table" aria-label="Cloud activity">
          {[...entries].reverse().map((e, i) => (
            <div className="pref-table-row" role="row" key={`${e.at}-${i}`}>
              <span role="cell" className="activity-when">
                {when(e.at)}
              </span>
              <span role="cell">
                OneDrive: {ACTION_WORDS[e.action]} {e.name}
                {e.count > 1 ? ` (${e.count} times since ${when(e.first ?? e.at)})` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="pref-row">
        <button type="button" className="btn" disabled={!entries.length} onClick={clearCloudLog}>
          Clear list
        </button>
      </div>
    </div>
  );
}
