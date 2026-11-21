import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fontExport, fontFallbackNotice, markupsUseNamedFonts, missingFontsNotice, setFontNoticeSink, afterFontNotice } from './fontNotices.ts';

test('says nothing when nothing fell back', () => {
  assert.equal(fontFallbackNotice([]), null);
  assert.equal(missingFontsNotice([]), null);
});

test('explains a licence restriction in plain words', () => {
  assert.equal(fontFallbackNotice([{ family: 'Segoe Script', reason: 'restricted' }]), "Segoe Script isn't allowed to be embedded by its licence, so Helvetica was used in the PDF.");
});

test('names the nearest standard font and groups several fonts by reason', () => {
  const text = fontFallbackNotice([
    { family: 'Georgia', reason: 'restricted' },
    { family: 'Consolas', reason: 'restricted' },
    { family: 'Old Face', reason: 'unavailable' },
  ])!;
  assert.ok(text.includes("Georgia and Consolas aren't allowed to be embedded by their licence, so Times and Courier were used in the PDF."), text);
  assert.ok(text.includes("Old Face couldn't be read from this computer, so Helvetica was used in the PDF."), text);
});

test('lists missing fonts quietly', () => {
  assert.equal(missingFontsNotice(['Gill Sans MT', 'Calibri']), "This document uses fonts not installed here: Gill Sans MT, Calibri. They're shown in a similar font.");
});

test('only loads fonts when a markup names one', () => {
  const text = (fontFamily?: string) => [{ style: { fontFamily }, type: 'text' }] as never;
  assert.equal(markupsUseNamedFonts(text('serif')), false);
  assert.equal(markupsUseNamedFonts(text(undefined)), false);
  assert.equal(markupsUseNamedFonts(text('Calibri')), true);
});

test('a later notice follows a font notice instead of replacing it', async () => {
  let shown: string | null = null;
  const unset = setFontNoticeSink((m) => (shown = m));
  const fx = await fontExport([]);
  fx.onFontFallback('Segoe Script', 'restricted');
  fx.done();
  unset();
  assert.ok(shown !== null);
  assert.equal(afterFontNotice(shown, 'Saved plan.pdf.'), `${shown} Saved plan.pdf.`);
  assert.equal(afterFontNotice('Something else.', 'Saved plan.pdf.'), 'Saved plan.pdf.');
  assert.equal(afterFontNotice(null, 'Saved plan.pdf.'), 'Saved plan.pdf.');
});
