import type { Point } from './model';

/** Same shape as pdf-core's PageOp (kept structural so this package does not depend on it). */
export type PageOperation =
  | { type: 'rotate'; pages: number[]; quarterTurns: number }
  | { type: 'delete'; pages: number[] }
  | { type: 'move'; pages: number[]; to: number }
  | { type: 'insert'; source: number; at: number }
  | { type: 'blank'; at: number; count: number; width: number; height: number };

export interface PagePlan {
  /** New index of each original page, or null if it was deleted. */
  oldToNew: (number | null)[];
  /** Clockwise quarter turns applied to each original page (0..3). */
  turns: number[];
  newCount: number;
}

/**
 * Works out where every page ends up after a list of page operations, mirroring PDFium's
 * semantics (FPDF_MovePages places the moved pages, in the given order, starting at `to` in the
 * resulting document). `insertCounts[i]` is the page count of inserted document i.
 */
export function planPageOps(pageCount: number, ops: readonly PageOperation[], insertCounts: readonly number[] = []): PagePlan {
  let order: { old: number | null; turns: number }[] = Array.from({ length: pageCount }, (_, i) => ({ old: i, turns: 0 }));
  for (const op of ops) {
    switch (op.type) {
      case 'rotate':
        for (const i of op.pages) if (order[i]) order[i]!.turns = (((order[i]!.turns + op.quarterTurns) % 4) + 4) % 4;
        break;
      case 'delete': {
        const drop = new Set(op.pages);
        order = order.filter((_, i) => !drop.has(i));
        break;
      }
      case 'move': {
        const moving = op.pages.map((i) => order[i]!);
        const rest = order.filter((_, i) => !op.pages.includes(i));
        rest.splice(op.to, 0, ...moving);
        order = rest;
        break;
      }
      case 'insert':
        order.splice(op.at, 0, ...Array.from({ length: insertCounts[op.source] ?? 0 }, () => ({ old: null, turns: 0 })));
        break;
      case 'blank':
        order.splice(op.at, 0, ...Array.from({ length: op.count }, () => ({ old: null, turns: 0 })));
        break;
    }
  }
  const oldToNew: (number | null)[] = Array.from({ length: pageCount }, () => null);
  const turns = Array.from({ length: pageCount }, () => 0);
  order.forEach((e, newIndex) => {
    if (e.old === null) return;
    oldToNew[e.old] = newIndex;
    turns[e.old] = e.turns;
  });
  return { oldToNew, turns, newCount: order.length };
}

/**
 * Maps a point in a page's displayed space through clockwise quarter turns of that page.
 * `width`/`height` are the page's displayed size before rotating.
 */
export function rotatePagePoint([x, y]: Point, width: number, height: number, turns: number): Point {
  let p: Point = [x, y];
  let w = width;
  let h = height;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    // One quarter turn clockwise: the left edge becomes the top.
    p = [h - p[1], p[0]];
    [w, h] = [h, w];
  }
  return p;
}
