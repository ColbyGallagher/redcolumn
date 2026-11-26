import { useState, useSyncExternalStore } from 'react';
import type { CornerDirection, ViewDirection } from '@nb/model3d';
import type { ModelView } from '../documents/openTabs';

type Face = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

const FACES: { dir: Face; label: string; transform: string }[] = [
  { dir: 'top', label: 'Top', transform: 'rotateX(90deg)' },
  { dir: 'bottom', label: 'Bottom', transform: 'rotateX(-90deg)' },
  { dir: 'front', label: 'S', transform: '' },
  { dir: 'back', label: 'N', transform: 'rotateY(180deg)' },
  { dir: 'right', label: 'E', transform: 'rotateY(90deg)' },
  { dir: 'left', label: 'W', transform: 'rotateY(-90deg)' },
];

/** How each face's rotation turns a point on it (CSS axes: x right, y down, z toward the viewer). */
const ROTATE: Record<Face, (v: [number, number, number]) => [number, number, number]> = {
  top: ([x, y, z]) => [x, -z, y],
  bottom: ([x, y, z]) => [x, z, -y],
  front: (v) => v,
  back: ([x, y, z]) => [-x, y, -z],
  right: ([x, y, z]) => [z, y, -x],
  left: ([x, y, z]) => [-z, y, x],
};

const CORNER_NAMES: Record<CornerDirection, string> = {
  'top-ne': 'Top north-east',
  'top-nw': 'Top north-west',
  'top-se': 'Top south-east',
  'top-sw': 'Top south-west',
  'bottom-ne': 'Bottom north-east',
  'bottom-nw': 'Bottom north-west',
  'bottom-se': 'Bottom south-east',
  'bottom-sw': 'Bottom south-west',
};

/**
 * The cube corner a face's corner is on: `u` and `v` are -1 or 1 across and down the face. In the
 * scene up is +Y (CSS -y), east +X (CSS +x) and south +Z (CSS +z, the S face toward the viewer).
 */
export function cornerOf(face: Face, u: -1 | 1, v: -1 | 1): CornerDirection {
  const [x, y, z] = ROTATE[face]([u, v, 1]);
  return `${y < 0 ? 'top' : 'bottom'}-${z > 0 ? 's' : 'n'}${x > 0 ? 'e' : 'w'}` as CornerDirection;
}

const CORNERS: { u: -1 | 1; v: -1 | 1; pos: string }[] = [
  { u: -1, v: -1, pos: 'tl' },
  { u: 1, v: -1, pos: 'tr' },
  { u: -1, v: 1, pos: 'bl' },
  { u: 1, v: 1, pos: 'br' },
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
 * north and up. Clicking a face looks from that side; clicking one of the cube's eight corners looks
 * from that corner (an isometric view from above or below), and the button under it gives the usual
 * isometric view.
 */
export function ViewCube({ view }: { view: ModelView }) {
  const [hot, setHot] = useState<CornerDirection | null>(null);
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
          <div key={f.dir} className={`view-cube-face ${f.dir}`} style={{ transform: `${f.transform} translateZ(24px)` }}>
            <button type="button" className="view-cube-side" title={`${f.dir[0]!.toUpperCase()}${f.dir.slice(1)} view`} onClick={() => look(f.dir)}>
              {f.label}
            </button>
            {CORNERS.map((c) => {
              const corner = cornerOf(f.dir, c.u, c.v);
              return (
                <button
                  key={c.pos}
                  type="button"
                  className={`view-cube-corner ${c.pos}${hot === corner ? ' hot' : ''}`}
                  data-corner={corner}
                  title={`${CORNER_NAMES[corner]} isometric view`}
                  aria-label={`${CORNER_NAMES[corner]} isometric view`}
                  onPointerEnter={() => setHot(corner)}
                  onPointerLeave={() => setHot((h) => (h === corner ? null : h))}
                  onClick={() => look(corner)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <button type="button" className="view-cube-iso" title="Isometric view" onClick={() => look('iso')}>
        ⌂
      </button>
    </div>
  );
}
