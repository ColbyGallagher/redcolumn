import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { faceBytes, SystemFonts, systemFontDirs } from './fonts.ts';

// Liberation fonts (SIL Open Font License) ship with the web app.
const FONTS = path.resolve(import.meta.dirname, '../../web/public/fonts');

async function folder(files: Record<string, string | Buffer>) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'rc-fonts-')));
  for (const [name, source] of Object.entries(files)) {
    const target = path.join(dir, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (typeof source === 'string') await fs.copyFile(path.join(FONTS, source), target);
    else await fs.writeFile(target, source);
  }
  return dir;
}

test('font files are listed by family with their styles', async () => {
  const dir = await folder({ 'a.ttf': 'LiberationSans-Regular.ttf', 'b.ttf': 'LiberationSans-BoldItalic.ttf', 'sub/c.ttf': 'LiberationMono-Regular.ttf', 'notes.txt': Buffer.from('x'), 'broken.ttf': Buffer.from('not a font at all, just text') });
  const list = await new SystemFonts([dir]).list();
  assert.deepEqual(list.map((f) => f.family), ['Liberation Mono', 'Liberation Sans']);
  const sans = list[1]!;
  assert.deepEqual(sans.styles.map((s) => [s.style, s.bold, s.italic]), [['Regular', false, false], ['Bold Italic', true, true]]);
  for (const s of sans.styles) assert.match(s.id, /^[0-9a-f]{32}$/);
});

test('a listed id gives the font file, and nothing else does', async () => {
  const dir = await folder({ 'a.ttf': 'LiberationSans-Regular.ttf' });
  const fonts = new SystemFonts([dir]);
  const id = (await fonts.list())[0]!.styles[0]!.id;
  const bytes = await fonts.read(id);
  assert.deepEqual(Buffer.from(bytes), await fs.readFile(path.join(FONTS, 'LiberationSans-Regular.ttf')));
  for (const bad of ['', 'nope', '../../etc/passwd', path.join(dir, 'a.ttf'), 'a.ttf', 0, null, undefined, {}, ['x']]) {
    await assert.rejects(fonts.read(bad), /not available/, String(bad));
  }
});

test('ids from before a list are refused, and the page never gets a path', async () => {
  const dir = await folder({ 'a.ttf': 'LiberationSans-Regular.ttf' });
  const list = await new SystemFonts([dir]).list();
  assert.equal(JSON.stringify(list).includes(dir), false);
  const other = new SystemFonts([dir]);
  await assert.rejects(other.read(list[0]!.styles[0]!.id), /not available/);
});

test('a link out of the font folder is refused', async (t) => {
  const outside = await folder({ 'secret.ttf': 'LiberationSans-Regular.ttf' });
  const dir = await folder({});
  try {
    await fs.symlink(path.join(outside, 'secret.ttf'), path.join(dir, 'link.ttf'));
  } catch {
    t.skip('symlinks are not allowed here');
    return;
  }
  assert.deepEqual(await new SystemFonts([dir]).list(), []);
});

test('missing folders are skipped and the list is cached', async () => {
  const dir = await folder({ 'a.ttf': 'LiberationSans-Regular.ttf' });
  const fonts = new SystemFonts([path.join(dir, 'nope'), dir]);
  const first = await fonts.list();
  await fs.rm(path.join(dir, 'a.ttf'));
  assert.equal(await fonts.list(), first);
});

test('a font collection is listed per face and read out as a standalone font', async () => {
  const ttf = await fs.readFile(path.join(FONTS, 'LiberationSans-Regular.ttf'));
  // A one-face collection: 16 bytes of header, then the font with its table offsets moved on by 16.
  const head = Buffer.alloc(16);
  head.write('ttcf', 0, 'latin1');
  head.writeUInt32BE(0x00010000, 4);
  head.writeUInt32BE(1, 8);
  head.writeUInt32BE(16, 12);
  const body = Buffer.from(ttf);
  const count = body.readUInt16BE(4);
  for (let i = 0; i < count; i++) body.writeUInt32BE(body.readUInt32BE(12 + i * 16 + 8) + 16, 12 + i * 16 + 8);
  const ttc = Buffer.concat([head, body]);
  const dir = await folder({ 'x.ttc': ttc });
  const fonts = new SystemFonts([dir]);
  const list = await fonts.list();
  assert.equal(list[0]!.family, 'Liberation Sans');
  const out = Buffer.from(await fonts.read(list[0]!.styles[0]!.id));
  assert.equal(out.toString('latin1', 0, 4), '\0\x01\0\0');
  // Every table of the original is in the copy with the same bytes.
  for (let i = 0; i < count; i++) {
    const tag = ttf.toString('latin1', 12 + i * 16, 16 + i * 16);
    const [o, l] = [ttf.readUInt32BE(12 + i * 16 + 8), ttf.readUInt32BE(12 + i * 16 + 12)];
    const j = [...Array(out.readUInt16BE(4)).keys()].find((k) => out.toString('latin1', 12 + k * 16, 16 + k * 16) === tag)!;
    const [o2, l2] = [out.readUInt32BE(12 + j * 16 + 8), out.readUInt32BE(12 + j * 16 + 12)];
    assert.equal(l2, l);
    assert.ok(ttf.subarray(o, o + l).equals(out.subarray(o2, o2 + l2)), tag);
  }
  assert.throws(() => faceBytes(ttc, 5), /not available/);
});

test('the font folders per system', () => {
  assert.deepEqual(systemFontDirs('win32', { WINDIR: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }), ['C:\\Windows\\Fonts', 'C:\\Users\\me\\AppData\\Local\\Microsoft\\Windows\\Fonts'].map((p) => path.join(p)));
  assert.deepEqual(systemFontDirs('darwin', {}, '/Users/me'), ['/System/Library/Fonts', '/Library/Fonts', path.join('/Users/me', 'Library', 'Fonts')]);
});
