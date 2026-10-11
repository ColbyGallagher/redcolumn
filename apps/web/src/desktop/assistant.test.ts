import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkupStore, type Markup } from '@nb/markup';
import { assistantCall, assistantDocuments, type AssistantDocument } from './assistant.ts';
import { clientSetups } from './clients.ts';

function markup(partial: Partial<Markup> & Pick<Markup, 'id' | 'type'>): Markup {
  return {
    pageIndex: 0,
    points: [
      [0, 0],
      [72, 0],
    ],
    style: { stroke: '#000', fill: null, width: 1, opacity: 1 },
    status: 'none',
    author: 'Ada',
    createdAt: 1,
    modifiedAt: 1,
    ...partial,
  };
}

async function doc(name: string, active: boolean): Promise<AssistantDocument> {
  const store = await MarkupStore.open(`assistant-${name}-${Math.random()}`, { persist: false });
  store.add(markup({ id: 'door', type: 'length', text: 'D1', subject: 'Door', comment: 'check', seq: 1 }));
  store.setDetectedSheets([[0, { number: 'A-101', title: 'Floor plan', discipline: null, scaleText: null, revision: null, source: 'manual', confidence: 1 }]]);
  return { id: name.toLowerCase(), name, pageCount: 2, pageIndex: 0, active, store };
}

test('the active drawing is listed once, with its sheet and measurement', async () => {
  const a = await doc('A-101.pdf', true);
  const copy = { ...a, active: false };
  const listed = assistantCall([copy, a], 'list_open_documents', {}) as { documents: { name: string; page: number; sheetNumber: string; active: boolean }[] };
  assert.equal(listed.documents.length, 1);
  assert.equal(listed.documents[0]!.name, 'A-101.pdf');
  assert.equal(listed.documents[0]!.page, 1);
  assert.equal(listed.documents[0]!.sheetNumber, 'A-101');
  assert.equal(listed.documents[0]!.active, true);
  assert.equal(assistantDocuments([copy, a]).length, 1);

  const markups = assistantCall([a], 'list_markups', { page: 1 }) as { markups: { id: string; status: string; measurement?: string }[] };
  assert.equal(markups.markups[0]!.id, 'door');
  assert.equal(markups.markups[0]!.status, 'None');
  assert.ok(markups.markups[0]!.measurement);
});

test('setting a status is its own undo step', async () => {
  const drawing = await doc('A-101.pdf', true);
  const changed = assistantCall([drawing], 'set_markup', { seq: 1, status: 'Accepted' }) as { markup: { status: string } };
  assert.equal(changed.markup.status, 'Accepted');
  assert.equal(drawing.store.get('door')?.status, 'accepted');
  drawing.store.undo();
  assert.equal(drawing.store.get('door')?.status, 'none');
  assert.throws(() => assistantCall([drawing], 'set_markup', { id: 'missing', status: 'Accepted' }), /No markup missing/);
  assert.throws(() => assistantCall([], 'list_markups', {}), /No document is open/);
});

test('a custom column can be set by name, and a calculation cannot', async () => {
  const drawing = await doc('A-101.pdf', true);
  drawing.store.setColumnSet({
    columns: [
      { id: 'trade', name: 'Trade', type: 'text' },
      { id: 'cost', name: 'Cost', type: 'formula', formula: '1' },
    ],
    statuses: drawing.store.columnSet().statuses,
  });
  assistantCall([drawing], 'set_markup', { id: 'door', field: 'Trade', value: 'Doors' });
  assert.equal(drawing.store.get('door')?.fields?.trade, 'Doors');
  assert.throws(() => assistantCall([drawing], 'set_markup', { id: 'door', field: 'Cost', value: '4' }), /calculated/);
});

test('each client starts this installation as Node', () => {
  const launch = { command: 'C:\\Program Files\\redcolumn\\redcolumn.exe', args: ['C:\\Program Files\\redcolumn\\resources\\assistant\\mcp-cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const clients = clientSetups(launch, 'win');
  assert.deepEqual(clients.map((c) => c.id), ['copilot', 'claude', 'claude-code', 'codex', 'cursor']);
  for (const client of clients) assert.match(client.copy, /redcolumn\.exe/);
  assert.match(clients[2]!.copy, /^claude mcp add --scope user redcolumn --env ELECTRON_RUN_AS_NODE=1 -- '/);
  assert.match(clients[3]!.copy, /^codex mcp add redcolumn --env ELECTRON_RUN_AS_NODE=1 -- '/);
  assert.match(clients[3]!.copy, /\[mcp_servers\.redcolumn\]/);
  const cursor = new URL(clients[4]!.href!);
  const config = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor.searchParams.get('config') ?? ''), (c) => c.charCodeAt(0)))) as { command: string; args: string[]; env: { ELECTRON_RUN_AS_NODE: string } };
  assert.deepEqual(config.args, launch.args);
  assert.equal(config.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(config.command, launch.command);
  const vscode = new URL(clients[0]!.href!);
  const vscodeConfig = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(decodeURIComponent(vscode.searchParams.get('config') ?? '')), (c) => c.charCodeAt(0)))) as { type: string };
  assert.equal(vscodeConfig.type, 'stdio');
});
