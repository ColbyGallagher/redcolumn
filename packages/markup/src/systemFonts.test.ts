import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFString, PDFHexString } from 'pdf-lib';
import { exportWithAnnotations, type FontFallbackReason } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { DEFAULT_STYLES, type Markup, type MarkupStyle, type MarkupType } from './model.ts';
import { canEmbedFont, cleanFontName, cssFontFamily, daFontName, familyFromPdfName, fontKeyword, fontPermissions, isFontKeyword, isNamedFont, isTrueTypeOutline } from './fonts.ts';
import { cssFont } from './style.ts';
import { writeBtx } from './revuWrite.ts';
import { parseBtx, type ToolChestItem } from './toolchest.ts';
import { parseDefaultStyle } from './bluebeam.ts';

// Liberation Sans (SIL OFL, apps/web/public/fonts) stands in for an installed font.
const SANS = new Uint8Array(readFileSync(new URL('../../../apps/web/public/fonts/LiberationSans-Regular.ttf', import.meta.url)));

/** A copy of the font with its OS/2 fsType set. */
function withFsType(bytes: Uint8Array, fsType: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  const v = new DataView(copy.buffer);
  const count = v.getUint16(4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(...copy.slice(rec, rec + 4)) === 'OS/2') {
      v.setUint16(v.getUint32(rec + 8) + 8, fsType);
      return copy;
    }
  }
  throw new Error('no OS/2');
}

test('keywords and installed names are told apart', () => {
  assert.equal(isFontKeyword('serif'), true);
  assert.equal(isFontKeyword('Segoe UI'), false);
  assert.equal(isNamedFont('Segoe UI'), true);
  assert.equal(isNamedFont('mono'), false);
  assert.equal(isNamedFont(undefined), false);
  assert.equal(isNamedFont('  '), false);
});

test('a named font falls back to the nearest keyword', () => {
  assert.equal(fontKeyword(undefined), 'sans');
  assert.equal(fontKeyword('mono'), 'mono');
  assert.equal(fontKeyword('Cascadia Mono'), 'mono');
  assert.equal(fontKeyword('Consolas'), 'mono');
  assert.equal(fontKeyword('Georgia'), 'serif');
  assert.equal(fontKeyword('Cambria'), 'serif');
  assert.equal(fontKeyword('Noto Sans'), 'sans');
  assert.equal(fontKeyword('Segoe UI'), 'sans');
  assert.equal(fontKeyword('Comic Neue'), 'sans');
});

test('names are cleaned, and the css stack ends in the keyword fallback', () => {
  assert.equal(cleanFontName('  Segoe   UI '), 'Segoe UI');
  assert.equal(cleanFontName('Seri"f<x>'), 'Seri f x');
  assert.equal(cleanFontName('SERIF'), 'serif');
  assert.equal(cleanFontName('  '), undefined);
  assert.equal(cssFontFamily('Georgia'), '"Georgia", "Times New Roman", Times, serif');
  assert.equal(cssFontFamily('mono'), '"Courier New", Courier, monospace');
  assert.equal(cssFont({ ...DEFAULT_STYLES.text, fontFamily: 'Segoe UI', bold: true }, 12), 'bold 12px "Segoe UI", Helvetica, Arial, sans-serif');
  assert.equal(daFontName('sans'), 'Helv');
  assert.equal(daFontName('Segoe UI'), 'SegoeUI');
});

test('pdf font names read back as keywords or the font name', () => {
  assert.equal(familyFromPdfName('Helv'), 'sans');
  assert.equal(familyFromPdfName('Arial-BoldMT'), 'sans');
  assert.equal(familyFromPdfName('TimesNewRomanPS-BoldMT'), 'serif');
  assert.equal(familyFromPdfName('Times New Roman'), 'serif');
  assert.equal(familyFromPdfName('CourierNewPSMT'), 'mono');
  assert.equal(familyFromPdfName('Calibri-Bold'), 'Calibri');
  assert.equal(familyFromPdfName('ABCDEF+Segoe UI'), 'Segoe UI');
  assert.equal(familyFromPdfName('Arial Narrow'), 'Arial Narrow');
});

test('fsType decides whether a font may be embedded', () => {
  assert.equal(fontPermissions(SANS)?.embedding, 'installable');
  assert.equal(isTrueTypeOutline(SANS), true);
  assert.equal(canEmbedFont(SANS), true);
  assert.equal(fontPermissions(withFsType(SANS, 0x0004))?.embedding, 'preview');
  assert.equal(canEmbedFont(withFsType(SANS, 0x0004)), true);
  assert.equal(fontPermissions(withFsType(SANS, 0x0008))?.embedding, 'editable');
  assert.equal(canEmbedFont(withFsType(SANS, 0x0008)), true);
  assert.equal(canEmbedFont(withFsType(SANS, 0x0002)), false);
  assert.equal(canEmbedFont(withFsType(SANS, 0x0202)), false);
  assert.equal(fontPermissions(withFsType(SANS, 0x0100))?.noSubsetting, true);
  assert.equal(fontPermissions(new Uint8Array(4)), null);
});

const box = (family: string | undefined, extra: Partial<Markup['style']> = {}): Markup => ({
  id: 't1',
  type: 'text',
  pageIndex: 0,
  points: [[20, 20], [220, 120]],
  style: { ...DEFAULT_STYLES.text, ...(family ? { fontFamily: family } : {}), ...extra },
  text: 'Hello world',
  status: 'none',
  author: 'Tester',
  createdAt: 1,
  modifiedAt: 1,
});

