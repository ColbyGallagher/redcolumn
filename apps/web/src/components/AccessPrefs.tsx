import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useState, useSyncExternalStore } from 'react';
import { clearCloudLog, cloudLog, subscribeCloudLog, type CloudLogEntry } from '../studio/drive/cloudLog';
import {
  dropMicrosoftStepUps,
  microsoftAccess,
  microsoftSignedInSince,
  microsoftTokenPlace,
  microsoftSignInManagedOff,
  microsoftUser,
  oneDriveConfigured,
  setStaySignedInToMicrosoft,
  signOutOfMicrosoft,
  staySignedInToMicrosoft,
  subscribeMicrosoftAccess,
  subscribeMicrosoftUser,
} from '../studio/drive/onedrive';
import { desktop } from '../desktop/host';
import { MANAGED_NOTE } from '../desktop/policy';
import { checkLocalKey, localEncryptionAvailable, localEncryptionOn, requestLocalEncryption } from '../storage/localCrypto';

/** What each OneDrive access level lets the app do, in the words PRIVACY.md uses. */
export const MICROSOFT_LEVELS = () => [
  {
    name: msg("The app's own folder (Apps/redcolumn)"),
    allows: msg('Read and change files in Apps/redcolumn only.'),
    usedFor: msg('Session and Project folders and their files, settings backup.'),
  },
  {
    name: msg('Your OneDrive'),
    allows: msg('Read and change any file in your OneDrive.'),
    usedFor: msg('Only sharing a session or Project folder by link or by email, and who it is shared with.'),
  },
  {
    name: msg('Your OneDrive and files shared with you'),
    allows: msg('Also reach files other people have shared with you.'),
    usedFor: msg('Only the folder in an invite to someone else\'s session or Project.'),
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
        <h4>{msg('Microsoft (OneDrive)')}</h4>
        {microsoftSignInManagedOff ? (
          <p className="access-note managed-note">{MANAGED_NOTE} {msg('Microsoft sign-in is turned off on this computer.')}</p>
        ) : !oneDriveConfigured ? (
          <p className="access-note">{msg('Microsoft sign-in is not set up for this site.')}</p>
        ) : ms ? (
          <>
            <p>
              {since ? keyed(msgParts('Signed in as {email}, since {date}.', { email: <b>{ms.email}</b>, date: when(since) })) : keyed(msgParts('Signed in as {email}.', { email: <b>{ms.email}</b> }))}
            </p>
            <p>
              {keyed(msgParts('{b} {name}. {allows} redcolumn uses it for: {usedFor}', { b: <b>{msg('Access in use:')}</b>, name: MICROSOFT_LEVELS()[access.level]!.name, allows: MICROSOFT_LEVELS()[access.level]!.allows, usedFor: MICROSOFT_LEVELS()[access.level]!.usedFor }))}
            </p>
            {access.pending && (
              <p className="access-note">
                {msg('The next sign-in will ask Microsoft for: {name}, to {what}.', { name: MICROSOFT_LEVELS()[access.pending.level]!.name, what: access.pending.what })}
              </p>
            )}
            <p>
              <b>{msg('Where the sign-in is kept:')}</b> {microsoftTokenPlace()}
            </p>
            <div className="pref-row">
              <button type="button" className="btn" disabled={access.level === 0 && !access.pending} onClick={dropMicrosoftStepUps} title={msg('Every call asks for the app folder alone again')}>
                {msg('Use the smallest access again')}
              </button>
              <button type="button" className="btn" onClick={() => void signOutOfMicrosoft().then(() => refresh((n) => n + 1))}>
                {msg('Sign out')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void signOutOfMicrosoft({ everywhere: true }).then(() => refresh((n) => n + 1))}
                title={msg('Also end the Microsoft session in this browser')}
              >
                {msg('Sign out everywhere')}
              </button>
            </div>
          </>
        ) : (
          <p className="access-note">{msg('Not signed in. Sessions and Projects in OneDrive ask you to sign in when you open them.')}</p>
        )}
        {oneDriveConfigured && !onDesktop && (
          <label className="pref-check" title={msg('Takes effect the next time you sign in')}>
            <input
              type="checkbox"
              checked={stay}
              onChange={(e) => {
                setStaySignedInToMicrosoft(e.target.checked);
                setStay(e.target.checked);
              }}
            />{' '}
            {ms ? msg('Stay signed in on this device (from the next sign-in)') : msg('Stay signed in on this device')}
          </label>
        )}
        {oneDriveConfigured && (
          <details>
            <summary>{msg('What each level allows')}</summary>
            <ul>
              {MICROSOFT_LEVELS().map((l) => (
                <li key={l.name}>
                  {keyed(msgParts('{b} {allows} Used for: {usedFor}', { b: <b>{l.name}.</b>, allows: l.allows, usedFor: l.usedFor }))}
                </li>
              ))}
            </ul>
          </details>
        )}
        {oneDriveConfigured && (
          <p className="access-note">
            {msg('Microsoft remembers what you allowed until you withdraw it:')}{' '}
            <a href="https://account.live.com/consent/Manage" target="_blank" rel="noopener noreferrer">
              {msg('personal accounts')}
            </a>
            ,{' '}
            <a href="https://myapps.microsoft.com" target="_blank" rel="noopener noreferrer">
              {msg('work or school accounts')}
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
      ? msg('Encrypt the library and markups on this computer? Every document is rewritten; this can take a while for a large library. The app restarts afterwards.')
      : msg('Store the library and markups on this computer unencrypted again? The app restarts afterwards.');
    if (!confirm(what)) return;
    setBusy(next ? msg('Encrypting as the app restarts…') : msg('Decrypting as the app restarts…'));
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
      <h4>{msg('This computer')}</h4>
      <label className="pref-check">
        <input type="checkbox" checked={on} disabled={!!busy} onChange={(e) => void change(e.target.checked)} /> {msg('Encrypt local data')}
      </label>
      <p className="access-note">
        {busy ??
          msg('Seals the library\'s PDFs, its list and every document\'s markups on this computer, with a key the system key store protects (Windows: your account\'s DPAPI). Someone who copies the files, or uses another account here, cannot read them. Preferences and collaboration lists are not encrypted.')}
      </p>
    </section>
  );
}

const ACTION_WORDS = (): Record<CloudLogEntry['action'], string> => ({
  'create folder': msg('Created folder'),
  upload: msg('Uploaded'),
  replace: msg('Saved'),
  'share by link': msg('Shared by link'),
  invite: msg('Invited'),
  'change access': msg('Changed access to'),
  'stop sharing': msg('Stopped sharing'),
  delete: msg('Deleted'),
  'delete folder': msg('Deleted folder'),
  'save app file': msg('Saved app file'),
});

/** Preferences › Account › Activity: what the app did in the cloud, kept in this browser only (1.4). */
export function ActivityPrefs() {
  const entries = useSyncExternalStore(subscribeCloudLog, cloudLog);
  return (
    <div className="access-prefs">
      <p className="access-note">
        {msg('What redcolumn did in your OneDrive from this browser, newest first. This list stays in this browser and is never sent anywhere. Saves to the same file are counted on one line.')}
      </p>
      {entries.length === 0 ? (
        <p className="access-note">{msg('Nothing yet.')}</p>
      ) : (
        <div className="pref-table" role="table" aria-label={msg('Cloud activity')}>
          {[...entries].reverse().map((e, i) => (
            <div className="pref-table-row" role="row" key={`${e.at}-${i}`}>
              <span role="cell" className="activity-when">
                {when(e.at)}
              </span>
              <span role="cell">
                {e.count > 1
                  ? msg('OneDrive: {action} {name} ({count} times since {date})', { action: ACTION_WORDS()[e.action], name: e.name, count: e.count, date: when(e.first ?? e.at) })
                  : msg('OneDrive: {action} {name}', { action: ACTION_WORDS()[e.action], name: e.name })}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="pref-row">
        <button type="button" className="btn" disabled={!entries.length} onClick={clearCloudLog}>
          {msg('Clear list')}
        </button>
      </div>
    </div>
  );
}
