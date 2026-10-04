import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { googleSignInConfigured, googleUser, signInWithGoogle, signOutOfGoogle, subscribeGoogleUser } from '../studio/drive/google';
import { microsoftUser, oneDriveConfigured, signInWithMicrosoft, signOutOfMicrosoft, subscribeMicrosoftUser } from '../studio/drive/onedrive';
import { forgetRecentSession, recentSessions, type SessionRef } from '../studio/local';
import { allows, policyOf, sameName, type RecordEntry, type SessionMeta } from '../studio/protocol';
import { attendeeColor, myAccess, type CollabSession, type StudioSnapshot } from '../studio/types';
import { ACCESS_SHORT } from './sessions/AccessEditor';
import { offlineReason, useOnline } from '../offline/network';
import { JoinSessionDialog, SessionSettingsDialog, StartSessionDialog, type StartRequest } from './sessions/SessionDialogs';

export interface JoinedSession {
  session: CollabSession;
  snapshot: StudioSnapshot;
}

interface Props {
  /** Sessions this browser is in right now (several at once is fine). */
  joined: JoinedSession[];
  /** The joined session shown in detail, or null for the list of sessions. */
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  /** The name markups are authored under; attendees join with it. */
  me: string;
  busy: boolean;
  error: string | null;
  /** The session document in the active tab, if any. */
  activeDoc: { sessionId: string; docId: string } | null;
  /** Session documents open in tabs, as `sessionId:docId`. */
  openDocs: ReadonlySet<string>;
  /** A local (non-session) document in the active tab that could be added to a session. */
  localDocName: string | null;
  /** Local documents open in tabs and the library, offered when starting a session. */
  openFiles: { id: string; name: string }[];
  library: { id: string; name: string }[];
  /** Whether this build has Google credentials (see VITE_GOOGLE_* in apps/web/.env.local). */
  driveAvailable: boolean;
  /** Whether this build has a Microsoft client ID (VITE_MICROSOFT_CLIENT_ID) for OneDrive sessions. */
  oneDriveAvailable: boolean;
  /** A Google Drive or OneDrive session from an invite link, waiting for a click to join. */
  invite: SessionRef | null;
  onDismissInvite: () => void;
  /** Opens the Start dialog with these documents (a tab's Add to Session → Start New Session). */
  startRequest?: { token: number; fileIds: string[] } | null;
  /** Resolve true on success so the dialog closes. */
  onStart: (req: StartRequest) => Promise<boolean>;
  /** Joins a session; a Drive ref with no id opens Google's Picker to choose the folder. */
  onJoin: (ref: SessionRef | { backend: 'drive'; id: null }) => Promise<boolean>;
  onLeave: (sessionId: string) => void;
  onAddCurrent: (sessionId: string) => void;
  onAddFiles: (sessionId: string, files: File[]) => void;
  onOpenDocument: (sessionId: string, docId: string) => void;
  onGoTo: (sessionId: string, docId: string, page: number | null) => void;
  /** Runs a session action, showing its error in the panel. */
  onRun: (job: () => Promise<void>) => void;
  onReport: (sessionId: string, format: 'pdf' | 'csv') => void;
  /** Invites people by email (the user's mail app sends it). */
  onInviteEmail?: (sessionId: string) => void;
  /** Host: replace a document with a new revision (markups stay). */
  onUpdateDocument: (sessionId: string, docId: string, file: File) => void;
  /** Host: finish the session (choosing whose markups to save). */
  onFinish: (sessionId: string) => void;
}

type Dialog = 'start' | 'join' | 'settings' | null;

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Live Sessions: a list of the sessions you can get into
 * with Start and Join, and, once in one, its documents, attendees and Record. You can be in
 * several sessions at once and switch between them here.
 */
