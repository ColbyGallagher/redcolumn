import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DriveAuthError, DriveForbiddenError, type DriveFile, type DrivePermission, type DriveProps } from '../drive/DriveApi';
import { CheckedOutError, Project, ProjectError, type ProjectDrive } from './Project';

type Stored = DriveFile & { parent: string; owner: string; body: Uint8Array };

/** One shared in-memory OneDrive folder, seen by each user through their own `FakeDrive`. */
class FakeStore {
  files = new Map<string, Stored>();
  viewers = new Set<string>();
  clock = 0;
  /** Who the folder is shared with. */
  permissions: DrivePermission[] = [{ id: 'p-owner', kind: 'owner', name: 'Hana', email: 'hana@x.com', role: 'owner', inherited: false }];
  private n = 0;
  nextId = () => `f${++this.n}`;
}

class FakeDrive implements ProjectDrive {
  signedIn = true;
  readonly store: FakeStore;
  readonly user: string;
  constructor(store: FakeStore, user: string) {
    this.store = store;
    this.user = user;
  }

  private auth() {
    if (!this.signedIn) throw new DriveAuthError('signed out');
  }

  async list(folderId: string): Promise<DriveFile[]> {
    return [...this.store.files.values()].filter((f) => f.parent === folderId).map((f) => ({ ...f, properties: { ...f.properties } }));
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    const f = this.store.files.get(fileId);
    if (!f) throw new Error('404');
    return f.body.slice().buffer;
  }

  async createFolder(name: string, properties: DriveProps): Promise<string> {
    this.auth();
    const id = this.store.nextId();
    this.store.files.set(id, { id, name, mimeType: 'folder', version: '1', size: 0, createdTime: '', properties, parent: 'root', owner: this.user, body: new Uint8Array() });
    return id;
  }

  async createFile(folderId: string, name: string, mimeType: string, body: Blob, properties: DriveProps): Promise<DriveFile> {
    this.auth();
    if (this.store.viewers.has(this.user)) throw new DriveForbiddenError('view only');
    const id = this.store.nextId();
    const bytes = new Uint8Array(await body.arrayBuffer());
    // A strictly increasing creation time, as the drive assigns.
    const createdTime = String(++this.store.clock).padStart(8, '0');
    const f = { id, name, mimeType, version: '1', size: bytes.byteLength, createdTime, properties, parent: folderId, owner: this.user, body: bytes };
    this.store.files.set(id, f);
    return { ...f };
  }

  async updateContent(fileId: string, body: Blob): Promise<string> {
    this.auth();
    const f = this.store.files.get(fileId);
    if (!f) throw new Error('404');
    if (this.store.viewers.has(this.user)) throw new DriveForbiddenError('view only');
    f.body = new Uint8Array(await body.arrayBuffer());
    f.version = String(Number(f.version) + 1);
    return f.version;
  }

  async updateProperties(): Promise<string> {
    return '1';
  }

  async shareWithLink(): Promise<void> {
    this.auth();
  }

  async shareWithUser(_id: string, email: string, _message: string, role: 'reader' | 'writer' = 'writer'): Promise<void> {
    this.auth();
    this.store.permissions.push({ id: `p-${email}`, kind: 'user', name: email, email, role, inherited: false });
  }

  async listPermissions(): Promise<DrivePermission[]> {
    return this.store.permissions.map((p) => ({ ...p }));
  }

  async setPermissionRole(_folder: string, id: string, role: 'reader' | 'writer'): Promise<void> {
    this.store.permissions.find((p) => p.id === id)!.role = role;
  }

  async removePermission(_folder: string, id: string): Promise<void> {
    this.store.permissions = this.store.permissions.filter((p) => p.id !== id);
  }

  async ownedByMe(fileId: string): Promise<boolean> {
    return this.store.files.get(fileId)?.owner === this.user;
  }

  async remove(fileId: string): Promise<void> {
    this.auth();
    if (this.store.viewers.has(this.user)) throw new DriveForbiddenError('view only');
    this.store.files.delete(fileId);
  }
}

