// Writes THIRD_PARTY_NOTICES.md: the licence of every package shipped in production
// (pnpm licenses list --prod), with each package's own licence and notice files.
// Run after changing dependencies: node scripts/third-party-notices.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// pnpm is a .cmd script on Windows, which needs a shell to start.
const byLicence = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }));

const packages = Object.entries(byLicence)
  .flatMap(([licence, list]) => list.map((p) => ({ ...p, licence })))
  .filter((p) => !p.name.startsWith('@nb/'))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Licence, notice and copying files in a package's folder. */
const licenceFiles = (dir, pattern = /^(licen[cs]e|notice|copying|copyright)/i) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => pattern.test(f))
        .sort()
        .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8').trim() }))
    : [];

/** The libraries compiled into PDFium, by their licence file in scripts/notices/pdfium/. */
const PDFIUM_PARTS = {
  'agg.txt': 'Anti-Grain Geometry 2.3',
  'freetype-ftl.txt': 'FreeType (FreeType License)',
  'lcms.txt': 'Little CMS',
  'libjpeg-turbo.md': 'libjpeg-turbo',
  'libpng.txt': 'libpng',
  'openjpeg.txt': 'OpenJPEG',
  'zlib.txt': 'zlib',
};

/** Notes for packages whose bundled contents carry more than their package.json says. */
const NOTES = {
  '@embedpdf/pdfium':
    'Bundles PDFium (BSD-3-Clause and Apache-2.0, in LICENSE.pdfium below) compiled to WebAssembly, with the libraries a standard PDFium build includes. Their licences follow, from scripts/notices/pdfium/.',
  'node-forge': 'Dual-licensed BSD-3-Clause or GPL-2.0; redcolumn uses it under BSD-3-Clause.',
  'dictionary-en': 'The English Hunspell dictionary, derived from SCOWL (wordlist.sourceforge.net). Its copyright notices are below.',
  'dictionary-en-gb': 'The British English Hunspell dictionary, derived from SCOWL (wordlist.sourceforge.net). Its copyright notices are below.',
  'dictionary-de': 'The German Hunspell dictionary (igerman98, by Björn Jacke), licensed GPL-2.0 or GPL-3.0. redcolumn ships it unmodified as separate data files (spell/de-DE.aff and spell/de-DE.dic) that the spell checker reads; its source is at https://www.j3e.de/ispell/igerman98/. Its licence is below.',
  'dictionary-fr': 'The French Hunspell dictionary (Dicollecte, by Olivier R.), licensed MPL-2.0. redcolumn ships it unmodified as separate data files (spell/fr-FR.aff and spell/fr-FR.dic) that the spell checker reads; its source is at https://grammalecte.net/. Its licence is below.',
  'dictionary-en-au': 'The Australian English Hunspell dictionary, derived from SCOWL (wordlist.sourceforge.net). Its copyright notices are below.',
};
for (const lang of ['deu', 'eng', 'fra', 'ita', 'nld', 'por', 'spa'])
  NOTES[`@tesseract.js-data/${lang}`] =
    'Tesseract trained data. The npm package is MIT; the data comes from the tesseract-ocr/tessdata project, Copyright Google Inc., licensed under the Apache License 2.0.';
NOTES['@pdf-lib/standard-fonts'] =
  'Contains font metrics for the 14 standard PDF fonts derived from Adobe Core14 AFM files, Copyright Adobe Systems Incorporated, which may be copied and distributed for any purpose provided the copyright notice is kept.';