export function SessionsPanel(props: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [startDocs, setStartDocs] = useState<string[] | null>(null);
  const google = useSyncExternalStore(subscribeGoogleUser, googleUser);
  const microsoft = useSyncExternalStore(subscribeMicrosoftUser, microsoftUser);
  useEffect(() => {
    if (!props.startRequest) return;
    setStartDocs(props.startRequest.fileIds);
    setDialog('start');
  }, [props.startRequest]);
  const focused = props.joined.find((j) => j.session.id === props.focusedId) ?? null;
  return (
    <>
      {focused ? <InSession {...props} {...focused} onSettings={() => setDialog('settings')} /> : <SessionList {...props} onStartDialog={() => {
            setStartDocs(null);
            setDialog('start');
          }} onJoinDialog={() => setDialog('join')} />}
      {dialog === 'start' && (
        <StartSessionDialog
          me={props.me}
          googleEmail={google?.email ?? null}
          microsoftEmail={microsoft?.email ?? null}
          driveAvailable={props.driveAvailable}
          oneDriveAvailable={props.oneDriveAvailable}
          openFiles={props.openFiles}
          library={props.library}
          initialDocs={startDocs}
          busy={props.busy}
          onClose={() => {
            setDialog(null);
            setStartDocs(null);
          }}
          onStart={(req) => void props.onStart(req).then((ok) => ok && setDialog(null))}
        />
      )}
      {dialog === 'join' && (
        <JoinSessionDialog
          me={props.me}
          driveAvailable={props.driveAvailable}
          oneDriveAvailable={props.oneDriveAvailable}
          busy={props.busy}
          onClose={() => setDialog(null)}
          onJoinOneDrive={(id) => void props.onJoin({ backend: 'onedrive', id }).then((ok) => ok && setDialog(null))}
          onJoinDrive={() => void props.onJoin({ backend: 'drive', id: null }).then((ok) => ok && setDialog(null))}
        />
      )}
      {dialog === 'settings' && focused && (
        <SessionSettingsDialog
          name={focused.snapshot.meta.name}
          host={focused.snapshot.meta.host}
          policy={policyOf(focused.snapshot.meta)}
          addDocuments={focused.snapshot.meta.permissions.addDocuments}
          saveCopy={allows(focused.snapshot.meta, 'saveCopy')}
          invite={allows(focused.snapshot.meta, 'invite')}
          expiresAt={focused.snapshot.meta.expiresAt ?? null}
          busy={props.busy}
          onClose={() => setDialog(null)}
          onFinish={() => {
            setDialog(null);
            props.onFinish(focused.session.id);
          }}
          onSave={({ name, access, addDocuments, saveCopy, invite, expiresAt }) => {
            setDialog(null);
            const { meta } = focused.snapshot;
            const permissions = {
              ...(addDocuments !== meta.permissions.addDocuments ? { addDocuments } : {}),
              ...(saveCopy !== allows(meta, 'saveCopy') ? { saveCopy } : {}),
              ...(invite !== allows(meta, 'invite') ? { invite } : {}),
            };
            props.onRun(() =>
              focused.session.update({
                access,
                ...(name !== meta.name ? { name } : {}),
                ...(Object.keys(permissions).length ? { permissions } : {}),
                ...((expiresAt ?? null) !== (meta.expiresAt ?? null) ? { expiresAt } : {}),
              }),
            );
          }}
        />
      )}
    </>
  );
}

