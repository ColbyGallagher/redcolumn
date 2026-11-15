// The box around a selected group: eight handles that stretch or scale every member together and a
// knob above it that turns them all. The box turns with the group (`GroupFrame.angle`), so the knob
// stays where the pointer is while turning. Pure geometry here; MarkupTools owns the gestures.
import { boundsOf, compose, markupBounds, rotatePoint, rotationAbout, ROTATABLE, rotationCentre, type Affine, type Markup, type Point, type Rect } from '@nb/markup';

export type GroupHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

/** Where the turn knob sits above the box, in screen pixels. */
const KNOB_PX = 22;
/** The smallest a group may be squeezed to, as a fraction of its size. */
const MIN_SCALE = 0.01;

/** A group's box: its middle `c`, size, and the angle in degrees clockwise it is turned. */
export interface GroupFrame {
  c: Point;
  w: number;
  h: number;
  angle: number;
}

/** The box as if it were not turned, about the same middle. */
export const frameRect = (f: GroupFrame): Rect => ({ x: f.c[0] - f.w / 2, y: f.c[1] - f.h / 2, w: f.w, h: f.h });

/** A page point in the box's own (unturned) frame. */
const toLocal = (f: GroupFrame, p: Point): Point => (f.angle ? rotatePoint(p, f.c, -f.angle) : p);
const toPage = (f: GroupFrame, p: Point): Point => (f.angle ? rotatePoint(p, f.c, f.angle) : p);

/** The points that outline a member as it lies on the page: its box's turned corners, or its vertices. */
function outlinePoints(m: Markup): Point[] {
  const b = markupBounds({ ...m, rotation: 0 });
  const corners: Point[] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  if (m.rotation) {
    const c = rotationCentre(m);
    return corners.map((p) => rotatePoint(p, c, m.rotation!));
  }
  // Boxes and anything curved or decorated: the axis-aligned bounds hold it; plain paths are their vertices.
  return m.points.length <= 2 || ROTATABLE.has(m.type) ? corners : [...m.points, ...(m.holes?.flat() ?? [])];
}

/** The tightest box turned `angle` that holds every member (strokes included). */
export function groupFrame(ms: readonly Markup[], angle: number): GroupFrame {
  if (!angle) {
    const b = boundsOf(
      ms.flatMap((m) => {
        const r = markupBounds(m);
        return [
          [r.x, r.y],
          [r.x + r.w, r.y + r.h],
        ] as Point[];
      }),
    );
    return { c: [b.x + b.w / 2, b.y + b.h / 2], w: b.w, h: b.h, angle: 0 };
  }
  const pad = Math.max(0, ...ms.map((m) => (m.style.width ?? 0) / 2));
  const local = boundsOf(ms.flatMap(outlinePoints).map((p) => rotatePoint(p, [0, 0], -angle)));
  const mid = rotatePoint([local.x + local.w / 2, local.y + local.h / 2], [0, 0], angle);
  return { c: mid, w: local.w + pad * 2, h: local.h + pad * 2, angle };
}

/** Each handle's place on the page; `zoom` (screen px per point) keeps the knob's reach constant on screen. */
export function groupHandles(f: GroupFrame, zoom: number): { id: GroupHandle; at: Point }[] {
  const b = frameRect(f);
  const mx = b.x + b.w / 2;
  const my = b.y + b.h / 2;
  const r = b.x + b.w;
  const bt = b.y + b.h;
  const local: { id: GroupHandle; at: Point }[] = [
    { id: 'nw', at: [b.x, b.y] },
    { id: 'n', at: [mx, b.y] },
    { id: 'ne', at: [r, b.y] },
    { id: 'e', at: [r, my] },
    { id: 'se', at: [r, bt] },
    { id: 's', at: [mx, bt] },
    { id: 'sw', at: [b.x, bt] },
    { id: 'w', at: [b.x, my] },
    { id: 'rotate', at: [mx, b.y - KNOB_PX / zoom] },
  ];
  return local.map(({ id, at }) => ({ id, at: toPage(f, at) }));
}

/** True if the box has nothing to stretch along that handle's axis. */
const flat = (id: GroupHandle, f: GroupFrame) => ((id === 'e' || id === 'w') && f.w < 1e-6) || ((id === 'n' || id === 's') && f.h < 1e-6);

