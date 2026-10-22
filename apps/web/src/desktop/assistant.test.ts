import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkupStore, type Markup } from '@nb/markup';
import { assistantCall, assistantDocuments, isDestructiveCommand, type AssistantCommand, type AssistantDocument, type AssistantTools } from './assistant.ts';
import { allowAssistant, assistantPrompt, confirmAssistant, denyAssistant } from './assistantConfirm.ts';
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
  return { id: name.toLowerCase(), name, pageCount: 2, pageIndex: 0, active, store, pageSize: () => ({ width: 612, height: 792 }) };
}

test('the active drawing is listed once, with its sheet and measurement', async () => {
  const a = await doc('A-101.pdf', true);
  const copy = { ...a, active: false };
  const listed = (await assistantCall([copy, a], 'list_open_documents', {})) as { documents: { name: string; page: number; sheetNumber: string; active: boolean }[] };
  assert.equal(listed.documents.length, 1);
  assert.equal(listed.documents[0]!.name, 'A-101.pdf');
  assert.equal(listed.documents[0]!.page, 1);
  assert.equal(listed.documents[0]!.sheetNumber, 'A-101');
  assert.equal(listed.documents[0]!.active, true);
  assert.equal(assistantDocuments([copy, a]).length, 1);

  const markups = (await assistantCall([a], 'list_markups', { page: 1 })) as { markups: { id: string; status: string; measurement?: string; points: number[][] }[] };
  assert.equal(markups.markups[0]!.id, 'door');
  assert.equal(markups.markups[0]!.status, 'None');
  assert.ok(markups.markups[0]!.measurement);
  assert.equal(markups.markups[0]!.points.length, 2);
});

test('setting a status is its own undo step', async () => {
  const drawing = await doc('A-101.pdf', true);
  const changed = (await assistantCall([drawing], 'set_markup', { seq: 1, status: 'Accepted' })) as { markup: { status: string } };
  assert.equal(changed.markup.status, 'Accepted');
  assert.equal(drawing.store.get('door')?.status, 'accepted');
  drawing.store.undo();
  assert.equal(drawing.store.get('door')?.status, 'none');
  await assert.rejects(() => assistantCall([drawing], 'set_markup', { id: 'missing', status: 'Accepted' }), /No markup missing/);
  await assert.rejects(() => assistantCall([], 'list_markups', {}), /No document is open/);
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
  await assistantCall([drawing], 'set_markup', { id: 'door', field: 'Trade', value: 'Doors' });
  assert.equal(drawing.store.get('door')?.fields?.trade, 'Doors');
  await assert.rejects(() => assistantCall([drawing], 'set_markup', { id: 'door', field: 'Cost', value: '4' }), /calculated/);
});

test('placing and updating a markup are each one undo step', async () => {
  const drawing = await doc('A-101.pdf', true);
  const placed = (await assistantCall([drawing], 'place_markup', { page: 1, type: 'rect', points: [[10, 10], [40, 30]], text: 'Note' })) as { markup: { id: string; text?: string } };
  assert.equal(placed.markup.text, 'Note');
  assert.equal(drawing.store.all().length, 2);
  drawing.store.undo();
  assert.equal(drawing.store.all().length, 1);

  await assistantCall([drawing], 'update_markup', { id: 'door', points: [[1, 1], [20, 1]], text: 'D2', style: { stroke: '#00ff00', width: 3 } });
  assert.equal(drawing.store.get('door')?.text, 'D2');
  assert.equal(drawing.store.get('door')?.style.stroke, '#00ff00');
  assert.deepEqual(drawing.store.get('door')?.points, [[1, 1], [20, 1]]);
  drawing.store.undo();
  assert.equal(drawing.store.get('door')?.text, 'D1');
  assert.equal(drawing.store.get('door')?.style.stroke, '#000');
});

async function crowded(count: number) {
  const drawing = await doc('A-101.pdf', true);
  for (let i = 0; i < count; i++) {
    drawing.store.add(markup({ id: `r${i}`, type: i % 2 ? 'rect' : 'cloud', pageIndex: i % 2, text: `Item ${i}`, comment: i === 3 ? 'Check the Header' : undefined }));
  }
  return drawing;
}

