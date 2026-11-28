// Server documents in the viewer: which facets they offer, what the app hides for them, the
// editing adapter and the resumable upload. Fictional data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MarkupStore, type Markup } from '@nb/markup';
import { DEFAULT_SCALE } from '@nb/measure';
import { FakeSyncServer, SyncDocument } from '@nb/sync';
import type { Command } from '../commands/appCommands.ts';
import { ServerClientError } from '../connect/client.ts';
import { applyFacetPolicy, hiddenRibbonTabs, listedCommandIds, measureToolIds, panelUnavailable, toolsFor } from './facetUi.ts';
import { hasFacet, hasFileSteps, hasYjs, isSynced, type FacetName } from './facets.ts';
import { MissingFacetError, ReviewDocument, type ReviewTransport } from './ReviewDocument.ts';
import { uploadPdf } from './upload.ts';

const FACETS: FacetName[] = ['takeoff', 'aiReview', 'portals', 'links', 'stitch', 'geo', 'import', 'fileSteps', 'yjs', 'setup'];

const quietTransport: ReviewTransport = {
  connectionId: null,
  setPage: () => {},
  retryNow: () => {},
  onPresence: () => () => {},
  onAccess: () => () => {},
  onSessionEnded: () => () => {},
};

async function serverDocument(server: FakeSyncServer, userId: string, role: 'project_admin' | 'reviewer' | 'viewer') {
  const transport = server.createTransport({ userId, partyId: null, groupId: null });
  const inner = await SyncDocument.open({
    streamId: 'doc-1',
    scopeId: 'scope-1',
    revisionId: 'revision-1',
    pages: ['page-1', 'page-2'],
    actor: { userId, partyId: null, groupId: null },
    context: { actor: { id: userId, name: userId } },
    transport,
    persistence: false,
  });
  const info = { projectName: 'Wharf Pavilion', documentTitle: 'S-101.pdf', documentNumber: 'S-101', revisionLabel: '1', userId, userName: userId, role };
  const doc = new ReviewDocument(inner, quietTransport, info, new Map());
  await inner.connect();
  return { doc, inner, transport };
}

const rectangle = (id: string, author: string, patch: Partial<Markup> = {}): Markup => ({
  id,
  type: 'rect',
  pageIndex: 0,
  points: [[10, 10], [90, 60]],
  style: { stroke: '#d00000', fill: null, width: 2, opacity: 1 },
  status: 'none',
  author,
  createdAt: 1,
  modifiedAt: 1,
  ...patch,
});

const command = (id: string): Command => ({ id, label: id, category: 'Tools', run: () => {}, enabled: true });

test('a local file has every facet, and nothing is hidden from it', async () => {
  const store = await MarkupStore.open('review-test-local', { persist: false });
  for (const facet of FACETS) assert.equal(hasFacet(store, facet), true, facet);
  assert.equal(hasFileSteps(store), true);
  assert.equal(hasYjs(store), true);
  assert.equal(isSynced(store), false);
  const commands = [...listedCommandIds(), 'tool.length', 'tool.cloud'].map(command);
  const after = applyFacetPolicy(commands, store);
  after.forEach((c, i) => assert.equal(c, commands[i], c.id));
  assert.equal(panelUnavailable('bookmarks', store), false);
  assert.deepEqual(hiddenRibbonTabs(store), []);
  assert.equal(toolsFor(store, null, ['rect', 'length']), null);
  await store.destroy();
});

test('a server document offers no optional facet and the app hides what needs one', async () => {
  const { doc } = await serverDocument(new FakeSyncServer(), 'ada', 'project_admin');
  for (const facet of FACETS) assert.equal(hasFacet(doc, facet), false, facet);
  assert.equal(hasFileSteps(doc), false);
  assert.equal(isSynced(doc), true);

  const hidden = (id: string) => {
    const [after] = applyFacetPolicy([command(id)], doc);
    return !after!.enabled && after!.managed === true;
  };
  for (const id of [...listedCommandIds(), 'tool.length', 'tool.area', 'tool.count']) assert.equal(hidden(id), true, id);
  for (const id of ['tool.rect', 'tool.cloud', 'tool.pen', 'edit.copy', 'edit.undo', 'file.saveAs', 'file.print', 'file.exportCsv', 'view.zoomIn']) {
    assert.equal(hidden(id), false, id);
  }
  assert.equal(panelUnavailable('stitching', doc), true);
  assert.equal(panelUnavailable('layers', doc), false);
  assert.deepEqual(hiddenRibbonTabs(doc), ['measure', 'takeoff']);
  assert.deepEqual(toolsFor(doc, null, ['rect', 'length', 'redaction', 'pen']), ['rect', 'pen']);
  await doc.destroy();
});

