import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { levelFor, visibleTo, wouldCycle, type ProjectMeta } from './projectModel.ts';
import { cleanEmails, invitationText, mailerFromEnv, type Mail } from './mailer.ts';
import { start } from './server.ts';

const meta = (): ProjectMeta => ({
  id: '111-222-333',
  name: 'Tower',
  owner: 'Olive',
  createdAt: 0,
  members: [
    { who: 'ann@example.com', level: 'write' },
    { who: 'Bob', level: 'read' },
  ],
  defaultLevel: 'none',
  folders: [
    { id: 'arch', name: 'Architectural', parentId: null },
    { id: 'arch-wip', name: 'WIP', parentId: 'arch', permissions: { default: 'none', people: [{ who: 'Bob', level: 'write' }] } },
    { id: 'struct', name: 'Structural', parentId: null, permissions: { people: [{ who: 'ann@example.com', level: 'read' }] } },
  ],
  files: [
    { id: 'f1', name: 'A-101.pdf', folderId: 'arch', revisions: [], checkout: null },
    { id: 'f2', name: 'A-101 wip.pdf', folderId: 'arch-wip', revisions: [], checkout: null },
  ],
});

test('folder permissions: innermost rule wins, then members, then the default; the owner has full control', () => {
  const m = meta();
  const ann = { name: 'Ann', email: 'ann@example.com', isOwner: false };
  const bob = { name: 'bob', email: null, isOwner: false };
  const eve = { name: 'Eve', email: null, isOwner: false };
  assert.equal(levelFor(m, 'arch', ann), 'write');
  assert.equal(levelFor(m, 'arch-wip', ann), 'none');
  assert.equal(levelFor(m, 'struct', ann), 'read');
  assert.equal(levelFor(m, 'arch', bob), 'read');
  assert.equal(levelFor(m, 'arch-wip', bob), 'write');
  assert.equal(levelFor(m, null, eve), 'none');
  assert.equal(levelFor(m, 'arch-wip', { name: 'Olive', email: null, isOwner: true }), 'full');
  const seen = visibleTo(m, ann);
  assert.deepEqual(seen.files.map((f) => f.id), ['f1']);
  assert.deepEqual(seen.folders.map((f) => f.id), ['arch', 'struct']);
  // Only people with full control see who has access.
  assert.deepEqual(seen.members, []);
  assert.equal(wouldCycle(m, 'arch', 'arch-wip'), true);
  assert.equal(wouldCycle(m, 'arch-wip', 'struct'), false);
});

test('invitation emails: addresses checked, providers from the environment', async () => {
  assert.deepEqual(cleanEmails(['A@Example.com', 'a@example.com', 'b@x.org']), ['a@example.com', 'b@x.org']);
  assert.equal(cleanEmails(['not an email']), null);
  assert.equal(cleanEmails([]), null);
  assert.equal(mailerFromEnv({}), null);
  const posted: { url: string; body: unknown }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    posted.push({ url, body: JSON.parse(String(init.body)) });
    return new Response('{}');
  }) as unknown as typeof fetch;
  await mailerFromEnv({ STUDIO_MAIL_WEBHOOK: 'https://mail.example/send' }, fetcher)!({ to: 'a@example.com', subject: 'Hi', text: 'Body' });
  assert.deepEqual(posted[0], { url: 'https://mail.example/send', body: { to: 'a@example.com', subject: 'Hi', text: 'Body' } });
  const text = invitationText({ from: 'Olive', what: 'Project', name: 'Tower', id: '111-222-333', link: 'https://app.example/?project=111-222-333', note: 'See A-101' });
  assert.match(text, /Olive invited you to the Team Project “Tower”/);
  assert.match(text, /Project ID: 111-222-333/);
  assert.match(text, /Olive wrote:\nSee A-101/);
});

let dir: string;
let base: string;
let running: Awaited<ReturnType<typeof start>>;
const mails: Mail[] = [];

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nb-projects-'));
  running = await start({ port: 0, hostname: '127.0.0.1', dataDir: dir, mailer: async (m) => void mails.push(m) });
  base = `http://127.0.0.1:${running.port}`;
});

after(async () => {
  await running.close();
  await rm(dir, { recursive: true, force: true });
});

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);

async function call(path: string, init: RequestInit & { as?: string; key?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-studio-attendee', init.as ?? 'Olive');
  if (init.key) headers.set('x-studio-project-key', init.key);
  if (init.body && !(init.body instanceof Uint8Array)) headers.set('content-type', 'application/json');
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, bytes: type.includes('pdf') ? new Uint8Array(await res.arrayBuffer()) : null };
}

