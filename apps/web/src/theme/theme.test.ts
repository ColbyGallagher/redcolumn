import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyTheme, resolveTheme, THEMES } from './themes';

test('the chosen theme is used', () => {
  assert.equal(resolveTheme('light', true).id, 'light');
  assert.equal(resolveTheme('graphite', false).id, 'graphite');
});

test('"system", and a theme that no longer exists, follow the system', () => {
  assert.equal(resolveTheme('system', true).id, 'navy');
  assert.equal(resolveTheme('system', false).id, 'light');
  assert.equal(resolveTheme('retired', false).id, 'light');
});

test('there is a dark and a light theme to follow the system with', () => {
  assert.ok(THEMES.some((t) => t.dark));
  assert.ok(THEMES.some((t) => !t.dark));
});

test('applyTheme sets data-theme and the theme-color meta tag', () => {
  let content = '';
  const meta = { setAttribute: (_: string, v: string) => void (content = v) };
  const doc = { documentElement: { dataset: {} as Record<string, string> }, querySelector: () => meta } as unknown as Document;
  const light = resolveTheme('light', true);
  applyTheme(light, doc);
  assert.equal(doc.documentElement.dataset.theme, 'light');
  assert.equal(content, light.color);
});

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('public/theme-init.js knows every theme and its colour', () => {
  const init = read('../../public/theme-init.js');
  for (const t of THEMES) assert.ok(init.includes(`${t.id}: '${t.color}'`), t.id);
});

test('every theme defines every token navy does', () => {
  const css = read('./themes.css');
  const tokens = (id: string) => {
    const out = new Set<string>();
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = m[1] ?? '';
      const applies = selector.includes(`data-theme='${id}'`) || (id === 'navy' && /(^|\s):root,/.test(selector));
      if (applies) for (const d of (m[2] ?? '').matchAll(/(--[a-z0-9-]+):/g)) out.add(d[1] ?? '');
    }
    return out;
  };
  const navy = tokens('navy');
  assert.ok(navy.size > 30);
  for (const t of THEMES) for (const name of navy) assert.ok(tokens(t.id).has(name), `${t.id} lacks ${name}`);
});