async function exportBox(m: Markup, font: Uint8Array | null) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const fallbacks: [string, FontFallbackReason][] = [];
  const out = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m], {
    systemFonts: { fontkit, load: async () => font },
    onFontFallback: (f, r) => fallbacks.push([f, r]),
  });
  const saved = await PDFDocument.load(out);
  const annot = saved.getPage(0).node.Annots()!.lookup(0, PDFDict);
  const da = (annot.lookup(PDFName.of('DA')) as PDFString | PDFHexString).decodeText();
  const ds = (annot.lookup(PDFName.of('DS')) as PDFString | PDFHexString).decodeText();
  const ap = annot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as PDFRawStream;
  const apDict = ap.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
  const baseFonts = apDict.keys().map((k: PDFName) => (apDict.lookup(k, PDFDict).lookup(PDFName.of('BaseFont')) as PDFName).decodeText());
  const hasFontFile2 = [...saved.context.enumerateIndirectObjects()].some(([, o]) => o instanceof PDFDict && o.has(PDFName.of('FontFile2')));
  let fontFileBytes = 0;
  for (const [, o] of saved.context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFDict) || !o.has(PDFName.of('FontFile2'))) continue;
    const file = o.lookup(PDFName.of('FontFile2'));
    if (file instanceof PDFRawStream) fontFileBytes += file.contents.length;
  }
  return { da, ds, baseFonts, hasFontFile2, fontFileBytes, fallbacks };
}

test('export embeds a named font and names it in /DA and the rich text', async () => {
  const r = await exportBox(box('Test Face'), SANS);
  assert.ok(r.hasFontFile2, 'a font file is embedded');
  assert.match(r.da, /^\/TestFace /);
  assert.match(r.ds, /font: Test Face 12pt/);
  assert.deepEqual(r.fallbacks, []);
  assert.ok(r.baseFonts.some((n: string) => /LiberationSans/.test(n)), JSON.stringify(r.baseFonts));
  assert.ok(r.fontFileBytes < 60000, `a subset, not the whole 400 KB file (${r.fontFileBytes})`);
});

test('keyword fonts still use the standard fonts', async () => {
  const r = await exportBox(box('serif'), SANS);
  assert.equal(r.hasFontFile2, false);
  assert.match(r.da, /^\/TiRo /);
});

test('a restricted-license font is not embedded and the nearest standard font is used', async () => {
  const r = await exportBox(box('Georgia'), withFsType(SANS, 0x0002));
  assert.equal(r.hasFontFile2, false);
  assert.match(r.da, /^\/TiRo /);
  assert.match(r.ds, /font: Times New Roman/);
  assert.deepEqual(r.fallbacks, [['Georgia', 'restricted']]);
});

test('preview-and-print and editable fonts are embedded', async () => {
  assert.equal((await exportBox(box('Test Face'), withFsType(SANS, 0x0004))).hasFontFile2, true);
  assert.equal((await exportBox(box('Test Face'), withFsType(SANS, 0x0008))).hasFontFile2, true);
});

test('a font whose bytes cannot be had falls back to the standard font', async () => {
  const r = await exportBox(box('Consolas'), null);
  assert.equal(r.hasFontFile2, false);
  assert.match(r.da, /^\/Cour /);
  assert.deepEqual(r.fallbacks, [['Consolas', 'unavailable']]);
});

const annot = (partial: Partial<ImportableAnnotation>): ImportableAnnotation => ({
  index: 0, subtype: 'FreeText', rect: { x: 100, y: 100, w: 80, h: 30 }, color: null, interior: null, opacity: 1, borderWidth: 0, contents: 'Hi', author: 'Jane', intent: '',
  cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null, ...partial,
});

test('import keeps a non-standard font name', () => {
  const { markups } = importAnnotations(0, [annot({ da: '/Calibri 11 Tf 0 0 0 rg' })]);
  assert.equal(markups[0]!.style.fontFamily, 'Calibri');
  const std = importAnnotations(0, [annot({ da: '/Helv 11 Tf 0 0 0 rg' })]).markups[0]!;
  assert.equal(std.style.fontFamily, undefined);
  assert.equal(importAnnotations(0, [annot({ da: '/TiRo 11 Tf 0 0 0 rg' })]).markups[0]!.style.fontFamily, 'serif');
});

test('a tool chest keeps a named font through write and read', async () => {
  const style: MarkupStyle = { ...DEFAULT_STYLES.text, fontFamily: 'Segoe UI', fontSize: 14 };
  const items: ToolChestItem[] = [{ id: 't', name: 'Note', subject: 'Note', type: 'text', revuType: '', style }];
  const xml = await writeBtx({ title: 'Fonts', items });
  const back = await parseBtx(xml, new Proxy({} as Record<MarkupType, MarkupStyle>, { get: (_, k) => DEFAULT_STYLES[k as MarkupType] ?? style }));
  assert.equal(back.items[0]!.style.fontFamily, 'Segoe UI');
});

test('rich text style reads a named font', () => {
  assert.equal(parseDefaultStyle('font: Calibri 12pt; color:#000000').fontFamily, 'Calibri');
  assert.equal(parseDefaultStyle('font: bold Arial 10pt').fontFamily, undefined);
  assert.equal(parseDefaultStyle('font: Times New Roman,Bold 9pt').fontFamily, 'serif');
  assert.equal(parseDefaultStyle("font-family: 'Segoe UI', sans-serif").fontFamily, 'Segoe UI');
});