/** Files shipped with the app that do not come from npm, with their licence in scripts/notices/. */
const BUNDLED = [
  {
    name: 'Liberation Fonts',
    version: '2.1.5',
    licence: 'OFL-1.1',
    homepage: 'https://github.com/liberationfonts/liberation-fonts',
    note: 'Liberation Sans, Serif and Mono (public/fonts), embedded in PDF/A exports in place of Helvetica, Times and Courier, and in PDFs converted from CAD drawings in place of their fonts.',
    file: 'liberation-fonts.txt',
  },
  {
    name: 'Liberation Sans Narrow',
    version: '1.07.5',
    licence: 'GPL-2.0-only WITH Font-exception-2.0',
    homepage: 'https://github.com/liberationfonts/liberation-sans-narrow',
    note: 'Liberation Sans Narrow (public/fonts), metric-compatible with Arial Narrow; used for on-screen rendering and PDF embedding when Arial Narrow is not installed on the computer.',
    file: 'liberation-sans-narrow.txt',
  },
  {
    name: 'Node.js',
    version: '24.21.0',
    licence: 'MIT',
    homepage: 'https://nodejs.org',
    note: 'The packaged local assistant runs on this Node.js binary (resources/assistant/node.exe on Windows, node on macOS and Linux). The Electron RunAsNode fuse is off, so the app executable cannot run the assistant. The binary also includes other software; the complete licence from that Node.js distribution is shipped beside it as LICENSE-node.txt. The MIT licence for Node.js itself follows.',
    file: 'node.txt',
  },
  {
    name: 'ACadSharp',
    version: '3.8.35 (d9f3de8)',
    licence: 'MIT',
    homepage: 'https://github.com/DomCR/ACadSharp',
    note: 'The DWG reader in apps/web/src/cad/dwg is ported from ACadSharp: its file container, bit-stream, LZ77 and object reading follow ACadSharp’s, rewritten in TypeScript.',
    file: 'acadsharp.txt',
  },
  {
    name: 'ONNX Runtime Web',
    version: '1.31.1',
    licence: 'MIT',
    homepage: 'https://github.com/microsoft/onnxruntime',
    note: "Search by meaning in the desktop app runs its embedding model with ONNX Runtime Web\'s CPU (WebAssembly) build, shipped as resources/semantic/ort (apps/desktop/scripts/fetch-search-models.mjs).",
    file: 'onnxruntime-web.txt',
  },
  {
    name: 'mdbr-leaf-ir (MongoDB)',
    version: '4262131b',
    licence: 'Apache-2.0',
    homepage: 'https://huggingface.co/MongoDB/mdbr-leaf-ir',
    note: "Search by meaning in the desktop app embeds page text with this model: the publisher\'s 8-bit quantised ONNX export and its tokenizer, unmodified, shipped as resources/semantic (revision 4262131b, apps/desktop/scripts/fetch-search-models.mjs).",
    file: 'mdbr-leaf-ir.txt',
  },
];

const out = [
  '# Third-party notices',
  '',
  'redcolumn is licensed under the Apache License 2.0 (see LICENSE). It includes the third-party',
  'software below, each under its own licence. This file is generated by',
  '`scripts/third-party-notices.mjs` from the production dependencies.',
  '',
  '| Package | Version | Licence |',
  '|---|---|---|',
  ...packages.map((p) => `| ${p.name} | ${p.versions.join(', ')} | ${p.licence} |`),
  ...BUNDLED.map((b) => `| ${b.name} | ${b.version} | ${b.licence} |`),
  '',
];
for (const p of packages) {
  out.push(`## ${p.name} ${p.versions.join(', ')}`, '', `Licence: ${p.licence}${p.homepage ? ` · ${p.homepage}` : ''}`, '');
  if (NOTES[p.name]) out.push(NOTES[p.name], '');
  const files = licenceFiles(p.paths[0]);
  if (!files.length) out.push(`No licence file is included in the package; it declares ${p.licence}${p.author ? `, by ${p.author}` : ''}.`, '');
  if (p.name === '@embedpdf/pdfium') files.push(...licenceFiles(join(root, 'scripts/notices/pdfium'), /./).map((f) => ({ ...f, name: PDFIUM_PARTS[f.name] ?? f.name })));
  for (const f of files) out.push(`<details><summary>${f.name}</summary>`, '', '```text', f.text, '```', '', '</details>', '');
}
for (const b of BUNDLED) {
  const text = readFileSync(join(root, 'scripts/notices', b.file), 'utf8').trim();
  out.push(`## ${b.name} ${b.version}`, '', `Licence: ${b.licence} · ${b.homepage}`, '', b.note, '', '<details><summary>LICENSE</summary>', '', '```text', text, '```', '', '</details>', '');
}
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), out.join('\n'));
console.log(`THIRD_PARTY_NOTICES.md: ${packages.length} packages`);
