import { useEffect, useRef, useState } from 'react';
import { settings } from '../settings/settings';

interface Props {
  /** A spoken note, or a video (with sound) from the camera. */
  kind?: 'sound' | 'video';
  /** The recording, to place as a note. */
  onDone: (file: File) => void;
  onCancel: () => void;
}

/** Longest recording, in seconds (notes are saved inside the PDF). */
const MAX_SECONDS = { sound: 300, video: 120 } as const;
/** Preferences › Images › Video Resolution: the camera resolution asked for. */
const VIDEO = { low: { width: 640, height: 480 }, medium: { width: 1280, height: 720 }, high: { width: 1920, height: 1080 } } as const;

/**
 * Tools › Sound and Tools › Video: records a note from the microphone (and camera), to place on the
 * page as a File Attachment.
 */
export function SoundDialog({ kind = 'sound', onDone, onCancel }: Props) {
  const video = kind === 'video';
  const live = useRef<HTMLVideoElement>(null);
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
      const size = VIDEO[settings.get().videoResolution];
      const stream = await navigator.mediaDevices.getUserMedia(video ? { audio: true, video: { facingMode: 'environment', width: { ideal: size.width }, height: { ideal: size.height } } } : { audio: true });
      if (live.current) live.current.srcObject = stream;
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer.current);
        if (live.current) live.current.srcObject = null;
        const blob = new Blob(chunks, { type: rec.mimeType || (video ? 'video/webm' : 'audio/webm') });
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
        if (s >= MAX_SECONDS[kind] && rec.state === 'recording') rec.stop();
      }, 250);
    } catch (err) {
      setError(err instanceof Error && err.name === 'NotAllowedError' ? `The ${video ? 'camera' : 'microphone'} is blocked for this site.` : `Recording failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const place = () => {
    if (!clip) return;
    const ext = clip.blob.type.includes('ogg') ? 'ogg' : clip.blob.type.includes('mp4') ? (video ? 'mp4' : 'm4a') : 'webm';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
    onDone(new File([clip.blob], `${video ? 'Video' : 'Sound'} note ${stamp}.${ext}`, { type: clip.blob.type }));
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
        <h3>{video ? 'Video' : 'Sound'}</h3>
        <p>Record a {video ? 'video' : 'spoken note'}. It is placed on the page as a file attachment; double-click it to play it back.</p>
        {video && state !== 'done' && <video ref={live} className="camera-video" autoPlay playsInline muted />}
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
          {clip && state === 'done' && (video ? <video className="camera-video" controls src={clip.url} /> : <audio controls src={clip.url} />)}
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