test('list_markups filters, pages, trims, and counts', async () => {
  const drawing = await crowded(10);
  type Listed = { total: number; offset: number; nextOffset?: number; markups: { id: string; type: string; points?: unknown; style?: unknown; author?: string; text?: string }[] };
  const list = (params: unknown) => assistantCall([drawing], 'list_markups', params) as Promise<Listed>;

  const all = await list({});
  assert.equal(all.total, 11);
  assert.equal(all.nextOffset, undefined);

  const clouds = await list({ type: 'cloud' });
  assert.ok(clouds.markups.length > 0 && clouds.markups.every((m) => m.type === 'cloud'));
  assert.equal(clouds.total, clouds.markups.length);
  const found = await list({ search: 'header' });
  assert.deepEqual(found.markups.map((m) => m.id), ['r3']);
  assert.equal((await list({ page: 2, type: 'rect' })).total, 5);
  assert.equal((await list({ status: 'Accepted' })).total, 0);
  await assert.rejects(() => list({ status: 'Nonsense' }), /not a status/);
  await assert.rejects(() => list({ type: 'nonsense' }), /Unknown markup type/);

  const first = await list({ limit: 4 });
  assert.equal(first.markups.length, 4);
  assert.equal(first.total, 11);
  assert.equal(first.nextOffset, 4);
  const last = await list({ limit: 4, offset: 8 });
  assert.equal(last.markups.length, 3);
  assert.equal(last.nextOffset, undefined);
  assert.deepEqual([...first.markups, ...(await list({ limit: 4, offset: 4 })).markups, ...last.markups].map((m) => m.id), all.markups.map((m) => m.id));
  await assert.rejects(() => list({ limit: 0 }), /Limit has to be a whole number/);
  await assert.rejects(() => list({ offset: -1 }), /Offset has to be a whole number/);

  const brief = await list({ detail: 'brief' });
  assert.equal(brief.markups[0]!.points, undefined);
  assert.equal(brief.markups[0]!.style, undefined);
  assert.equal(brief.markups[0]!.author, undefined);
  assert.ok(JSON.stringify(brief).length < JSON.stringify(all).length);
  assert.equal(all.markups[0]!.author, 'Ada');

  const summary = (await assistantCall([drawing], 'list_markups', { summary: true })) as { total: number; markups?: unknown; byType: Record<string, number>; byStatus: Record<string, number>; byPage: Record<string, number> };
  assert.equal(summary.total, 11);
  assert.equal(summary.markups, undefined);
  assert.equal(Object.values(summary.byType).reduce((a, b) => a + b, 0), 11);
  assert.deepEqual(summary.byStatus, { None: 11 });
  assert.deepEqual(summary.byPage, { 1: 6, 2: 5 });
});

test('list_commands narrows by text and by what can run now', async () => {
  const commands = () =>
    new Map<string, AssistantCommand>([
      ['view.zoomIn', { id: 'view.zoomIn', label: 'Zoom In', category: 'View', enabled: true, run: () => {} }],
      ['view.zoomOut', { id: 'view.zoomOut', label: 'Zoom Out', category: 'View', enabled: false, run: () => {} }],
      ['edit.undo', { id: 'edit.undo', label: 'Undo', category: 'Edit', enabled: true, run: () => {} }],
    ]);
  const ids = async (params: unknown) => ((await assistantCall([], 'list_commands', params, { commands })) as { commands: { id: string }[] }).commands.map((c) => c.id);
  assert.deepEqual(await ids({}), ['view.zoomIn', 'view.zoomOut', 'edit.undo']);
  assert.deepEqual(await ids({ query: 'ZOOM' }), ['view.zoomIn', 'view.zoomOut']);
  assert.deepEqual(await ids({ query: 'undo' }), ['edit.undo']);
  assert.deepEqual(await ids({ query: 'zoom', available: true }), ['view.zoomIn']);
  assert.deepEqual(await ids({ category: 'view', available: true }), ['view.zoomIn']);
});

