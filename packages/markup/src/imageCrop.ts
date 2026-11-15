import type { Axis } from './arrange';
import { boundsOf, rotatePoint, rotationCentre, type ImageCrop, type Markup, type Point, type Rect } from './model';

/**
 * Crop Image keeps the whole picture and records the part shown (`Markup.crop`), so a crop can be
 * reset or redone wider later. The box shrinks to the part kept, which keeps every other tool
 * (move, resize, rotate, snap, hit testing) working on what the person sees. Drawing on screen and
 * in the PDF both go through `imageFrame`: the whole picture placed where it would be uncropped,
 * clipped to the box.
 */

/** Smallest crop kept, as a fraction of the picture; anything thinner is a slip of the mouse. */
const MIN_FRACTION = 1e-3;
/** A crop this close to the whole picture is no crop. */
const WHOLE = 1e-6;

/** The markup's crop, or null when it shows the whole picture (or the crop is not usable). */
export function cropOf(m: Pick<Markup, 'crop'>): ImageCrop | null {
  const c = m.crop;
  if (!c || ![c.x, c.y, c.w, c.h].every(Number.isFinite)) return null;
  if (c.w < MIN_FRACTION || c.h < MIN_FRACTION || c.x < -WHOLE || c.y < -WHOLE || c.x + c.w > 1 + WHOLE || c.y + c.h > 1 + WHOLE) return null;
  if (c.x <= WHOLE && c.y <= WHOLE && c.w >= 1 - WHOLE && c.h >= 1 - WHOLE) return null;
  return c;
}

/**
 * Where to draw a markup's picture: `full` is the whole picture's rectangle and `clip` the box it is
 * cut to, both in the markup's own unrotated frame (page points, y down). Uncropped, they match.
 */
export function imageFrame(m: Pick<Markup, 'points' | 'crop'>): { clip: Rect; full: Rect } {
  const clip = boundsOf(m.points);
  const c = cropOf(m);
  if (!c) return { clip, full: clip };
  const w = clip.w / c.w;
  const h = clip.h / c.h;
  return { clip, full: { x: clip.x - c.x * w, y: clip.y - c.y * h, w, h } };
}

/**
 * The box `local` (in the markup's unrotated frame) as two page points, keeping a rotated markup's
 * picture where it was: the box turns about its own centre, so that centre is moved to where the
 * old rotation puts it.
 */
function placeBox(m: Pick<Markup, 'type' | 'points' | 'rotation'>, local: Rect): [Point, Point] {
  let cx = local.x + local.w / 2;
  let cy = local.y + local.h / 2;
  if (m.rotation) [cx, cy] = rotatePoint([cx, cy], rotationCentre(m), m.rotation);
  return [
    [cx - local.w / 2, cy - local.h / 2],
    [cx + local.w / 2, cy + local.h / 2],
  ];
}

/**
 * The change that crops an image to the part between two page points (the corners of a box drawn
 * over it), on top of any crop it already has. Null when the box misses the picture or leaves too
 * little of it. A rotated image is cropped in its own frame: the box's corners are turned back
 * with it first.
 */
export function cropImage(m: Markup, a: Point, b: Point): Pick<Markup, 'points' | 'crop'> | null {
  if (!m.image) return null;
  const box = boundsOf(m.points);
  if (box.w <= 0 || box.h <= 0) return null;
  const c = rotationCentre(m);
  const [ua, ub] = m.rotation ? [rotatePoint(a, c, -m.rotation), rotatePoint(b, c, -m.rotation)] : [a, b];
  const x0 = Math.max(box.x, Math.min(ua[0], ub[0]));
  const y0 = Math.max(box.y, Math.min(ua[1], ub[1]));
  const x1 = Math.min(box.x + box.w, Math.max(ua[0], ub[0]));
  const y1 = Math.min(box.y + box.h, Math.max(ua[1], ub[1]));
  const kept: Rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const was = cropOf(m) ?? { x: 0, y: 0, w: 1, h: 1 };
  const crop: ImageCrop = {
    x: was.x + ((kept.x - box.x) / box.w) * was.w,
    y: was.y + ((kept.y - box.y) / box.h) * was.h,
    w: (kept.w / box.w) * was.w,
    h: (kept.h / box.h) * was.h,
  };
  if (!(crop.w >= MIN_FRACTION && crop.h >= MIN_FRACTION)) return null;
  return { points: placeBox(m, kept), crop: cropOf({ crop }) ?? undefined };
}

/** The change that shows a cropped image whole again, at the same size and place. Null when it is not cropped. */
export function uncropImage(m: Markup): Pick<Markup, 'points' | 'crop'> | null {
  if (!cropOf(m)) return null;
  return { points: placeBox(m, imageFrame(m).full), crop: undefined };
}

/** A crop on a picture that has been mirrored across `axis` (Flip), so the same part stays shown. */
export function mirrorCrop(c: ImageCrop, axis: Axis): ImageCrop {
  return axis === 'horizontal' ? { ...c, x: 1 - c.x - c.w } : { ...c, y: 1 - c.y - c.h };
}
