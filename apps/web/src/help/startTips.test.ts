import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { TIP_PAGES, inlineParts, parseTip } from './startTips.ts';

const page = (id: string) => readFileSync(new URL(`../../public/help/pages/${id}.md`, import.meta.url), 'utf8');

test('every tip page exists and has a step-by-step with a picture', () => {
  for (const id of TIP_PAGES) {
    const tip = parseTip(page(id));
    assert.ok(tip, id);
    assert.ok(tip.steps.length >= 3 && tip.steps.length <= 10, `${id} has ${tip.steps.length} steps`);
    for (const s of tip.steps) assert.ok(!s.text.includes('!['), `${id}: picture left in a step`);
    if (tip.image) assert.ok(existsSync(new URL(`../../public/help/${tip.image.src}`, import.meta.url)), `${id}: ${tip.image.src}`);
  }
});

test('a tip takes the title, intro, numbered steps, sub-choices, last picture and note', () => {
  const tip = parseTip(`# Compare two drawings

Compare finds every difference
between two revisions.

## Compare

1. Open both revisions.
2. Choose {{Document > Compare Documents…}}.

   ![The window](img/compare-dialog.png)
3. Choose the **Pages**:
   - **All pages** — best.
   - **One page**.
4. Click **Compare**.

   ![The result](img/compare-results.png)

## See the results

1. Not part of the tip.

> **Tip:** Turn on **Align**
> for scans.
`)!;
  assert.equal(tip.title, 'Compare two drawings');
  assert.equal(tip.intro, 'Compare finds every difference between two revisions.');
  assert.deepEqual(
    tip.steps.map((s) => s.text),
    ['Open both revisions.', 'Choose {{Document > Compare Documents…}}.', 'Choose the **Pages**:', 'Click **Compare**.'],
  );
  assert.deepEqual(tip.steps[2]!.sub, ['**All pages** — best.', '**One page**.']);
  assert.deepEqual(tip.image, { src: 'img/compare-results.png', alt: 'The result' });
  assert.equal(tip.note, 'Turn on **Align** for scans.');
});

test('pages without a numbered list give no tip', () => {
  assert.equal(parseTip('# Glossary\n\nWords.\n\n- A\n- B\n'), null);
  assert.equal(parseTip('No title'), null);
});

test('help text splits into keys, menus, bold and links', () => {
  assert.deepEqual(inlineParts('Press [[Ctrl+Plus]] or choose {{File > Open}}, then **OK** — see [Scale](#scale).'), [
    { kind: 'text', text: 'Press ' },
    { kind: 'keys', keys: ['Ctrl', '+'] },
    { kind: 'text', text: ' or choose ' },
    { kind: 'menu', path: ['File', 'Open'] },
    { kind: 'text', text: ', then ' },
    { kind: 'bold', text: 'OK' },
    { kind: 'text', text: ' — see ' },
    { kind: 'link', text: 'Scale', page: 'scale', url: null },
    { kind: 'text', text: '.' },
  ]);
});

test('italics inside bold do not break the bold', () => {
  assert.deepEqual(inlineParts('**Old page *n* with new page *n***, or *this*.'), [
    { kind: 'bold', text: 'Old page n with new page n' },
    { kind: 'text', text: ', or ' },
    { kind: 'text', text: 'this' },
    { kind: 'text', text: '.' },
  ]);
});
