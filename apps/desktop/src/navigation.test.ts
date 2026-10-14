import assert from 'node:assert/strict';
import test from 'node:test';
import { externalProtocol, isAppNavigation, isAppOrigin, isHelpUrl } from './navigation.ts';

test('packaged navigations stay on app://redcolumn', () => {
  assert.equal(isAppNavigation('app://redcolumn/index.html', false), true);
  assert.equal(isAppNavigation('app://other/index.html', false), false);
  assert.equal(isAppNavigation('https://example.com/', false), false);
  assert.equal(isAppNavigation('blob:app://redcolumn/11111111-1111-1111-1111-111111111111', false), true);
});

test('dev navigations stay on the Vite server', () => {
  assert.equal(isAppNavigation('http://127.0.0.1:5173/help/index.html', true), true);
  assert.equal(isAppNavigation('http://127.0.0.1:5174/', true), false);
  assert.equal(isAppNavigation('app://redcolumn/', true), false);
});

test('help is recognised only on the app origin', () => {
  assert.equal(isHelpUrl('app://redcolumn/help/index.html', false), true);
  assert.equal(isHelpUrl('http://127.0.0.1:5173/help/index.html', true), true);
  assert.equal(isHelpUrl('http://127.0.0.1:5173/help/index.html', false), false);
  assert.equal(isHelpUrl('https://example.com/help/index.html', false), false);
  assert.equal(isHelpUrl('https://example.com/help/index.html', true), false);
  assert.equal(isHelpUrl('app://redcolumn/index.html', false), false);
});

test('permissions are granted to the app origin only', () => {
  assert.equal(isAppOrigin('app://redcolumn', false), true);
  assert.equal(isAppOrigin('app://redcolumn/index.html', false), true);
  assert.equal(isAppOrigin('https://example.com', false), false);
  assert.equal(isAppOrigin('http://127.0.0.1:5173', true), true);
  assert.equal(isAppOrigin('', false), false);
});

test('http, https, mailto, and the assistant install links leave the app', () => {
  assert.equal(externalProtocol('https://onedrive.live.com/'), 'https:');
  assert.equal(externalProtocol('mailto:a@b.c?subject=Hi'), 'mailto:');
  assert.equal(externalProtocol('cursor://anysphere.cursor-deeplink/mcp/install?name=redcolumn'), 'cursor:');
  assert.equal(externalProtocol('vscode://mcp/install'), 'vscode:');
  assert.equal(externalProtocol('file:///C:/secret.pdf'), null);
  assert.equal(externalProtocol('not a url'), null);
});
