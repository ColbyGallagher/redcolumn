import { useEffect, useRef, useState } from 'react';

interface Props {
  /** The recording, to place as a sound note. */
  onDone: (file: File) => void;
  onCancel: () => void;
}

/** Longest recording, in seconds (sound notes are saved inside the PDF). */
const MAX_SECONDS = 300;

/** Tools › Sound: records an audio note from the microphone, to place on the page as a File Attachment. */
export function SoundDialog({ onDone, onCancel }: Props) {
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef(0);

  useEffect(
    () => () => {
      clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => () => void (clip && URL.revokeObjectURL(clip.url)), [clip]);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer.current);
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        setClip({ blob, url: URL.createObjectURL(blob) });
        setState('done');
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setState('recording');
      const began = Date.now();
      timer.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - began) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS && rec.state === 'recording') rec.stop();
      }, 250);
    } catch (err) {
      setError(err instanceof Error && err.name === 'NotAllowedError' ? 'The microphone is blocked for this site.' : `Recording failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const place = () => {
    if (!clip) return;
    const ext = clip.blob.type.includes('ogg') ? 'ogg' : clip.blob.type.includes('mp4') ? 'm4a' : 'webm';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
    onDone(new File([clip.blob], `Sound note ${stamp}.${ext}`, { type: clip.blob.type }));
  };

  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Sound</h3>
        <p>Record a spoken note. It is placed on the page as a file attachment; double-click it to play it back.</p>
        <div className="sound-controls">
          {state === 'recording' ? (
            <button className="btn primary" onClick={() => recorder.current?.stop()}>
              ■ Stop ({time})
            </button>
          ) : (
            <button className="btn" onClick={() => void start()}>
              ● {state === 'done' ? 'Record again' : 'Record'}
            </button>
          )}
          {clip && state === 'done' && <audio controls src={clip.url} />}
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!clip || state !== 'done'} onClick={place}>
            Place on Page
          </button>
        </div>
      </div>
    </div>
  );
}
