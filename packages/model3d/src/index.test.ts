import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the 3D libraries are pinned exactly', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const [name, version] of Object.entries({
    '@thatopen/components': '3.6.0',
    '@thatopen/components-front': '3.6.1',
    '@thatopen/fragments': '3.6.1',
    'web-ifc': '0.0.80',
  })) {
    assert.equal(pkg.dependencies[name], version, name);
  }
});
