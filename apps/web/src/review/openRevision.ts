import { msg } from '@nb/i18n';
import type { Markup } from '@nb/markup';
import { IndexedDbSyncPersistence, SyncDocument, WsSyncTransport, type SyncDocumentOptions, type SyncPersistence } from '@nb/sync';
import { ServerClientError } from '../connect/client';
import { holdInMemory, type StoredFile } from '../storage/fileStore';
import { openLocal, sealLocal } from '../storage/localCrypto';
import { getOpenInfo, getRevisionFile, type RevisionOpenInfo, type RevisionTarget } from './documentsApi';
import { ReviewDocument } from './ReviewDocument';
import { sha256Hex } from './upload';

/*
 * Opens a revision from the server for the viewer: its PDF from the server's blob store, and its
 * markups as a `SyncDocument` over a WebSocket to the same server. The PDF stays in memory while
 * the tab is open. Unsent changes are kept on this device (sealed when local encryption is on),
 * per server, user and revision, so they survive a reload.
 */

/** A server revision's tab id: never a library file's. */
export const serverFileId = (target: Pick<RevisionTarget, 'documentId' | 'revisionId'>) =>
  `server:${target.documentId}:${target.revisionId}`;

export const isServerFileId = (id: string): boolean => id.startsWith('server:');

export interface OpenedRevision {
  file: StoredFile;
  bytes: ArrayBuffer;
  /** Starts the synced document. Call it once, when a tab is going to show it. */
  createStore: () => Promise<ReviewDocument>;
}

export interface OpenRevisionHooks {
  /** Called after a markup is added here. */
  onAdded: (doc: ReviewDocument, markup: Markup) => void;
}

/** One per document: closing a document closes its own connection, never another's. */
function devicePersistence(): SyncPersistence | false {
  if (typeof indexedDB === 'undefined') return false;
  return new IndexedDbSyncPersistence({ dbName: 'nb-server-docs', sealer: { seal: sealLocal, open: openLocal } });
}

/** Why a revision did not open, for the person trying. */
export function describeOpenError(err: unknown): string {
  if (err instanceof ServerClientError) {
    if (err.status === 401) return msg('Your session has expired. Please sign in again.');
    if (err.code === 'revision_not_ready') return msg('The server is still reading this PDF. Try again in a moment.');
    if (err.status === 404) return msg('This document is not available. You may no longer have access to it.');
    return msg('Could not open the document ({code}).', { code: err.code });
  }
  return err instanceof Error ? msg('Could not open the document: {value}', { value: err.message }) : msg('Could not open the document.');
}

function socketUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

async function startDocument(info: RevisionOpenInfo, hooks: OpenRevisionHooks): Promise<ReviewDocument> {
  const names = new Map(info.members.map((m) => [m.userId, m.name]));
  names.set(info.user.id, info.user.name);
  const transport = new WsSyncTransport({ url: socketUrl(window.location) });
  let review: ReviewDocument | null = null;
  const options: SyncDocumentOptions = {
    key: `${window.location.origin}|${info.user.id}|${info.streamId}:${info.revision.id}`,
    streamId: info.streamId,
    scopeId: info.scopeId,
    revisionId: info.revision.id,
    pages: info.pages,
    actor: { userId: info.user.id, partyId: null, groupId: null },
    laneId: info.laneId,
    context: {
      actor: { id: info.user.id, name: info.user.name },
      onAdded: (_inner, markup) => {
        if (review) hooks.onAdded(review, markup);
      },
    },
    resolveAuthor: (actor) => names.get(actor.userId) ?? msg('Unknown user'),
    statuses: info.statuses,
    persistence: devicePersistence(),
  };
  let inner: SyncDocument;
  let notKept = false;
  try {
    inner = await SyncDocument.open(options);
  } catch (err) {
    console.error('Could not read the changes kept on this device:', err);
    notKept = true;
    inner = await SyncDocument.open({ ...options, persistence: false });
  }
  // The transport is attached only now, by `connect`, so an attempt that failed to open never hears it.
  transport.onReconnectDue(() => void inner.connect().catch((err: unknown) => console.warn('Reconnect failed:', err)));
  review = new ReviewDocument(
    inner,
    transport,
    {
      projectName: info.project.name,
      documentTitle: info.document.title,
      documentNumber: info.document.number,
      revisionLabel: info.revision.label,
      userId: info.user.id,
      userName: info.user.name,
      role: info.role,
      statuses: info.statuses,
      rules: info.rules,
    },
    names,
  );
  if (notKept) review.report(msg('Changes kept on this device could not be read. New changes are only kept until the tab closes.'));
  const online = () => transport.retryNow();
  window.addEventListener('online', online);
  review.onDestroy(() => window.removeEventListener('online', online));
  void inner.connect(transport).catch((err: unknown) => console.warn('Could not connect:', err));
  return review;
}

export async function openRevision(target: RevisionTarget, hooks: OpenRevisionHooks): Promise<OpenedRevision> {
  const info = await getOpenInfo(target);
  const bytes = await getRevisionFile(target);
  if ((await sha256Hex(bytes)) !== info.revision.fileSha256) throw new Error(msg('The file from the server does not match what was uploaded.'));
  // The viewer takes ownership of `bytes`; indexing and search read this copy.
  const held = bytes.slice(0);
  const title = info.document.title.trim();
  const now = Date.now();
  return {
    file: {
      id: serverFileId(target),
      hash: info.revision.fileSha256,
      name: /\.pdf$/i.test(title) ? title : `${info.document.number}.pdf`,
      size: info.revision.fileSize,
      addedAt: now,
      lastOpenedAt: now,
    },
    bytes,
    createStore: async () => {
      const release = holdInMemory(info.revision.fileSha256, held);
      try {
        const doc = await startDocument(info, hooks);
        doc.onDestroy(release);
        return doc;
      } catch (err) {
        release();
        throw err;
      }
    },
  };
}
