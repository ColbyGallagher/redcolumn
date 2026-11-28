import type { StatusDef } from '@nb/ops';
import type { StatusRules } from '@nb/sync';
import { ServerClientError, type ProjectRole } from '../connect/client.ts';

/** Same-origin calls about a project's documents. The session cookie goes with them. */

export interface RevisionSummary {
  id: string;
  label: string;
  fileSize: number;
  pageCount: number;
  processingStatus: 'pending' | 'processing' | 'ready' | 'failed';
  processingError: string | null;
  createdAt: string | null;
}

export interface DocumentSummary {
  id: string;
  number: string;
  title: string;
  revisions: RevisionSummary[];
}

export interface RevisionTarget {
  projectId: string;
  documentId: string;
  revisionId: string;
}

/** What the viewer needs to open a revision. */
export interface RevisionOpenInfo {
  project: { id: string; name: string };
  document: { id: string; number: string; title: string };
  revision: { id: string; label: string; fileSha256: string; fileSize: number; pageCount: number };
  /** Page ids in page order. */
  pages: string[];
  streamId: string;
  scopeId: string;
  laneId: string;
  role: ProjectRole;
  /** The project's status set, in order. */
  statuses: StatusDef[];
  /** What this person may do with statuses and ticks. */
  rules: StatusRules;
  user: { id: string; name: string };
  members: { userId: string; name: string }[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/** The error a failed response describes. */
export async function responseError(res: Response): Promise<ServerClientError> {
  let code = `http_${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) code = body.error;
  } catch {
    // Not a JSON answer.
  }
  return new ServerClientError(res.status, code);
}

export async function getJson<T>(path: string, fetchImpl: FetchLike = defaultFetch): Promise<T> {
  const res = await fetchImpl(path, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
  if (!res.ok) throw await responseError(res);
  return (await res.json()) as T;
}

const project = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export const revisionPath = (t: RevisionTarget) =>
  `${project(t.projectId)}/documents/${encodeURIComponent(t.documentId)}/revisions/${encodeURIComponent(t.revisionId)}`;

export async function listDocuments(projectId: string, fetchImpl?: FetchLike): Promise<DocumentSummary[]> {
  return (await getJson<{ documents: DocumentSummary[] }>(`${project(projectId)}/documents`, fetchImpl)).documents;
}

export function getOpenInfo(target: RevisionTarget, fetchImpl?: FetchLike): Promise<RevisionOpenInfo> {
  return getJson<RevisionOpenInfo>(`${revisionPath(target)}/open`, fetchImpl);
}

export async function getRevisionFile(target: RevisionTarget, fetchImpl: FetchLike = defaultFetch): Promise<ArrayBuffer> {
  const res = await fetchImpl(`${revisionPath(target)}/file`, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw await responseError(res);
  return res.arrayBuffer();
}
