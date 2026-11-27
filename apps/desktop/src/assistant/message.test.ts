import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { assistantNodePath, mcpLaunch, parseMcpCliArgs } from './argv.ts';
import { parseEndpoint } from './endpoint.ts';
import { ASSISTANT_METHODS, COMPACT_CORE_METHODS, OFFLINE, handleMcpMessage, takeLines, toolContent } from './message.ts';
import { attachStdio } from './stdio.ts';

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
    'get_page_image',
    'get_page_text',
    'select_markups',
    'place_markup',
    'place_markups',
    'update_markup',
    'update_markups',
    'delete_markups',
    'list_assemblies',
    'propose_takeoff',
    'list_takeoff_proposals',
    'find_symbol_matches',
    'propose_counts',
    'list_count_proposals',
    'propose_grouping_column',
    'list_grouping_columns',
    'propose_grouping_tool',
    'list_grouping_tools',
    'run_grouping_tool',
    'get_review_packet',
    'report_review_findings',
    'start_comparison',
    'get_comparison',
    'report_document_changes',
    'get_stitching',
    'set_stitch_region',
    'place_match_lines',
    'update_match_lines',
    'delete_match_lines',
    'get_stitch_image',
    'show_stitched_view',
    'stitch_to_page',
    'list_viewports',
    'place_viewport',
    'place_viewports',
    'set_viewport_scale',
    'get_sheet_info',
    'propose_page_scale',
    'get_drawing_standard',
    'list_sheet_links',
    'get_sheet_graph',
    'propose_sheet_links',
    'propose_standard_hints',
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
  assert.deepEqual(reads, ['list_open_documents', 'list_markups', 'list_commands', 'get_page', 'get_page_image', 'get_page_text', 'list_assemblies', 'list_takeoff_proposals', 'find_symbol_matches', 'list_count_proposals', 'list_grouping_columns', 'list_grouping_tools', 'get_review_packet', 'get_comparison', 'get_stitching', 'get_stitch_image', 'list_viewports', 'get_sheet_info', 'get_drawing_standard', 'list_sheet_links', 'get_sheet_graph']);
  // Only the tools that remove things, or run any command, are flagged destructive.
  const flagged = list.result.tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name);
  assert.deepEqual(flagged, ['run_command', 'delete_markups', 'delete_match_lines']);
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

