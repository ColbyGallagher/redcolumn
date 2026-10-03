import { useCallback, useEffect, useRef, useState } from 'react';
import type { Markup } from '@nb/markup';
import { signatures, trimCanvas, useSignatures, type SavedSignature } from '../signatures/signatures';
import { askText } from './AskText';
import { ContextMenu, type ContextMenuState } from './ContextMenu';

const INK_COLORS = ['#111827', '#1e3a8a', '#991b1b'];
const SCRIPT_FONTS = [
  { label: 'Script', css: '"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive' },
  { label: 'Brush', css: '"Brush Script MT", "Segoe Script", cursive' },
  { label: 'Handwriting', css: '"Lucida Handwriting", "Segoe Print", cursive' },
  { label: 'Formal', css: '"Palatino Linotype", "Book Antiqua", Georgia, serif' },
];

type Mode = 'draw' | 'type' | 'image';

/** Creates a signature by drawing, typing, or from an image. */
function SignatureDialog({ author, onClose }: { author: string; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('draw');
  const [kind, setKind] = useState<'signature' | 'initials'>('signature');
  const [name, setName] = useState('');
  const [color, setColor] = useState(INK_COLORS[0]!);
  const [typed, setTyped] = useState(author === 'Me' ? '' : author);
  const [font, setFont] = useState(SCRIPT_FONTS[0]!.css);
  const [knockout, setKnockout] = useState(true);
  const [upload, setUpload] = useState<HTMLImageElement | null>(null);
  const [inked, setInked] = useState(false);
  const [clears, setClears] = useState(0);
  const pad = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);

  // Draw-mode strokes are kept as ink on the pad canvas; typed and image modes redraw it.
  useEffect(() => {
    const c = pad.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    if (mode === 'draw') {
      ctx.clearRect(0, 0, c.width, c.height);
      setInked(false);
      return;
    }
    ctx.clearRect(0, 0, c.width, c.height);
    if (mode === 'type') {
      const text = kind === 'initials' ? typed.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join('') : typed;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 72;
      do {
        ctx.font = `${size}px ${font}`;
        size -= 4;
      } while (ctx.measureText(text).width > c.width - 40 && size > 16);
      ctx.fillText(text, c.width / 2, c.height / 2);
      setInked(!!text.trim());
    } else if (upload) {
      const k = Math.min((c.width - 20) / upload.naturalWidth, (c.height - 20) / upload.naturalHeight, 1);
      const w = upload.naturalWidth * k;
      const h = upload.naturalHeight * k;
      ctx.drawImage(upload, (c.width - w) / 2, (c.height - h) / 2, w, h);
      if (knockout) {
        // Scanned signatures: make the paper transparent so only the ink is placed.
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
          if (lum > 200) d[i + 3] = 0;
          else if (lum > 150) d[i + 3] = Math.round(d[i + 3]! * ((200 - lum) / 50));
        }
        ctx.putImageData(img, 0, 0);
      }
      setInked(true);
    } else {
      setInked(false);
    }
  }, [mode, typed, font, color, kind, upload, knockout, clears]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };

  const save = () => {
    const c = pad.current;
    if (!c) return;
    const trimmed = trimCanvas(c);
    if (!trimmed) return;
    signatures.add({ name: name.trim() || (kind === 'initials' ? 'Initials' : 'Signature'), kind, ...trimmed });
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal signature-dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Create signature">
        <h3>Create Signature</h3>
        <div className="seg sig-kind">
          {(['signature', 'initials'] as const).map((k) => (
            <button key={k} className={`seg-btn${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
              {k === 'signature' ? 'Signature' : 'Initials'}
            </button>
          ))}
        </div>
        <div className="tabs sig-tabs" role="tablist">
          {(['draw', 'type', 'image'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m === 'draw' ? 'Draw' : m === 'type' ? 'Type' : 'Image'}
            </button>
          ))}
        </div>
        <div className="sig-pad-wrap">
          <canvas
            ref={pad}
            className={`sig-pad${mode === 'draw' ? ' drawable' : ''}`}
            width={560}
            height={200}
            onPointerDown={(e) => {
              if (mode !== 'draw') return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drawing.current = point(e);
            }}
            onPointerMove={(e) => {
              if (mode !== 'draw' || !drawing.current) return;
              const p = point(e);
              const ctx = e.currentTarget.getContext('2d')!;
              ctx.strokeStyle = color;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              // Pen pressure where available, so strokes look written rather than plotted.
              ctx.lineWidth = 2 + (e.pressure && e.pointerType === 'pen' ? e.pressure * 3 : 1.5);
              ctx.beginPath();
              ctx.moveTo(drawing.current.x, drawing.current.y);
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
              drawing.current = p;
              setInked(true);
            }}
            onPointerUp={() => (drawing.current = null)}
          />
          {mode === 'draw' && !inked && <span className="sig-pad-hint">Sign here with your mouse, pen or finger</span>}
          <span className="sig-line" aria-hidden="true" />
        </div>
        <div className="sig-options">
          {mode !== 'image' && (
            <span className="sig-colors">
              {INK_COLORS.map((c) => (
                <button key={c} className={`sig-color${color === c ? ' active' : ''}`} style={{ background: c }} title="Ink colour" onClick={() => setColor(c)} />
              ))}
            </span>
          )}
          {mode === 'draw' && (
            <button className="btn small" onClick={() => setClears((n) => n + 1)} disabled={!inked}>
              Clear
            </button>
          )}
          {mode === 'type' && (
            <>
              <input className="sig-typed" value={typed} placeholder="Your name" onChange={(e) => setTyped(e.target.value)} autoFocus />
              <select value={font} onChange={(e) => setFont(e.target.value)}>
                {SCRIPT_FONTS.map((f) => (
                  <option key={f.label} value={f.css}>
                    {f.label}
                  </option>
                ))}
              </select>
            </>
          )}
          {mode === 'image' && (
            <>
              <label className="btn small">
                Choose image…
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const img = new Image();
                    img.onload = () => setUpload(img);
                    img.src = URL.createObjectURL(f);
                  }}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={knockout} onChange={(e) => setKnockout(e.target.checked)} /> Remove white background
              </label>
            </>
          )}
        </div>
        <div className="row sig-name">
          <input value={name} placeholder={kind === 'initials' ? 'Name (e.g. Initials)' : 'Name (e.g. My signature)'} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!inked} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export type SignatureValidity = 'valid' | 'modified' | 'checking';

interface Props {
  author: string;
  /** Signatures placed on the open document. */
  placed: Markup[];
  canSign: boolean;
  /** Current fingerprint of the document, to check placed signatures against. */
  currentDigest: string | null;
  selected: ReadonlySet<string>;
  onPlace: (sig: SavedSignature, reason: string) => void;
  onSelect: (m: Markup) => void;
}

/**
 * Signatures: create and keep signatures and initials on this device, place them on documents,
 * and see who signed the open document, when, and whether it changed afterwards.
 */
export function SignaturesPanel({ author, placed, canSign, currentDigest, selected, onPlace, onSelect }: Props) {
  const saved = useSignatures();
  const [creating, setCreating] = useState(false);
  const [reason, setReason] = useState('');
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const validity = (m: Markup): SignatureValidity => (!currentDigest ? 'checking' : m.signature?.digest === currentDigest ? 'valid' : 'modified');

  return (
    <div className="signatures">
      <h3>My Signatures</h3>
      <div className="sig-list">
        {saved.map((s) => (
          <button
            key={s.id}
            className="sig-card"
            disabled={!canSign}
            title={canSign ? `Place "${s.name}": click on the page, or drag to size it` : 'Open a document you can mark up to sign it'}
            onClick={() => onPlace(s, reason.trim())}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  { label: 'Place on Page', disabled: !canSign, onClick: () => onPlace(s, reason.trim()) },
                  {
                    label: 'Rename…',
                    onClick: () =>
                      void askText('Rename Signature', s.name, { confirm: 'Rename' }).then((n) => {
                        if (n) signatures.rename(s.id, n);
                      }),
                  },
                  { sep: true },
                  {
                    label: 'Delete',
                    danger: true,
                    onClick: () => {
                      if (confirm(`Delete "${s.name}" from this device? Signatures already placed stay on their documents.`)) signatures.remove(s.id);
                    },
                  },
                ],
              });
            }}
          >
            <img src={s.image} alt="" />
            <span className="sig-card-name">
              {s.name}
              <small>{s.kind === 'initials' ? 'Initials' : 'Signature'}</small>
            </span>
          </button>
        ))}
        <button className="sig-card add" onClick={() => setCreating(true)}>
          <span className="plus">+</span>
          <span className="sig-card-name">New signature…</span>
        </button>
      </div>
      <label className="sig-reason">
        Reason <span className="hint-text">(optional)</span>
        <input value={reason} placeholder="e.g. Approved for construction" onChange={(e) => setReason(e.target.value)} />
      </label>

      <h3>In This Document</h3>
      {!placed.length && <p className="empty">No signatures yet. Choose one above, then click on the page.</p>}
      <ul className="bookmark-list sig-placed">
        {placed.map((m) => {
          const v = validity(m);
          return (
            <li key={m.id}>
              <button className={`bookmark sig-row${selected.has(m.id) ? ' active' : ''}`} onClick={() => onSelect(m)}>
                <span className={`sig-state ${v}`} title={v === 'valid' ? 'Valid: nothing changed since signing' : v === 'modified' ? 'The document changed after this signature was placed' : 'Checking…'}>
                  {v === 'valid' ? '✔' : v === 'modified' ? '!' : '…'}
                </span>
                <span className="sig-row-text">
                  <b>{m.signature?.signer ?? m.author}</b>
                  <span>
                    {m.signature ? new Date(m.signature.signedAt).toLocaleString() : ''} · p. {m.pageIndex + 1}
                  </span>
                  {m.signature?.reason && <span className="sig-row-reason">{m.signature.reason}</span>}
                  <span className={`sig-row-status ${v}`}>{v === 'valid' ? 'Document unchanged since signing' : v === 'modified' ? 'Document modified after signing' : 'Checking…'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {creating && <SignatureDialog author={author} onClose={() => setCreating(false)} />}
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </div>
  );
}
