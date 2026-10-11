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
  const none = appCsp({ google: false, microsoft: false });
  assert.ok(!/google|microsoft|sharepoint/.test(none), none);
  assert.deepEqual(directives(none).get('frame-src'), ["'none'"]);
  const ms = directives(appCsp({ google: false, microsoft: true }));
  assert.ok(ms.get('connect-src')!.includes('https://graph.microsoft.com'));
  assert.ok(!ms.get('script-src')!.some((s) => s.includes('google')));
  const g = directives(appCsp({ google: true, microsoft: false }));
  assert.ok(g.get('script-src')!.includes('https://accounts.google.com/gsi/client'));
});

test('no policy allows inline script or eval', () => {
  for (const csp of [appCsp({ google: true, microsoft: true }), redirectCsp(), helpCsp()]) {
    const script = directives(csp).get('script-src')!;
    assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"), csp);
    assert.deepEqual(directives(csp).get('object-src'), ["'none'"]);
    assert.deepEqual(directives(csp).get('base-uri'), ["'none'"]);
  }
});
