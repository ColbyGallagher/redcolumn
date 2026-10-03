import { polygonArea, polygonCentroid } from '@nb/measure';
import { pointInPolygon } from './geometry';
import { boundsOf, type Markup, type Point } from './model';

/**
 * Spaces are named regions of a page (rooms, zones, levels). A markup belongs to every Space
 * containing its reference point; Spaces nest by the same rule, so a room sits inside its floor.
 */
export const isSpace = (m: Pick<Markup, 'type'>): boolean => m.type === 'space';

/** A Space's name (its subject), or "Space" when it has none. */
export const spaceName = (s: Pick<Markup, 'subject'>): string => s.subject?.trim() || 'Space';

/** The point that decides which Spaces a markup is in. */
function referencePoint(m: Markup): Point | null {
  if (!m.points.length) return null;
  if (m.type === 'count') return m.points[0]!;
  if (m.type === 'space' || m.type === 'area' || m.type === 'volume' || m.type === 'polygon' || m.type === 'perimeter') {
    const [x, y] = polygonCentroid(m.points);
    return [x, y];
  }
  const b = boundsOf(m.points);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** Spaces on the markup's page that contain it, outermost first. A Space is not in itself. */
export function spacesContaining(m: Markup, spaces: readonly Markup[]): Markup[] {
  const p = referencePoint(m);
  if (!p) return [];
  return spaces
    .filter((s) => s.id !== m.id && isSpace(s) && s.pageIndex === m.pageIndex && s.points.length > 2 && pointInPolygon(p, s.points))
    .filter((s) => !isSpace(m) || polygonArea(s.points) > polygonArea(m.points))
    .sort((a, b) => polygonArea(b.points) - polygonArea(a.points));
}

/** The innermost Space containing a markup, or null. */
export function spaceOf(m: Markup, spaces: readonly Markup[]): Markup | null {
  return spacesContaining(m, spaces).at(-1) ?? null;
}

/** The chain of Spaces containing a markup, e.g. "Level 1 › Room 101". */
export function spacePath(m: Markup, spaces: readonly Markup[]): string {
  return spacesContaining(m, spaces).map(spaceName).join(' › ');
}

/** Spaces on a page as a tree (outermost first), each with its depth. */
export function spaceTree(spaces: readonly Markup[]): { space: Markup; depth: number }[] {
  const list = spaces.filter(isSpace);
  const parentOf = new Map(list.map((s) => [s.id, spaceOf(s, list)?.id ?? null]));
  const out: { space: Markup; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const s of list.filter((x) => parentOf.get(x.id) === parent).sort((a, b) => a.pageIndex - b.pageIndex || spaceName(a).localeCompare(spaceName(b), undefined, { numeric: true }))) {
      out.push({ space: s, depth });
      visit(s.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