test('every command and measuring tool in the facet tables exists', () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const commands = source('../commands/appCommands.ts');
  const toolbar = source('../components/ToolBar.tsx');
  for (const id of listedCommandIds()) {
    // Tool commands are made from the toolbar's tool lists.
    const found = commands.includes(`'${id}'`) || (id.startsWith('tool.') && toolbar.includes(`tool: '${id.slice(5)}'`));
    assert.equal(found, true, id);
  }
  const measureGroups = toolbar.slice(toolbar.indexOf('export const MEASURE_GROUPS'), toolbar.indexOf('export const MARKUP_TOOLS'));
  const measureTools = [...measureGroups.matchAll(/tool: '(\w+)'/g)].map((m) => m[1]!);
  assert.deepEqual(measureToolIds().sort(), measureTools.sort());
});

test('a server document refuses file changes instead of making them only here', async () => {
  const { doc } = await serverDocument(new FakeSyncServer(), 'ada', 'project_admin');
  assert.throws(() => doc.fileStep(), MissingFacetError);
  assert.throws(() => doc.copyPages(), MissingFacetError);
  assert.throws(() => doc.importAnnotations([], [], {}), MissingFacetError);
  assert.deepEqual([doc.allLinks(), doc.portals(), doc.assemblies(), doc.bookmarks(), doc.stitchGroups()], [[], [], [], [], []]);
  // Reads are the same object each time, as the panels' subscriptions need.
  assert.equal(doc.allLinks(), doc.allLinks());
  assert.equal(doc.aiReview(), doc.aiReview());

  doc.setScale([0], DEFAULT_SCALE);
  assert.match(doc.problem ?? '', /not shared/);
  assert.equal(doc.hasScale(0), false);
  await doc.destroy();
});

test('statuses and replies are refused aloud, and the rest of the same change is kept', async () => {
  const { doc } = await serverDocument(new FakeSyncServer(), 'ada', 'project_admin');
  doc.add(rectangle('m1', 'ada'));
  assert.equal(doc.problem, null);

  doc.update('m1', { status: 'accepted', comment: 'Check the splice' });
  assert.equal(doc.get('m1')!.comment, 'Check the splice');
  assert.equal(doc.get('m1')!.status, 'none');
  assert.match(doc.problem ?? '', /not saved/);

  doc.dismissProblem();
  // Sending back an unchanged value is not a refusal.
  doc.update('m1', { status: 'none', label: 'B2' });
  assert.equal(doc.problem, null);
  assert.equal(doc.get('m1')!.label, 'B2');
  await doc.destroy();
});

test('the edit hint follows the role: reviewers their own markups, admins any, viewers none', async () => {
  const server = new FakeSyncServer();
  const ben = await serverDocument(server, 'ben', 'reviewer');
  ben.doc.add(rectangle('bens', 'ben'));
  const eve = await serverDocument(server, 'eve', 'reviewer');
  const ada = await serverDocument(server, 'ada', 'project_admin');
  const vic = await serverDocument(server, 'vic', 'viewer');

  assert.equal(ben.doc.mayEdit(ben.doc.get('bens')!), true);
  assert.equal(eve.doc.mayEdit(eve.doc.get('bens')!), false);
  assert.equal(ada.doc.mayEdit(ada.doc.get('bens')!), true);
  assert.equal(vic.doc.readOnly, true);
  assert.equal(vic.doc.mayEdit(vic.doc.get('bens')!), false);
  vic.doc.setReadOnly(false);
  assert.equal(vic.doc.readOnly, true, 'the role still holds');
  for (const each of [ben, eve, ada, vic]) await each.doc.destroy();
});