test('set_markups changes many markups as one undo step, and checks them all first', async () => {
  const drawing = await crowded(5);
  const done = (await assistantCall([drawing], 'set_markups', { ids: ['r0', 'r1'], seqs: [4, 2], status: 'Accepted', comment: 'ok' })) as { updated: string[]; failed?: unknown };
  // seq 2 is r0 and seq 4 is r2: r0 is named twice and is changed once.
  assert.deepEqual(done.updated, ['r0', 'r1', 'r2']);
  assert.equal(done.failed, undefined);
  for (const id of done.updated) {
    assert.equal(drawing.store.get(id)?.status, 'accepted');
    assert.equal(drawing.store.get(id)?.comment, 'ok');
  }
  assert.equal(drawing.store.get('r3')?.status, 'none');
  drawing.store.undo();
  for (const id of done.updated) assert.equal(drawing.store.get(id)?.status, 'none');
  assert.equal(drawing.store.get('r0')?.comment, undefined);

  await assert.rejects(() => assistantCall([drawing], 'set_markups', { ids: ['r0'], status: 'Nonsense' }), /not a status/);
  await assert.rejects(() => assistantCall([drawing], 'set_markups', { ids: ['r0', 'missing'], status: 'Accepted' }), /No markup missing/);
  assert.equal(drawing.store.get('r0')?.status, 'none');
  await assert.rejects(() => assistantCall([drawing], 'set_markups', { status: 'Accepted' }), /ids or seqs/);
  await assert.rejects(() => assistantCall([drawing], 'set_markups', { ids: ['r0'] }), /Say what to change/);
  await assert.rejects(() => assistantCall([drawing], 'set_markups', { ids: Array.from({ length: 501 }, (_, i) => `r${i}`), status: 'Accepted' }), /The most is 500/);
});

test('place_markups draws many markups as one undo step, and none when one is wrong', async () => {
  const drawing = await doc('A-101.pdf', true);
  const placed = (await assistantCall([drawing], 'place_markups', {
    page: 2,
    markups: [
      { type: 'rect', points: [[0, 0], [10, 10]], text: 'A' },
      { type: 'rect', page: 1, points: [[20, 20], [30, 30]], subject: 'B' },
      { type: 'note', points: [[5, 5]] },
    ],
  })) as { placed: { id: string; seq: number; type: string; page: number }[] };
  assert.deepEqual(placed.placed.map((p) => [p.type, p.page]), [['rect', 2], ['rect', 1], ['note', 2]]);
  assert.deepEqual(placed.placed.map((p) => p.seq), [2, 3, 4]);
  assert.equal(drawing.store.all().length, 4);
  assert.equal(drawing.store.get(placed.placed[0]!.id)?.text, 'A');
  assert.equal(drawing.store.get(placed.placed[1]!.id)?.subject, 'B');
  drawing.store.undo();
  assert.equal(drawing.store.all().length, 1);

  const refuses = (markups: unknown, message: RegExp, page?: number) => assert.rejects(() => assistantCall([drawing], 'place_markups', { ...(page ? { page } : {}), markups }), message);
  await refuses([{ type: 'rect', page: 1, points: [[0, 0], [1, 1]] }, { type: 'rect', page: 1, points: [[0, 0]] }], /Markup 2: .*two opposite corners/);
  await refuses([{ type: 'rect', points: [[0, 0], [1, 1]] }], /Markup 1: Say which page/);
  await refuses([{ type: 'rect', page: 3, points: [[0, 0], [1, 1]] }], /Markup 1: Page 3 is not in/);
  await refuses([{ type: 'nonsense', page: 1, points: [[0, 0]] }], /Markup 1: Unknown markup type/);
  await refuses([{ type: 'stamp', page: 1, points: [[0, 0], [1, 1]] }], /Markup 1: .*needs a file/);
  await refuses([{ type: 'cloudPlus', page: 1, points: [[0, 0], [1, 1]] }], /Markup 1: .*Use place_markup/);
  await refuses([], /Give markups/);
  await refuses(Array.from({ length: 501 }, () => ({ type: 'rect', page: 1, points: [[0, 0], [1, 1]] })), /The most is 500/);
  assert.equal(drawing.store.all().length, 1);
});