test('a Project: folders, check out, check in, revisions, restore, permissions and its Record', async () => {
  const made = await call('/v1/projects', { method: 'POST', body: JSON.stringify({ name: 'Tower' }) });
  assert.equal(made.status, 201);
  const { ownerKey } = made.json;
  const id = made.json.project.id as string;
  const owner = { key: ownerKey };

  // Private by default: someone else with the ID cannot open it.
  assert.equal((await call(`/v1/projects/${id}`, { as: 'Bob' })).status, 403);

  const folder = await call(`/v1/projects/${id}/folders`, { ...owner, method: 'POST', body: JSON.stringify({ name: 'Architectural', parentId: null }) });
  const arch = folder.json.folder.id as string;
  const added = await call(`/v1/projects/${id}/files?folder=${arch}&name=A-101.pdf`, { ...owner, method: 'POST', body: pdf('rev 1') });
  assert.equal(added.status, 201);
  const fileId = added.json.file.id as string;
  assert.equal((await call(`/v1/projects/${id}/files?folder=${arch}&name=a-101.pdf`, { ...owner, method: 'POST', body: pdf('dup') })).status, 409);

  // Bob gets write access to the Project.
  await call(`/v1/projects/${id}`, { ...owner, method: 'PATCH', body: JSON.stringify({ members: [{ who: 'Bob', level: 'write' }, { who: 'Cara', level: 'read' }] }) });
  const bobView = await call(`/v1/projects/${id}`, { as: 'Bob' });
  assert.equal(bobView.status, 200);
  assert.equal(bobView.json.project.levels[arch], 'write');

  // Check in needs a check-out; only the holder can check in.
  assert.equal((await call(`/v1/projects/${id}/files/${fileId}/checkin`, { as: 'Bob', method: 'POST', body: pdf('x') })).status, 409);
  assert.equal((await call(`/v1/projects/${id}/files/${fileId}/checkout`, { as: 'Bob', method: 'POST', body: JSON.stringify({ note: 'markups' }) })).status, 200);
  assert.equal((await call(`/v1/projects/${id}/files/${fileId}/checkout`, { ...owner, method: 'POST', body: '{}' })).status, 409);
  assert.equal((await call(`/v1/projects/${id}/files/${fileId}/checkout`, { as: 'Cara', method: 'POST', body: '{}' })).status, 403);
  const checkin = await call(`/v1/projects/${id}/files/${fileId}/checkin?comment=${encodeURIComponent('Added clouds')}`, { as: 'Bob', method: 'POST', body: pdf('rev 2') });
  assert.equal(checkin.status, 200);
  assert.equal(checkin.json.file.checkout, null);
  assert.deepEqual(checkin.json.file.revisions.map((r: { n: number; by: string; comment: string }) => [r.n, r.by, r.comment]), [
    [1, 'Olive', 'Added'],
    [2, 'Bob', 'Added clouds'],
  ]);

  // Latest and older revisions download; restoring makes a new revision.
  const latest = await call(`/v1/projects/${id}/files/${fileId}`, { as: 'Cara' });
  assert.equal(latest.headers.get('x-revision'), '2');
  assert.match(new TextDecoder().decode(latest.bytes!), /rev 2/);
  assert.match(new TextDecoder().decode((await call(`/v1/projects/${id}/files/${fileId}?rev=1`, { as: 'Cara' })).bytes!), /rev 1/);
  const restored = await call(`/v1/projects/${id}/files/${fileId}/restore`, { as: 'Bob', method: 'POST', body: JSON.stringify({ n: 1 }) });
  assert.equal(restored.json.file.revisions.at(-1).comment, 'Restored revision 1');
  assert.match(new TextDecoder().decode((await call(`/v1/projects/${id}/files/${fileId}`, { as: 'Cara' })).bytes!), /rev 1/);

  // A folder closed to everyone but Bob hides its files from Cara.
  await call(`/v1/projects/${id}/folders/${arch}`, { ...owner, method: 'PATCH', body: JSON.stringify({ permissions: { default: 'none', people: [{ who: 'Bob', level: 'delete' }] } }) });
  assert.deepEqual((await call(`/v1/projects/${id}`, { as: 'Cara' })).json.project.files, []);
  assert.equal((await call(`/v1/projects/${id}/files/${fileId}`, { as: 'Cara' })).status, 404);
  // Bob can delete there now, but not change permissions.
  assert.equal((await call(`/v1/projects/${id}/folders/${arch}`, { as: 'Bob', method: 'PATCH', body: JSON.stringify({ permissions: null }) })).status, 403);

  // Invitations add members and are emailed.
  const invite = await call(`/v1/projects/${id}/invite`, { ...owner, method: 'POST', body: JSON.stringify({ emails: ['dan@example.com'], level: 'read', note: 'Welcome' }) });
  assert.equal(invite.json.sent.sent, true);
  assert.equal(mails.at(-1)!.to, 'dan@example.com');
  assert.match(mails.at(-1)!.text, /Project ID: /);

  const record = await call(`/v1/projects/${id}/record`, { ...owner });
  const lines = record.json.entries.map((e: { who: string; text: string }) => `${e.who}: ${e.text}`);
  assert.ok(lines.includes('Bob: checked out A-101.pdf (markups)'), lines.join('\n'));
  assert.ok(lines.includes('Bob: checked in A-101.pdf as revision 2: Added clouds'));
  assert.ok(lines.includes('Bob: restored revision 1 of A-101.pdf as revision 3'));
  // Cara no longer sees what happens to files she cannot read.
  const caras = (await call(`/v1/projects/${id}/record`, { as: 'Cara' })).json.entries.map((e: { text: string }) => e.text);
  assert.ok(!caras.some((t: string) => t.includes('checked in')));
});

test('session invitations email the invitees and add them to a private session', async () => {
  const made = await fetch(`${base}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Review', host: 'Olive', access: { default: 'none', people: [], groups: [] } }) }).then((r) => r.json());
  const res = await fetch(`${base}/v1/sessions/${made.session.id}/invite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-studio-host-key': made.hostKey, 'x-studio-attendee': 'Olive' },
    body: JSON.stringify({ emails: ['erin@example.com'], note: 'Tuesday 10am' }),
  }).then((r) => r.json());
  assert.equal(res.sent, true);
  assert.deepEqual(res.session.access.people, [{ name: 'erin@example.com', access: 'markup' }]);
  assert.match(mails.at(-1)!.text, /Live Session “Review”/);
  // Attendees cannot invite to a private session.
  const denied = await fetch(`${base}/v1/sessions/${made.session.id}/invite`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-attendee': 'erin@example.com' }, body: JSON.stringify({ emails: ['x@example.com'] }) });
  assert.equal(denied.status, 403);
});
