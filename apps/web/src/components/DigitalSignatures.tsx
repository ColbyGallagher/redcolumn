import { useRef, useState } from 'react';
import type { DigitalIdRecord } from '../documents/digitalIds';
import type { SignatureCheck } from '../documents/pdfSign';
import type { SavedSignature } from '../signatures/signatures';
import { askText } from './AskText';

// --- Signatures in the document ---------------------------------------------------------------

interface SectionProps {
  checks: SignatureCheck[] | null;
  trusted: readonly string[];
  canSign: boolean;
  onSign: () => void;
  onManageIds: () => void;
  onGo: (field: string) => void;
  onTrust: (fingerprint: string) => void;
  onOpenSignedVersion: (check: SignatureCheck) => void;
  /** Asks the certificate's OCSP responder (or its CRL) whether it was revoked; resolves to a sentence. */
  onCheckRevocation: (check: SignatureCheck) => Promise<string>;
}

/** The certificate in the signer's chain the user trusts (the signer's own, or an issuer's), if any. */
function trustedBy(c: SignatureCheck, trusted: readonly string[]): string | null {
  if (c.certificate && trusted.includes(c.certificate.fingerprint)) return c.signer;
  // An issuer counts only when every link from the signer up to it checks out.
  const i = c.chain.fingerprints.findIndex((f, k) => k > 0 && trusted.includes(f));
  return i > 0 && (c.chain.complete || i < c.chain.fingerprints.length - 1 || !c.chain.problem) ? (c.chain.names[i] ?? null) : null;
}

function status(c: SignatureCheck, trusted: readonly string[]): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (!c.intact) return { tone: 'bad', text: c.problem ?? 'Invalid' };
  const by = trustedBy(c, trusted);
  const who = !by ? 'identity not verified' : by === c.signer ? 'identity trusted' : `identity trusted through ${by}`;
  if (!c.coversWholeFile) return { tone: 'warn', text: `Valid for the version signed; the document changed afterwards (${who})` };
  if (c.certificate && !c.certificate.validAtSigning) return { tone: 'warn', text: 'Valid, but the certificate was not valid when it was signed' };
  if (c.timestamp && !c.timestamp.verified) return { tone: 'warn', text: `Valid, but its time stamp is not: ${c.timestamp.problem ?? 'unverified'}` };
  return { tone: by ? 'ok' : 'warn', text: `Valid: unchanged since it was signed (${who})` };
}

const CERTIFY = { 1: 'no changes allowed', 2: 'form filling and signing allowed', 3: 'form filling, signing and markups allowed' } as const;

