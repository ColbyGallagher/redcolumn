// Fixtures shared by the server's tests. Everything here is fictional.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { WebSocket } from 'ws';
import type { UserProfile } from './auth.ts';
import type { Database, ProjectRole } from './db.ts';
import { createProject } from './projects.ts';

export interface DocumentFixture {
  projectId: string;
  scopeId: string;
  laneId: string;
  /** Also the id of the document's stream. */
  documentId: string;
  revisionId: string;
  pageIds: string[];
}

/** Adds an active member to a project and to its lane, as accepting an invitation does. */
export async function addMember(
  db: Kysely<Database>,
  fixture: Pick<DocumentFixture, 'projectId' | 'laneId'>,
  userId: string,
  role: ProjectRole,
): Promise<void> {
  await db
    .insertInto('project_members')
    .values({ project_id: fixture.projectId, user_id: userId, party_id: null, role, state: 'active', updated_at: new Date() })
    .execute();
  await db.insertInto('lane_members').values({ lane_id: fixture.laneId, subject_kind: 'user', subject_id: userId }).execute();
}

/** A project owned by `owner` with one document whose revision has two pages, without an upload. */
export async function createDocumentFixture(
  db: Kysely<Database>,
  owner: UserProfile,
  members: readonly { userId: string; role: ProjectRole }[] = [],
): Promise<DocumentFixture> {
  const created = await createProject(db, owner, { name: 'Harbour Street Depot' });
  assert.ok(created.ok);
  const fixture: DocumentFixture = {
    projectId: created.project.id,
    scopeId: created.scope.id,
    laneId: created.lane.id,
    documentId: randomUUID(),
    revisionId: randomUUID(),
    pageIds: [randomUUID(), randomUUID()],
  };
  for (const member of members) await addMember(db, fixture, member.userId, member.role);
  await db
    .insertInto('documents')
    .values({ id: fixture.documentId, project_id: fixture.projectId, number: `S-${fixture.documentId.slice(0, 8)}`, title: 'Roof framing plan', discipline: null })
    .execute();
  await db
    .insertInto('revisions')
    .values({
      id: fixture.revisionId,
      document_id: fixture.documentId,
      label: '1',
      file_sha256: 'a'.repeat(64),
      file_size: 1,
      page_count: fixture.pageIds.length,
      processing_status: 'ready',
      processing_error: null,
      issued_by: owner.id,
      issued_at: new Date(),
    })
    .execute();
  await db
    .insertInto('pages')
    .values(fixture.pageIds.map((id, position) => ({ id, revision_id: fixture.revisionId, sheet_id: null, position, width: 842, height: 595, rotation: 0 as const })))
    .execute();
  return fixture;
}

/** A small valid PDF with one blank page of each size, for tests that upload a real file. */
export function blankPdf(pages: readonly { width: number; height: number }[]): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${i + 3} 0 R`).join(' ')}] >>`,
    ...pages.map((p) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}] /Resources << >> >>`),
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

export type Frame = Record<string, unknown> & { type: string };

/** Collects every frame a socket receives, so a test can wait for the one it means in any order. */
export class FrameInbox {
  readonly frames: Frame[] = [];
  private taken = new Set<number>();
  private waiters: (() => void)[] = [];

  constructor(ws: WebSocket) {
    ws.on('message', (data) => {
      this.frames.push(JSON.parse(data.toString()) as Frame);
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  /** The first frame not yet taken that matches, waiting for it if need be. */
  async next(matches: (frame: Frame) => boolean, what: string, timeoutMs = 5000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const at = this.frames.findIndex((frame, i) => !this.taken.has(i) && matches(frame));
      if (at >= 0) {
        this.taken.add(at);
        return this.frames[at]!;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Timed out waiting for ${what}; got ${JSON.stringify(this.frames)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** The next `sync` frame carrying a message of this type. */
  async sync(messageType: string): Promise<Record<string, unknown>> {
    const frame = await this.next(
      (f) => f.type === 'sync' && (f.message as { type?: string }).type === messageType,
      `a "${messageType}" sync message`,
    );
    return frame.message as Record<string, unknown>;
  }
}