test('a page picture rides along as an image block, beside the text the model reads it by', () => {
  const picture = toolContent({ page: 3, scale: 2, region: { x: 0, y: 0, w: 100, h: 50 }, image: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } });
  assert.equal(picture.isError, false);
  assert.deepEqual(picture.content.map((c) => c.type), ['text', 'image']);
  assert.deepEqual(JSON.parse((picture.content[0] as { text: string }).text), { page: 3, scale: 2, region: { x: 0, y: 0, w: 100, h: 50 } });
  assert.deepEqual(picture.content[1], { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' });
  // Anything that is not a picture, image key or not, stays one text block.
  assert.deepEqual(toolContent({ image: 'none' }).content, [{ type: 'text', text: '{"image":"none"}' }]);
  assert.deepEqual(toolContent({ image: { mimeType: 'text/plain', data: 'x' } }).content.length, 1);
  assert.deepEqual(toolContent('plain').content, [{ type: 'text', text: 'plain' }]);
});

test('mcpLaunch appends --compact when requested and parseMcpCliArgs validates flags', () => {
  assert.deepEqual(mcpLaunch('C:\\Redcolumn\\redcolumn.exe', 'mcp-cli.js', undefined, true), {
    command: 'C:\\Redcolumn\\redcolumn.exe',
    args: ['mcp-cli.js', '--compact'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
  assert.deepEqual(mcpLaunch('C:\\Redcolumn\\redcolumn.exe', 'mcp-cli.js', 'node.exe', true), {
    command: 'node.exe',
    args: ['mcp-cli.js', '--compact'],
    env: {},
  });
  assert.deepEqual(parseMcpCliArgs([]), { compact: false });
  assert.deepEqual(parseMcpCliArgs(['--compact']), { compact: true });
  const bad = parseMcpCliArgs(['--unknown']);
  assert.equal(bad.compact, false);
  assert.match(bad.error ?? '', /Unknown argument: --unknown/);
});

test('compact mode lists the 10 core tools plus tool_search and tool_call', async () => {
  const res = JSON.parse(
    (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), async () => ({}), { compact: true })) ?? '',
  ) as { result: { tools: { name: string; title: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean; openWorldHint: boolean } }[] } };

  assert.deepEqual(
    res.result.tools.map((t) => t.name),
    [...COMPACT_CORE_METHODS, 'tool_search', 'tool_call'],
  );
  const searchTool = res.result.tools.find((t) => t.name === 'tool_search')!;
  assert.deepEqual(searchTool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  const callTool = res.result.tools.find((t) => t.name === 'tool_call')!;
  assert.deepEqual(callTool.annotations, { readOnlyHint: false, destructiveHint: true, openWorldHint: false });
});

test('tool_search lists all tools compactly without a query and returns full schemas for matches', async () => {
  const neverCall = async () => {
    throw new Error('tool_search should not call the desktop app');
  };

  const allRes = JSON.parse(
    (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tool_search', arguments: {} } }), neverCall, { compact: true })) ?? '',
  ) as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(allRes.result.isError, false);
  const all = JSON.parse(allRes.result.content[0]!.text) as { tools: Record<string, unknown>[] };
  assert.equal(all.tools.length, ASSISTANT_METHODS.length);
  for (const t of all.tools) {
    assert.deepEqual(Object.keys(t).sort(), ['annotations', 'name', 'title']);
  }

  // Whitespace-only query behaves the same as omitted query.
  const blankRes = JSON.parse(
    (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tool_search', arguments: { query: '   ' } } }), neverCall, { compact: true })) ?? '',
  ) as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(JSON.parse(blankRes.result.content[0]!.text).tools.length, ASSISTANT_METHODS.length);

  // Case-insensitive search across name, title, and description returns full schemas.
  const stitchRes = JSON.parse(
    (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tool_search', arguments: { query: 'STITCH' } } }), neverCall, { compact: true })) ?? '',
  ) as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(stitchRes.result.isError, false);
  const stitch = JSON.parse(stitchRes.result.content[0]!.text) as { tools: { name: string; title: string; description: string; inputSchema: unknown; annotations: unknown }[] };
  assert.ok(stitch.tools.length > 0);
  assert.ok(stitch.tools.some((t) => t.name === 'get_stitching'));
  for (const t of stitch.tools) {
    assert.ok(t.description);
    assert.ok(t.inputSchema);
    assert.ok(t.annotations);
  }

  const noneRes = JSON.parse(
    (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tool_search', arguments: { query: 'definitely_no_such_tool_xyz' } } }), neverCall, { compact: true })) ?? '',
  ) as { result: { content: { text: string }[]; isError: boolean } };
  assert.deepEqual(JSON.parse(noneRes.result.content[0]!.text), { tools: [] });
});

test('tool_call forwards valid tools including images and errors, and refuses unknown or recursive names', async () => {
  const seen: { name: string; args: Record<string, unknown> }[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    seen.push({ name, args });
    if (name === 'get_stitch_image') {
      return { page: 1, scale: 1.5, image: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } };
    }
    if (name === 'list_assemblies') {
      throw new Error('No document is open.');
    }
    if (name === 'list_viewports') {
      throw new Error(OFFLINE);
    }
    return { ok: true, name, args };
  };

  // Normal forwarding + default arguments.
  const ok = JSON.parse(
    (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tool_call', arguments: { name: 'get_sheet_info', arguments: { page: 2 } } } }), call, { compact: true })) ?? '',
  ) as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(ok.result.isError, false);
  assert.deepEqual(JSON.parse(ok.result.content[0]!.text), { ok: true, name: 'get_sheet_info', args: { page: 2 } });
  assert.deepEqual(seen.at(-1), { name: 'get_sheet_info', args: { page: 2 } });

  // Omitted arguments defaults to {}.
  await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tool_call', arguments: { name: 'get_sheet_info' } } }), call, { compact: true });
  assert.deepEqual(seen.at(-1), { name: 'get_sheet_info', args: {} });

  // Image blocks are preserved.
  const img = JSON.parse(
    (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tool_call', arguments: { name: 'get_stitch_image', arguments: { page: 1 } } } }), call, { compact: true })) ?? '',
  ) as { result: { content: { type: string; text?: string; mimeType?: string; data?: string }[]; isError: boolean } };
  assert.equal(img.result.isError, false);
  assert.deepEqual(img.result.content.map((c) => c.type), ['text', 'image']);
  assert.deepEqual(img.result.content[1], { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' });

  // Error handling preserves isError semantics (true for tool errors, false for OFFLINE).
  const errRes = JSON.parse(
    (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tool_call', arguments: { name: 'list_assemblies' } } }), call, { compact: true })) ?? '',
  ) as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(errRes.result.isError, true);
  assert.equal(errRes.result.content[0]!.text, 'No document is open.');

  const offlineRes = JSON.parse(
    (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'tool_call', arguments: { name: 'list_viewports' } } }), call, { compact: true })) ?? '',
  ) as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(offlineRes.result.isError, false);
  assert.equal(offlineRes.result.content[0]!.text, OFFLINE);

  // Refuses unknown and recursive tool names without calling the app.
  const before = seen.length;
  for (const badName of ['does_not_exist', 'tool_search', 'tool_call', '', 123, undefined]) {
    const res = JSON.parse(
      (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'tool_call', arguments: badName === undefined ? {} : { name: badName } } }), call, { compact: true })) ?? '',
    ) as { result: { content: { text: string }[]; isError: boolean } };
    assert.equal(res.result.isError, true, `refuses ${String(badName)}`);
  }
  assert.equal(seen.length, before);

  // Direct call to a non-core tool still works in compact mode.
  const direct = JSON.parse(
    (await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_sheet_graph', arguments: { page: 1 } } }), call, { compact: true })) ?? '',
  ) as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(direct.result.isError, false);
  assert.deepEqual(JSON.parse(direct.result.content[0]!.text), { ok: true, name: 'get_sheet_graph', args: { page: 1 } });
});

test('attachStdio forwards compact option to handleMcpMessage', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));

  const mcp = attachStdio(input, output, async () => ({}), { compact: true });
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
  await new Promise<void>((resolve) => {
    input.once('mcp-idle', resolve);
    mcp.closeWhenDrained();
  });
  const reply = JSON.parse(chunks.join('').trim()) as { result: { tools: { name: string }[] } };
  assert.deepEqual(
    reply.result.tools.map((t) => t.name),
    [...COMPACT_CORE_METHODS, 'tool_search', 'tool_call'],
  );
  mcp.stop();
});
