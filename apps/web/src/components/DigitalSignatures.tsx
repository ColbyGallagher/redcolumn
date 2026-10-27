import { useEffect, useRef, useState } from 'react';
import type { DigitalIdRecord } from '../documents/digitalIds';
import { recalledPassword } from '../documents/idPasswords';
import type { SignatureCheck } from '../documents/pdfSign';
import type { SavedSignature } from '../signatures/signatures';
import { desktop, type TokenCertificate, type TokenModule } from '../desktop/host';
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
  /** Adds the signature's long-term validation data (desktop only); resolves to a sentence. */
  onAddLtv?: (check: SignatureCheck) => Promise<string>;
}

/** Nothing but validation data was added after it: the signed document is the whole document. */
const unchanged = (c: SignatureCheck) => c.coversWholeFile || c.onlyValidationAdded;

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
  if (!unchanged(c)) return { tone: 'warn', text: `Valid for the version signed; the document changed afterwards (${who})` };
  if (c.certificate && !c.certificate.validAtSigning) return { tone: 'warn', text: 'Valid, but the certificate was not valid when it was signed' };
  if (c.timestamp && !c.timestamp.verified) return { tone: 'warn', text: `Valid, but its time stamp is not: ${c.timestamp.problem ?? 'unverified'}` };
  return { tone: by ? 'ok' : 'warn', text: `Valid: unchanged since it was signed (${who})` };
}

const CERTIFY = { 1: 'no changes allowed', 2: 'form filling and signing allowed', 3: 'form filling, signing and markups allowed' } as const;

