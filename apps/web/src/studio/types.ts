import type { MarkupStore } from '@nb/markup';
import { accessFor, type Access, type AccessPolicy, type Permissions, type RecordEntry, type SessionDocument, type SessionMeta } from './protocol';

/** Where a session lives: the redcolumn server, or a folder in the host's Google Drive or OneDrive. */
export type Backend = 'server' | 'drive' | 'onedrive';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface Presence {
  clientId: number;
  name: string;
  /** Google email, when signed in. */
  email?: string | null;
  color: string;
  docId: string | null;
  page: number | null;
  self: boolean;
}

export interface StudioSnapshot {
  backend: Backend;
  meta: SessionMeta;
  isHost: boolean;
  me: string;
  /** This attendee's Google email (verified by the redcolumn server), when signed in. */
  email?: string | null;
  status: ConnectionStatus;
  record: RecordEntry[];
  presence: Presence[];
  /** A link that opens this session in the app. */
  inviteLink: string;
  /** Google Drive: sign-in has lapsed; edits are kept and saved once the user reconnects. */
  needsAuth?: boolean;
  /** Google Drive: this attendee may view but not write (the folder is shared view-only with them). */
  viewOnly?: boolean;
  /** Google Drive: the session folder, for "Open in Drive". */
  folderUrl?: string;
  /** The host has taken this attendee's access away; the session no longer syncs. */
  denied?: boolean;
}

/** What the attendee of a snapshot may do. */
export function myAccess(snap: Pick<StudioSnapshot, 'meta' | 'me' | 'isHost' | 'email'>): Access {
  return accessFor(snap.meta, snap.me, snap.isHost, snap.email);
}

export interface SessionUpdate {
  name?: string;
  permissions?: Partial<Permissions>;
  access?: AccessPolicy;
  status?: 'finished';
  /** When the session ends by itself; null for never. */
  expiresAt?: number | null;
}

/** A joined session, whichever backend carries it. */
export interface CollabSession {
  readonly backend: Backend;
  readonly id: string;
  readonly meta: SessionMeta;
  readonly me: string;
  readonly canMarkup: boolean;
  readonly canAddDocuments: boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): StudioSnapshot;
  setPresence(docId: string | null, page: number | null): void;
  sendChat(text: string): void;
  /** Syncs a document's markups with the session; resolves after the first sync (or a short wait offline). */
  attach(docId: string, store: MarkupStore): Promise<void>;
  fetchDocument(docId: string): Promise<ArrayBuffer>;
  addDocument(name: string, bytes: ArrayBuffer): Promise<SessionDocument>;
  removeDocument(docId: string): Promise<void>;
  /** Host: replaces a document with a new revision; its markups stay on the same pages. */
  updateDocument(docId: string, bytes: ArrayBuffer, name?: string): Promise<SessionDocument>;
  /** Sends a Markup Alert: everyone is shown the markup and can jump to it. */
  sendAlert(docId: string, markupId: string, page: number, text: string): void;
  update(patch: SessionUpdate): Promise<void>;
  /** Invites people by email (Google Drive sessions). */
  invite?(emails: string[]): Promise<void>;
  /** redcolumn server: invitation emails (sent by the server if it can send mail). */
  emailInvite?(emails: string[], note: string): Promise<{ sent: boolean; failed: string[] }>;
  /** Signs in again after it lapsed (Google Drive sessions); must run from a click. */
  reconnect?(): Promise<void>;
  retry(): void;
  leave(): void;
  destroy(): void;
}

export class StudioError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777'];

/** A stable color per attendee name, used for their presence dot and Record lines. */
export function attendeeColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length]!;
}

/** The Record as CSV, for the session report. */
export function recordToCsv(meta: SessionMeta, record: readonly RecordEntry[]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const docName = (id?: string) => meta.documents.find((d) => d.id === id)?.name ?? '';
  const header = ['Time', 'Author', 'Type', 'Detail', 'Document', 'Page'];
  const rows = record.map((e) => [new Date(e.at).toISOString(), e.author, e.kind, e.text, docName(e.docId), e.page != null ? e.page + 1 : ''].map(cell).join(','));
  return [header.join(','), ...rows].join('\r\n');
}
