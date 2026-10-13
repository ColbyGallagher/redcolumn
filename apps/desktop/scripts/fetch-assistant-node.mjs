// Downloads the Node binary the packaged assistant runs. The app's RunAsNode fuse is off, so
// redcolumn.exe cannot run mcp-cli.js. Hashes are the official SHASUMS256.txt for this version.
// Bump scripts/notices/node.txt and THIRD_PARTY_NOTICES.md when VERSION changes.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const VERSION = '24.21.0';
const execFileAsync = promisify(execFile);

/** @type {Record<string, { file: string, sha256: string, node: string, license: string, binaryName: string }>} */
const ASSETS = {
  'win32-x64': {
    file: `node-v${VERSION}-win-x64.zip`,
    sha256: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
    node: `node-v${VERSION}-win-x64/node.exe`,
    license: `node-v${VERSION}-win-x64/LICENSE`,
    binaryName: 'node.exe',
  },
  'win32-arm64': {
    file: `node-v${VERSION}-win-arm64.zip`,
    sha256: '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921',
    node: `node-v${VERSION}-win-arm64/node.exe`,
    license: `node-v${VERSION}-win-arm64/LICENSE`,
    binaryName: 'node.exe',
  },
  'darwin-x64': {
    file: `node-v${VERSION}-darwin-x64.tar.gz`,
    sha256: '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
    node: `node-v${VERSION}-darwin-x64/bin/node`,
    license: `node-v${VERSION}-darwin-x64/LICENSE`,
    binaryName: 'node',
  },
  'darwin-arm64': {
    file: `node-v${VERSION}-darwin-arm64.tar.gz`,
    sha256: 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
    node: `node-v${VERSION}-darwin-arm64/bin/node`,
    license: `node-v${VERSION}-darwin-arm64/LICENSE`,
    binaryName: 'node',
  },
  'linux-x64': {
    file: `node-v${VERSION}-linux-x64.tar.gz`,
    sha256: '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff',
    node: `node-v${VERSION}-linux-x64/bin/node`,
    license: `node-v${VERSION}-linux-x64/LICENSE`,
    binaryName: 'node',
  },
  'linux-arm64': {
    file: `node-v${VERSION}-linux-arm64.tar.gz`,
    sha256: '724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5',
    node: `node-v${VERSION}-linux-arm64/bin/node`,
    license: `node-v${VERSION}-linux-arm64/LICENSE`,
    binaryName: 'node',
  },
};

// --arch=x64 or --arch=arm64 packages for another architecture than this machine's (the macOS
// release job builds both DMGs on one runner). Defaults to this machine's.
const arch = process.argv.find((a) => a.startsWith('--arch='))?.slice('--arch='.length) ?? process.arch;

const desktopRoot = path.join(import.meta.dirname, '..');
const outDir = path.join(desktopRoot, 'dist', 'assistant');
const cacheDir = path.join(desktopRoot, 'dist', '.node-cache');

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`);
  if (!response.url.startsWith('https://')) throw new Error(`Refused a non-https download: ${response.url}`);
  const partial = `${dest}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  await rename(partial, dest);
}

async function archivePath(asset) {
  const dest = path.join(cacheDir, asset.file);
  const existing = await sha256(dest).catch(() => '');
  if (existing === asset.sha256) return dest;
  await rm(dest, { force: true });
  const url = `https://nodejs.org/dist/v${VERSION}/${asset.file}`;
  console.log(`Downloading ${url}`);
  await download(url, dest);
  const actual = await sha256(dest);
  if (actual !== asset.sha256) {
    await rm(dest, { force: true });
    throw new Error(`Node archive hash is ${actual}, expected ${asset.sha256}. It was not packaged.`);
  }
  return dest;
}

async function main() {
  const asset = ASSETS[`${process.platform}-${arch}`];
  if (!asset) throw new Error(`No assistant Node binary is pinned for ${process.platform}-${arch}.`);
  await mkdir(outDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const binary = path.join(outDir, asset.binaryName);
  const license = path.join(outDir, 'LICENSE-node.txt');
  // Records which archive dist/assistant was extracted from, so switching --arch re-extracts.
  const stamp = path.join(cacheDir, 'extracted.ok');
  const extracted = await readFile(stamp, 'utf8').catch(() => '');
  if (extracted.trim() === asset.sha256 && await stat(binary).then(() => true, () => false) && await stat(license).then(() => true, () => false)) {
    const size = await stat(binary);
    console.log(`assistant node ${VERSION} already present (${size.size} bytes)`);
    return;
  }
  const archive = await archivePath(asset);
  const extractDir = path.join(cacheDir, 'extract');
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  // The archive argument is a file name in cwd, so it has no drive letter. Windows
  // bsdtar (GitHub runners) rejects --force-local, which GNU tar would want only for a path with a colon.
  await execFileAsync('tar', ['-xf', path.basename(archive), '-C', 'extract', asset.node, asset.license], { cwd: cacheDir });
  await copyFile(path.join(extractDir, asset.node), binary);
  await copyFile(path.join(extractDir, asset.license), license);
  if (process.platform !== 'win32') await chmod(binary, 0o755);
  await writeFile(stamp, `${asset.sha256}\n`);
  const size = await stat(binary);
  console.log(`assistant node ${VERSION} (${process.platform}-${arch}, ${size.size} bytes)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
