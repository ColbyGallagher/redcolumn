/**
 * Touch gestures on the drawing, as plain functions the viewer calls: two-finger pinch and pan,
 * long press, and which touches to ignore while a pen is in use.
 */

export type Pt = { x: number; y: number };

/** How long a finger must stay put to open the context menu, and how far it may drift. */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP_PX = 10;

/**
 * One step of a two-finger gesture, from the fingers' last positions to their new ones: zoom by
 * `scale` about the new midpoint, after moving by (`dx`, `dy`) with the midpoint.
 */
export function pinchStep(from: readonly [Pt, Pt], to: readonly [Pt, Pt]): { scale: number; cx: number; cy: number; dx: number; dy: number } {
  const d0 = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const d1 = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  const m0 = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 };
  const m1 = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  // Fingers almost together give an unstable ratio; hold the zoom then.
  const scale = d0 > 8 && d1 > 8 ? d1 / d0 : 1;
  return { scale, cx: m1.x, cy: m1.y, dx: m1.x - m0.x, dy: m1.y - m0.y };
}

/**
 * Applies pinch steps to a simple view (screen = pan + page × zoom), for tests and as the
 * definition of what the viewer does: the page point under the fingers stays under them.
 */
export function applyPinch(view: { zoom: number; panX: number; panY: number }, step: ReturnType<typeof pinchStep>) {
  const panX = view.panX + step.dx;
  const panY = view.panY + step.dy;
  return { zoom: view.zoom * step.scale, panX: step.cx - (step.cx - panX) * step.scale, panY: step.cy - (step.cy - panY) * step.scale };
}

/**
 * Palm rejection: while a pen is on (or just left) the screen, touches are ignored, and once a pen
 * has been used a single finger navigates rather than draws, so a resting hand never marks up.
 */
export class PenGuard {
  private down = false;
  private lastPen = -Infinity;
  /** A pen has been used on this canvas: fingers pan and pinch, the pen draws. */
  penUsed = false;
  pen(event: 'down' | 'move' | 'up', now: number) {
    this.penUsed = true;
    this.lastPen = now;
    if (event === 'down') this.down = true;
    if (event === 'up') this.down = false;
  }
  /** Whether a touch that starts now is a palm (ignored). */
  rejects(now: number): boolean {
    return this.down || now - this.lastPen < 300;
  }
}