/** The PDF's digital signatures, checked, with Sign and Digital IDs. */
export function DigitalSignaturesSection({ checks, trusted, canSign, onSign, onManageIds, onGo, onTrust, onOpenSignedVersion, onCheckRevocation }: SectionProps) {
  const [revocation, setRevocation] = useState<Record<string, string>>({});
  return (
    <div className="digital-signatures">
      <h3>Digital Signatures</h3>
      <div className="sheet-actions">
        <button className="btn small primary" disabled={!canSign} onClick={onSign} title="Sign the document with a Digital ID">
          Sign…
        </button>
        <button className="btn small" onClick={onManageIds}>
          Digital IDs…
        </button>
      </div>
      {checks === null ? (
        <p className="empty">Checking…</p>
      ) : !checks.length ? (
        <p className="empty">No digital signatures. Sign with a Digital ID, or draw a signature field (Forms) and click it to sign there.</p>
      ) : (
        <ul className="dsig-list">
          {checks.map((c) => {
            const s = status(c, trusted);
            return (
              <li key={c.field} className={`dsig ${s.tone}`}>
                <button className="dsig-head" onClick={() => onGo(c.field)} title="Show the signature">
                  <span className="dsig-icon">{s.tone === 'ok' ? '✓' : s.tone === 'warn' ? '!' : '✗'}</span>
                  <b>{c.signer || 'Unknown signer'}</b>
                  {c.certify && <span className="badge">Certified</span>}
                </button>
                <div className="dsig-status">{s.text}</div>
                <div className="print-hint">
                  {c.signedAt ? c.signedAt.toLocaleString() : 'Time not given'}
                  {c.timestamp?.verified ? ` (time stamped by ${c.timestamp.tsa || 'a time stamp server'})` : c.signedAt ? ' (signer’s clock)' : ''}
                  {c.reason ? ` · ${c.reason}` : ''}
                  {c.location ? ` · ${c.location}` : ''}
                  {c.certify ? ` · ${CERTIFY[c.certify]}` : ''}
                </div>
                {c.certificate && (
                  <div className="print-hint">
                    Certificate: {c.issuer || 'unknown issuer'}
                    {c.certificate.selfSigned ? ' (self-signed)' : ''}, valid to {c.certificate.notAfter.toLocaleDateString()}
                  </div>
                )}
                {c.chain.names.length > 1 && (
                  <div className="print-hint" title={c.chain.problem ?? 'Every certificate in the chain is signed by the next'}>
                    Chain: {c.chain.names.join(' → ')}
                    {c.chain.complete ? '' : ` (${c.chain.problem ?? 'incomplete'})`}
                  </div>
                )}
                {revocation[c.field] && <div className="print-hint dsig-revocation">{revocation[c.field]}</div>}
                <div className="dsig-actions">
                  {c.intact && !c.coversWholeFile && (
                    <button className="btn small flat" onClick={() => onOpenSignedVersion(c)}>
                      Open signed version
                    </button>
                  )}
                  {c.intact && c.certificate && !trusted.includes(c.certificate.fingerprint) && (
                    <button className="btn small flat" title={`SHA-256 ${c.certificate.fingerprint}`} onClick={() => onTrust(c.certificate!.fingerprint)}>
                      Trust this signer
                    </button>
                  )}
                  {c.intact && c.chain.complete && c.chain.names.length > 1 && !trusted.includes(c.chain.fingerprints.at(-1)!) && (
                    <button className="btn small flat" title={`Trust every signer this certificate authority vouches for (SHA-256 ${c.chain.fingerprints.at(-1)})`} onClick={() => onTrust(c.chain.fingerprints.at(-1)!)}>
                      Trust {c.chain.names.at(-1)}
                    </button>
                  )}
                  {c.intact && c.certificate && !c.certificate.selfSigned && (
                    <button
                      className="btn small flat"
                      title="Ask the certificate authority whether this certificate was revoked (OCSP, else its revocation list)"
                      onClick={() => {
                        setRevocation((r) => ({ ...r, [c.field]: 'Checking revocation…' }));
                        void onCheckRevocation(c).then(
                          (text) => setRevocation((r) => ({ ...r, [c.field]: text })),
                          (err) => setRevocation((r) => ({ ...r, [c.field]: `Revocation not checked: ${err instanceof Error ? err.message : String(err)}` })),
                        );
                      }}
                    >
                      Check revocation
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --- Digital IDs --------------------------------------------------------------------------------

interface IdsProps {
  ids: DigitalIdRecord[];
  onCreate: (o: { name: string; email: string; org: string; password: string }) => Promise<void>;
  onImport: (file: File, password: string) => Promise<void>;
  onExportCertificate: (id: DigitalIdRecord, password: string) => Promise<void>;
  onDelete: (id: DigitalIdRecord) => void;
  onClose: () => void;
}

/** Digital IDs: make a self-signed one, import a .p12/.pfx, give out the certificate, delete. */
export function DigitalIdsDialog({ ids, onCreate, onImport, onExportCertificate, onDelete, onClose }: IdsProps) {
  const [mode, setMode] = useState<'list' | 'create' | 'import'>(ids.length ? 'list' : 'create');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const run = (job: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    job()
      .then(() => {
        setMode('list');
        setPw('');
        setPw2('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onClose}>
      <div className="modal print-dialog digital-ids" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' && !busy) onClose();
      }}>
        <h3>Digital IDs</h3>
        {mode === 'list' && (
          <>
            {ids.length ? (
              <ul className="id-list">
                {ids.map((id) => (
                  <li key={id.id}>
                    <div>
                      <b>{id.name}</b>
                      {id.email ? ` <${id.email}>` : ''}
                    </div>
                    <div className="print-hint">
                      {id.selfSigned ? 'Self-signed' : `Issued by ${id.issuer}`} · valid to {new Date(id.notAfter).toLocaleDateString()}
                    </div>
                    <div className="row">
                      <button className="btn small flat" disabled={busy} onClick={() => {
                        void askText('Export certificate', '', { label: `Password for ${id.name}'s Digital ID`, confirm: 'Export', password: true }).then((p) => {
                          if (p !== null) run(() => onExportCertificate(id, p));
                        });
                      }}>
                        Export certificate
                      </button>
                      <button className="btn small flat" disabled={busy} onClick={() => {
                        if (confirm(`Delete the Digital ID "${id.name}" from this device? Documents it signed stay signed.`)) onDelete(id);
                      }}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">No Digital IDs on this device yet.</p>
            )}
            <div className="row">
              <button className="btn small" onClick={() => setMode('create')}>
                New self-signed ID…
              </button>
              <button className="btn small" onClick={() => setMode('import')}>
                Import .p12 / .pfx…
              </button>
            </div>
          </>
        )}
        {mode === 'create' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && pw && pw === pw2) run(() => onCreate({ name: name.trim(), email: email.trim(), org: org.trim(), password: pw }));
            }}
          >
            <p className="print-hint">A self-signed ID proves the document hasn’t changed since you signed it. People who check it can choose to trust your certificate (send it to them from here).</p>
            <label className="row">
              Name
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="row">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="row">
              Organisation
              <input value={org} onChange={(e) => setOrg(e.target.value)} />
            </label>
            <label className="row">
              Password
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </label>
            <label className="row">
              Again
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </label>
            {pw && pw2 && pw !== pw2 && <p className="print-hint">The passwords don’t match.</p>}
            <div className="actions">
              <span className="spacer" />
              <button type="button" className="btn" disabled={busy} onClick={() => (ids.length ? setMode('list') : onClose())}>
                Back
              </button>
              <button type="submit" className="btn primary" disabled={busy || !name.trim() || !pw || pw !== pw2}>
                {busy ? 'Making the key…' : 'Create'}
              </button>
            </div>
          </form>
        )}
        {mode === 'import' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (file) run(() => onImport(file, pw));
            }}
          >
            <label className="row">
              File
              <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
                {file ? file.name : 'Choose…'}
              </button>
              <input ref={fileRef} type="file" accept=".p12,.pfx,application/x-pkcs12" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className="row">
              Password
              <input type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
            </label>
            <div className="actions">
              <span className="spacer" />
              <button type="button" className="btn" disabled={busy} onClick={() => setMode('list')}>
                Back
              </button>
              <button type="submit" className="btn primary" disabled={busy || !file}>
                Import
              </button>
            </div>
          </form>
        )}
        {error && <p className="print-error">{error}</p>}
        {mode === 'list' && (
          <div className="actions">
            <span className="spacer" />
            <button className="btn primary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Signing ------------------------------------------------------------------------------------

export interface SignChoice {
  idId: string;
  password: string;
  reason: string;
  location: string;
  certify: 0 | 1 | 2 | 3;
  /** A saved signature's picture to show, or none. */
  imageId: string | null;
  /** Where: the given field, an invisible signature, or a field to draw first. */
  where: 'field' | 'invisible' | 'draw';
  /** A time stamp server (RFC 3161) to get a trusted signing time from, or none. */
  timestampUrl: string | null;
}

const TSA_KEY = 'nb.tsaUrl';
/** The time stamp server last used (and whether one is used). */
export function savedTsa(): { on: boolean; url: string } {
  try {
    return { on: false, url: 'http://timestamp.digicert.com', ...JSON.parse(localStorage.getItem(TSA_KEY) ?? '{}') };
  } catch {
    return { on: false, url: 'http://timestamp.digicert.com' };
  }
}
export function saveTsa(v: { on: boolean; url: string }) {
  try {
    localStorage.setItem(TSA_KEY, JSON.stringify(v));
  } catch {
    // Not remembered.
  }
}

/** "Add a trusted time stamp" with the server's address; the choice is remembered. */
export function TimestampOption({ value, onChange }: { value: { on: boolean; url: string }; onChange: (v: { on: boolean; url: string }) => void }) {
  return (
    <div className="row" title="A time stamp server vouches for when the document was signed, so the time does not rest on this computer’s clock. It is reached through the redcolumn server.">
      <label className="check">
        <input type="checkbox" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} />
        Trusted time stamp from
      </label>
      <input aria-label="Time stamp server" value={value.url} disabled={!value.on} style={{ flex: 1 }} onChange={(e) => onChange({ ...value, url: e.target.value })} />
    </div>
  );
}

interface SignProps {
  ids: DigitalIdRecord[];
  pictures: SavedSignature[];
  /** The empty signature field being signed, if any. */
  fieldName: string | null;
  /** The document is already signed (it can no longer be certified). */
  alreadySigned: boolean;
  onSign: (c: SignChoice) => Promise<void>;
  onManageIds: () => void;
  onCancel: () => void;
}

export function SignDialog({ ids, pictures, fieldName, alreadySigned, onSign, onManageIds, onCancel }: SignProps) {
  const [idId, setIdId] = useState(ids[0]?.id ?? '');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('I am approving this document');
  const [location, setLocation] = useState('');
  const [certify, setCertify] = useState<0 | 1 | 2 | 3>(0);
  const [imageId, setImageId] = useState<string | null>(pictures.find((p) => p.kind === 'signature')?.id ?? null);
  const [where, setWhere] = useState<SignChoice['where']>(fieldName ? 'field' : 'draw');
  const [tsa, setTsa] = useState(savedTsa);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <form
        className="modal print-dialog sign-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !busy) onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!idId || busy) return;
          setBusy(true);
          setError(null);
          saveTsa(tsa);
          onSign({ idId, password, reason, location, certify, imageId, where, timestampUrl: tsa.on && tsa.url.trim() ? tsa.url.trim() : null }).catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
          });
        }}
      >
        <h3>Sign{fieldName ? ` ${fieldName}` : ''}</h3>
        {!ids.length ? (
          <p>
            Signing needs a Digital ID.{' '}
            <button type="button" className="btn small" onClick={onManageIds}>
              Make or import one…
            </button>
          </p>
        ) : (
          <>
            <label className="row">
              Digital ID
              <select value={idId} onChange={(e) => setIdId(e.target.value)}>
                {ids.map((id) => (
                  <option key={id.id} value={id.id}>
                    {id.name}
                    {id.email ? ` <${id.email}>` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="row">
              Password
              <input type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="row">
              Reason
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="row">
              Location
              <input value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
            {!fieldName && (
              <fieldset>
                <legend>Where</legend>
                <label className="row">
                  <input type="radio" checked={where === 'draw'} onChange={() => setWhere('draw')} />
                  Draw the signature’s box on the page
                </label>
                <label className="row">
                  <input type="radio" checked={where === 'invisible'} onChange={() => setWhere('invisible')} />
                  Invisible (listed in Signatures only)
                </label>
              </fieldset>
            )}
            {where !== 'invisible' && (
              <label className="row">
                Appearance
                <select value={imageId ?? ''} onChange={(e) => setImageId(e.target.value || null)}>
                  <option value="">Name and date only</option>
                  {pictures.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || (p.kind === 'initials' ? 'Initials' : 'Signature')}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="row" title={alreadySigned ? 'Only the first signature can certify a document' : undefined}>
              <select value={certify} disabled={alreadySigned} onChange={(e) => setCertify(Number(e.target.value) as 0 | 1 | 2 | 3)}>
                <option value={0}>Approve (sign)</option>
                <option value={1}>Certify: no changes allowed</option>
                <option value={2}>Certify: allow form filling and signing</option>
                <option value={3}>Certify: also allow markups</option>
              </select>
            </label>
            <TimestampOption value={tsa} onChange={setTsa} />
          </>
        )}
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !ids.length}>
            {busy ? 'Signing…' : where === 'draw' && !fieldName ? 'Next: draw the box' : 'Sign'}
          </button>
        </div>
      </form>
    </div>
  );
}