/** The handle under `p` (within `tol` points), the knob and corners winning over the edge middles. */
export function groupHandleAt(f: GroupFrame, zoom: number, p: Point, tol: number): GroupHandle | null {
  const hits = groupHandles(f, zoom).filter(({ id, at }) => !flat(id, f) && Math.hypot(at[0] - p[0], at[1] - p[1]) <= (id === 'rotate' ? tol * 1.5 : tol));
  const order: GroupHandle[] = ['rotate', 'nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];
  return order.find((id) => hits.some((h) => h.id === id)) ?? null;
}

/** True if `p` is on the box's outline (within `tol`) rather than inside it or away from it. */
export function onGroupOutline(f: GroupFrame, p: Point, tol: number): boolean {
  const b = frameRect(f);
  const [x, y] = toLocal(f, p);
  const inside = x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
  if (!inside) return false;
  return Math.min(Math.abs(x - b.x), Math.abs(x - (b.x + b.w)), Math.abs(y - b.y), Math.abs(y - (b.y + b.h))) <= tol;
}

const clamp = (k: number) => (Math.abs(k) < MIN_SCALE ? MIN_SCALE : Math.abs(k));

/**
 * What a drag of `handle` to `p` does to the group (`f` is its box when the drag began): the transform
 * to apply and the angle the box ends up at. The knob turns the group about the middle of the box so
 * the knob points at the pointer; Shift snaps the box's angle to 15° steps. An edge handle stretches
 * along its (turned) axis; a corner scales evenly about the opposite corner, or freely with Shift.
 * Null for a degenerate drag.
 */
export function groupAffine(handle: GroupHandle, f: GroupFrame, p: Point, shift: boolean): { t: Affine; angle: number } | null {
  const [cx, cy] = f.c;
  if (handle === 'rotate') {
    // The knob sits above the box, so pointing straight up is angle 0 (the box's angle is where the knob points).
    let angle = (Math.atan2(p[1] - cy, p[0] - cx) * 180) / Math.PI + 90;
    angle = ((((angle + 180) % 360) + 360) % 360) - 180;
    // Near a right angle or a step of 15° it settles there; Shift forces the steps.
    const step = Math.round(angle / 15) * 15;
    angle = shift || Math.abs(angle - step) < 2 ? step : Math.round(angle * 10) / 10;
    return { t: rotationAbout(f.c, angle - f.angle), angle };
  }
  const b = frameRect(f);
  const [px, py] = toLocal(f, p);
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  // The fixed point is the opposite edge or corner.
  const ax = west ? b.x + b.w : east ? b.x : cx;
  const ay = north ? b.y + b.h : south ? b.y : cy;
  const dragsX = west || east;
  const dragsY = north || south;
  const fromX = (west ? b.x : b.x + b.w) - ax;
  const fromY = (north ? b.y : b.y + b.h) - ay;
  let sx = dragsX && Math.abs(fromX) > 1e-6 ? clamp((px - ax) / fromX) : 1;
  let sy = dragsY && Math.abs(fromY) > 1e-6 ? clamp((py - ay) / fromY) : 1;
  if (dragsX && dragsY && !shift) {
    // Evenly: how far the pointer is along the diagonal, as a fraction of it.
    const len2 = fromX * fromX + fromY * fromY;
    if (len2 < 1e-12) return null;
    const k = clamp(((px - ax) * fromX + (py - ay) * fromY) / len2);
    sx = k;
    sy = k;
  }
  const scale: Affine = { a: sx, b: 0, c: 0, d: sy, e: ax * (1 - sx), f: ay * (1 - sy) };
  // Worked in the box's own frame, then turned back onto the page.
  const t = f.angle ? compose(rotationAbout(f.c, f.angle), compose(scale, rotationAbout(f.c, -f.angle))) : scale;
  return { t, angle: f.angle };
}

/** Draws the group's box (turned with it), its eight handles and the turn knob; thin outlines on its members while upright. */
export function drawGroupBox(ctx: CanvasRenderingContext2D, members: readonly Markup[], f: GroupFrame, zoom: number, handlePx: number, handles: boolean) {
  const px = 1 / zoom;
  ctx.save();
  ctx.lineWidth = px;
  if (!f.angle) {
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.55)';
    ctx.setLineDash([2 * px, 2 * px]);
    for (const m of members) {
      const mb = markupBounds(m);
      ctx.strokeRect(mb.x, mb.y, mb.w, mb.h);
    }
  }
  ctx.translate(f.c[0], f.c[1]);
  ctx.rotate((f.angle * Math.PI) / 180);
  ctx.translate(-f.c[0], -f.c[1]);
  const b = frameRect(f);
  ctx.strokeStyle = '#3b82f6';
  ctx.setLineDash(handles ? [] : [4 * px, 3 * px]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  if (handles) {
    ctx.fillStyle = '#fff';
    const h = handlePx * px;
    // Drawn in the turned frame, so the handles are laid out as on an upright box.
    const upright = groupHandles({ ...f, angle: 0 }, zoom);
    for (const { id, at } of upright) {
      if (flat(id, f)) continue;
      if (id === 'rotate') {
        ctx.beginPath();
        ctx.moveTo(b.x + b.w / 2, b.y);
        ctx.lineTo(at[0], at[1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(at[0], at[1], 4 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (id.length === 2) {
        // Corners are round and the middles of the edges square, as on a single box.
        ctx.beginPath();
        ctx.arc(at[0], at[1], h / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(at[0] - h / 2, at[1] - h / 2, h, h);
        ctx.strokeRect(at[0] - h / 2, at[1] - h / 2, h, h);
      }
    }
  }
  ctx.restore();
}