test('place_markups draws through the tools on screen when it owns the drawing', async () => {
  const drawing = await doc('A-101.pdf', true);
  const calls: string[] = [];
  const tools: AssistantTools = {
    owns: (store) => store === drawing.store,
    place: (type, page, points) => {
      calls.push(`${type} ${page} ${points.length}`);
      const m = markup({ id: `p${calls.length}`, type, pageIndex: page, points });
      drawing.store.add(m);
      return m;
    },
    select: () => {},
  };
  await assistantCall([drawing], 'place_markups', { page: 1, markups: [{ type: 'rect', points: [[0, 0], [5, 5]] }, { type: 'ellipse', points: [[1, 1], [6, 6]] }] }, { toolsFor: () => tools });
  assert.deepEqual(calls, ['rect 0 2', 'ellipse 0 2']);
  drawing.store.undo();
  assert.equal(drawing.store.all().length, 1);
});

test('update_markups changes many markups as one undo step, and checks them all first', async () => {
  const drawing = await crowded(3);
  const done = (await assistantCall([drawing], 'update_markups', {
    markups: [
      { id: 'r0', text: 'First', style: { stroke: '#ff0000' } },
      { seq: 3, points: [[1, 1], [9, 9]] },
    ],
  })) as { updated: string[]; failed?: unknown };
  assert.deepEqual(done.updated, ['r0', 'r1']);
  assert.equal(drawing.store.get('r0')?.text, 'First');
  assert.equal(drawing.store.get('r0')?.style.stroke, '#ff0000');
  assert.deepEqual(drawing.store.get('r1')?.points, [[1, 1], [9, 9]]);
  drawing.store.undo();
  assert.equal(drawing.store.get('r0')?.text, 'Item 0');
  assert.equal(drawing.store.get('r0')?.style.stroke, '#000');
  assert.deepEqual(drawing.store.get('r1')?.points, [[0, 0], [72, 0]]);

  drawing.store.update('r2', { locked: true });
  const refuses = (markups: unknown, message: RegExp) => assert.rejects(() => assistantCall([drawing], 'update_markups', { markups }), message);
  await refuses([{ id: 'r0', text: 'Changed' }, { id: 'r2', text: 'Locked' }], /locked/);
  await refuses([{ id: 'r0', text: 'Changed' }, { id: 'r0', text: 'Again' }], /in the list twice/);
  await refuses([{ id: 'r0', text: 'Changed' }, { id: 'r1' }], /Say what to change/);
  await refuses([{ id: 'r0', text: 'Changed' }, { id: 'r1', style: { stroke: 'red' } }], /color/);
  await refuses([{ id: 'r0', text: 'Changed' }, { id: 'nope', text: 'x' }], /No markup nope/);
  await refuses([], /Give markups/);
  assert.equal(drawing.store.get('r0')?.text, 'Item 0');
});

test('deleting asks first and does nothing when denied', async () => {
  const drawing = await doc('A-101.pdf', true);
  let asked = '';
  await assert.rejects(
    () => assistantCall([drawing], 'delete_markups', { ids: ['door'] }, { confirm: async (message) => { asked = message; return false; } }),
    /Not confirmed/,
  );
  assert.match(asked, /markup 1/);
  assert.match(asked, /A-101\.pdf/);
  assert.ok(drawing.store.get('door'));

  await assistantCall([drawing], 'delete_markups', { ids: ['door'] }, { confirm: async () => true });
  assert.equal(drawing.store.get('door'), undefined);
  drawing.store.undo();
  assert.ok(drawing.store.get('door'));
});

