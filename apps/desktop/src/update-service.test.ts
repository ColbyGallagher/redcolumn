import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { UpdateService, type NativeUpdater, type UpdateState } from './update-service.ts';

class FakeNative extends EventEmitter {
  installs: [boolean, boolean][] = [];
  /** What checkForUpdates does: emit events, then resolve. */
  onCheck: () => void | Promise<void> = () => this.emit('update-not-available');
  async checkForUpdates() {
    await this.onCheck();
    return null;
  }
  quitAndInstall(silent: boolean, run: boolean) {
    this.installs.push([silent, run]);
  }
}

const release = { tag: 'v0.2.0', url: 'https://github.com/ColbyGallagher/redcolumn/releases/tag/v0.2.0' };

function service(opts: { native?: FakeNative | null; latest?: typeof release | null; unsaved?: boolean }) {
  const states: UpdateState[] = [];
  const native = opts.native === undefined ? null : opts.native;
  const svc = new UpdateService({
    current: '0.1.8',
    native: native as unknown as NativeUpdater | null,
    fetchLatest: async () => (opts.latest === undefined ? release : opts.latest),
    hasUnsavedChanges: () => opts.unsaved ?? false,
  });
  svc.onChange = (s) => states.push(s);
  return { svc, states };
}

test('without a native updater a newer release is offered with its page', async () => {
  const { svc } = service({});
  assert.deepEqual(await svc.check(), { status: 'available', current: '0.1.8', latest: '0.2.0', url: release.url });
});

test('the same or an older release is the latest', async () => {
  assert.equal((await service({ latest: { ...release, tag: 'v0.1.8' } }).svc.check()).status, 'latest');
  assert.equal((await service({ latest: { ...release, tag: 'v0.1.0' } }).svc.check()).status, 'latest');
});

test('a release that cannot be read is unavailable', async () => {
  assert.equal((await service({ latest: null }).svc.check()).status, 'unavailable');
});

test('the native updater downloads in the background and reports each whole percent once', async () => {
  const native = new FakeNative();
  native.onCheck = () => {
    native.emit('update-available', { version: '0.2.0' });
    native.emit('download-progress', { percent: 10.2 });
    native.emit('download-progress', { percent: 10.9 });
    native.emit('download-progress', { percent: 55 });
  };
  const { svc, states } = service({ native });
  const state = await svc.check();
  assert.deepEqual(state, { status: 'downloading', current: '0.1.8', latest: '0.2.0', percent: 55 });
  assert.deepEqual(
    states.map((s) => s.percent),
    [undefined, 0, 10, 55],
  );
  native.emit('update-downloaded', { version: '0.2.0' });
  assert.deepEqual(svc.state, { status: 'ready', current: '0.1.8', latest: '0.2.0' });
});

test('a check does not disturb a download or a finished download', async () => {
  const native = new FakeNative();
  let checks = 0;
  native.onCheck = () => {
    checks++;
    native.emit('update-available', { version: '0.2.0' });
  };
  const { svc } = service({ native });
  await svc.check();
  assert.equal((await svc.check()).status, 'downloading');
  native.emit('update-downloaded', { version: '0.2.0' });
  assert.equal((await svc.check()).status, 'ready');
  assert.equal(checks, 1);
});

test('checks that overlap share one request', async () => {
  const native = new FakeNative();
  let checks = 0;
  native.onCheck = async () => {
    checks++;
    await new Promise((r) => setTimeout(r, 5));
    native.emit('update-not-available');
  };
  const { svc } = service({ native });
  const [a, b] = await Promise.all([svc.check(), svc.check()]);
  assert.equal(checks, 1);
  assert.equal(a.status, 'latest');
  assert.equal(b.status, 'latest');
});

test('an error while checking is unavailable, and a later check can succeed', async () => {
  const native = new FakeNative();
  native.onCheck = () => {
    native.emit('error', new Error('offline'));
    throw new Error('offline');
  };
  const { svc } = service({ native });
  assert.equal((await svc.check()).status, 'unavailable');
  native.onCheck = () => native.emit('update-not-available');
  assert.equal((await svc.check()).status, 'latest');
});

test('an error after the download finished keeps it ready', async () => {
  const native = new FakeNative();
  native.onCheck = () => {
    native.emit('update-available', { version: '0.2.0' });
    native.emit('update-downloaded', { version: '0.2.0' });
  };
  const { svc } = service({ native });
  await svc.check();
  native.emit('error', new Error('late'));
  assert.equal(svc.state.status, 'ready');
});

test('a native check that says nothing is not left checking', async () => {
  const native = new FakeNative();
  native.onCheck = () => undefined;
  assert.equal((await service({ native }).svc.check()).status, 'unavailable');
});

test('install restarts silently into a ready update', async () => {
  const native = new FakeNative();
  native.onCheck = () => {
    native.emit('update-available', { version: '0.2.0' });
    native.emit('update-downloaded', { version: '0.2.0' });
  };
  const { svc } = service({ native });
  await svc.check();
  assert.deepEqual(svc.install(), { ok: true });
  assert.deepEqual(native.installs, [[true, true]]);
});

test('install does not restart over unsaved changes', async () => {
  const native = new FakeNative();
  native.onCheck = () => {
    native.emit('update-available', { version: '0.2.0' });
    native.emit('update-downloaded', { version: '0.2.0' });
  };
  const { svc } = service({ native, unsaved: true });
  await svc.check();
  const result = svc.install();
  assert.equal(result.ok, false);
  assert.deepEqual(native.installs, []);
});

test('install needs a downloaded update', async () => {
  assert.equal(service({ native: new FakeNative() }).svc.install().ok, false);
  const { svc } = service({});
  await svc.check();
  assert.equal(svc.install().ok, false);
});
