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

test('a page picture fits the whole sheet, and a region gets the resolution asked for', async () => {
  const drawing = await doc('A-101.pdf', true);
  const asked: { pageIndex: number; region: { x: number; y: number; w: number; h: number }; scale: number; withMarkups: boolean }[] = [];
  const render: AssistantDocument['render'] = async (pageIndex, region, scale, withMarkups) => {
    asked.push({ pageIndex, region, scale, withMarkups });
    return { png: 'iVBORw0KGgo=', width: Math.round(region.w * scale), height: Math.round(region.h * scale), scale, region };
  };
  const seeing = { ...drawing, render };
  type Picture = { page: number; region: { x: number; y: number; w: number; h: number }; width: number; height: number; scale: number; dpi: number; markups: boolean; image: { mimeType: string; data: string } };

  // The whole page, 612 × 792 points, lands within 1600 pixels: 200 dpi would be 2200 tall.
  const whole = (await assistantCall([seeing], 'get_page_image', {})) as Picture;
  assert.equal(whole.page, 1);
  assert.deepEqual(whole.region, { x: 0, y: 0, w: 612, h: 792 });
  assert.equal(whole.height, 1600);
  assert.ok(Math.abs(whole.scale - 1600 / 792) < 1e-9);
  assert.equal(whole.markups, true);
  assert.deepEqual(whole.image, { mimeType: 'image/png', data: 'iVBORw0KGgo=' });

  // A small region is drawn at the dpi asked for, clipped to the page, with the markups left off.
  const part = (await assistantCall([seeing], 'get_page_image', { page: 2, region: { x: 500, y: -10, w: 200, h: 100 }, dpi: 300, markups: false })) as Picture;
  assert.equal(part.page, 2);
  assert.deepEqual(part.region, { x: 500, y: 0, w: 112, h: 90 });
  assert.ok(Math.abs(part.scale - 300 / 72) < 1e-9);
  assert.equal(part.dpi, 300);
  assert.equal(part.markups, false);
  assert.equal(asked[1]!.pageIndex, 1);
  assert.equal(asked[1]!.withMarkups, false);

  await assert.rejects(() => assistantCall([seeing], 'get_page_image', { region: { x: 700, y: 0, w: 10, h: 10 } }), /off the page/);
  await assert.rejects(() => assistantCall([seeing], 'get_page_image', { region: { x: 0, y: 0, w: 0, h: 10 } }), /more than 0/);
  await assert.rejects(() => assistantCall([seeing], 'get_page_image', { dpi: 1000 }), /between 18 and 600/);
  await assert.rejects(() => assistantCall([drawing], 'get_page_image', {}), /cannot be drawn here/);
});

