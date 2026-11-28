/*
 * What the status and tick controls ask the document in front. A file on this device lets anyone
 * who may change it set any status. A server document follows the project's rules, and numbers its
 * comments on the server.
 */

/** What a document whose statuses are shared by a server says about them. */
export interface SharedStatuses {
  /** Whether every one of these markups may be given this status. */
  mayChooseStatus(markupIds: readonly string[], statusId: string): boolean;
  mayTick(): boolean;
  /** What to show as a markup's ID while the server has not numbered it yet, or null. */
  temporaryId(markupId: string): string | null;
}

const shared = (doc: object | null | undefined): SharedStatuses | null =>
  doc && typeof (doc as Partial<SharedStatuses>).mayChooseStatus === 'function' ? (doc as SharedStatuses) : null;

export const mayChooseStatus = (doc: object | null | undefined, markupIds: readonly string[], statusId: string): boolean =>
  shared(doc)?.mayChooseStatus(markupIds, statusId) ?? true;

export const mayTick = (doc: object | null | undefined): boolean => shared(doc)?.mayTick() ?? true;

export const temporaryId = (doc: object | null | undefined, markupId: string): string | null =>
  shared(doc)?.temporaryId(markupId) ?? null;