test('a denied command does not run, and a disabled one is refused', async () => {
  const drawing = await doc('A-101.pdf', true);
  let ran = false;
  const remove: AssistantCommand = { id: 'edit.delete', label: 'Delete', category: 'Edit', enabled: true, run: () => { ran = true; } };
  const commands = () => new Map<string, AssistantCommand>([['edit.delete', remove], ['view.zoomIn', { id: 'view.zoomIn', label: 'Zoom In', category: 'View', enabled: false, run: () => { ran = true; } }]]);
  await assert.rejects(() => assistantCall([drawing], 'run_command', { id: 'edit.delete' }, { commands, confirm: async () => false }), /Not confirmed/);
  assert.equal(ran, false);
  await assert.rejects(() => assistantCall([drawing], 'run_command', { id: 'view.zoomIn' }, { commands, confirm: async () => true }), /Zoom In is not available/);
  assert.equal(ran, false);

  let confirmed = false;
  const host = globalThis as { confirm?: (message?: string) => boolean };
  host.confirm = () => {
    confirmed = true;
    return false;
  };
  remove.run = () => {
    if (!host.confirm?.('Delete 1 markup?')) throw new Error('cancelled');
  };
  try {
    await assistantCall([drawing], 'run_command', { id: 'edit.delete' }, { commands, confirm: async () => true });
    assert.equal(confirmed, false);
  } finally {
    delete host.confirm;
  }
});

test('a dialog command starts in the app and does not ask', async () => {
  let ran = false;
  const commands = () => new Map<string, AssistantCommand>([['file.open', { id: 'file.open', label: 'Open…', category: 'File', enabled: true, run: () => { ran = true; } }]]);
  const started = await assistantCall([], 'run_command', { id: 'file.open' }, { commands, confirm: async () => { throw new Error('should not ask'); } });
  assert.deepEqual(started, { started: true, needsYou: true });
  assert.equal(ran, true);
});

test('page and command failures name what went wrong', async () => {
  const drawing = await doc('A-101.pdf', true);
  await assert.rejects(() => assistantCall([drawing], 'get_page', { page: 9 }), /Page 9 is not in A-101\.pdf/);
  await assert.rejects(() => assistantCall([{ ...drawing, pageSize: () => null }], 'get_page', { page: 1 }), /Page size is not available/);
  const page = (await assistantCall([drawing], 'get_page', {})) as { page: number; width: number; height: number; scale?: string };
  assert.equal(page.page, 1);
  assert.equal(page.width, 612);
  assert.equal(page.height, 792);
  assert.equal(page.scale, undefined);
});

test('Cloud+ and Smart Fill go through the tools on screen, and say why when they cannot', async () => {
  const drawing = await doc('A-101.pdf', true);
  const cloud = markup({ id: 'c1', type: 'cloud' });
  const callout = markup({ id: 'c2', type: 'callout', text: 'Check' });
  const filled = markup({ id: 'f1', type: 'area' });
  const calls: string[] = [];
  const tools: AssistantTools = {
    owns: (store) => store === drawing.store,
    place: () => { throw new Error('not used'); },
    placeCloudPlus: (page, points, extras) => {
      calls.push(`cloud+ ${page} ${points.length} ${extras?.text}`);
      return { cloud, callout };
    },
    fill: async (page, at) => {
      calls.push(`fill ${page} ${at.join(',')}`);
      return filled;
    },
    select: () => {},
  };
  const env = { toolsFor: () => tools };

  await assert.rejects(() => assistantCall([drawing], 'place_markup', { type: 'cloudPlus', page: 1, points: [[0, 0], [50, 50]] }), /on screen for Cloud\+/);
  await assert.rejects(() => assistantCall([drawing], 'place_markup', { type: 'dynamicFill', page: 1, points: [[5, 5]] }), /on screen for Smart Fill/);

  const pair = (await assistantCall([drawing], 'place_markup', { type: 'cloudPlus', page: 1, points: [[0, 0], [50, 50]], text: 'Check' }, env)) as { markup: { type: string }; callout: { type: string } };
  assert.equal(pair.markup.type, 'cloud');
  assert.equal(pair.callout.type, 'callout');
  await assert.rejects(() => assistantCall([drawing], 'place_markup', { type: 'cloudPlus', page: 1, points: [[0, 0]] }, env), /Cloud needs two opposite corners/);

  const area = (await assistantCall([drawing], 'place_markup', { type: 'dynamicFill', page: 1, points: [[5, 5]] }, env)) as { markup: { type: string } };
  assert.equal(area.markup.type, 'area');
  await assert.rejects(() => assistantCall([drawing], 'place_markup', { type: 'dynamicFill', page: 1, points: [[5, 5], [9, 9]] }, env), /one point inside a closed outline/);
  assert.deepEqual(calls, ['cloud+ 0 2 Check', 'fill 0 5,5']);
});