const opts = { authorize: async () => {} };
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.7 ${text}`).buffer as ArrayBuffer;
const text = (b: ArrayBuffer) => new TextDecoder().decode(b);
const hana = { name: 'Hana', email: 'hana@x.com' };
const sam = { name: 'Sam', email: 'sam@x.com' };

async function twoPeople() {
  const drive = new FakeStore();
  const owner = await Project.create(new FakeDrive(drive, 'hana'), 'Tower', hana, opts);
  const member = await Project.open(new FakeDrive(drive, 'sam'), owner.id, sam, opts);
  return { drive, owner, member };
}

test('a new Project opens for a second person, who sees what the owner adds', async () => {
  const { owner, member } = await twoPeople();
  assert.equal(owner.level, 'owner');
  assert.equal(member.getSnapshot().manifest.name, 'Tower');
  const plans = await owner.addFolder('Plans', null);
  await owner.addFolder('Level 2', plans.id);
  await owner.addFile('A-101.pdf', plans.id, pdf('one'));
  await member.poll();
  const snap = member.getSnapshot();
  assert.deepEqual(snap.folders.map((f) => f.name), ['Level 2', 'Plans']);
  assert.deepEqual(snap.files.map((f) => [f.name, f.folderId, f.revisions.length]), [['A-101.pdf', plans.id, 1]]);
  assert.equal(snap.files[0]!.checkout, null);
  assert.equal(text((await member.download(snap.files[0]!.id)).bytes), '%PDF-1.7 one');
});

test('check out blocks others; check in adds a revision and releases it', async () => {
  const { owner, member } = await twoPeople();
  const f = await owner.addFile('A-101.pdf', null, pdf('one'));
  await member.poll();
  await member.checkOut(f.id, 'redlines');
  await owner.poll();
  assert.equal(owner.getSnapshot().files[0]!.checkout?.by, 'Sam');
  await assert.rejects(owner.checkOut(f.id), CheckedOutError);
  await assert.rejects(owner.checkIn(f.id, pdf('mine'), 'x'), CheckedOutError);

  const rev = await member.checkIn(f.id, pdf('two'), 'Added the stair core');
  assert.equal(rev.n, 2);
  await owner.poll();
  const file = owner.getSnapshot().files[0]!;
  assert.equal(file.checkout, null);
  assert.deepEqual(file.revisions.map((r) => [r.n, r.by, r.comment]), [[1, 'Hana', 'First revision'], [2, 'Sam', 'Added the stair core']]);
  assert.equal(text((await owner.download(f.id)).bytes), '%PDF-1.7 two');
  assert.equal(text((await owner.download(f.id, 1)).bytes), '%PDF-1.7 one');
});

test('two people checking out at once: one wins, the other is told who', async () => {
  const { owner, member } = await twoPeople();
  const f = await owner.addFile('A-101.pdf', null, pdf('one'));
  await member.poll();
  const results = await Promise.allSettled([owner.checkOut(f.id), member.checkOut(f.id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(lost.reason instanceof CheckedOutError);
  await owner.poll();
  assert.ok(owner.getSnapshot().files[0]!.checkout);
});

test('undo releases your check-out; releasing someone else’s needs force', async () => {
  const { owner, member } = await twoPeople();
  const f = await owner.addFile('A-101.pdf', null, pdf('one'));
  await member.poll();
  await member.checkOut(f.id);
  await owner.poll();
  await assert.rejects(owner.undoCheckOut(f.id), CheckedOutError);
  await owner.undoCheckOut(f.id, true);
  assert.equal(owner.getSnapshot().files[0]!.checkout, null);
  await member.poll();
  await member.checkOut(f.id);
  await member.undoCheckOut(f.id);
  assert.equal(member.getSnapshot().files[0]!.checkout, null);
});

test('a revision whose PDF never arrived is ignored, and a changed PDF is refused', async () => {
  const { drive, owner } = await twoPeople();
  const f = await owner.addFile('A-101.pdf', null, pdf('one'));
  const pdfFile = [...drive.files.values()].find((x) => x.name.endsWith('.pdf'))!;
  pdfFile.body = new TextEncoder().encode('tampered');
  await assert.rejects(owner.download(f.id), ProjectError);
  drive.files.delete(pdfFile.id);
  await owner.poll();
  assert.equal(owner.getSnapshot().files.length, 0);
});

test('the Record merges everyone’s entries in time order', async () => {
  const { owner, member } = await twoPeople();
  const f = await owner.addFile('A-101.pdf', null, pdf('one'));
  await member.poll();
  await member.checkOut(f.id);
  await member.checkIn(f.id, pdf('two'), 'Done');
  await owner.poll();
  const rec = owner.getSnapshot().record;
  assert.deepEqual(rec.map((e) => [e.who, e.kind]), [['Hana', 'project'], ['Hana', 'file'], ['Sam', 'checkout'], ['Sam', 'checkin']]);
});

test('a viewer can read but every write is refused', async () => {
  const { drive, owner } = await twoPeople();
  const f = await owner.addFile('A-101.pdf', null, pdf('one'));
  drive.viewers.add('vic');
  const viewer = await Project.open(new FakeDrive(drive, 'vic'), owner.id, { name: 'Vic', email: null }, opts);
  assert.equal(viewer.getSnapshot().files.length, 1);
  await assert.rejects(viewer.checkOut(f.id), ProjectError);
  assert.equal(viewer.level, 'viewer');
  await assert.rejects(viewer.addFolder('X', null), /view/);
});

test('names are checked: empty, duplicate and missing folders', async () => {
  const { owner } = await twoPeople();
  await owner.addFolder('Plans', null);
  await assert.rejects(owner.addFolder('  ', null), /name/);
  await assert.rejects(owner.addFolder('plans', null), /already/);
  await assert.rejects(owner.addFile('a.pdf', 'nope', pdf('x')), /gone/);
  await owner.addFile('a.pdf', null, pdf('x'));
  await assert.rejects(owner.addFile('A.PDF', null, pdf('y')), /already/);
});

test('only the owner invites; an opened non-Project folder is refused', async () => {
  const { drive, owner, member } = await twoPeople();
  await assert.rejects(member.invite('lee@x.com'), /owner/);
  await assert.rejects(owner.invite('nope'), /email/);
  await owner.invite('lee@x.com');
  assert.deepEqual(owner.getSnapshot().manifest.members, [{ who: 'lee@x.com', level: 'editor' }]);
  const stray = await new FakeDrive(drive, 'hana').createFolder('Other', {});
  await assert.rejects(Project.open(new FakeDrive(drive, 'sam'), stray, sam, opts), /not a redcolumn Project/);
});

test('restoring an old revision adds it as a new one', async () => {
  const { owner } = await twoPeople();
  const f = await owner.addFile('A-101.pdf', null, pdf('one'));
  await owner.checkOut(f.id);
  await owner.checkIn(f.id, pdf('two'), 'Edit');
  const rev = await owner.restore(f.id, 1);
  assert.equal(rev.n, 3);
  assert.equal(rev.comment, 'Restored revision 1');
  assert.equal(text((await owner.download(f.id)).bytes), '%PDF-1.7 one');
  assert.equal(owner.getSnapshot().files[0]!.checkout, null);
});

test('rename, move and delete reach everyone, and a check-in keeps them', async () => {
  const { owner, member } = await twoPeople();
  const plans = await owner.addFolder('Plans', null);
  const f = await owner.addFile('A-101.pdf', null, pdf('one'));
  await member.poll();
  await member.renameFile(f.id, 'A-101 stair.pdf');
  await member.moveFile(f.id, plans.id);
  await owner.poll();
  let file = owner.getSnapshot().files[0]!;
  assert.deepEqual([file.name, file.folderId], ['A-101 stair.pdf', plans.id]);
  // A later check-in carries the new name and place, and an edit made after it still applies.
  await owner.checkOut(f.id);
  await owner.checkIn(f.id, pdf('two'), 'Edit');
  await member.renameFile(f.id, 'Stair.pdf');
  await owner.poll();
  file = owner.getSnapshot().files[0]!;
  assert.deepEqual([file.name, file.folderId, file.revisions.length], ['Stair.pdf', plans.id, 2]);
  await owner.deleteFile(f.id);
  await member.poll();
  assert.equal(member.getSnapshot().files.length, 0);
  assert.ok(owner.getSnapshot().record.some((e) => /deleted Stair\.pdf/.test(e.text)));
});

test('rename, move and delete are checked: names, cycles, check-outs', async () => {
  const { owner, member } = await twoPeople();
  const a = await owner.addFolder('A', null);
  const b = await owner.addFolder('B', a.id);
  const f = await owner.addFile('x.pdf', a.id, pdf('x'));
  await owner.addFile('y.pdf', a.id, pdf('y'));
  await assert.rejects(owner.renameFile(f.id, 'Y.PDF'), /already/);
  await assert.rejects(owner.moveFolder(a.id, b.id), /itself/);
  await assert.rejects(owner.moveFolder(a.id, a.id), /itself/);
  await assert.rejects(owner.moveFile(f.id, 'nope'), /gone/);
  await owner.checkOut(f.id);
  await member.poll();
  await assert.rejects(member.renameFile(f.id, 'z.pdf'), CheckedOutError);
  await assert.rejects(member.deleteFile(f.id), CheckedOutError);
  await assert.rejects(owner.deleteFile(f.id), /Undo your check-out/);
  await assert.rejects(owner.deleteFolder(a.id), /checked out/);
  await owner.renameFile(f.id, 'z.pdf');
  assert.equal(owner.getSnapshot().files.find((x) => x.id === f.id)!.name, 'z.pdf');
});

test('deleting a folder removes what is inside it from view; moving a folder takes its files along', async () => {
  const { owner, member } = await twoPeople();
  const a = await owner.addFolder('A', null);
  const b = await owner.addFolder('B', a.id);
  const c = await owner.addFolder('C', null);
  await owner.addFile('deep.pdf', b.id, pdf('d'));
  await owner.addFile('top.pdf', null, pdf('t'));
  assert.deepEqual(owner.contentsOf(a.id), { folders: 1, files: 1 });
  await owner.moveFolder(a.id, c.id);
  await member.poll();
  assert.deepEqual(member.pathOf(b.id).map((f) => f.name), ['C', 'A', 'B']);
  await member.renameFolder(a.id, 'A2');
  await member.deleteFolder(a.id);
  await owner.poll();
  const snap = owner.getSnapshot();
  assert.deepEqual(snap.folders.map((f) => f.name), ['C']);
  assert.deepEqual(snap.files.map((f) => f.name), ['top.pdf']);
  await assert.rejects(owner.renameFolder(b.id, 'Q'), /gone/);
});

test('a viewer cannot rename, move or delete', async () => {
  const { drive, owner } = await twoPeople();
  const f = await owner.addFile('A.pdf', null, pdf('one'));
  drive.viewers.add('vic');
  const viewer = await Project.open(new FakeDrive(drive, 'vic'), owner.id, { name: 'Vic', email: null }, opts);
  await assert.rejects(viewer.renameFile(f.id, 'B.pdf'), ProjectError);
  await assert.rejects(viewer.deleteFile(f.id), ProjectError);
});

test('the owner sees who has access, changes their level and removes them; others cannot', async () => {
  const { owner, member } = await twoPeople();
  await owner.invite('lee@x.com', 'viewer');
  await owner.invite('kim@x.com');
  let people = await owner.members();
  assert.deepEqual(people.map((p) => [p.email, p.role]), [['hana@x.com', 'owner'], ['lee@x.com', 'reader'], ['kim@x.com', 'writer']]);
  await owner.setLevel('p-lee@x.com', 'editor');
  assert.equal((await owner.members()).find((p) => p.email === 'lee@x.com')!.role, 'writer');
  await owner.removeMember('p-kim@x.com');
  people = await owner.members();
  assert.deepEqual(people.map((p) => p.email), ['hana@x.com', 'lee@x.com']);
  assert.deepEqual(owner.getSnapshot().manifest.members.map((m) => m.who), ['lee@x.com']);
  await assert.rejects(owner.removeMember('p-owner'), /owner cannot/);
  await assert.rejects(member.members(), /Only the owner/);
  await assert.rejects(member.setLevel('p-lee@x.com', 'viewer'), /Only the owner/);
  await assert.rejects(member.removeMember('p-lee@x.com'), /Only the owner/);
  assert.deepEqual(owner.getSnapshot().record.filter((e) => e.kind === 'members').map((e) => e.text), [
    'invited lee@x.com (can view)',
    'invited kim@x.com (can edit)',
    'changed lee@x.com to can edit',
    'removed kim@x.com',
  ]);
});
