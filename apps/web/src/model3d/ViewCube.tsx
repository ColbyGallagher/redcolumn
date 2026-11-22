import { useSyncExternalStore } from 'react';
import type { ViewDirection } from '@nb/model3d';
import type { ModelView } from '../documents/openTabs';

const FACES: { dir: ViewDirection; label: string; transform: string }[] = [
  { dir: 'top', label: 'Top', transform: 'rotateX(90deg)' },
  { dir: 'bottom', label: 'Bottom', transform: 'rotateX(-90deg)' },
  { dir: 'front', label: 'S', transform: '' },
  { dir: 'back', label: 'N', transform: 'rotateY(180deg)' },
  { dir: 'right', label: 'E', transform: 'rotateY(90deg)' },
  { dir: 'left', label: 'W', transform: 'rotateY(-90deg)' },
];

/**
 * The cube's CSS rotation for a camera yaw and pitch (radians), so the face toward the camera is the
 * side it looks from: looking north shows S, looking east shows W, looking down shows Top.
 */
export function cubeTransform(yaw: number, pitch: number): string {
  const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 10) / 10 || 0;
  return `rotateX(${deg(pitch)}deg) rotateY(${deg(yaw)}deg)`;
}

/**
 * A small cube in the corner of the 3D view that turns with the camera, so it is clear which way is
 * north and up; clicking a face looks from that side, and the corner button gives an isometric view.
 */
export function ViewCube({ view }: { view: ModelView }) {
  const key = useSyncExternalStore(view.subscribe, () => {
    const o = view.controls()?.orientation();
    return o ? cubeTransform(o.yaw, o.pitch) : '';
  });
  if (!key) return null;
  const look = (direction: ViewDirection) => view.controls()?.run({ type: 'direction', direction });
  return (
    <div className="view-cube" aria-label="View cube">
      <div className="view-cube-body" style={{ transform: `translateZ(-24px) ${key}` }}>
        {FACES.map((f) => (
          <button key={f.dir} type="button" className={`view-cube-face ${f.dir}`} style={{ transform: `${f.transform} translateZ(24px)` }} title={`${f.dir[0]!.toUpperCase()}${f.dir.slice(1)} view`} onClick={() => look(f.dir)}>
            {f.label}
          </button>
        ))}
      </div>
      <button type="button" className="view-cube-iso" title="Isometric view" onClick={() => look('iso')}>
        ⌂
      </button>
    </div>
  );
}
