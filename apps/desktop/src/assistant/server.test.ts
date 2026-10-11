import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callAssistant, requestAssistant } from './client.ts';
import { newToken, writeEndpoint } from './endpoint.ts';
import { OFFLINE } from './message.ts';
import { listenForAssistant } from './server.ts';
import { AssistantService } from './service.ts';

test('the listener accepts the launch token and refuses any other', async () => {
  const token = newToken();
  const listener = await listenForAssistant(token, async (method, params) => ({ method, params }));
  try {
    assert.deepEqual(await requestAssistant(listener.port, token, 'list_open_documents', { page: 2 }), { method: 'list_open_documents', params: { page: 2 } });
    await assert.rejects(requestAssistant(listener.port, 'b'.repeat(64), 'list_open_documents', {}), (err: unknown) => err instanceof Error && err.message === OFFLINE);
    await assert.rejects(requestAssistant(listener.port, token, 'not_a_tool', {}), (err: unknown) => err instanceof Error && err.message === 'Unknown tool.');
  } finally {
    await listener.close();
  }
});

test('turning the assistant on writes a dialable endpoint, and quitting drops the port', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redcolumn-assistant-'));
  const file = path.join(dir, 'assistant.json');
  const service = new AssistantService(file, async () => ({ documents: [] }));
  try {
    assert.equal(await callAssistant(file, 'list_open_documents', {}).then(() => 'up', (err: unknown) => (err instanceof Error ? err.message : '')), OFFLINE);
    const on = await service.setEnabled(true);
    assert.equal(on.enabled, true);
    assert.deepEqual(await callAssistant(file, 'list_open_documents', {}), { documents: [] });
    service.suspend();
    assert.equal(await callAssistant(file, 'list_open_documents', {}).then(() => 'up', (err: unknown) => (err instanceof Error ? err.message : '')), OFFLINE);
    const kept = JSON.parse(fs.readFileSync(file, 'utf8')) as { enabled: boolean; port?: number };
    assert.equal(kept.enabled, true);
    assert.equal(kept.port, undefined);
  } finally {
    service.suspend();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a remembered switch starts listening again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redcolumn-assistant-'));
  const file = path.join(dir, 'assistant.json');
  writeEndpoint(file, { enabled: true });
  const service = new AssistantService(file, async (method) => method);
  try {
    await service.restore();
    assert.equal(await callAssistant(file, 'list_markups', {}), 'list_markups');
  } finally {
    service.suspend();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
