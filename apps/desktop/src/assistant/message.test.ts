import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantNodePath, mcpLaunch } from './argv.ts';
import { parseEndpoint } from './endpoint.ts';
import { OFFLINE, handleMcpMessage, takeLines } from './message.ts';

test('development runs Electron as Node so the GUI executable can read stdin', () => {
  assert.deepEqual(mcpLaunch('C:\\Redcolumn\\redcolumn.exe', 'C:\\Redcolumn\\resources\\assistant\\mcp-cli.js'), {
    command: 'C:\\Redcolumn\\redcolumn.exe',
    args: ['C:\\Redcolumn\\resources\\assistant\\mcp-cli.js'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
});

test('a packaged build starts the bundled Node binary, because the app fuse ignores ELECTRON_RUN_AS_NODE', () => {
  const nodePath = assistantNodePath('C:\\Redcolumn\\resources\\assistant', 'win32');
  assert.equal(nodePath, 'C:\\Redcolumn\\resources\\assistant\\node.exe');
  assert.equal(assistantNodePath('/Applications/redcolumn.app/Contents/Resources/assistant', 'darwin'), '/Applications/redcolumn.app/Contents/Resources/assistant/node');
  assert.deepEqual(mcpLaunch('C:\\Redcolumn\\redcolumn.exe', 'C:\\Redcolumn\\resources\\assistant\\mcp-cli.js', nodePath), {
    command: nodePath,
    args: ['C:\\Redcolumn\\resources\\assistant\\mcp-cli.js'],
    env: {},
  });
});

test('an endpoint needs a port and a 64-character token before it can be dialed', () => {
  assert.deepEqual(parseEndpoint(''), { enabled: false });
  assert.deepEqual(parseEndpoint(JSON.stringify({ enabled: true })), { enabled: true });
  const token = 'a'.repeat(64);
  assert.deepEqual(parseEndpoint(JSON.stringify({ enabled: true, port: 1, token })), { enabled: true, port: 1, token });
  assert.deepEqual(parseEndpoint(JSON.stringify({ enabled: true, port: 0, token })), { enabled: true });
});

test('stdio lines split across chunks and ignore blanks', () => {
  const state = { buf: '' };
  assert.deepEqual(takeLines(state, '{"a":1}\n{"b":'), ['{"a":1}']);
  assert.deepEqual(takeLines(state, '2}\r\n\n'), ['{"b":2}']);
  assert.equal(state.buf, '');
});

test('initialize and tools/list answer even when the app is closed', async () => {
  const init = await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }), async () => {
    throw new Error('should not call');
  });
  const parsed = JSON.parse(init ?? '') as { result: { protocolVersion: string; serverInfo: { name: string } } };
  assert.equal(parsed.result.protocolVersion, '2025-03-26');
  assert.equal(parsed.result.serverInfo.name, 'redcolumn');

  const list = JSON.parse((await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), async () => ({}))) ?? '') as { result: { tools: { name: string; title: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean; openWorldHint: boolean } }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), [
    'list_open_documents',
    'list_markups',
    'set_markup',
    'set_markups',
    'list_commands',
    'run_command',
    'get_page',
    'select_markups',
    'place_markup',
    'place_markups',
    'update_markup',
    'update_markups',
    'delete_markups',
  ]);
  const tool = (name: string) => list.result.tools.find((t) => t.name === name)!;
  assert.equal(tool('delete_markups').annotations.destructiveHint, true);
  assert.equal(tool('run_command').annotations.destructiveHint, true);
  for (const t of list.result.tools) {
    assert.ok(t.title, `${t.name} has a title`);
    assert.equal(t.annotations.openWorldHint, false, `${t.name} says it stays on this computer`);
  }
});

test('reads say they are read-only, and nothing else does', async () => {
  const list = JSON.parse((await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), async () => ({}))) ?? '') as { result: { tools: { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[] } };
  const reads = list.result.tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
  assert.deepEqual(reads, ['list_open_documents', 'list_markups', 'list_commands', 'get_page']);
  // Only the tools that remove things, or run any command, are flagged destructive.
  const flagged = list.result.tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name);
  assert.deepEqual(flagged, ['run_command', 'delete_markups']);
});

test('a tool call reaches the app, and a closed app is a plain message', async () => {
  const ok = JSON.parse((await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_open_documents', arguments: {} } }), async (name) => ({ via: name }))) ?? '') as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(ok.result.isError, false);
  assert.deepEqual(JSON.parse(ok.result.content[0]!.text), { via: 'list_open_documents' });

  const closed = JSON.parse((await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_markups', arguments: {} } }), async () => {
    throw new Error(OFFLINE);
  })) ?? '') as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(closed.result.isError, false);
  assert.equal(closed.result.content[0]!.text, OFFLINE);
  assert.equal(await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), async () => ({})), null);
});
