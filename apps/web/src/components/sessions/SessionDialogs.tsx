import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseOneDriveInvite } from '../../studio/drive/onedrive';
import type { AccessPolicy } from '../../studio/protocol';
import type { Backend } from '../../studio/types';
import { AccessEditor, emptyPolicy } from './AccessEditor';

/** A document to put in a new session: one already open or in the library, or a file from disk. */
export type DocumentSource = { kind: 'file'; fileId: string; name: string } | { kind: 'upload'; file: File; name: string };

export interface StartRequest {
  name: string;
  backend: Backend;
  addDocuments: boolean;
  linkCanEdit: boolean;
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
      <label className="check" title="Attendees see the invite link">
        <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
        Attendees may invite others
      </label>
      <label className="row" title="The session closes by itself then: everyone's documents become read-only. Its files stay until the host ends it.">
        Closes
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
  busy: boolean;
  onStart: (req: StartRequest) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('general');
  const [name, setName] = useState('');
  const [backend, setBackend] = useState<Backend>(driveAvailable || !oneDriveAvailable ? 'drive' : 'onedrive');
  const [addDocuments, setAddDocuments] = useState(true);
  const [linkCanEdit, setLinkCanEdit] = useState(true);
  const [saveCopy, setSaveCopy] = useState(true);
  const [invite, setInvite] = useState(true);
  const [ends, setEnds] = useState('');
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
          if (!sessionEndIsValid(ends) || !(backend === 'drive' ? driveAvailable : oneDriveAvailable)) return;
          onStart({ name: name.trim(), backend, addDocuments, linkCanEdit, access: tidyPolicy(policy), documents: docs, saveCopy, invite, expiresAt: fromLocalInput(ends) });
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
              <label className="check" title="Otherwise the link gives view-only access, and people are invited as editors by email">
                <input type="checkbox" checked={linkCanEdit} onChange={(e) => setLinkCanEdit(e.target.checked)} />
                Anyone with the link can edit the {backend === 'onedrive' ? 'OneDrive' : 'Drive'} folder
              </label>
            </fieldset>
            <p className="hint">
              You host as <b>{me}</b>
              {backend === 'onedrive' ? (microsoftEmail ? ` (${microsoftEmail})` : '') : googleEmail ? ` (${googleEmail})` : ''}.{' '}
              {backend === 'onedrive' ? 'Add people by their Microsoft account email.' : 'Add people by their Google email.'}
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
          <button type="submit" className="btn primary" disabled={busy || !name.trim() || !(backend === 'drive' ? driveAvailable : oneDriveAvailable)}>
            {busy ? 'Starting…' : 'Start session'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Join by picking a shared session folder (Google Drive) or by pasting a session link (OneDrive). */
export function JoinSessionDialog({
  me,
  driveAvailable,
  oneDriveAvailable,
  busy,
  onJoinDrive,
  onJoinOneDrive,
  onClose,
}: {
  me: string;
  driveAvailable: boolean;
  oneDriveAvailable: boolean;
  busy: boolean;
  onJoinDrive: () => void;
  onJoinOneDrive: (shareId: string) => void;
  onClose: () => void;
}) {
  const [link, setLink] = useState('');
  const oneDriveId = parseOneDriveInvite(link);
  return (
    <Dialog title="Join Session" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (oneDriveId) onJoinOneDrive(oneDriveId);
        }}
      >
        <p>You join as {me}. The easiest way in is the invite link from the host.</p>
        {!driveAvailable && !oneDriveAvailable && <p className="hint">Live Sessions need Google Drive or OneDrive, and neither is set up in this build.</p>}
        {driveAvailable && (
          <p>
            <button type="button" className="btn" disabled={busy} onClick={onJoinDrive}>
              Choose a session folder in Google Drive…
            </button>
          </p>
        )}
        {oneDriveAvailable && (
          <div className="row">
            <input
              autoFocus
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a OneDrive session link"
              autoComplete="off"
              aria-label="OneDrive session link"
              aria-invalid={link.trim() !== '' && !oneDriveId}
            />
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {oneDriveAvailable && (
            <button type="submit" className="btn primary" disabled={!oneDriveId || busy}>
              {busy ? 'Joining…' : 'Join OneDrive session'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/** The host's session settings: name and who may do what. */
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

/** What to save before a session is ended, and where. */
export interface EndSessionChoice {
  /** This computer (a folder the host picks), a new folder in their OneDrive, or a redcolumn Project. */
  destination: 'local' | 'onedrive' | 'project';
  projectId: string | null;
  /** Each document as a PDF with the markups of `authors`. */
  pdfs: boolean;
  authors: string[];
  /** Every markup in the session as one CSV. */
  markupsCsv: boolean;
  recordCsv: boolean;
  reportPdf: boolean;
  /** Session Roundtrip: documents to send back to the library with the markups of `authors`. */
  sendBack: string[];
}

/**
 * End Session: saves what the host chooses, then removes the session folder and every file in it
 * for everyone. Typing the session name is required, so it cannot happen by a stray click.
 */
export function EndSessionDialog({
  name,
  backend,
  documents,
  authors,
  projects,
  oneDriveAvailable,
  busy,
  error,
  onEnd,
  onClose,
  sendBack = [],
}: {
  name: string;
  backend: Backend;
  documents: number;
  /** Everyone who made markups in the session. */
  authors: string[];
  /** Projects the files can go into. */
  projects: { id: string; name: string }[];
  oneDriveAvailable: boolean;
  busy: boolean;
  /** Why the last try stopped (nothing was removed). */
  error?: string | null;
  onEnd: (choice: EndSessionChoice) => void;
  onClose: () => void;
  /** Session Roundtrip: documents that came from the library, and where they would go back. */
  sendBack?: { docId: string; name: string; target: string }[];
}) {
  const [pdfs, setPdfs] = useState(documents > 0);
  const [chosen, setChosen] = useState<string[]>(authors);
  const [markupsCsv, setMarkupsCsv] = useState(documents > 0);
  const [recordCsv, setRecordCsv] = useState(true);
  const [reportPdf, setReportPdf] = useState(false);
  const [destination, setDestination] = useState<EndSessionChoice['destination']>('local');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [typed, setTyped] = useState('');
  const [back, setBack] = useState<string[]>(sendBack.map((d) => d.docId));
  const drive = backend === 'onedrive' ? 'OneDrive' : 'Google Drive';
  const saving = pdfs || markupsCsv || recordCsv || reportPdf;
  const confirmed = typed.trim().toLowerCase() === name.trim().toLowerCase();
  const ready = confirmed && !busy && (!saving || destination !== 'project' || !!projectId);
  return (
    <Dialog title={`End “${name}”`} className="wide" onClose={onClose}>
      <form
        className="dialog-body end-session"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onEnd({ destination, projectId: destination === 'project' ? projectId : null, pdfs, authors: chosen, markupsCsv, recordCsv, reportPdf, sendBack: back });
        }}
      >
        <div className="end-warning" role="alert">
          <b>Ending removes this session’s files for everyone.</b>
          <p>
            The session folder in {drive} goes to the {backend === 'onedrive' ? 'recycle bin' : 'trash'}, with every document, everyone’s markups, the chat and the Record in it. Attendees lose the
            session straight away and it leaves your Sessions list. Save what you need below first.
          </p>
        </div>

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

        <fieldset>
          <legend>Save before ending</legend>
          <label className="check">
            <input type="checkbox" checked={pdfs} disabled={!documents} onChange={(e) => setPdfs(e.target.checked)} />
            Documents as PDFs ({documents}), with the markups of:
          </label>
          {(pdfs || back.length > 0) && (
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
          <label className="check">
            <input type="checkbox" checked={markupsCsv} disabled={!documents} onChange={(e) => setMarkupsCsv(e.target.checked)} />
            Markups as CSV (every markup, one row each)
          </label>
          <label className="check">
            <input type="checkbox" checked={recordCsv} onChange={(e) => setRecordCsv(e.target.checked)} />
            Session record as CSV (chat, joins, every change)
          </label>
          <label className="check">
            <input type="checkbox" checked={reportPdf} onChange={(e) => setReportPdf(e.target.checked)} />
            Session report as PDF (documents, attendees, markups and the record)
          </label>
        </fieldset>

        <fieldset disabled={!saving}>
          <legend>Save to</legend>
          <label className="check">
            <input type="radio" name="end-dest" checked={destination === 'local'} onChange={() => setDestination('local')} />
            This computer (you choose a folder)
          </label>
          <label className="check" title={oneDriveAvailable ? undefined : 'This build is not set up for OneDrive.'}>
            <input type="radio" name="end-dest" checked={destination === 'onedrive'} disabled={!oneDriveAvailable} onChange={() => setDestination('onedrive')} />
            OneDrive (a new folder in Apps/redcolumn)
          </label>
          <label className="check" title={projects.length ? undefined : 'You have no Projects. Make one in the Projects panel first.'}>
            <input type="radio" name="end-dest" checked={destination === 'project'} disabled={!projects.length} onChange={() => setDestination('project')} />
            A redcolumn Project
            {destination === 'project' && (
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <span className="hint">If anything fails to save, the session is not ended and nothing is removed.</span>
        </fieldset>

        <div className="end-confirm">
          {!saving && <p className="end-nothing">Nothing will be saved. Everything in the session will be removed.</p>}
          <label className="stack">
            <span>
              To confirm, type the session name: <b>{name}</b>
            </span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} aria-label="Type the session name to confirm" autoComplete="off" spellCheck={false} />
          </label>
        </div>

        {busy && <p className="hint">Saving… The session is removed only once everything is saved.</p>}
        {error && !busy && (
          <p className="session-error" role="alert">
            {error} The session was not ended.
          </p>
        )}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn danger" disabled={!ready} title={confirmed ? undefined : 'Type the session name above first'}>
            {saving ? 'Save, then end session and remove files' : 'End session and remove files'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