function SessionList({
  joined,
  me,
  busy,
  error,
  driveAvailable,
  oneDriveAvailable,
  invite,
  onDismissInvite,
  onJoin,
  onFocus,
  onStartDialog,
  onJoinDialog,
}: Props & { onStartDialog: () => void; onJoinDialog: () => void }) {
  const [refresh, setRefresh] = useState(0);
  const online = useOnline();
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  // Sessions in Drive and OneDrive show their details once joined (reading them needs a sign-in).
  const recent = useMemo(recentSessions, [refresh, joined.length]);

  const rows = recent
    .map((r) => {
      const j = joined.find((x) => x.session.id === r.id);
      const meta = j?.snapshot.meta ?? null;
      const status = j ? (j.snapshot.meta.status === 'finished' ? 'Finished' : 'Joined') : r.backend === 'drive' ? 'Google Drive' : 'OneDrive';
      const access = j ? (j.snapshot.isHost ? 'Host' : ACCESS_SHORT[myAccess({ meta: j.snapshot.meta, me, isHost: false })]) : null;
      return { ref: r, joined: j, meta, status, usable: true, access };
    })
    .filter((row) => filter === 'all' || row.joined || (row.usable && row.meta?.status !== 'finished'));

  return (
    <div className="sessions">
      <div className="session-toolbar">
        <button className="btn primary" onClick={onStartDialog} disabled={busy || !online} title={online ? 'Start a new session' : offlineReason('Starting a session')}>
          + Start
        </button>
        <button className="btn" onClick={onJoinDialog} disabled={busy || !online} title={online ? 'Join a session by its ID' : offlineReason('Joining a session')}>
          Join…
        </button>
        <button className="btn flat" onClick={() => setRefresh((n) => n + 1)} title="Refresh the list" aria-label="Refresh">
          ↻
        </button>
      </div>

      {invite && (
        <div className="session-invite">
          <b>You're invited to a Live Session in {invite.backend === 'onedrive' ? 'OneDrive' : 'Google Drive'}.</b>
          <p>
            {invite.backend === 'onedrive'
              ? oneDriveAvailable
                ? 'Joining signs you in to Microsoft (a personal, work or school account).'
                : 'This copy of the app is not set up for OneDrive, so it cannot join. Open the link on the site the host uses.'
              : driveAvailable
                ? 'Joining signs you in to Google and asks you to select the session folder once.'
                : 'This copy of the app is not set up for Google Drive, so it cannot join. Open the link on the site the host uses.'}
          </p>
          <div className="row">
            <button className="btn primary" disabled={busy || !(invite.backend === 'onedrive' ? oneDriveAvailable : driveAvailable)} onClick={() => void onJoin(invite)}>
              Join session
            </button>
            <button className="btn small flat" onClick={onDismissInvite}>
              Not now
            </button>
          </div>
        </div>
      )}

      <h3>
        My Sessions
        <span className="experimental-badge" title="Sessions is experimental and may change">Experimental</span>
        <span className="record-filter" role="tablist">
          {(['active', 'all'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'active' ? 'Active' : 'All'}
            </button>
          ))}
        </span>
      </h3>
      {rows.length === 0 ? (
        <p className="empty">
          {recent.length ? 'No active sessions. Show All to see finished ones.' : 'Sessions you start or join appear here. Start one to mark up PDFs together in Google Drive or OneDrive, or join from an invite link.'}
        </p>
      ) : (
        <ul className="session-list">
          {rows.map(({ ref, joined: j, meta, status, usable, access }) => (
            <li key={ref.id} className={j ? 'joined' : usable ? '' : 'unusable'}>
              <button
                className="session-row"
                disabled={busy || !usable || (!j && ((ref.backend === 'drive' && !driveAvailable) || (ref.backend === 'onedrive' && !oneDriveAvailable)))}
                onClick={() => (j ? onFocus(ref.id) : void onJoin(ref).then((ok) => ok && onFocus(ref.id)))}
                title={j ? 'Show this session' : 'Join this session'}
              >
                <span className="line1">
                  {j && <span className={`conn ${j.snapshot.status}`} />}
                  <b>{meta?.name ?? ref.name}</b>
                  <span className={`status ${status.toLowerCase().replace(/\s/g, '-')}`}>{status}</span>
                </span>
                <span className="line2">
                  <span className="sid">{ref.backend === 'onedrive' ? 'OneDrive' : 'Drive'}</span>
                  {meta && (
                    <span>
                      {meta.host} · {meta.documents.length} doc{meta.documents.length === 1 ? '' : 's'}
                      {access ? ` · ${access}` : ''}
                    </span>
                  )}
                </span>
              </button>
              {!j && (
                <button
                  className="btn small flat"
                  title="Remove from this list"
                  onClick={() => {
                    forgetRecentSession(ref.id);
                    setRefresh((n) => n + 1);
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="empty">Connecting…</p>}
      {error && <p className="session-error">{error}</p>}
      <p className="session-me">
        You appear as <b>{me}</b> (change under Edit → Author).
      </p>
      <GoogleIdentity onChanged={() => setRefresh((n) => n + 1)} />
      <MicrosoftIdentity onChanged={() => setRefresh((n) => n + 1)} />
    </div>
  );
}

function InSession({
  session,
  snapshot,
  joined,
  busy,
  error,
  activeDoc,
  openDocs,
  localDocName,
  onFocus,
  onLeave,
  onAddCurrent,
  onAddFiles,
  onOpenDocument,
  onGoTo,
  onRun,
  onReport,
  onUpdateDocument,
  onSettings,
  onInviteEmail,
}: Props & JoinedSession & { onSettings: () => void }) {
  const online = useOnline();
  const { meta, isHost, status, record, presence, backend, needsAuth, viewOnly, denied } = snapshot;
  const [emails, setEmails] = useState('');
  const finished = meta.status === 'finished';
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState({ docs: true, people: true, record: true });
  const fileRef = useRef<HTMLInputElement>(null);
  const access = myAccess(snapshot);
  const policy = policyOf(meta);
  const copy = (what: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  // Host, invited people and everyone who has joined; online first, and online people show where they are.
  const people = useMemo(() => {
    // One row per person: known by Google email when they have one, else by name.
    type Row = { name: string; email: string | null };
    const rows: Row[] = [];
    const same = (a: Row, b: Row) => (a.email && b.email ? sameName(a.email, b.email) : sameName(a.name, b.name) || (!!a.email && sameName(a.email, b.name)) || (!!b.email && sameName(b.email, a.name)));
    const add = (r: Row) => {
      const found = rows.find((x) => same(x, r));
      if (!found) rows.push({ ...r });
      else if (r.email && !found.email) {
        found.email = r.email;
        // An invited email gets the person's name once they turn up.
        if (sameName(found.name, r.email)) found.name = r.name;
      }
    };
    add({ name: meta.host, email: meta.hostEmail ?? null });
    for (const a of meta.attendees) add({ name: a.name, email: a.email ?? null });
    for (const p of presence) add({ name: p.name, email: p.email ?? null });
    for (const p of policy.people) add({ name: p.name, email: p.name.includes('@') ? p.name : null });
    for (const e of meta.invited ?? []) add({ name: e, email: e });
    const hereFor = (r: Row) => presence.filter((p) => same(r, { name: p.name, email: p.email ?? null })).sort((a, b) => Number(b.self) - Number(a.self))[0] ?? null;
    return rows
      .map((r) => {
        const host = same(r, { name: meta.host, email: meta.hostEmail ?? null });
        const here = hereFor(r);
        const matchesMember = (m: string) => sameName(m, r.name) || (!!r.email && sameName(m, r.email));
        return {
          name: r.name,
          email: r.email,
          here,
          host,
          invitedOnly: !host && !here && !meta.attendees.some((a) => same(r, { name: a.name, email: a.email ?? null })),
          access: myAccess({ meta, me: r.name, isHost: host, email: r.email }),
          groups: policy.groups.filter((g) => g.members.some(matchesMember)).map((g) => g.name),
        };
      })
      .sort((a, b) => Number(!!b.here) - Number(!!a.here) || Number(b.host) - Number(a.host) || a.name.localeCompare(b.name));
  }, [presence, meta, policy]);

  const docName = (id: string | null) => meta.documents.find((d) => d.id === id)?.name ?? null;
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const others = joined.filter((j) => j.session.id !== session.id);

  return (
    <div className="sessions in-session">
      <div className="session-nav">
        <button className="btn small flat" onClick={() => onFocus(null)} title="All sessions">
          ‹ Sessions
        </button>
        {others.length > 0 && (
          <select aria-label="Switch session" value={session.id} onChange={(e) => onFocus(e.target.value)} title="You are in several sessions">
            {joined.map((j) => (
              <option key={j.session.id} value={j.session.id}>
                {j.snapshot.meta.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="session-head">
        <div className="session-title">
          <span className={`conn ${status}`} title={status === 'online' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Offline: changes sync when you reconnect'} />
          <b title={meta.name}>{meta.name}</b>
          <span className={`access-badge ${isHost ? 'host' : access}`}>{isHost ? 'Host' : ACCESS_SHORT[access]}</span>
        </div>
        {snapshot.email && <p className="session-identity">you are {snapshot.email}</p>}
        {!finished && meta.expiresAt ? <p className="session-identity">Ends {new Date(meta.expiresAt).toLocaleString()}</p> : null}
        {(isHost || allows(meta, 'invite')) && (
        <div className="session-id">
          <a className="drive-link" href={snapshot.folderUrl} target="_blank" rel="noreferrer" title={`Open the session folder in ${backend === 'onedrive' ? 'OneDrive' : 'Google Drive'}`}>
            {backend === 'onedrive' ? 'OneDrive' : 'Google Drive'} ↗
          </a>
          <button className="btn small" onClick={() => copy('link', snapshot.inviteLink)} title="Copy a link that opens this session">
            {copied === 'link' ? 'Copied' : 'Invite link'}
          </button>
          {onInviteEmail && (
            <button className="btn small" onClick={() => onInviteEmail(meta.id)} disabled={!online} title={online ? 'Invite people by email' : offlineReason('Inviting people by email')}>
              Email…
            </button>
          )}
        </div>
        )}
        {denied && <p className="session-error">The host has removed your access to this session.</p>}
        {needsAuth && (
          <div className="session-offline">
            {`Signed out of ${backend === 'onedrive' ? 'Microsoft' : 'Google'}. Your edits are kept here and saved when you reconnect.`}{' '}
            <button className="btn small primary" onClick={() => session.reconnect && onRun(() => session.reconnect!())}>
              Reconnect
            </button>
          </div>
        )}
        {viewOnly && <p className="session-offline">View only: the session folder is shared with you read-only. Ask the host to invite you as an editor.</p>}
        {!isHost && access === 'view' && !finished && !denied && <p className="session-offline">You can view documents and chat. The host has not given you comment access.</p>}
        {finished && <p className="session-finished">Finished {meta.endedAt ? new Date(meta.endedAt).toLocaleString() : ''}. Documents are read-only.</p>}
        {status === 'offline' && !finished && !denied && <p className="session-offline">Offline. Keep working: markups sync when the connection returns.</p>}
      </div>

      <section className="session-section">
        <h3 className="collapsible">
          <button className="twisty" aria-expanded={open.docs} onClick={() => toggle('docs')}>
            {open.docs ? '▾' : '▸'} Documents ({meta.documents.length})
          </button>
          {session.canAddDocuments && (
            <span className="h3-actions">
              {localDocName && (
                <button className="btn small" disabled={busy} onClick={() => onAddCurrent(session.id)} title={`Add ${localDocName} and its markups to the session`}>
                  Add open
                </button>
              )}
              <button className="btn small" disabled={busy} onClick={() => fileRef.current?.click()} title="Add PDFs from this computer">
                Add files…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  if (files.length) onAddFiles(session.id, files);
                }}
              />
            </span>
          )}
        </h3>
        {open.docs && (
          <>
            {meta.documents.length === 0 && <p className="empty">{session.canAddDocuments ? 'Add a PDF to share it with everyone.' : 'The host has not added any documents yet.'}</p>}
            <ul className="bookmark-list">
              {meta.documents.map((d) => {
                const viewers = presence.filter((p) => p.docId === d.id && !p.self);
                const key = `${session.id}:${d.id}`;
                const active = activeDoc?.sessionId === session.id && activeDoc.docId === d.id;
                return (
                  <li key={d.id} className="session-doc">
                    <button
                      className={`bookmark${active ? ' active' : ''}${openDocs.has(key) ? ' is-open' : ''}`}
                      disabled={denied}
                      onClick={() => onOpenDocument(session.id, d.id)}
                      title={`Added by ${d.addedBy} · ${(d.size / 1e6).toFixed(1)} MB${openDocs.has(key) ? ' · open in a tab' : ''}`}
                    >
                      <span className="name">{d.name}</span>
                      <span className="dots">
                        {viewers.map((p) => (
                          <i key={p.clientId} style={{ background: p.color }} title={`${p.name} is viewing`} />
                        ))}
                      </span>
                    </button>
                    {isHost && !finished && (
                      <label className="btn small flat" title="Update to a new revision: pick the new PDF; markups stay on their pages">
                        ⟳
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          hidden
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f && confirm(`Update ${d.name} to ${f.name}? Everyone's markups stay on the same pages of the new revision.`)) onUpdateDocument(session.id, d.id, f);
                          }}
                        />
                      </label>
                    )}
                    {isHost && !finished && (
                      <button
                        className="btn small flat"
                        title="Remove from session"
                        onClick={() => {
                          if (confirm(`Remove ${d.name} from the session? Its markups are kept but it is no longer listed.`)) onRun(() => session.removeDocument(d.id));
                        }}
                      >
                        ×
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="session-section">
        <h3 className="collapsible">
          <button className="twisty" aria-expanded={open.people} onClick={() => toggle('people')}>
            {open.people ? '▾' : '▸'} Attendees ({people.filter((p) => p.here).length} online)
          </button>
          {isHost && !finished && (
            <span className="h3-actions">
              <button className="btn small" onClick={onSettings} title="Invite people, create groups and set who can view or comment">
                Permissions…
              </button>
            </span>
          )}
        </h3>
        {open.people && (
          <ul className="attendees">
            {people.map(({ name, email, here, host, invitedOnly, access: a, groups }) => (
              <li key={email ?? name} className={here ? 'online' : 'away'}>
                <button
                  className="bookmark"
                  disabled={!here?.docId || here.self}
                  onClick={() => here?.docId && onGoTo(session.id, here.docId, here.page)}
                  title={[email && email !== name ? email : '', here?.docId && !here.self ? `Go to ${name}'s page` : '', groups.length ? `Groups: ${groups.join(', ')}` : ''].filter(Boolean).join(' · ') || undefined}
                >
                  <i className="dot" style={{ background: here ? here.color : undefined }} />
                  <span className="name">
                    {name}
                    {here?.self ? ' (you)' : ''}
                  </span>
                  <span className={`access-badge ${host ? 'host' : a}`}>{host ? 'Host' : ACCESS_SHORT[a]}</span>
                  <span className="where">{here ? (here.docId ? `${docName(here.docId) ?? ''} p. ${(here.page ?? 0) + 1}` : 'online') : invitedOnly ? 'not joined yet' : 'offline'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RecordView session={session} record={record} open={open.record} onToggle={() => toggle('record')} readOnly={finished || !!denied} docName={docName} onGoTo={(docId, page) => onGoTo(session.id, docId, page)} />

      {session.invite && !finished && !viewOnly && (
        <form
          className="session-section invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            const list = emails.split(/[\s,;]+/).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
            if (!list.length) return;
            onRun(async () => {
              await session.invite!(list);
              setEmails('');
            });
          }}
        >
          <h3>Invite by email</h3>
          <div className="row">
            <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@company.com, …" aria-label="Email addresses to invite" />
            <button className="btn small" type="submit" disabled={busy || !emails.trim()}>
              Invite
            </button>
          </div>
        </form>
      )}

      {error && <p className="session-error">{error}</p>}
      <div className="session-actions">
        <button className="btn small" onClick={() => onReport(session.id, 'pdf')} title="Session Report: documents, attendees, the Record and every markup, as a PDF">
          Report
        </button>
        <button className="btn small flat" onClick={() => onReport(session.id, 'csv')} title="Download the Record as CSV">
          CSV
        </button>
        <span className="spacer" />
        <button className="btn small danger" onClick={() => onLeave(session.id)} title="Leave this session and close its documents">
          Leave session
        </button>
      </div>
    </div>
  );
}

type RecordFilter = 'all' | 'chat' | 'markup';

function RecordView({
  session,
  record,
  open,
  onToggle,
  readOnly,
  docName,
  onGoTo,
}: {
  session: CollabSession;
  record: RecordEntry[];
  open: boolean;
  onToggle: () => void;
  readOnly: boolean;
  docName: (id: string | null) => string | null;
  onGoTo: (docId: string, page: number | null) => void;
}) {
  const [filter, setFilter] = useState<RecordFilter>('all');
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const shown = record.filter((e) => filter === 'all' || (filter === 'chat' ? e.kind === 'chat' : e.kind === 'markup' || e.kind === 'alert'));

  // Stay scrolled to the newest line unless the reader has scrolled up.
  const pinned = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, open]);

  return (
    <section className="session-section record">
      <h3 className="collapsible">
        <button className="twisty" aria-expanded={open} onClick={onToggle}>
          {open ? '▾' : '▸'} Record
        </button>
        {open && (
          <span className="record-filter" role="tablist">
            {(['all', 'chat', 'markup'] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'chat' ? 'Chat' : 'Markups'}
              </button>
            ))}
          </span>
        )}
      </h3>
      {open && (
        <>
          <ol
            className="record-list"
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {shown.length === 0 && <li className="empty">{filter === 'chat' ? 'No messages yet.' : 'Nothing yet.'}</li>}
            {shown.map((e) => {
              const target = e.docId && docName(e.docId) ? e.docId : null;
              return (
                <li key={e.id} className={`rec ${e.kind}`}>
                  <span className="who" style={{ color: attendeeColor(e.author) }}>
                    {e.author}
                  </span>
                  <time dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toLocaleString()}>
                    {time(e.at)}
                  </time>
                  {e.kind === 'alert' ? (
                    <button className="what link alert" disabled={!target} onClick={() => target && onGoTo(target, e.page ?? null)} title="Show the markup">
                      ⚠ Markup Alert{target ? ` (${docName(target)} p. ${(e.page ?? 0) + 1})` : ''}: {e.text}
                    </button>
                  ) : target && e.kind === 'markup' ? (
                    <button className="what link" onClick={() => onGoTo(target, e.page ?? null)} title="Show on the drawing">
                      {e.text}
                    </button>
                  ) : (
                    <span className="what">{e.text}</span>
                  )}
                </li>
              );
            })}
          </ol>
          {!readOnly && (
            <form
              className="chat-form"
              onSubmit={(ev) => {
                ev.preventDefault();
                session.sendChat(draft);
                setDraft('');
                pinned.current = true;
              }}
            >
              <input value={draft} onChange={(ev) => setDraft(ev.target.value)} placeholder="Message everyone" maxLength={2000} />
              <button className="btn small" type="submit" disabled={!draft.trim()}>
                Send
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

/** Who you are signed in to Google as (used to identify you in sessions), with sign in and out. */
function GoogleIdentity({ onChanged }: { onChanged: () => void }) {
  const user = useSyncExternalStore(subscribeGoogleUser, googleUser);
  const [error, setError] = useState<string | null>(null);
  if (!googleSignInConfigured) return null;
  return (
    <div className="google-identity">
      {user ? (
        <>
          <span title={user.name}>
            Google: <b>{user.email}</b>
          </span>
          <button
            className="btn small flat"
            onClick={() => {
              signOutOfGoogle();
              onChanged();
            }}
          >
            Sign out
          </button>
        </>
      ) : (
        <button
          className="btn small"
          onClick={() => {
            setError(null);
            signInWithGoogle().then(onChanged, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
          }}
          title="Sessions can then identify you by your Google account's email"
        >
          Sign in with Google
        </button>
      )}
      {error && <p className="session-error">{error}</p>}
    </div>
  );
}

/** Who you are signed in to Microsoft as (OneDrive sessions), with sign in and out. */
function MicrosoftIdentity({ onChanged }: { onChanged: () => void }) {
  const user = useSyncExternalStore(subscribeMicrosoftUser, microsoftUser);
  const [error, setError] = useState<string | null>(null);
  if (!oneDriveConfigured) return null;
  return (
    <div className="google-identity">
      {user ? (
        <>
          <span title={user.name}>
            Microsoft: <b>{user.email}</b>
          </span>
          <button className="btn small flat" onClick={() => void signOutOfMicrosoft().then(onChanged)}>
            Sign out
          </button>
        </>
      ) : (
        <button
          className="btn small"
          onClick={() => {
            setError(null);
            signInWithMicrosoft().then(onChanged, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
          }}
          title="Needed to start or join sessions in OneDrive"
        >
          Sign in with Microsoft
        </button>
      )}
      {error && <p className="session-error">{error}</p>}
    </div>
  );
}
