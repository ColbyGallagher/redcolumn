import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { microsoftUser, oneDriveSharingEnabled, setStaySignedInToMicrosoft, signInWithMicrosoft, signOutOfMicrosoft, staySignedInToMicrosoft, subscribeMicrosoftUser } from '../studio/drive/onedrive';
import { forgetRecentSession, recentSessions, restoreRecentSession, type SessionRef } from '../studio/local';
import { allows, policyOf, sameName, type RecordEntry, type SessionMeta } from '../studio/protocol';
import { attendeeColor, myAccess, type CollabSession, type StudioSnapshot } from '../studio/types';
import { ACCESS_SHORT } from './sessions/AccessEditor';
import { StudioHelp } from './studio/StudioHelp';
import { Caret, DocIcon, FilterButton, KebabIcon, PersonIcon, StudioHeader, StudioMenu, StudioRow, StudioTabs, studioIdText, type StudioSort } from './studio/chrome';
import { desktop } from '../desktop/host';
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
  /** Whether this build has a Microsoft client ID (VITE_MICROSOFT_CLIENT_ID) for OneDrive sessions. */
  oneDriveAvailable: boolean;
  /** Whether sessions can live in a shared folder on this computer (the desktop app). */
  folderAvailable?: boolean;
  /** Joins a session by choosing its folder on this computer; resolves true on success. */
  onJoinFolder?: () => Promise<boolean>;
  /** Opens a folder session's folder in Explorer or Finder. */
  onShowFolder?: (sessionId: string) => void;
  /** A OneDrive session from an invite link, waiting for a click to join. */
  invite: SessionRef | null;
  onDismissInvite: () => void;
  /** Opens the Start dialog with these documents (a tab's Add to Session → Start New Session). */
  startRequest?: { token: number; fileIds: string[] } | null;
  /** Resolve true on success so the dialog closes. */
  onStart: (req: StartRequest) => Promise<boolean>;
  /** Joins a session. */
  onJoin: (ref: SessionRef) => Promise<boolean>;
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
          microsoftEmail={microsoft?.email ?? null}
          oneDriveAvailable={props.oneDriveAvailable}
          folderAvailable={props.folderAvailable}
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
          oneDriveAvailable={props.oneDriveAvailable}
          busy={props.busy}
          onClose={() => setDialog(null)}
          onJoinOneDrive={(id) => void props.onJoin({ backend: 'onedrive', id }).then((ok) => ok && setDialog(null))}
          onJoinFolder={props.onJoinFolder && (() => void props.onJoinFolder!().then((ok) => ok && setDialog(null)))}
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
  oneDriveAvailable,
  folderAvailable,
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
  // Sessions in OneDrive show their details once joined (reading them needs a sign-in).
  const recent = useMemo(recentSessions, [refresh, joined.length]);

  const rows = recent.map((r) => {
    const j = joined.find((x) => x.session.id === r.id);
    const meta = j?.snapshot.meta ?? null;
    const status = j ? (j.snapshot.meta.ended || j.snapshot.removed ? 'Ended' : j.snapshot.meta.status === 'finished' ? 'Closed' : 'Joined') : r.removed ? 'Removed' : r.backend === 'folder' ? 'Folder' : 'OneDrive';
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
    <div className="sessions rc-studio">
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

      <StudioHelp id="sessions" title="How sessions work">
        <p>A session lets several people look at the same PDFs and mark them up together at the same time, from different places. Everyone sees the others' markups and chat within seconds.</p>
        <h4>Where it lives</h4>
        <p>
          The person who starts the session (the host) signs in to their OneDrive. redcolumn makes one shared folder there and puts the PDFs in it. Your documents are kept in that folder, not on a redcolumn server, and when the host ends the session the folder's files
          are removed.
        </p>
        {folderAvailable && (
          <p>
            In the desktop app the host can instead choose a shared folder on their computer: a OneDrive, Teams or Dropbox folder, or a network drive. Nobody signs in. Everyone who can open that folder joins by choosing it in Join, and changes arrive as fast as the folder syncs.
          </p>
        )}
        <h4>Accounts you need</h4>
        <ul>
          <li>A Microsoft account (personal, work or school). The host and guests all sign in with one.</li>
          <li>Guests join with a link or an email invitation from the host. They do not need to pay for anything.</li>
          <li>The sign-in button is at the bottom of this list. Your email is shown to others so they know who made which markup.</li>
        </ul>
        <h4>What the app can reach</h4>
        <ul>
          <li>Microsoft: it asks your permission each time it needs more, such as opening a shared folder. You can sign out whenever you like.</li>
          <li>Your name and email, so markups and chat show who wrote them.</li>
        </ul>
        <p>If you lose your internet connection, keep working. Your markups are saved on this device and sent when you are back online.</p>
      </StudioHelp>

      {invite && (
        <div className="session-invite">
          <b>You're invited to a Live Session in OneDrive.</b>
          <p>
            {oneDriveAvailable
              ? 'Joining signs you in to Microsoft (a personal, work or school account).'
              : 'OneDrive sharing is turned off in this copy of the app, so it cannot join this session.'}
          </p>
          <div className="row">
            <button className="btn primary" disabled={busy || !oneDriveAvailable} onClick={() => void onJoin(invite)}>
              Join session
            </button>
            <button className="btn small flat" onClick={onDismissInvite}>
              Not now
            </button>
          </div>
        </div>
      )}

      <div className="rc-scroll">
      {shown.length === 0 ? (
        <p className="rc-empty">
          {tab === 'deleted' ? 'No deleted sessions.' : tab === 'not' ? 'Sessions you have not joined are listed here.' : recent.length ? 'You are not in a session right now.' : 'Sessions you start or join appear here.'}
        </p>
      ) : (
        <ul className="rc-list">
          {shown.map(({ ref, joined: j, meta, status, usable, access }) => {
            const blocked = busy || !usable || (!j && ref.backend !== 'folder' && !oneDriveAvailable);
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
                      className="rc-join"
                      onClick={() => {
                        restoreRecentSession(ref.id);
                        setRefresh((n) => n + 1);
                      }}
                    >
                      Restore
                    </button>
                  ) : (
                    <>
                      <button type="button" className="rc-join" disabled={blocked} onClick={() => void onJoin(ref).then((ok) => ok && onFocus(ref.id))}>
                        Join
                      </button>
                      <button
                        type="button"
                        className="rc-x"
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
      {busy && <p className="rc-empty">Connecting…</p>}
      {error && <p className="session-error">{error}</p>}
      <p className="rc-note">
        You appear as <b>{me}</b>.
      </p>
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
  onShowFolder,
}: Props & JoinedSession & { onSettings: () => void }) {
  const online = useOnline();
  const { meta, isHost, status, record, presence, needsAuth, viewOnly, denied } = snapshot;
  // In a shared folder on this computer: no link to copy and no email invites; people open the folder.
  const inFolder = snapshot.backend === 'folder';
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
    // One row per person: known by Microsoft email when they have one, else by name.
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
    <div className="sessions rc-studio in-session">
      <div className="rc-session-top">
        <div className="rc-session-switch">
          <select aria-label="Session" value={session.id} onChange={(e) => onFocus(e.target.value || null)} title={status === 'online' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Offline: changes sync when you reconnect'}>
            <option value="">All Sessions</option>
            {joined.map((j) => (
              <option key={j.session.id} value={j.session.id}>
                {j.snapshot.backend === 'folder' ? j.snapshot.meta.name : `${j.snapshot.meta.name} — ${studioIdText(j.snapshot.meta.id)}`}
              </option>
            ))}
          </select>
          <StudioMenu
            label="Session commands"
            icon={<KebabIcon />}
            items={[
              ...(isHost && !finished && !ended ? [{ label: 'Session settings', onClick: onSettings }] : []),
              ...(onInviteEmail && !inFolder && (isHost || allows(meta, 'invite')) ? [{ label: 'Share invitations', onClick: () => onInviteEmail(meta.id), disabled: !online }] : []),
              ...(!inFolder && (isHost || allows(meta, 'invite')) ? [{ label: copied === 'link' ? 'Link copied' : 'Copy invitation link', onClick: () => copy('link', snapshot.inviteLink) }] : []),
              ...(inFolder && onShowFolder ? [{ label: 'Show session folder', onClick: () => onShowFolder(session.id) }] : []),
              { label: 'Session report', onClick: () => onReport(session.id, 'pdf') },
              { label: 'Record as CSV', onClick: () => onReport(session.id, 'csv') },
              { label: 'Leave session', onClick: () => onLeave(session.id), danger: true },
              ...(isHost && session.end && !ended ? [{ label: 'End session…', onClick: () => onEnd(session.id), disabled: busy || !online, danger: true }] : []),
            ]}
          />
        </div>
        {snapshot.email && <p className="rc-banner">You are {snapshot.email}</p>}
        {!finished && meta.expiresAt ? <p className="rc-banner">Closes {new Date(meta.expiresAt).toLocaleString()}</p> : null}
        {denied && <p className="session-error">The host has removed your access to this session.</p>}
        {needsAuth && (
          <div className="rc-banner">
            {`Signed out of Microsoft. Your edits are kept here and saved when you reconnect.`}{' '}
            <button className="rc-text-btn" onClick={() => session.reconnect && onRun(() => session.reconnect!())}>
              Reconnect
            </button>
          </div>
        )}
        {viewOnly && <p className="rc-banner">View only: the session folder is shared with you read-only.</p>}
        {!isHost && access === 'view' && !finished && !denied && <p className="rc-banner">You can view documents and chat. The host has not given you comment access.</p>}
        {finished && !ended && <p className="rc-banner">Closed {meta.endedAt ? new Date(meta.endedAt).toLocaleString() : ''}. Documents are read-only.</p>}
        {ended && <p className="session-error">The host ended this session and removed its files. Documents you have open stay read-only until you close them.</p>}
        {status === 'offline' && !finished && !denied && !ended && <p className="rc-banner">Offline. Keep working: markups sync when the connection returns.</p>}

        <section>
          <button type="button" className="rc-sec-h" aria-expanded={open.people} onClick={() => toggle('people')}>
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
                  <div className="rc-group">Online ({onlinePeople.length})</div>
                  <ul className="rc-people">
                    {onlinePeople.map((p) => (
                      <li key={p.email ?? p.name}>
                        <button type="button" className="rc-person" disabled={!p.here?.docId || p.here.self} title={p.email && p.email !== p.name ? p.email : undefined} onClick={() => p.here?.docId && onGoTo(session.id, p.here.docId, p.here.page)}>
                          <PersonIcon />
                          <span className="rc-name">
                            {p.name}
                            {p.here?.self ? ' (you)' : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="rc-group dim">Offline ({offlinePeople.length})</div>
                  <ul className="rc-people dim">
                    {offlinePeople.map((p) => (
                      <li key={p.email ?? p.name} className="rc-person dim" title={p.email && p.email !== p.name ? p.email : undefined}>
                        <PersonIcon />
                        <span className="rc-name">{p.name}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ul className="rc-people dim">
                  {pendingPeople.length === 0 && <li className="rc-empty">No one is waiting to join.</li>}
                  {pendingPeople.map((p) => (
                    <li key={p.email ?? p.name} className="rc-person dim" title={p.email && p.email !== p.name ? p.email : undefined}>
                      <PersonIcon />
                      <span className="rc-name">{p.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section>
          <div className="rc-sec-bar">
            <button type="button" className="rc-sec-h" aria-expanded={open.docs} onClick={() => toggle('docs')}>
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
            <ul className="rc-docs">
              {meta.documents.length === 0 && <li className="rc-empty">{session.canAddDocuments ? 'Add a PDF to share it.' : 'No documents yet.'}</li>}
              {meta.documents.map((d) => {
                const key = `${session.id}:${d.id}`;
                const active = activeDoc?.sessionId === session.id && activeDoc.docId === d.id;
                return (
                  <li key={d.id} className={active ? 'rc-doc on' : 'rc-doc'}>
                    <button type="button" className="rc-doc-main" disabled={denied} onClick={() => onOpenDocument(session.id, d.id)} title={`Added by ${d.addedBy}${openDocs.has(key) ? ' · open in a tab' : ''}`}>
                      <DocIcon />
                      <span className="rc-name">{d.name}</span>
                    </button>
                    <span className="rc-doc-actions">
                        {isHost && !finished && (
                          <label className="rc-mini" title="Update to a new revision">
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
                            className="rc-mini"
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
    <section className="rc-dock">
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
        className="rc-log"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {tab === 'pending' && pending.length === 0 && <li className="rc-empty">No pending invitations.</li>}
        {tab === 'pending' &&
          pending.map((p) => (
            <li key={p.email ?? p.name}>
              <PersonIcon />
              <span>
                <b>{p.name}</b>: Not joined yet
              </span>
            </li>
          ))}
        {tab !== 'pending' && shown.length === 0 && <li className="rc-empty">{tab === 'alerts' ? 'No notifications.' : 'Nothing yet.'}</li>}
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
          className="rc-chat"
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

/** Who you are signed in to Microsoft as (OneDrive sessions), with sign in and out. */
function MicrosoftIdentity({ onChanged }: { onChanged: () => void }) {
  const user = useSyncExternalStore(subscribeMicrosoftUser, microsoftUser);
  const [error, setError] = useState<string | null>(null);
  const [stay, setStay] = useState(staySignedInToMicrosoft);
  if (!oneDriveSharingEnabled) return null;
  return (
    <div className="cloud-identity">
      {user ? (
        <>
          <span title={`${user.name}. ${stay ? 'Kept signed in on this device.' : 'Signed in for this tab only; closing it signs you out.'}`}>
            Microsoft: <b>{user.email}</b>
          </span>
          <button className="btn small flat" onClick={() => void signOutOfMicrosoft().then(onChanged)} title="Forget the sign-in in redcolumn">
            Sign out
          </button>
          <button className="btn small flat" onClick={() => void signOutOfMicrosoft({ everywhere: true }).then(onChanged)} title="Also end the Microsoft session in this browser">
            Sign out everywhere
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
      {/* The desktop app keeps the sign-in in the system keychain instead. */}
      {!user && !desktop() && (
        <label title="Off: closing this tab signs you out of Microsoft. On: the sign-in is kept in this browser for up to a day.">
          <input
            type="checkbox"
            checked={stay}
            onChange={(e) => {
              setStaySignedInToMicrosoft(e.target.checked);
              setStay(e.target.checked);
            }}
          />{' '}
          Stay signed in on this device
        </label>
      )}
      {error && <p className="session-error">{error}</p>}
    </div>
  );
}
