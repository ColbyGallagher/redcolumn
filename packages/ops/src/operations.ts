import type { Markup, MarkupType } from '@nb/markup';
import type { ItemRef, PlacementMethod, PlacementState, ResponseKind } from './entities.ts';
import type { ContentKey, GeometryKey, MarkupContent, MarkupGeometry } from './fieldGroups.ts';

/**
 * What a client sends to change something. The server takes the actor from the authenticated
 * connection and the time from its own clock: an operation never carries an author, owner or
 * authoritative time.
 */
export interface Envelope<T extends string, P> {
  /** Unique, made by the client. A retry sends the same id; reusing it with different content is refused. */
  opId: string;
  /** The protocol version the operation was written for (see `protocol.ts`). */
  schemaVersion: number;
  /** The ordered stream it belongs to: a document's, or the project's. */
  streamId: string;
  type: T;
  /** The record it acts on. Made by the client for a new record. */
  entityId: string;
  /**
   * Per group key it changes: the group's confirmed version, or the id of an earlier operation of
   * this client's still pending, so a run of one's own changes never conflicts with itself.
   */
  basedOn?: Record<string, number | string>;
  payload: P;
  /** A batch is applied all or nothing, within one stream. */
  batchId?: string;
  batchSize?: number;
  /** The client's clock, ms since the epoch. Shown for information only. */
  clientTime?: number;
}

type Empty = Record<string, never>;

/** A patch's value: a new value, or null to clear the field. */
type Patch<T> = { [K in keyof T]?: NonNullable<T[K]> | null };

export type MarkupContentPatch = Patch<Omit<Pick<Markup, ContentKey>, 'fields' | 'style'>> & { style?: Markup['style'] };
export type MarkupGeometryPatch = Patch<Omit<Pick<Markup, GeometryKey>, 'points'>> & { points?: Markup['points'] };

export interface MarkupCreate { scopeId: string; type: MarkupType; content: MarkupContent }
export interface MarkupPatch {
  set?: MarkupContentPatch;
  /** Custom columns: per column id, its new value, or null to clear it. */
  fields?: Record<string, string | null>;
}

export interface PlacementCreate {
  markupId: string;
  revisionId: string;
  pageId: string;
  geometry: MarkupGeometry;
  method: PlacementMethod;
  confidence: number | null;
  state: PlacementState;
}
export interface PlacementPatch {
  geometry?: MarkupGeometryPatch;
  /** Group `state`. */
  placed?: { method?: PlacementMethod; confidence?: number | null; state?: PlacementState };
}

export interface IssueCreate {
  scopeId: string;
  title: string;
  /** The status it starts with in the creator's lane. */
  status: string;
  markupIds?: string[];
  originatingReviewId?: string | null;
}
export interface IssuePatch { title?: string; checked?: boolean }
export interface IssueLink { markupId: string }

export interface ResponseCreate {
  parent: { kind: 'markup' | 'issue'; id: string };
  inReplyTo?: string | null;
  answersRev?: number | null;
  kind: ResponseKind;
  body: string;
}
export interface ResponsePatch { body: string }

/** `entityId` is the new status event's id. */
export interface StatusTransition {
  issueId: string;
  /** The status the sender saw. If it has moved since, the change is rejected for them to decide again. */
  from: string | null;
  to: string;
  note?: string | null;
  revisionSeenId?: string | null;
}

/** `entityId` is the new release's id. Releases need a connection: they are never queued offline. */
export interface ReleaseCreate {
  gateId: string | null;
  toLaneIds: string[];
  /** The exact versions previewed. If one has changed since, the release is rejected. */
  items: ItemRef[];
}

export type Operation =
  | Envelope<'markup.create', MarkupCreate>
  | Envelope<'markup.patch', MarkupPatch>
  | Envelope<'markup.delete', Empty>
  | Envelope<'markup.restore', Empty>
  | Envelope<'placement.create', PlacementCreate>
  | Envelope<'placement.patch', PlacementPatch>
  | Envelope<'placement.delete', Empty>
  | Envelope<'placement.restore', Empty>
  | Envelope<'issue.create', IssueCreate>
  | Envelope<'issue.patch', IssuePatch>
  | Envelope<'issue.link', IssueLink>
  | Envelope<'issue.unlink', IssueLink>
  | Envelope<'issue.delete', Empty>
  | Envelope<'issue.restore', Empty>
  | Envelope<'response.create', ResponseCreate>
  | Envelope<'response.patch', ResponsePatch>
  | Envelope<'response.delete', Empty>
  | Envelope<'response.restore', Empty>
  | Envelope<'status.transition', StatusTransition>
  | Envelope<'release.create', ReleaseCreate>;

/** Operations only the server makes; a client sending one is refused by `parseOperation`. */
export type ServerOperation = Envelope<'issue.number', { number: number }>;

export type AnyOperation = Operation | ServerOperation;
export type OperationType = AnyOperation['type'];
export type OperationOf<T extends OperationType> = Extract<AnyOperation, { type: T }>;