test('an undo that cannot happen is said, not skipped', async () => {
  const server = new FakeSyncServer();
  const ben = await serverDocument(server, 'ben', 'reviewer');
  const ada = await serverDocument(server, 'ada', 'project_admin');
  ben.doc.add(rectangle('m1', 'ben'));
  ben.doc.update('m1', { comment: 'First wording' });
  ada.doc.update('m1', { comment: 'Changed by someone else' });

  assert.deepEqual(await ben.doc.undo(), { ok: false, reason: 'changed' });
  assert.match(ben.doc.problem ?? '', /changed since/);
  assert.equal(ben.doc.get('m1')!.comment, 'Changed by someone else');
  await ben.doc.destroy();
  await ada.doc.destroy();
});

/** A stand-in for the upload API that holds what it was sent and can drop the connection. */
function uploadServer(options: { failChunks?: Set<number>; chunkSize?: number } = {}) {
  const received: number[] = [];
  const calls: string[] = [];
  let chunkCalls = 0;
  let created = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.replace('/api/projects/p1/uploads', '')}`);
    if (url.endsWith('/uploads') && method === 'POST') {
      created += 1;
      received.length = 0;
      return json({ uploadId: `u${created}`, chunkSize: options.chunkSize ?? 4 }, 201);
    }
    if (url.endsWith('/chunks')) {
      chunkCalls += 1;
      const offset = Number((init.headers as Record<string, string>)['x-upload-offset']);
      if (offset !== received.length) return json({ error: 'offset_mismatch', expectedOffset: received.length }, 409);
      const bytes = new Uint8Array(await (init.body as Blob).arrayBuffer());
      if (options.failChunks?.has(chunkCalls)) {
        // Part of the chunk arrived before the connection was cut.
        received.push(...bytes.slice(0, 1));
        throw new TypeError('network error');
      }
      received.push(...bytes);
      return json({ receivedBytes: received.length });
    }
    if (url.endsWith('/complete')) return json({ documentId: 'd1', revisionId: 'r1' }, 201);
    return json({ state: 'uploading', receivedBytes: received.length, chunkSize: options.chunkSize ?? 4 });
  };
  return { fetchImpl, received, calls, created: () => created };
}

const pdfFile = () => Object.assign(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])]), { name: 'S-101.pdf' });

test('an upload resumes from what the server has after the connection drops', async () => {
  const api = uploadServer({ failChunks: new Set([2]) });
  const progress: number[] = [];
  const result = await uploadPdf('p1', pdfFile(), { fetchImpl: api.fetchImpl, wait: async () => {}, onProgress: (sent) => progress.push(sent) });
  assert.deepEqual(result, { documentId: 'd1', revisionId: 'r1' });
  assert.deepEqual(api.received, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(api.created(), 1);
  assert.ok(api.calls.includes('GET /u1'), 'asked the server how far it got');
  assert.equal(progress.at(-1), 10);
});

test('an upload that gave up carries on with the same attempt', async () => {
  const api = uploadServer({ failChunks: new Set([2, 3]) });
  const attempt = {};
  await assert.rejects(uploadPdf('p1', pdfFile(), { fetchImpl: api.fetchImpl, wait: async () => {}, attempt, maxRetries: 1 }), TypeError);
  const result = await uploadPdf('p1', pdfFile(), { fetchImpl: api.fetchImpl, wait: async () => {}, attempt });
  assert.equal(result.revisionId, 'r1');
  assert.deepEqual(api.received, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(api.created(), 1, 'the same upload session');
});

test('an upload the server refuses is not retried', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'invalid_total_bytes' }), { status: 400 });
  };
  await assert.rejects(
    uploadPdf('p1', pdfFile(), { fetchImpl, wait: async () => {} }),
    (err: unknown) => err instanceof ServerClientError && err.code === 'invalid_total_bytes',
  );
  assert.equal(calls, 1);
});
