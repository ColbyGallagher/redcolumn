// Converts every DWG/DXF under a folder and reports what happened to each: whether it converted,
// how long it took, its pages, and what the converter could not draw. For checking the DWG/DXF
// import (issue #230) against real drawings, which stay on your machine.
//
//   pnpm cad:corpus <folder> [--out <dir>] [--pdf] [--timeout <seconds>] [--only <text>]
//
// Writes <out>/corpus.json (one record per drawing) and <out>/corpus.md (the summary), and with
// --pdf each converted PDF beside them. <out> defaults to reference_data/cad-corpus (not committed).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

if (!isMainThread) {
  // One drawing, in its own thread so a hang or a crash cannot stop the run.
  const { file, fontsDir, pdfPath } = workerData;
  const { convertCad, readDrawing } = await import(new URL('../apps/web/src/cad/convert.ts', import.meta.url).href);
  const font = (n) => new Uint8Array(readFileSync(join(fontsDir, `Liberation${n}-Regular.ttf`)));
  const fonts = { sans: font('Sans'), serif: font('Serif'), mono: font('Mono') };
  const bytes = new Uint8Array(readFileSync(file));
  const t0 = performance.now();
  try {
    const read = readDrawing(basename(file), bytes);
    const tRead = performance.now() - t0;
    const { pdf, report } = await convertCad(basename(file), bytes, { fonts });
    if (pdfPath) writeFileSync(pdfPath, pdf);
    parentPort.postMessage({
      ok: true,
      readMs: Math.round(tRead),
      ms: Math.round(performance.now() - t0),
      version: report.version,
      entities: read.drawing.modelSpace.length,
      pdfBytes: pdf.length,
      pages: report.pages.map((p) => ({ name: p.name, w: Math.round(p.widthPt), h: Math.round(p.heightPt), scale: p.scale, viewports: p.viewports.map((v) => v.scale) })),
      warnings: report.warnings,
    });
  } catch (err) {
    parentPort.postMessage({ ok: false, ms: Math.round(performance.now() - t0), error: String(err?.message ?? err), kind: err?.constructor?.name ?? 'Error', stack: String(err?.stack ?? '').split('\n').slice(1, 4).map((s) => s.trim()) });
  }
} else {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const folder = args.find((a, i) => !a.startsWith('--') && !['--out', '--timeout', '--only'].includes(args[i - 1]));
  if (!folder) {
    console.error('Usage: pnpm cad:corpus <folder> [--out <dir>] [--pdf] [--timeout <seconds>] [--only <text>]');
    process.exit(2);
  }
  const out = resolve(opt('--out', join(ROOT, 'reference_data', 'cad-corpus')));
  const timeout = Number(opt('--timeout', '120')) * 1000;
  const only = opt('--only', '');
  mkdirSync(out, { recursive: true });

  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(dwg|dxf)$/i.test(name) && (!only || p.includes(only))) files.push(p);
    }
  };
  walk(resolve(folder));
  files.sort();

  const records = [];
  const seen = new Set();
  for (const [i, file] of files.entries()) {
    const bytes = readFileSync(file);
    const head = bytes.subarray(0, 64).toString('latin1');
    const rel = relative(resolve(folder), file);
    if (head.startsWith('version https://git-lfs')) {
      records.push({ file: rel, skipped: 'Git LFS pointer, not a drawing' });
      continue;
    }
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    if (seen.has(hash)) {
      records.push({ file: rel, skipped: 'duplicate of an earlier file' });
      continue;
    }
    seen.add(hash);
    const pdfPath = flag('--pdf') ? join(out, `${String(i).padStart(4, '0')}-${basename(file).replace(/\.[^.]+$/, '')}.pdf`) : null;
    const result = await new Promise((done) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { file, fontsDir: join(ROOT, 'apps/web/public/fonts'), pdfPath }, execArgv: process.execArgv });
      const timer = setTimeout(() => {
        void w.terminate();
        done({ ok: false, error: `timed out after ${timeout / 1000} s`, kind: 'Timeout' });
      }, timeout);
      w.once('message', (m) => {
        clearTimeout(timer);
        void w.terminate();
        done(m);
      });
      w.once('error', (e) => {
        clearTimeout(timer);
        done({ ok: false, error: String(e?.message ?? e), kind: 'WorkerError' });
      });
    });
    const record = { file: rel, bytes: bytes.length, head: head.slice(0, 6), ...result };
    records.push(record);
    const tag = result.ok ? `ok ${result.ms} ms, ${result.pages.length} p, ${result.warnings.length} w` : `FAIL ${result.kind}: ${result.error}`;
    console.log(`[${i + 1}/${files.length}] ${rel} — ${tag}`);
  }
  writeFileSync(join(out, 'corpus.json'), JSON.stringify(records, null, 1));
  writeFileSync(join(out, 'corpus.md'), summary(records));
  console.log(`\nWrote ${join(out, 'corpus.md')}`);
}

/** Text for a Markdown table cell: backslashes first, then pipes, escaped; line breaks as spaces. */
const cell = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function summary(records) {
  const tried = records.filter((r) => !r.skipped);
  const ok = tried.filter((r) => r.ok);
  const failed = tried.filter((r) => !r.ok);
  const lines = ['# CAD corpus', '', `${tried.length} drawings tried (${records.length - tried.length} skipped): ${ok.length} converted, ${failed.length} failed.`, ''];
  const byVersion = {};
  for (const r of tried) {
    const v = (byVersion[r.head] ??= { ok: 0, fail: 0 });
    r.ok ? v.ok++ : v.fail++;
  }
  lines.push('| Version | Converted | Failed |', '|---|---|---|', ...Object.entries(byVersion).map(([v, c]) => `| ${v} | ${c.ok} | ${c.fail} |`), '');
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  if (times.length) lines.push(`Time: median ${times[times.length >> 1]} ms, slowest ${times.at(-1)} ms.`, '');
  const errors = {};
  for (const r of failed) (errors[`${r.kind}: ${r.error}`] ??= []).push(r.file);
  if (failed.length) {
    lines.push('## Failures', '', '| Error | Drawings | Example |', '|---|---|---|');
    for (const [e, fs] of Object.entries(errors).sort((a, b) => b[1].length - a[1].length)) lines.push(`| ${cell(e)} | ${fs.length} | ${cell(fs[0])} |`);
    lines.push('');
  }
  const kinds = {};
  const skipped = {};
  for (const r of ok) {
    for (const k of new Set(r.warnings.map((w) => w.kind))) kinds[k] = (kinds[k] ?? 0) + 1;
    for (const w of r.warnings) {
      if (w.kind === 'unsupported') {
        const s = (skipped[w.type] ??= { drawings: 0, count: 0 });
        s.drawings++;
        s.count += w.count;
      }
    }
  }
  lines.push('## Warnings (drawings with each)', '', '| Kind | Drawings |', '|---|---|', ...Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`), '');
  lines.push('## Not drawn', '', '| Type | Drawings | Objects |', '|---|---|---|', ...Object.entries(skipped).sort((a, b) => b[1].drawings - a[1].drawings).map(([k, s]) => `| ${k} | ${s.drawings} | ${s.count} |`), '');
  return lines.join('\n');
}
