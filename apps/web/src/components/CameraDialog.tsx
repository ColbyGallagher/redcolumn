import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flatSize, guessCorners, warpQuad, type Pt } from '../documents/perspective';
import { settings } from '../settings/settings';

interface Shot {
  id: string;
  image: ImageData;
  preview: string;
  corners: Pt[];
}

interface Props {
  /**
   * The straightened pages with their pixel sizes: JPEG, or PNG when Preferences › Images ›
   * Scanned Colour Images as JPEG is off.
   */
  onDone: (pages: { jpeg?: Uint8Array; png?: Uint8Array; width: number; height: number }[]) => void;
  onCancel: () => void;
}

/**
 * Preferences › Images › Photo Resolution: the camera resolution asked for, and the longest side of
 * a straightened page in pixels (medium is about 200 dpi on letter or A4 paper).
 */
const PHOTO = {
  low: { width: 1920, height: 1080, maxSide: 1600 },
  medium: { width: 3840, height: 2160, maxSide: 2400 },
  high: { width: 4096, height: 3072, maxSide: 3600 },
} as const;
/** Clockwise quarter turns for Preferences › Images › Camera Portrait Orientation. */
const TURNS = { none: 0, rotate90: 1, rotate180: 2, rotate270: 3 } as const;

/**
 * File › Create › From Camera: photograph pages with the device camera, adjust each page's four
 * corners (found automatically where the paper stands out), and make a PDF of the straightened pages.
 */
export function CameraDialog({ onDone, onCancel }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: PHOTO[settings.get().photoResolution].width }, height: { ideal: PHOTO[settings.get().photoResolution].height } } })
      .then((s) => {
        live = s;
        setStream(s);
        if (video.current) video.current.srcObject = s;
      })
      .catch((err: Error) => setError(err.name === 'NotAllowedError' ? 'The camera is blocked for this site.' : `No camera: ${err.message}`));
    if (!navigator.mediaDevices) setError('This browser has no camera access.');
    return () => live?.getTracks().forEach((t) => t.stop());
  }, []);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // A portrait photo (taller than wide) is turned as Camera Portrait Orientation says.
    const turns = v.videoHeight > v.videoWidth ? TURNS[settings.get().cameraOrientation] : 0;
    const canvas = document.createElement('canvas');
    canvas.width = turns % 2 ? v.videoHeight : v.videoWidth;
    canvas.height = turns % 2 ? v.videoWidth : v.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(v, -v.videoWidth / 2, -v.videoHeight / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const shot: Shot = { id: crypto.randomUUID(), image, preview: canvas.toDataURL('image/jpeg', 0.6), corners: guessCorners(image) };
    setShots((s) => [...s, shot]);
    setEditing(shot.id);
  };

  const finish = async () => {
    setBusy(true);
    try {
      const pages: { jpeg?: Uint8Array; png?: Uint8Array; width: number; height: number }[] = [];
      const { photoResolution, scannedJpeg } = settings.get();
      for (const s of shots) {
        let { width, height } = flatSize(s.corners);
        const k = Math.min(1, PHOTO[photoResolution].maxSide / Math.max(width, height));
        width = Math.max(1, Math.round(width * k));
        height = Math.max(1, Math.round(height * k));
        const flat = warpQuad(s.image, s.corners, width, height);
        const canvas = new OffscreenCanvas(width, height);
        canvas.getContext('2d')!.putImageData(flat, 0, 0);
        const blob = await canvas.convertToBlob(scannedJpeg ? { type: 'image/jpeg', quality: 0.85 } : { type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        pages.push({ ...(scannedJpeg ? { jpeg: bytes } : { png: bytes }), width, height });
      }
      onDone(pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const current = shots.find((s) => s.id === editing) ?? null;
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal camera-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Create PDF from Camera</h3>
        {error && <p className="error-text">{error}</p>}
        <div className="camera-body">
          {current ? (
            <CornerEditor shot={current} onChange={(corners) => setShots((all) => all.map((s) => (s.id === current.id ? { ...s, corners } : s)))} />
          ) : (
            <video
              ref={(el) => {
                video.current = el;
                // The preview comes back after adjusting a photo's corners.
                if (el && stream && el.srcObject !== stream) el.srcObject = stream;
              }}
              autoPlay
              playsInline
              muted
              className="camera-video"
            />
          )}
        </div>
        <div className="camera-strip">
          {shots.map((s, i) => (
            <button key={s.id} className={`camera-thumb${s.id === editing ? ' active' : ''}`} onClick={() => setEditing(s.id === editing ? null : s.id)} title={`Page ${i + 1}: adjust its corners`}>
              <img src={s.preview} alt={`Page ${i + 1}`} />
              <span>{i + 1}</span>
            </button>
          ))}
        </div>
        <p className="pref-hint">{current ? 'Drag the corners onto the corners of the page, then take the next photo or create the PDF.' : 'Point the camera at a page and take a photo; add as many pages as you like.'}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          {current && (
            <button type="button" className="btn" onClick={() => {
              setShots((all) => all.filter((s) => s.id !== current.id));
              setEditing(null);
            }}>
              Delete Page
            </button>
          )}
          <button type="button" className="btn" disabled={!stream} onClick={() => (current ? setEditing(null) : capture())}>
            {current ? 'Next Photo' : '● Take Photo'}
          </button>
          <button type="button" className="btn primary" disabled={!shots.length || busy} onClick={() => void finish()}>
            {busy ? 'Working…' : `Create PDF (${shots.length} page${shots.length === 1 ? '' : 's'})`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A photo with its four corner handles to drag onto the page's corners. */
function CornerEditor({ shot, onChange }: { shot: Shot; onChange: (corners: Pt[]) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const { width: w, height: h } = shot.image;
  const drag = (i: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(w, ((ev.clientX - r.left) / r.width) * w));
      const y = Math.max(0, Math.min(h, ((ev.clientY - r.top) / r.height) * h));
      onChange(shot.corners.map((c, k) => (k === i ? [x, y] : c)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="corner-editor" ref={box} style={{ aspectRatio: `${w} / ${h}` }}>
      <img src={shot.preview} alt="Photo" draggable={false} />
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polygon points={shot.corners.map((c) => c.join(',')).join(' ')} />
      </svg>
      {shot.corners.map((c, i) => (
        <span key={i} className="corner-handle" style={{ left: `${(c[0] / w) * 100}%`, top: `${(c[1] / h) * 100}%` }} onPointerDown={drag(i)} />
      ))}
    </div>
  );
}