test('page text comes in reading order, narrowed by region or search, and paged', async () => {
  const drawing = await doc('A-101.pdf', true);
  const word = (text: string, x0: number, y0: number) => ({ text, x0, y0, x1: x0 + text.length * 5, y1: y0 + 8, size: 8, angle: 0 });
  const reading = { ...drawing, text: async () => [word('#5', 200, 100.4), word('SLAB', 10, 50), word('@', 230, 100), word('6"', 10, 100), word('REBAR', 50, 50.9), word('O.C.', 250, 101)] };
  type Words = { page: number; total: number; nextOffset?: number; words: { text: string; x0: number; y0: number }[] };

  const all = (await assistantCall([reading], 'get_page_text', {})) as Words;
  assert.equal(all.page, 1);
  assert.equal(all.total, 6);
  assert.deepEqual(all.words.map((w) => w.text), ['SLAB', 'REBAR', '6"', '#5', '@', 'O.C.']);
  assert.deepEqual(all.words[1], { text: 'REBAR', x0: 50, y0: 50.9, x1: 75, y1: 58.9, size: 8 });

  const right = (await assistantCall([reading], 'get_page_text', { region: { x: 190, y: 90, w: 100, h: 30 } })) as Words;
  assert.deepEqual(right.words.map((w) => w.text), ['#5', '@', 'O.C.']);

  const found = (await assistantCall([reading], 'get_page_text', { search: 'rebar' })) as Words;
  assert.deepEqual(found.words.map((w) => w.text), ['REBAR']);

  const first = (await assistantCall([reading], 'get_page_text', { limit: 4 })) as Words;
  assert.equal(first.words.length, 4);
  assert.equal(first.nextOffset, 4);
  const rest = (await assistantCall([reading], 'get_page_text', { limit: 4, offset: 4 })) as Words;
  assert.deepEqual(rest.words.map((w) => w.text), ['@', 'O.C.']);
  assert.equal(rest.nextOffset, undefined);

  await assert.rejects(() => assistantCall([reading], 'get_page_text', { page: 9 }), /Page 9 is not in A-101\.pdf/);
  await assert.rejects(() => assistantCall([drawing], 'get_page_text', {}), /has no text here/);
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

test('an AI client proposes takeoff assemblies; they wait for a person, and the drawing is unchanged', async () => {
  const drawing = await doc('A-101.pdf', true);
  drawing.store.setAssemblies([{ id: 'wall', name: 'Stud Wall', variables: [{ name: 'Spacing', value: 16 }], items: [{ id: 'studs', name: 'Studs', unit: 'ea', formula: '[Length] / [Spacing] + 1', roundUp: true }] }]);
  drawing.store.add(markup({ id: 'note', type: 'text', text: 'hi', seq: 2 }));
  const listed = (await assistantCall([drawing], 'list_assemblies', {})) as { assemblies: { name: string; items: { formula: string }[] }[]; formulaNames: string[] };
  assert.equal(listed.assemblies[0]!.name, 'Stud Wall');
  assert.equal(listed.assemblies[0]!.items[0]!.formula, '[Length] / [Spacing] + 1');
  assert.ok(listed.formulaNames.includes('Length'));

  // Every proposal is checked first: one bad one keeps them all out.
  await assert.rejects(() => assistantCall([drawing], 'propose_takeoff', { proposals: [{ seq: 1, assembly: 'Stud Wall', reasoning: 'wall' }, { seq: 2, assembly: 'Stud Wall', reasoning: 'x' }] }), /Proposal 2: markup 2 is a text, not a measurement/);
  await assert.rejects(() => assistantCall([drawing], 'propose_takeoff', { proposals: [{ seq: 1, assembly: 'Slab' }] }), /no assembly "Slab"/);
  await assert.rejects(() => assistantCall([drawing], 'propose_takeoff', { proposals: [{ seq: 1, assembly: 'Stud Wall' }] }), /say why/);
  const none = (await assistantCall([drawing], 'list_takeoff_proposals', {})) as { proposals: unknown[] };
  assert.equal(none.proposals.length, 0);

  const made = (await assistantCall([drawing], 'propose_takeoff', { source: 'Claude', proposals: [{ seq: 1, assembly: 'stud wall', reasoning: 'The run is labelled as a partition wall.', expected: [{ item: 'Studs', quantity: 5 }] }] })) as { proposed: number; note: string };
  assert.equal(made.proposed, 1);
  assert.match(made.note, /Nothing is added to the takeoff until they approve it/);
  assert.equal(drawing.store.get('door')!.assemblyId, undefined, 'the drawing is unchanged');
  const pending = (await assistantCall([drawing], 'list_takeoff_proposals', {})) as { proposals: { state: string; assembly: string; markup: { seq: number } }[] };
  assert.deepEqual(pending.proposals.map((p) => [p.state, p.assembly, p.markup.seq]), [['pending', 'Stud Wall', 1]]);
});

test('viewports are placed, listed, and given a scale, each as one undo step', async () => {
  const drawing = await doc('A-101.pdf', true);
  const one = (await assistantCall([drawing], 'place_viewport', { page: 1, points: [[300, 400], [100, 50]], scale: '1:100' })) as { viewport: { id: string; name: string; page: number; rect: { x: number; y: number; w: number; h: number }; scale: string } };
  assert.equal(one.viewport.name, 'Viewport 1');
  assert.deepEqual(one.viewport.rect, { x: 100, y: 50, w: 200, h: 350 });
  assert.equal(one.viewport.scale, '1 mm = 100 mm');
  assert.equal(drawing.store.allViewports().length, 1);
  assert.equal(((await assistantCall([drawing], 'get_page', { page: 1 })) as { viewports?: number }).viewports, 1);

  const listed = (await assistantCall([drawing], 'list_viewports', { page: 1 })) as { viewports: { id: string }[] };
  assert.deepEqual(listed.viewports.map((v) => v.id), [one.viewport.id]);
  assert.deepEqual(((await assistantCall([drawing], 'list_viewports', { page: 2 })) as { viewports: unknown[] }).viewports, []);

  const changed = (await assistantCall([drawing], 'set_viewport_scale', { id: one.viewport.id, scale: '1:50' })) as { viewport: { scale: string } };
  assert.equal(changed.viewport.scale, '1 mm = 50 mm');
  assert.equal(drawing.store.allViewports()[0]!.scale.label, '1:50');
  drawing.store.undo();
  assert.equal(drawing.store.allViewports()[0]!.scale.label, '1:100', 'the scale change is one step');
  drawing.store.undo();
  assert.equal(drawing.store.allViewports().length, 0, 'so is placing the viewport');
});

test('a viewport scale that is not a scale, or a viewport that is not there, changes nothing', async () => {
  const drawing = await doc('A-101.pdf', true);
  const one = (await assistantCall([drawing], 'place_viewport', { page: 1, points: [[0, 0], [100, 100]] })) as { viewport: { id: string } };
  await assert.rejects(() => assistantCall([drawing], 'set_viewport_scale', { id: one.viewport.id, scale: 'big' }), /not a scale/);
  await assert.rejects(() => assistantCall([drawing], 'set_viewport_scale', { id: 'missing', scale: '1:50' }), /No viewport missing/);
  await assert.rejects(() => assistantCall([drawing], 'place_viewport', { page: 1, points: [[900, 10], [950, 60]] }), /nothing on page 1/);
  assert.equal(drawing.store.allViewports().length, 1);
});

test('placing many viewports is one undo step, and one bad item places none', async () => {
  const drawing = await doc('A-101.pdf', true);
  const placed = (await assistantCall([drawing], 'place_viewports', {
    page: 1,
    viewports: [{ points: [[0, 0], [100, 100]] }, { points: [[200, 200], [300, 300]], name: 'Section', scale: "1/4\" = 1'-0\"" }, { page: 2, points: [[0, 0], [50, 50]] }],
  })) as { placed: { name: string; page: number }[] };
  assert.deepEqual(placed.placed.map((v) => [v.name, v.page]), [['Viewport 1', 1], ['Section', 1], ['Viewport 1', 2]]);
  assert.equal(drawing.store.allViewports().length, 3);
  drawing.store.undo();
  assert.equal(drawing.store.allViewports().length, 0);

  await assert.rejects(
    () => assistantCall([drawing], 'place_viewports', { page: 1, viewports: [{ points: [[0, 0], [100, 100]] }, { points: [[0, 0], [100, 100]], scale: 'nope' }] }),
    /Viewport 2: .*not a scale/,
  );
  assert.equal(drawing.store.allViewports().length, 0);
  drawing.store.setReadOnly(true);
  await assert.rejects(() => assistantCall([drawing], 'place_viewport', { page: 1, points: [[0, 0], [10, 10]] }), /read-only/);
});
