/**
 * Putting a document back to what its file holds ("Don't Save", and Discard on the recovered-markups
 * bar). Pure planning, so the choice can be tested without a document.
 */

/** What the app remembers about the last time a document matched its file. */
export interface SavedBase {
  /** The store's edit count at that moment; -1 when the changes came from an earlier session or window. */
  edits: number;
  /** Undo steps there were at that moment, when the document was open then. */
  undo?: number;
}

export type DiscardPlan =
  /** Undo this many of the newest steps: everything done since the document matched its file. */
  | { kind: 'undo'; steps: number }
  /** The undo history cannot say what the file held (an earlier session, or history cleared since): read the markups from the file again. */
  | { kind: 'reread' };

export function planDiscard(base: SavedBase | undefined, undoSteps: number): DiscardPlan {
  if (!base || base.edits < 0 || base.undo === undefined || base.undo > undoSteps) return { kind: 'reread' };
  return { kind: 'undo', steps: undoSteps - base.undo };
}
