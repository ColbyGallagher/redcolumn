import type { MarkupType } from '@nb/markup';
import type { MarkupContent, MarkupGeometry } from './fieldGroups.ts';

// The records operations create and change. Every record is plain JSON, so it can be stored,
// sent and compared as is.

/** One group's version: how many accepted changes it has had, and the operation that made the last one. */
export interface GroupVersion {
  v: number;
  op: string;
}

/** Who did something, as the server works it out from the signed-in connection. Never sent by a client. */
export interface Actor {
  userId: string;
  /** The firm they acted for. */
  partyId: string | null;
  /** The team they acted as, when they chose one. */
  groupId: string | null;
}

/** Fields every record that can be edited and deleted has. */
export interface VersionedRecord {
  id: string;
  /**
   * The record's version as a whole: 1 when made, plus one for every accepted change. A release
   * names this number, so it shares exactly what was previewed.
   */
  rev: number;
  /** Per group key, the group's version. A group not listed is at `{ v: 0, op: createdBy }`. */
  versions: Readonly<Record<string, GroupVersion>>;
  /** The operation that made the record. */
  createdBy: string;
  /** Server time of creation and of the last change, ms since the epoch. */
  createdAt: number;
  modifiedAt: number;
  /** The client's clock when the record was made, shown as "made offline at". Information only. */
  clientTime: number | null;
  /** Deleted records are kept, so they can be restored. */
  deleted: boolean;
}

/** Something drawn on a drawing: its content. Where it is drawn is on its placements. */
export interface MarkupRecord extends VersionedRecord {
  /** The review, or a standalone session, whose rules decide who sees it. */
  scopeId: string;
  type: MarkupType;
  content: MarkupContent;
  owner: Actor;
}

export const PLACEMENT_METHODS = ['original', 'aligned', 'ai', 'manual'] as const;
export type PlacementMethod = (typeof PLACEMENT_METHODS)[number];
export const PLACEMENT_STATES = ['suggested', 'confirmed', 'not_found'] as const;
export type PlacementState = (typeof PLACEMENT_STATES)[number];

/** A markup's position on one page of one revision. A markup has one per revision it appears on. */
export interface Placement extends VersionedRecord {
  markupId: string;
  revisionId: string;
  pageId: string;
  geometry: MarkupGeometry;
  method: PlacementMethod;
  /** 0..1 for a suggestion; null when a person placed it. */
  confidence: number | null;
  state: PlacementState;
}

/** The thing tracked to close-out, with or without markups. */
export interface Issue extends VersionedRecord {
  scopeId: string;
  /** The project-wide number, assigned by the server; null until then (a temporary label is shown). */
  number: number | null;
  title: string;
  /** Ticked off: a review mark separate from the status. */
  checked: boolean;
  originatingReviewId: string | null;
  /** The markups it is linked to, in the order they were linked. */
  markupIds: readonly string[];
  owner: Actor;
}

export const RESPONSE_KINDS = ['reply', 'formal'] as const;
export type ResponseKind = (typeof RESPONSE_KINDS)[number];

/** A reply or formal response. A separate record from its parent, so it never conflicts with edits to it. */
export interface Response extends VersionedRecord {
  parent: { kind: 'markup' | 'issue'; id: string };
  /** The response this answers, when it answers one rather than the parent itself. */
  inReplyTo: string | null;
  /** The parent's `rev` it answers, when it answers an earlier version than the current one. */
  answersRev: number | null;
  kind: ResponseKind;
  body: string;
  owner: Actor;
}

export const STATUS_CATEGORIES = ['open', 'closed', 'void'] as const;
/** What a status means, whatever it is called: carry-over, closing rules and dashboards use this. */
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** One of the project's statuses. */
export interface StatusDef {
  id: string;
  name: string;
  category: StatusCategory;
}

/** One status change. Append-only: never edited or deleted. */
export interface StatusEvent {
  id: string;
  /** Always 1: an event never changes. */
  rev: 1;
  issueId: string;
  /** The lane whose status changed. */
  laneId: string;
  /** The status it was changed from: null for the first in this lane. */
  from: string | null;
  to: string;
  note: string | null;
  /** The revision that was checked; required for a change into a `closed` status. */
  revisionSeenId: string | null;
  actor: Actor;
  at: number;
  clientTime: number | null;
}

/** An issue's current status as one lane sees it. */
export interface LaneStatus {
  status: string;
  /** The event that set it; null for the status the issue was made with. */
  eventId: string | null;
}

export const ITEM_KINDS = ['markup', 'placement', 'issue', 'response', 'statusEvent'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** One record at one version. */
export interface ItemRef {
  kind: ItemKind;
  id: string;
  rev: number;
}

/** A record that exact versions of items became visible to other lanes. */
export interface Release {
  id: string;
  rev: 1;
  /** The route it went through; null for an automatic release, where no gate applies. */
  gateId: string | null;
  toLaneIds: readonly string[];
  items: readonly ItemRef[];
  by: Actor;
  at: number;
}