test('only destructive commands ask', () => {
  assert.equal(isDestructiveCommand('edit.delete'), true);
  assert.equal(isDestructiveCommand('file.save'), true);
  assert.equal(isDestructiveCommand('batch.flatten'), true);
  assert.equal(isDestructiveCommand('view.zoomIn'), false);
  assert.equal(isDestructiveCommand('tool.line'), false);
  assert.equal(isDestructiveCommand('edit.eraseContent'), false);
});

test('selection follows the drawing on screen, and one confirmation shows at a time', async () => {
  const drawing = await doc('A-101.pdf', true);
  await assert.rejects(() => assistantCall([drawing], 'select_markups', { ids: ['door'] }), /not the drawing on screen/);
  let selected: string[] = [];
  const tools: AssistantTools = {
    owns: (store) => store === drawing.store,
    place: () => { throw new Error('not used'); },
    select: (ids) => { selected = [...ids]; },
  };
  const picked = await assistantCall([drawing], 'select_markups', { ids: ['door'] }, { toolsFor: () => tools });
  assert.deepEqual(selected, ['door']);
  assert.deepEqual(picked, { document: 'A-101.pdf', selected: ['door'] });

  const first = confirmAssistant('Delete markup 1 on A-101.pdf?');
  const second = confirmAssistant('Allow the assistant to Save on A-101.pdf?');
  assert.equal(assistantPrompt(), 'Delete markup 1 on A-101.pdf?');
  denyAssistant();
  assert.equal(await first, false);
  assert.equal(assistantPrompt(), null);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(assistantPrompt(), 'Allow the assistant to Save on A-101.pdf?');
  allowAssistant();
  assert.equal(await second, true);
  assert.equal(assistantPrompt(), null);
});

test('each client starts the bundled Node program', () => {
  const launch = { command: 'C:\\Program Files\\redcolumn\\resources\\assistant\\node.exe', args: ['C:\\Program Files\\redcolumn\\resources\\assistant\\mcp-cli.js'], env: {} };
  const clients = clientSetups(launch, 'win');
  assert.deepEqual(clients.map((c) => c.id), ['copilot', 'claude', 'claude-code', 'codex', 'cursor']);
  for (const client of clients) {
    assert.match(client.copy, /node\.exe/);
    assert.doesNotMatch(client.copy, /ELECTRON_RUN_AS_NODE/);
  }
  assert.match(clients[2]!.copy, /^claude mcp add --scope user redcolumn -- '/);
  assert.match(clients[3]!.copy, /^codex mcp add redcolumn -- '/);
  assert.match(clients[3]!.copy, /\[mcp_servers\.redcolumn\]/);
  assert.doesNotMatch(clients[3]!.copy, /\[mcp_servers\.redcolumn\.env\]/);
  const cursor = new URL(clients[4]!.href!);
  const config = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor.searchParams.get('config') ?? ''), (c) => c.charCodeAt(0)))) as { command: string; args: string[]; env?: { ELECTRON_RUN_AS_NODE: string } };
  assert.deepEqual(config.args, launch.args);
  assert.equal(config.env, undefined);
  assert.equal(config.command, launch.command);
  const vscode = new URL(clients[0]!.href!);
  const vscodeConfig = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(decodeURIComponent(vscode.searchParams.get('config') ?? '')), (c) => c.charCodeAt(0)))) as { type: string };
  assert.equal(vscodeConfig.type, 'stdio');
});

test('a development launch still passes ELECTRON_RUN_AS_NODE through', () => {
  const launch = { command: 'C:\\Redcolumn\\redcolumn.exe', args: ['mcp-cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const clients = clientSetups(launch, 'win');
  assert.match(clients[2]!.copy, /--env ELECTRON_RUN_AS_NODE=1 /);
  assert.match(clients[3]!.copy, /\[mcp_servers\.redcolumn\.env\]\nELECTRON_RUN_AS_NODE = "1"/);
});
