import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseOneDriveInvite } from '../../studio/drive/onedrive';
import { parseSessionId, type AccessPolicy } from '../../studio/protocol';
import type { Backend } from '../../studio/types';
import { AccessEditor, emptyPolicy } from './AccessEditor';

/** A document to put in a new session: one already open or in the library, or a file from disk. */
export type DocumentSource = { kind: 'file'; fileId: string; name: string } | { kind: 'upload'; file: File; name: string };

export interface StartRequest {
  name: string;
  backend: Backend;
  addDocuments: boolean;
  linkCanEdit: boolean;
  /** redcolumn server: only Google-signed-in people may join, matched by their email. */
  requireGoogle: boolean;
  access: AccessPolicy;
  documents: DocumentSource[];
  saveCopy: boolean;
  invite: boolean;
  /** When the session ends by itself (ms), or null. */
  expiresAt: number | null;
}

/** A time for a datetime-local input (local time), and back. */
const toLocalInput = (t: number | null | undefined) => {
  if (!t) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (s: string) => (s ? new Date(s).getTime() : null);

/** End date, and what attendees may do besides markups: save copies, invite others. */
function MoreOptions({ ends, setEnds, saveCopy, setSaveCopy, invite, setInvite }: { ends: string; setEnds: (v: string) => void; saveCopy: boolean; setSaveCopy: (v: boolean) => void; invite: boolean; setInvite: (v: boolean) => void }) {
  const past = !!ends && (fromLocalInput(ends) ?? 0) <= Date.now();
  return (
    <>
      <label className="check" title="Attendees may download, export and print the documents (with markups)">
        <input type="checkbox" checked={saveCopy} onChange={(e) => setSaveCopy(e.target.checked)} />
        Attendees may save copies of documents
      </label>
      <label className="check" title="Attendees see the Session ID and invite link">
        <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
        Attendees may invite others
      </label>
      <label className="row" title="The session finishes by itself then: everyone's documents become read-only">
        Ends
        <input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
        {ends && (
          <button type="button" className="btn small flat" onClick={() => setEnds('')}>
            Never
          </button>
        )}
      </label>
      {past && <p className="print-hint">The end date must be in the future.</p>}
    </>
  );
}

export const sessionEndIsValid = (ends: string) => !ends || (fromLocalInput(ends) ?? 0) > Date.now();

/** Drops unnamed groups before a policy is saved. */
export const tidyPolicy = (p: AccessPolicy): AccessPolicy => ({ ...p, groups: p.groups.filter((g) => g.name.trim()).map((g) => ({ ...g, name: g.name.trim() })) });

function Dialog({ title, className, onClose, children }: { title: string; className?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal session-dialog ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

type Step = 'general' | 'documents' | 'people';

/** Start New Session: name and options, the documents to share, and who may do what. */
export function StartSessionDialog({
  me,
  driveAvailable,
  oneDriveAvailable,
  openFiles,
  library,
  initialDocs,
  googleEmail,
  microsoftEmail,
  serverGoogle,
  busy,
  onStart,
  onClose,
}: {
  me: string;
  driveAvailable: boolean;
  oneDriveAvailable: boolean;
  /** Documents open in tabs (local ones, not already in a session). */
  openFiles: { id: string; name: string }[];
  library: { id: string; name: string }[];
  /** Documents to start with instead of every open one. */
  initialDocs?: string[] | null;
  /** The signed-in Google email, if any. */
  googleEmail?: string | null;
  /** The signed-in Microsoft email, if any. */
  microsoftEmail?: string | null;
  /** Whether the redcolumn server supports Google sign-in. */
  serverGoogle?: boolean;
  busy: boolean;
  onStart: (req: StartRequest) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('general');
  const [name, setName] = useState('');
  const [backend, setBackend] = useState<Backend>(driveAvailable ? 'drive' : oneDriveAvailable ? 'onedrive' : 'server');
  const [addDocuments, setAddDocuments] = useState(true);
  const [linkCanEdit, setLinkCanEdit] = useState(true);
  const [saveCopy, setSaveCopy] = useState(true);
  const [invite, setInvite] = useState(true);
  const [ends, setEnds] = useState('');
  const [requireGoogle, setRequireGoogle] = useState(false);
  const [policy, setPolicy] = useState<AccessPolicy>(emptyPolicy);
  const [docs, setDocs] = useState<DocumentSource[]>(() =>
    initialDocs
      ? initialDocs.flatMap((id) => {
          const f = openFiles.find((x) => x.id === id) ?? library.find((x) => x.id === id);
          return f ? [{ kind: 'file' as const, fileId: f.id, name: f.name }] : [];
        })
      : openFiles.map((f) => ({ kind: 'file' as const, fileId: f.id, name: f.name })),
  );
  const [libraryPick, setLibraryPick] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const hasFile = (id: string) => docs.some((d) => d.kind === 'file' && d.fileId === id);
  const addFile = (id: string, fileName: string) => !hasFile(id) && setDocs((d) => [...d, { kind: 'file', fileId: id, name: fileName }]);
  const available = library.filter((f) => !hasFile(f.id));
  const steps: { id: Step; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'documents', label: `Documents (${docs.length})` },
    { id: 'people', label: `Attendees (${policy.people.length})` },
  ];

  return (
    <Dialog title="Start a New Session" className="wide" onClose={onClose}>
      <nav className="dialog-steps" role="tablist">
        {steps.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={step === s.id} className={step === s.id ? 'active' : ''} onClick={() => setStep(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) {
            setStep('general');
            nameRef.current?.focus();
            return;
          }
          if (!sessionEndIsValid(ends)) return;
          onStart({ name: name.trim(), backend, addDocuments, linkCanEdit, requireGoogle: backend === 'server' && requireGoogle, access: tidyPolicy(policy), documents: docs, saveCopy, invite, expiresAt: fromLocalInput(ends) });
        }}
      >
        {step === 'general' && (
          <div className="dialog-pane">
            <label className="stack">
              Session name
              <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Level 2 coordination" maxLength={120} required />
            </label>
            <fieldset className="stack">
              <legend>Host the session in</legend>
              <label className="check">
                <input type="radio" name="backend" checked={backend === 'server'} onChange={() => setBackend('server')} />
                redcolumn server <span className="hint">instant sync; others join with the session ID</span>
              </label>
              <label className="check">
                <input type="radio" name="backend" checked={backend === 'drive'} disabled={!driveAvailable} onChange={() => setBackend('drive')} />
                My Google Drive <span className="hint">{driveAvailable ? 'a shared folder; syncs within seconds' : 'not set up in this build'}</span>
              </label>
              <label className="check">
                <input type="radio" name="backend" checked={backend === 'onedrive'} disabled={!oneDriveAvailable} onChange={() => setBackend('onedrive')} />
                My OneDrive <span className="hint">{oneDriveAvailable ? 'a shared folder; everyone signs in with Microsoft' : 'not set up in this build'}</span>
              </label>
            </fieldset>
            <fieldset className="stack">
              <legend>Options</legend>
              <label className="check">
                <input type="checkbox" checked={addDocuments} onChange={(e) => setAddDocuments(e.target.checked)} />
                Attendees who can comment may also add documents
              </label>
              <MoreOptions ends={ends} setEnds={setEnds} saveCopy={saveCopy} setSaveCopy={setSaveCopy} invite={invite} setInvite={setInvite} />
              {backend === 'server' && (
                <label className="check" title={serverGoogle ? 'People sign in with Google; people and groups are matched by Google email' : 'This redcolumn server is not set up for Google sign-in (STUDIO_GOOGLE_CLIENT_ID)'}>
                  <input type="checkbox" checked={requireGoogle} disabled={!serverGoogle} onChange={(e) => setRequireGoogle(e.target.checked)} />
                  Only people signed in with Google can join <span className="hint">{serverGoogle ? 'identify people by Google email' : 'server not set up for Google'}</span>
                </label>
              )}
              {(backend === 'drive' || backend === 'onedrive') && (
                <label className="check" title="Otherwise the link gives view-only access, and people are invited as editors by email">
                  <input type="checkbox" checked={linkCanEdit} onChange={(e) => setLinkCanEdit(e.target.checked)} />
                  Anyone with the link can edit the {backend === 'onedrive' ? 'OneDrive' : 'Drive'} folder
                </label>
              )}
            </fieldset>
            <p className="hint">
              You host as <b>{me}</b>
              {backend === 'onedrive' ? (microsoftEmail ? ` (${microsoftEmail})` : '') : googleEmail ? ` (${googleEmail})` : ''}.{' '}
              {backend === 'onedrive'
                ? 'Add people by their Microsoft account email.'
                : backend === 'drive' || requireGoogle
                  ? 'Add people by their Google email.'
                  : 'Access is matched on each attendee’s name, or their Google email when they sign in.'}
            </p>
          </div>
        )}

        {step === 'documents' && (
          <div className="dialog-pane">
            <p className="hint">Everyone in the session sees these PDFs. Markups already on open documents come along.</p>
            <ul className="dialog-list">
              {docs.length === 0 && <li className="empty">No documents yet. You can also add them once the session has started.</li>}
              {docs.map((d, i) => (
                <li key={d.kind === 'file' ? d.fileId : `${d.name}-${i}`}>
                  <span className="name" title={d.name}>
                    {d.name}
                  </span>
                  <span className="tag">{d.kind === 'upload' ? 'from disk' : openFiles.some((f) => f.id === d.fileId) ? 'open' : 'library'}</span>
                  <button type="button" className="btn small flat" title="Remove" onClick={() => setDocs((all) => all.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="row">
              {openFiles.some((f) => !hasFile(f.id)) && (
                <button type="button" className="btn" onClick={() => openFiles.forEach((f) => addFile(f.id, f.name))}>
                  Add open documents
                </button>
              )}
              <select value={libraryPick} aria-label="Add from library" onChange={(e) => setLibraryPick(e.target.value)} disabled={!available.length}>
                <option value="">{available.length ? 'Add from library…' : 'Library: nothing else to add'}</option>
                {available.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                disabled={!libraryPick}
                onClick={() => {
                  const f = library.find((x) => x.id === libraryPick);
                  if (f) addFile(f.id, f.name);
                  setLibraryPick('');
                }}
              >
                Add
              </button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                Browse…
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
                  setDocs((d) => [...d, ...files.map((file) => ({ kind: 'upload' as const, file, name: file.name }))]);
                }}
              />
            </div>
          </div>
        )}

        {step === 'people' && (
          <div className="dialog-pane">
            <AccessEditor policy={policy} onChange={setPolicy} host={me} />
            {(backend === 'drive' || backend === 'onedrive') && (
              <p className="hint">People entered as email addresses are also invited to the {backend === 'onedrive' ? 'OneDrive' : 'Drive'} folder by email.</p>
            )}
          </div>
        )}

        <div className="actions">
          {step !== 'general' && (
            <button type="button" className="btn flat" onClick={() => setStep(step === 'people' ? 'documents' : 'general')}>
              Back
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {step !== 'people' && (
            <button type="button" className="btn" onClick={() => setStep(step === 'general' ? 'documents' : 'people')}>
              Next
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            {busy ? 'Starting…' : 'Start session'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Join by session ID (redcolumn server), by picking a shared folder (Google Drive), or by link (OneDrive). */
export function JoinSessionDialog({
  me,
  driveAvailable,
  oneDriveAvailable,
  busy,
  onJoinId,
  onJoinDrive,
  onJoinOneDrive,
  onClose,
}: {
  me: string;
  driveAvailable: boolean;
  oneDriveAvailable: boolean;
  busy: boolean;
  onJoinId: (id: string) => void;
  onJoinDrive: () => void;
  onJoinOneDrive: (shareId: string) => void;
  onClose: () => void;
}) {
  const [id, setId] = useState('');
  const [link, setLink] = useState('');
  const parsed = parseSessionId(id);
  const oneDriveId = parseOneDriveInvite(link);
  return (
    <Dialog title="Join Session" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed) onJoinId(parsed);
        }}
      >
        <p>Enter the 9-digit Session ID from the host. You join as {me}.</p>
        <div className="row">
          <input
            autoFocus
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="123-456-789"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Session ID"
            aria-invalid={id.trim() !== '' && !parsed}
          />
        </div>
        {driveAvailable && (
          <p className="or">
            or{' '}
            <button type="button" className="btn small" disabled={busy} onClick={onJoinDrive}>
              Choose a session folder in Google Drive…
            </button>
          </p>
        )}
        {oneDriveAvailable && (
          <div className="row">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="or paste a OneDrive session link"
              autoComplete="off"
              aria-label="OneDrive session link"
              aria-invalid={link.trim() !== '' && !oneDriveId}
            />
            <button type="button" className="btn small" disabled={busy || !oneDriveId} onClick={() => oneDriveId && onJoinOneDrive(oneDriveId)}>
              Join OneDrive
            </button>
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!parsed || busy}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** The host's session settings: name, who may do what, and finishing the session. */
export function SessionSettingsDialog({
  name,
  host,
  policy,
  addDocuments,
  saveCopy: initialSaveCopy,
  invite: initialInvite,
  expiresAt,
  busy,
  onSave,
  onFinish,
  onClose,
}: {
  name: string;
  host: string;
  policy: AccessPolicy;
  addDocuments: boolean;
  saveCopy: boolean;
  invite: boolean;
  expiresAt: number | null;
  busy: boolean;
  onSave: (patch: { name: string; access: AccessPolicy; addDocuments: boolean; saveCopy: boolean; invite: boolean; expiresAt: number | null }) => void;
  onFinish: () => void;
  onClose: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draft, setDraft] = useState(policy);
  const [docs, setDocs] = useState(addDocuments);
  const [saveCopy, setSaveCopy] = useState(initialSaveCopy);
  const [invite, setInvite] = useState(initialInvite);
  const [ends, setEnds] = useState(toLocalInput(expiresAt));
  return (
    <Dialog title="Session Permissions" className="wide" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!sessionEndIsValid(ends)) return;
          onSave({ name: draftName.trim() || name, access: tidyPolicy(draft), addDocuments: docs, saveCopy, invite, expiresAt: fromLocalInput(ends) });
        }}
      >
        <div className="dialog-pane">
          <label className="stack">
            Session name
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={120} />
          </label>
          <label className="check">
            <input type="checkbox" checked={docs} onChange={(e) => setDocs(e.target.checked)} />
            Attendees who can comment may also add documents
          </label>
          <MoreOptions ends={ends} setEnds={setEnds} saveCopy={saveCopy} setSaveCopy={setSaveCopy} invite={invite} setInvite={setInvite} />
          <AccessEditor policy={draft} onChange={setDraft} host={host} />
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              if (confirm(`Finish “${name}”? Everyone's documents become read-only. This cannot be undone.`)) onFinish();
            }}
          >
            Finish session
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Finish Session: ends the session for everyone (documents become read-only) and saves each
 * document to the host's library with the markups of the attendees chosen.
 */
export function FinishSessionDialog({
  name,
  authors,
  busy,
  onFinish,
  onClose,
  sendBack = [],
}: {
  name: string;
  /** Everyone who made markups in the session. */
  authors: string[];
  busy: boolean;
  onFinish: (choice: { save: boolean; authors: string[]; sendBack: string[] }) => void;
  onClose: () => void;
  /** Session Roundtrip: documents that came from the library or a Project, and where they would go back. */
  sendBack?: { docId: string; name: string; target: string }[];
}) {
  const [save, setSave] = useState(!sendBack.length);
  const [chosen, setChosen] = useState<string[]>(authors);
  const [back, setBack] = useState<string[]>(sendBack.map((d) => d.docId));
  return (
    <Dialog title={`Finish “${name}”`} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          onFinish({ save, authors: chosen, sendBack: back });
        }}
      >
        <p>Everyone’s documents become read-only. Attendees can still open the session to review it and make a report. This cannot be undone.</p>
        {sendBack.length > 0 && (
          <fieldset>
            <legend>Send back (Session Roundtrip)</legend>
            {sendBack.map((d) => (
              <label key={d.docId} className="check">
                <input type="checkbox" checked={back.includes(d.docId)} onChange={(e) => setBack((b) => (e.target.checked ? [...b, d.docId] : b.filter((x) => x !== d.docId)))} />
                {d.name}: {d.target}
              </label>
            ))}
            <span className="hint">With the markups of the people chosen below.</span>
          </fieldset>
        )}
        <label className="check">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          Save each document to my library with the markups of:
        </label>
        {save && (
          <div className="finish-authors">
            {authors.length ? (
              authors.map((a) => (
                <label key={a} className="check">
                  <input type="checkbox" checked={chosen.includes(a)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, a] : c.filter((x) => x !== a)))} />
                  {a}
                </label>
              ))
            ) : (
              <span className="hint">Nobody has made markups yet.</span>
            )}
          </div>
        )}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn danger" disabled={busy}>
            Finish session
          </button>
        </div>
      </form>
    </Dialog>
  );
}
