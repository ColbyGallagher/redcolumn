import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { googleSignInConfigured, googleUser, signInWithGoogle, signOutOfGoogle, subscribeGoogleUser } from '../studio/drive/google';
import { microsoftUser, oneDriveConfigured, signInWithMicrosoft, signOutOfMicrosoft, subscribeMicrosoftUser } from '../studio/drive/onedrive';
import { forgetRecentSession, recentSessions, restoreRecentSession, type SessionRef } from '../studio/local';
import { allows, policyOf, sameName, type RecordEntry, type SessionMeta } from '../studio/protocol';
import { attendeeColor, myAccess, type CollabSession, type StudioSnapshot } from '../studio/types';
import { ACCESS_SHORT } from './sessions/AccessEditor';
import { Caret, DocIcon, FilterButton, KebabIcon, PersonIcon, StudioHeader, StudioMenu, StudioRow, StudioTabs, studioIdText, type StudioSort } from './studio/chrome';
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
  /** Host: end the session (save what is wanted, then remove its files). */
  onEnd: (sessionId: string) => void;
}

type Dialog = 'start' | 'join' | 'settings' | null;

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
          id={focused.snapshot.meta.id}
          createdAt={focused.snapshot.meta.createdAt}
          attendeeNames={[focused.snapshot.meta.host, ...focused.snapshot.meta.attendees.map((a) => a.name), ...(focused.snapshot.meta.invited ?? [])]}
          documents={focused.snapshot.meta.documents}
          onAddFiles={(files) => props.onAddFiles(focused.session.id, files)}
          onUpdateDocument={(docId, file) => props.onUpdateDocument(focused.session.id, docId, file)}
          onRemoveDocument={(docId) => props.onRun(() => focused.session.removeDocument(docId))}
          onEnd={
            focused.session.end
              ? () => {
                  setDialog(null);
                  props.onEnd(focused.session.id);
                }
              : undefined
          }
          name={focused.snapshot.meta.name}
          host={focused.snapshot.meta.host}
          policy={policyOf(focused.snapshot.meta)}
          addDocuments={focused.snapshot.meta.permissions.addDocuments}
          saveCopy={allows(focused.snapshot.meta, 'saveCopy')}
          invite={allows(focused.snapshot.meta, 'invite')}
          expiresAt={focused.snapshot.meta.expiresAt ?? null}
          busy={props.busy}
          onClose={() => setDialog(null)}
          onSave={({ name, access, addDocuments, saveCopy, invite, expiresAt }, close) => {
            if (close) setDialog(null);
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
  const [tab, setTab] = useState<'joined' | 'not' | 'deleted'>('joined');
  const [sort, setSort] = useState<StudioSort>('recent');
  const [sortDesc, setSortDesc] = useState(true);
  // Sessions in Drive and OneDrive show their details once joined (reading them needs a sign-in).
  const recent = useMemo(recentSessions, [refresh, joined.length]);

  const rows = recent.map((r) => {
    const j = joined.find((x) => x.session.id === r.id);
    const meta = j?.snapshot.meta ?? null;
    const status = j ? (j.snapshot.meta.ended || j.snapshot.removed ? 'Ended' : j.snapshot.meta.status === 'finished' ? 'Closed' : 'Joined') : r.removed ? 'Removed' : r.backend === 'drive' ? 'Google Drive' : 'OneDrive';
    const access = j ? (j.snapshot.isHost ? 'Host' : ACCESS_SHORT[myAccess({ meta: j.snapshot.meta, me, isHost: false })]) : null;
    return { ref: r, joined: j, meta, status, usable: true, access };
  });
  const notJoinedCount = rows.filter((row) => !row.joined && !row.ref.removed).length;
  const shown = rows
    .filter((row) => (tab === 'joined' ? !!row.joined : tab === 'deleted' ? !!row.ref.removed && !row.joined : !row.joined && !row.ref.removed))
    .sort((a, b) => {
      const dir = sortDesc ? -1 : 1;
      if (sort === 'name') return dir * (a.meta?.name ?? a.ref.name).localeCompare(b.meta?.name ?? b.ref.name, undefined, { sensitivity: 'base' });
      if (sort === 'id') return dir * a.ref.id.localeCompare(b.ref.id);
      return dir * (a.ref.joinedAt - b.ref.joinedAt);
    });

  return (
    <div className="sessions bb-studio">
      <StudioHeader
        title="All Sessions"
        onRefresh={() => setRefresh((n) => n + 1)}
        plus={
          <StudioMenu
            label="New session"
            items={[
              { label: 'Start session', onClick: onStartDialog, disabled: busy || !online },
              { label: 'Join session…', onClick: onJoinDialog, disabled: busy || !online },
            ]}
          />
        }
        filter={<FilterButton sort={sort} desc={sortDesc} onChange={(next, desc) => { setSort(next); setSortDesc(desc); }} />}
      />
      <StudioTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'joined', label: 'Joined' },
          { id: 'not', label: 'Not Joined', count: notJoinedCount },
          { id: 'deleted', label: 'Deleted' },
        ]}
      />

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

      <div className="bb-scroll">
      {shown.length === 0 ? (
        <p className="bb-empty">
          {tab === 'deleted' ? 'No deleted sessions.' : tab === 'not' ? 'Sessions you have not joined are listed here.' : recent.length ? 'You are not in a session right now.' : 'Sessions you start or join appear here.'}
        </p>
      ) : (
        <ul className="bb-list">
          {shown.map(({ ref, joined: j, meta, status, usable, access }) => {
            const blocked = busy || !usable || (!j && ((ref.backend === 'drive' && !driveAvailable) || (ref.backend === 'onedrive' && !oneDriveAvailable)));
            const name = meta?.name ?? ref.name;
            return (
              <StudioRow
                key={ref.id}
                icon={<DocIcon />}
                name={name}
                id={ref.id}
                disabled={blocked || (!!ref.removed && !j)}
                title={[name, ref.id, status, access].filter(Boolean).join(' · ')}
                onClick={() => {
                  if (ref.removed && !j) return;
                  if (j) onFocus(ref.id);
                  else void onJoin(ref).then((ok) => ok && onFocus(ref.id));
                }}
                trailing={
                  j ? null : ref.removed ? (
                    <button
                      type="button"
                      className="bb-join"
                      onClick={() => {
                        restoreRecentSession(ref.id);
                        setRefresh((n) => n + 1);
                      }}
                    >
                      Restore
                    </button>
                  ) : (
                    <>
                      <button type="button" className="bb-join" disabled={blocked} onClick={() => void onJoin(ref).then((ok) => ok && onFocus(ref.id))}>
                        Join
                      </button>
                      <button
                        type="button"
                        className="bb-x"
                        title="Remove from your sessions. Restore it from Deleted."
                        aria-label="Remove"
                        onClick={() => {
                          if (!confirm(`Remove ${name} from your Sessions? The session is not deleted, and you can restore it from Deleted.`)) return;
                          forgetRecentSession(ref.id);
                          setRefresh((n) => n + 1);
                        }}
                      >
                        ×
                      </button>
                    </>
                  )
                }
              />
            );
          })}
        </ul>
      )}
      {busy && <p className="bb-empty">Connecting…</p>}
      {error && <p className="session-error">{error}</p>}
      <p className="bb-note">
        You appear as <b>{me}</b>.
      </p>
      <GoogleIdentity onChanged={() => setRefresh((n) => n + 1)} />
      <MicrosoftIdentity onChanged={() => setRefresh((n) => n + 1)} />
      </div>
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
  onEnd,
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
  const finished = meta.status === 'finished';
  // Ended: the host removed the session's files (seen just before, or found gone).
  const ended = !!meta.ended || !!snapshot.removed;
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState({ docs: true, people: true });
  const [who, setWho] = useState<'joined' | 'not'>('joined');
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
  const joinedPeople = people.filter((p) => !p.invitedOnly);
  const pendingPeople = people.filter((p) => p.invitedOnly);
  const onlinePeople = joinedPeople.filter((p) => p.here);
  const offlinePeople = joinedPeople.filter((p) => !p.here);

  return (
    <div className="sessions bb-studio in-session">
      <div className="bb-session-top">
        <div className="bb-session-switch">
          <select aria-label="Session" value={session.id} onChange={(e) => onFocus(e.target.value || null)} title={status === 'online' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Offline: changes sync when you reconnect'}>
            <option value="">All Sessions</option>
            {joined.map((j) => (
              <option key={j.session.id} value={j.session.id}>
                {j.snapshot.meta.name} — {studioIdText(j.snapshot.meta.id)}
              </option>
            ))}
          </select>
          <StudioMenu
            label="Session commands"
            icon={<KebabIcon />}
            items={[
              ...(isHost && !finished && !ended ? [{ label: 'Session settings', onClick: onSettings }] : []),
              ...(onInviteEmail && (isHost || allows(meta, 'invite')) ? [{ label: 'Share invitations', onClick: () => onInviteEmail(meta.id), disabled: !online }] : []),
              ...(isHost || allows(meta, 'invite') ? [{ label: copied === 'link' ? 'Link copied' : 'Copy invitation link', onClick: () => copy('link', snapshot.inviteLink) }] : []),
              { label: 'Session report', onClick: () => onReport(session.id, 'pdf') },
              { label: 'Record as CSV', onClick: () => onReport(session.id, 'csv') },
              { label: 'Leave session', onClick: () => onLeave(session.id), danger: true },
              ...(isHost && session.end && !ended ? [{ label: 'End session…', onClick: () => onEnd(session.id), disabled: busy || !online, danger: true }] : []),
            ]}
          />
        </div>
        {snapshot.email && <p className="bb-banner">You are {snapshot.email}</p>}
        {!finished && meta.expiresAt ? <p className="bb-banner">Closes {new Date(meta.expiresAt).toLocaleString()}</p> : null}
        {denied && <p className="session-error">The host has removed your access to this session.</p>}
        {needsAuth && (
          <div className="bb-banner">
            {`Signed out of ${backend === 'onedrive' ? 'Microsoft' : 'Google'}. Your edits are kept here and saved when you reconnect.`}{' '}
            <button className="bb-text-btn" onClick={() => session.reconnect && onRun(() => session.reconnect!())}>
              Reconnect
            </button>
          </div>
        )}
        {viewOnly && <p className="bb-banner">View only: the session folder is shared with you read-only.</p>}
        {!isHost && access === 'view' && !finished && !denied && <p className="bb-banner">You can view documents and chat. The host has not given you comment access.</p>}
        {finished && !ended && <p className="bb-banner">Closed {meta.endedAt ? new Date(meta.endedAt).toLocaleString() : ''}. Documents are read-only.</p>}
        {ended && <p className="session-error">The host ended this session and removed its files. Documents you have open stay read-only until you close them.</p>}
        {status === 'offline' && !finished && !denied && !ended && <p className="bb-banner">Offline. Keep working: markups sync when the connection returns.</p>}

        <section>
          <button type="button" className="bb-sec-h" aria-expanded={open.people} onClick={() => toggle('people')}>
            <Caret open={open.people} /> Attendees
          </button>
          {open.people && (
            <>
              <StudioTabs
                value={who}
                onChange={setWho}
                tabs={[
                  { id: 'joined', label: 'Joined' },
                  { id: 'not', label: 'Not Joined', count: pendingPeople.length },
                ]}
              />
              {who === 'joined' ? (
                <>
                  <div className="bb-group">Online ({onlinePeople.length})</div>
                  <ul className="bb-people">
                    {onlinePeople.map((p) => (
                      <li key={p.email ?? p.name}>
                        <button type="button" className="bb-person" disabled={!p.here?.docId || p.here.self} title={p.email && p.email !== p.name ? p.email : undefined} onClick={() => p.here?.docId && onGoTo(session.id, p.here.docId, p.here.page)}>
                          <PersonIcon />
                          <span className="bb-name">
                            {p.name}
                            {p.here?.self ? ' (you)' : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="bb-group dim">Offline ({offlinePeople.length})</div>
                  <ul className="bb-people dim">
                    {offlinePeople.map((p) => (
                      <li key={p.email ?? p.name} className="bb-person dim" title={p.email && p.email !== p.name ? p.email : undefined}>
                        <PersonIcon />
                        <span className="bb-name">{p.name}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ul className="bb-people dim">
                  {pendingPeople.length === 0 && <li className="bb-empty">No one is waiting to join.</li>}
                  {pendingPeople.map((p) => (
                    <li key={p.email ?? p.name} className="bb-person dim" title={p.email && p.email !== p.name ? p.email : undefined}>
                      <PersonIcon />
                      <span className="bb-name">{p.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section>
          <div className="bb-sec-bar">
            <button type="button" className="bb-sec-h" aria-expanded={open.docs} onClick={() => toggle('docs')}>
              <Caret open={open.docs} /> Documents
            </button>
            {session.canAddDocuments && (
              <StudioMenu
                label="Add documents"
                items={[
                  ...(localDocName ? [{ label: `Add ${localDocName}`, onClick: () => onAddCurrent(session.id), disabled: busy }] : []),
                  { label: 'Add PDFs…', onClick: () => fileRef.current?.click(), disabled: busy },
                ]}
              />
            )}
          </div>
          {session.canAddDocuments && (
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
          )}
          {open.docs && (
            <ul className="bb-docs">
              {meta.documents.length === 0 && <li className="bb-empty">{session.canAddDocuments ? 'Add a PDF to share it.' : 'No documents yet.'}</li>}
              {meta.documents.map((d) => {
                const key = `${session.id}:${d.id}`;
                const active = activeDoc?.sessionId === session.id && activeDoc.docId === d.id;
                return (
                  <li key={d.id} className={active ? 'bb-doc on' : 'bb-doc'}>
                    <button type="button" className="bb-doc-main" disabled={denied} onClick={() => onOpenDocument(session.id, d.id)} title={`Added by ${d.addedBy}${openDocs.has(key) ? ' · open in a tab' : ''}`}>
                      <DocIcon />
                      <span className="bb-name">{d.name}</span>
                    </button>
                    <span className="bb-doc-actions">
                        {isHost && !finished && (
                          <label className="bb-mini" title="Update to a new revision">
                            Update
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
                            type="button"
                            className="bb-mini"
                            title="Remove from session"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Remove ${d.name} from the session? Its markups are kept but it is no longer listed.`)) onRun(() => session.removeDocument(d.id));
                            }}
                          >
                            Remove
                          </button>
                        )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {error && <p className="session-error">{error}</p>}
      </div>
      <RecordView session={session} record={record} readOnly={finished || !!denied} pending={pendingPeople} docName={docName} onGoTo={(docId, page) => onGoTo(session.id, docId, page)} />
    </div>
  );
}

function RecordView({
  session,
  record,
  readOnly,
  pending,
  docName,
  onGoTo,
}: {
  session: CollabSession;
  record: RecordEntry[];
  readOnly: boolean;
  pending: { name: string; email: string | null }[];
  docName: (id: string | null) => string | null;
  onGoTo: (docId: string, page: number | null) => void;
}) {
  const [tab, setTab] = useState<'record' | 'alerts' | 'pending'>('record');
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const activity = record.filter((e) => e.kind !== 'alert');
  const alerts = record.filter((e) => e.kind === 'alert');
  const shown = tab === 'alerts' ? alerts : tab === 'record' ? activity : [];

  const pinned = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, tab]);

  return (
    <section className="bb-dock">
      <StudioTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'record', label: 'Record' },
          { id: 'alerts', label: 'Notifications' },
          { id: 'pending', label: 'Pending', count: pending.length },
        ]}
      />
      <ol
        className="bb-log"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {tab === 'pending' && pending.length === 0 && <li className="bb-empty">No pending invitations.</li>}
        {tab === 'pending' &&
          pending.map((p) => (
            <li key={p.email ?? p.name}>
              <PersonIcon />
              <span>
                <b>{p.name}</b>: Not joined yet
              </span>
            </li>
          ))}
        {tab !== 'pending' && shown.length === 0 && <li className="bb-empty">{tab === 'alerts' ? 'No notifications.' : 'Nothing yet.'}</li>}
        {tab !== 'pending' &&
          shown.map((e) => {
            const target = e.docId && docName(e.docId) ? e.docId : null;
            const text = e.kind === 'alert' ? `Markup alert${target ? ` (${docName(target)})` : ''}: ${e.text}` : e.text;
            return (
              <li key={e.id}>
                <PersonIcon />
                {target && (e.kind === 'markup' || e.kind === 'alert') ? (
                  <button type="button" className="link" onClick={() => onGoTo(target, e.page ?? null)} title="Show on the drawing">
                    <b>{e.author}</b>: {text}
                  </button>
                ) : (
                  <span>
                    <b>{e.author}</b>: {text}
                  </span>
                )}
              </li>
            );
          })}
      </ol>
      {!readOnly && (
        <form
          className="bb-chat"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!draft.trim()) return;
            session.sendChat(draft);
            setDraft('');
            pinned.current = true;
          }}
        >
          <input value={draft} onChange={(ev) => setDraft(ev.target.value)} placeholder="Chat" aria-label="Chat" maxLength={2000} />
          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        </form>
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
