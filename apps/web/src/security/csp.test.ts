import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { appCsp, helpCsp, redirectCsp, securityHeaders } from './csp';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const directives = (csp: string) => new Map(csp.split(/;\s*/).map((d) => [d.split(' ')[0]!, d.split(' ').slice(1)]));

test('vercel.json sends exactly the headers csp.ts lists', () => {
  const vercel = JSON.parse(read('../../vercel.json')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
  assert.deepEqual(vercel.headers, [{ source: '/(.*)', headers: securityHeaders() }]);
});

test('the help page carries the help policy', () => {
  const html = read('../../public/help/index.html');
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
  assert.equal(meta, helpCsp());
});

test('the app policy lists cloud hosts only for the providers that are configured', () => {
  const none = appCsp({ microsoft: false });
  assert.ok(!/microsoft|sharepoint/.test(none), none);
  assert.deepEqual(directives(none).get('frame-src'), ["'none'"]);
  const ms = directives(appCsp({ microsoft: true }));
  assert.ok(ms.get('connect-src')!.includes('https://graph.microsoft.com'));
  assert.deepEqual(ms.get('frame-src'), ["'none'"]);
});

test('no policy allows inline script or eval', () => {
  for (const csp of [appCsp({ microsoft: true }), redirectCsp(), helpCsp()]) {
    const script = directives(csp).get('script-src')!;
    assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"), csp);
    assert.deepEqual(directives(csp).get('object-src'), ["'none'"]);
    assert.deepEqual(directives(csp).get('base-uri'), ["'none'"]);
  }
});