/** The PDF's digital signatures, checked, with Sign and Digital IDs. */
export function DigitalSignaturesSection({ checks, trusted, canSign, onSign, onManageIds, onGo, onTrust, onOpenSignedVersion, onCheckRevocation, onAddLtv }: SectionProps) {
  const [revocation, setRevocation] = useState<Record<string, string>>({});
  const [ltvNote, setLtvNote] = useState<Record<string, string>>({});
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
                  {c.format === 'pades' ? (c.timestamp?.verified ? (c.ltv ? ' · PAdES B-LT' : ' · PAdES B-T') : ' · PAdES') : c.format === 'pkcs7' ? ' · PKCS #7' : ''}
                  {c.ltv ? ' · LTV enabled' : ''}
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
                {ltvNote[c.vri] && <div className="print-hint dsig-revocation">{ltvNote[c.vri]}</div>}
                <div className="dsig-actions">
                  {c.intact && !unchanged(c) && (
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
                  {onAddLtv && c.intact && !c.ltv && c.certificate && !c.certificate.selfSigned && (
                    <button
                      className="btn small flat"
                      title="Keep the certificate chain and the certificate authority’s revocation answer in the PDF, so this signature can be checked later without them (appended; the signature stays valid)"
                      onClick={() => {
                        // Keyed by the signature itself: a field of the same name in another document is another signature.
                        setLtvNote((r) => ({ ...r, [c.vri]: 'Adding long-term validation…' }));
                        void onAddLtv(c).then(
                          (text) => setLtvNote((r) => ({ ...r, [c.vri]: text })),
                          (err) => setLtvNote((r) => ({ ...r, [c.vri]: `LTV not added: ${err instanceof Error ? err.message : String(err)}` })),
                        );
                      }}
                    >
                      Add LTV
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
  /** Adds a certificate on a smart card or USB token (desktop app only). */
  onAddCard: (card: TokenCertificate) => Promise<void>;
  onClose: () => void;
}

/** Digital IDs: make a self-signed one, import a .p12/.pfx, add one on a card, give out the certificate, delete. */
export function DigitalIdsDialog({ ids, onCreate, onImport, onExportCertificate, onDelete, onAddCard, onClose }: IdsProps) {
  const [mode, setMode] = useState<'list' | 'create' | 'import' | 'card'>(ids.length ? 'list' : 'create');
  const cards = !!desktop()?.tokens;
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
                      {id.token ? `On ${id.token.label || 'a card'} · ` : ''}
                      {id.selfSigned ? 'Self-signed' : `Issued by ${id.issuer}`} · valid to {new Date(id.notAfter).toLocaleDateString()}
                    </div>
                    <div className="row">
                      <button className="btn small flat" disabled={busy} onClick={() => {
                        if (id.token) return run(() => onExportCertificate(id, ''));
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
              {cards && (
                <button className="btn small" onClick={() => setMode('card')} title="A certificate on a smart card or USB token. Its key stays on the card.">
                  Add from smart card / token…
                </button>
              )}
            </div>
          </>
        )}
        {mode === 'card' && <CardPicker have={ids} busy={busy} onPick={(card) => run(() => onAddCard(card))} onBack={() => setMode('list')} />}
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
              {/* To the list even with no IDs yet: it offers importing and adding a card too. */}
              <button type="button" className="btn" disabled={busy} onClick={() => setMode('list')}>
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

/** The certificates on inserted cards, through the drivers on this computer (desktop app). */
function CardPicker({ have, busy, onPick, onBack }: { have: DigitalIdRecord[]; busy: boolean; onPick: (card: TokenCertificate) => void; onBack: () => void }) {
  const tokens = desktop()!.tokens!;
  const [modules, setModules] = useState<TokenModule[] | null>(null);
  const [found, setFound] = useState<Awaited<ReturnType<typeof tokens.certificates>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setFound(null);
    setError(null);
    void Promise.all([tokens.modules(), tokens.certificates()]).then(
      ([m, f]) => {
        setModules(m);
        setFound(f);
      },
      (err) => setError(err instanceof Error ? err.message : String(err)),
    );
  };
  useEffect(refresh, []);
  const mine = new Set(have.map((r) => r.token?.ref).filter(Boolean));
  // Signing certificates first: those whose key is visible, then the rest. A card can show some keys
  // and keep its signing key hidden until the PIN, so none is left out.
  const list = [...(found?.certificates ?? [])].sort((a, b) => Number(b.hasKey === true) - Number(a.hasKey === true));
  return (
    <>
      <p className="print-hint">Insert the card or token. Its key never leaves it: the card signs, with its PIN, each time.</p>
      {modules && !modules.length && <p className="empty">No card drivers found on this computer. Install the card’s software (or OpenSC), or choose its PKCS#11 driver file.</p>}
      {!found && !error && <p className="empty">Looking for cards…</p>}
      {found && modules?.length ? (
        list.length ? (
          <ul className="id-list">
            {list.map((c) => (
              <li key={c.ref}>
                <div>
                  <b>{c.label || 'Certificate'}</b> on {c.token || 'a card'}
                </div>
                <div className="print-hint">
                  {c.module}
                  {c.pinPad ? ' · PIN on the reader' : ''}
                </div>
                <div className="row">
                  <button className="btn small flat" disabled={busy || mine.has(c.ref)} onClick={() => onPick(c)}>
                    {mine.has(c.ref) ? 'Added' : 'Add'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No signing certificates on the inserted cards.</p>
        )
      ) : null}
      {found?.problems.map((p) => (
        <p key={p.module} className="print-hint">
          {p.module}: {p.problem}
        </p>
      ))}
      {error && <p className="print-error">{error}</p>}
      <div className="row">
        <button className="btn small" disabled={busy} onClick={refresh}>
          Look again
        </button>
        <button className="btn small" disabled={busy} onClick={() => void tokens.addModule().then((m) => m && refresh(), (err) => setError(err instanceof Error ? err.message : String(err)))}>
          Choose driver file…
        </button>
        {modules
          ?.filter((m) => m.added)
          .map((m) => (
            <button key={m.id} className="btn small flat" disabled={busy} onClick={() => void tokens.removeModule(m.id).then(refresh)}>
              Forget {m.name}
            </button>
          ))}
      </div>
      <div className="actions">
        <span className="spacer" />
        <button type="button" className="btn" disabled={busy} onClick={onBack}>
          Back
        </button>
      </div>
    </>
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
  /** Add long-term validation data (the chain and revocation answers) once signed. */
  ltv: boolean;
}

const LTV_KEY = 'nb.ltv';
/** Whether LTV data is added after signing (never where certificate services cannot be reached). */
export function savedLtv(): boolean {
  try {
    return canTimestamp() && localStorage.getItem(LTV_KEY) === '1';
  } catch {
    return false;
  }
}
export function saveLtv(on: boolean) {
  if (!canTimestamp()) return;
  try {
    localStorage.setItem(LTV_KEY, on ? '1' : '0');
  } catch {
    // Not remembered.
  }
}

/** "Add long-term validation (LTV)"; the choice is remembered. */
export function LtvOption({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  const available = canTimestamp();
  return (
    <label
      className="check"
      title={
        available
          ? 'Keeps the certificate chain and the certificate authority’s “not revoked” answer in the PDF, so the signature can still be checked after the certificate expires or the authority’s servers are gone. This computer asks the authority about the certificate, not the document.'
          : 'Long-term validation needs the desktop app: browsers cannot reach certificate authorities.'
      }
    >
      <input type="checkbox" checked={value && available} disabled={!available} onChange={(e) => onChange(e.target.checked)} />
      Add long-term validation (LTV)
    </label>
  );
}

const TSA_KEY = 'nb.tsaUrl';
/**
 * Time stamp servers are reached by the desktop app's main process (apps/desktop/src/pki.ts). A
 * browser cannot reach them: the page's security policy only allows its own site, and most of
 * these servers refuse browsers anyway.
 */
const canTimestamp = () => !!desktop()?.pkiFetch;
/** The time stamp server last used (and whether one is used; never where it cannot be reached). */
export function savedTsa(): { on: boolean; url: string } {
  let saved: { on: boolean; url: string };
  try {
    saved = { on: false, url: 'http://timestamp.digicert.com', ...JSON.parse(localStorage.getItem(TSA_KEY) ?? '{}') };
  } catch {
    saved = { on: false, url: 'http://timestamp.digicert.com' };
  }
  return canTimestamp() ? saved : { ...saved, on: false };
}
/** Remembers the choice, except where time stamps are unavailable (savedTsa reads it as off there). */
export function saveTsa(v: { on: boolean; url: string }) {
  if (!canTimestamp()) return;
  try {
    localStorage.setItem(TSA_KEY, JSON.stringify(v));
  } catch {
    // Not remembered.
  }
}

/** "Add a trusted time stamp" with the server's address; the choice is remembered. */
export function TimestampOption({ value, onChange }: { value: { on: boolean; url: string }; onChange: (v: { on: boolean; url: string }) => void }) {
  const available = canTimestamp();
  return (
    <div
      className="row"
      title={
        available
          ? 'A time stamp server vouches for when the document was signed, so the time does not rest on this computer’s clock. This computer contacts the server directly and sends it a fingerprint of the signature, not the document.'
          : 'Trusted time stamps need the desktop app: browsers cannot reach time stamp servers.'
      }
    >
      <label className="check">
        <input type="checkbox" checked={value.on} disabled={!available} onChange={(e) => onChange({ ...value, on: e.target.checked })} />
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
  const [ltv, setLtv] = useState(savedLtv);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = ids.find((i) => i.id === idId)?.token;
  // A card's PIN is never remembered; a .p12 password is, for the time-out in Preferences.
  const remembered = idId && !card ? recalledPassword(idId) : null;
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
          saveLtv(ltv);
          onSign({ idId, password: card?.pinPad ? '' : (remembered ?? password), reason, location, certify, imageId, where, timestampUrl: tsa.on && tsa.url.trim() ? tsa.url.trim() : null, ltv }).catch((err) => {
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
              <select
                value={idId}
                onChange={(e) => {
                  setIdId(e.target.value);
                  // A password typed for one ID is never sent to another: to a card it would use up a PIN try.
                  setPassword('');
                }}
              >
                {ids.map((id) => (
                  <option key={id.id} value={id.id}>
                    {id.name}
                    {id.email ? ` <${id.email}>` : ''}
                  </option>
                ))}
              </select>
            </label>
            {remembered ? (
              <p className="print-hint">Unlocked: no password needed until the time-out in Preferences › Signature.</p>
            ) : card?.pinPad ? (
              <p className="print-hint">Enter the PIN on the card reader when it asks.</p>
            ) : (
              <label className="row" title={card ? 'Sent to the card for this signature only; never stored' : undefined}>
                {card ? 'PIN' : 'Password'}
                <input type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
            )}
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
            <LtvOption value={ltv} onChange={setLtv} />
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
