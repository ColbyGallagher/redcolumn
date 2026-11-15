import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkupStore } from '@nb/markup';
import type { DetectedLink, SheetInfo } from '@nb/sheets';
import { acceptProposal, exportStandard, newStandard, parseStandardFile, withExamples, exampleOf, type DrawingStandard } from '../sheets/standards.ts';
import { aiPrompt, stepsForAi } from '../sheets/standardsWizard.ts';
import { assistantCall, type AssistantDocument } from './assistant.ts';
import type { AssistantStandards } from './assistantStandards.ts';

const sheet = (number: string): SheetInfo => ({ number, title: null, discipline: null, scaleText: null, revision: null, source: 'text', confidence: 0.9 });
const link = (id: string, pageIndex: number, targetPage: number, kind: DetectedLink['kind'], label: string, confidence: number): DetectedLink => ({ id, pageIndex, rect: { x: 100, y: 100, w: 20, h: 20 }, label, kind, detail: kind === 'detail' ? label.split('/')[0]! : null, targetPage, targetRect: null, confidence, evidence: ['bubble'] });

async function drawing(): Promise<AssistantDocument> {
  const store = await MarkupStore.open(`standards-${Math.random()}`, { persist: false });
  store.setDetectedSheets([
    [0, sheet('C-101')],
    [1, sheet('C-501')],
  ]);
  store.setDetectedLinks([link('0:3/C-501', 0, 1, 'detail', '3/C-501', 0.9), link('0:4/C-501', 0, 1, 'detail', '4/C-501', 0.5), link('1:C-101', 1, 0, 'sheet', 'C-101', 0.8)]);
  return { id: 'set', name: 'Set.pdf', pageCount: 2, pageIndex: 0, active: true, store, pageSize: () => ({ width: 1200, height: 800 }) };
}

function profile(...list: DrawingStandard[]): AssistantStandards & { all: DrawingStandard[] } {
  const p = {
    all: list,
    list: () => p.all,
    save: (s: DrawingStandard) => {
      p.all = [...p.all.filter((x) => x.id !== s.id), s];
    },
  };
  return p;
}

function meridian(): DrawingStandard {
  const s = newStandard('Meridian');
  return {
    ...withExamples(s, 'details', [exampleOf('details', 'mark', 0, { x: 90, y: 90, w: 40, h: 40 }, { width: 1200, height: 800 }, 'C-101', '3 C-501')]),
    results: { details: { band: 'ai', score: 0.4, references: 10, linked: 4, checked: 2, wrong: 1, unreadable: 3, ambiguous: 0, at: 1 }, sections: { band: 'good', score: 0.95, references: 4, linked: 4, checked: 4, wrong: 0, unreadable: 0, ambiguous: 0, at: 1 } },
  };
}

test('get_drawing_standard: the standard the document is read with, its examples and how each step did', async () => {
  const d = await drawing();
  const s = meridian();
  const other = newStandard('Other');
  const standards = profile(s, other);
  await assert.rejects(() => assistantCall([d], 'get_drawing_standard', {}, { standards }), /Say which standard: Meridian, Other/);
  d.store.setDrawingStandard({ id: s.id, hash: 'x' });
  const got = (await assistantCall([d], 'get_drawing_standard', {}, { standards })) as { name: string; examples: { page: number; text: string; step: string }[]; steps: { step: string; band: string }[] };
  assert.equal(got.name, 'Meridian');
  assert.deepEqual(got.examples.map((e) => [e.step, e.page, e.text]), [['details', 1, '3 C-501']]);
  assert.deepEqual(got.steps.map((x) => [x.step, x.band]), [
    ['sections', 'good'],
    ['elevations', 'not run'],
    ['details', 'ai'],
    ['matchLines', 'not run'],
    ['chainage', 'not run'],
  ]);
  const byName = (await assistantCall([d], 'get_drawing_standard', { standard: 'other' }, { standards })) as { name: string };
  assert.equal(byName.name, 'Other');
});

test('list_sheet_links filters by kind and status and says why each scored what it did', async () => {
  const d = await drawing();
  const all = (await assistantCall([d], 'list_sheet_links', {})) as { total: number; byStatus: Record<string, number> };
  assert.equal(all.total, 3);
  assert.deepEqual(all.byStatus, { auto: 2, review: 1 });
  const review = (await assistantCall([d], 'list_sheet_links', { kind: 'detail', status: 'review' })) as { links: { label: string; page: number; targetPage: number; targetSheet: string; source: string; why: string[] }[] };
  assert.deepEqual(review.links.map((l) => [l.label, l.page, l.targetPage, l.targetSheet, l.source]), [['4/C-501', 1, 2, 'C-501', 'text']]);
  assert.ok(review.links[0]!.why[0]!.startsWith('raises:'));
  const page = (await assistantCall([d], 'list_sheet_links', { page: 2, limit: 1 })) as { links: unknown[] };
  assert.equal(page.links.length, 1);
  await assert.rejects(() => assistantCall([d], 'list_sheet_links', { kind: 'callout' }), /kind is one of/);
});

test('propose_sheet_links: AI links wait for review, survive detection, and one bad item adds none', async () => {
  const d = await drawing();
  const good = { page: 1, rect: { x: 400, y: 300, w: 24, h: 24 }, label: '5/C-501', kind: 'detail', targetPage: 2, reasoning: 'Outlined bubble, read from the picture' };
  await assert.rejects(() => assistantCall([d], 'propose_sheet_links', { links: [good, { ...good, targetPage: 9 }] }), /Link 2: Page 9 is not in Set.pdf/);
  assert.equal(d.store.allLinks().length, 3, 'nothing added');
  await assert.rejects(() => assistantCall([d], 'propose_sheet_links', { links: [{ ...good, reasoning: '' }] }), /reasoning/);
  await assert.rejects(() => assistantCall([d], 'propose_sheet_links', { links: [{ ...good, rect: { x: 1190, y: 0, w: 50, h: 10 } }] }), /off the page/);
  const res = (await assistantCall([d], 'propose_sheet_links', { links: [good] })) as { ids: string[]; review: string };
  assert.match(res.review, /Needs review/);
  const added = d.store.allLinks().find((l) => l.id === res.ids[0])!;
  assert.deepEqual([added.status, added.detail, added.note, added.evidence], ['review', '5', 'Outlined bubble, read from the picture', ['aiProposed']]);
  // A new detection run keeps it; a person's decision on it sticks when it is proposed again.
  d.store.setDetectedLinks([link('0:3/C-501', 0, 1, 'detail', '3/C-501', 0.9)]);
  assert.ok(d.store.allLinks().some((l) => l.id === res.ids[0]));
  d.store.setLinkStatus(res.ids[0]!, 'rejected');
  await assistantCall([d], 'propose_sheet_links', { links: [good] });
  assert.equal(d.store.allLinks().find((l) => l.id === res.ids[0])!.status, 'rejected');
});

test('propose_standard_hints waits in the standard until a person adds the words', async () => {
  const d = await drawing();
  const s = meridian();
  const standards = profile(s);
  await assert.rejects(() => assistantCall([d], 'propose_standard_hints', { reasoning: 'x' }, { standards }), /at least one/);
  await assert.rejects(() => assistantCall([d], 'propose_standard_hints', { matchLineWords: ['JOIN LINE'] }, { standards }), /reasoning/);
  const res = (await assistantCall([d], 'propose_standard_hints', { matchLineWords: ['JOIN LINE'], alignments: ['MC07'], alignmentTemplate: 'mc##', reasoning: 'Sheets 4-9 label match lines JOIN LINE' }, { standards })) as { proposed: string[] };
  assert.deepEqual(res.proposed, ['Match-line words: JOIN LINE', 'Alignment names: MC07', 'Alignment names look like MC##']);
  const saved = standards.all[0]!;
  assert.equal(saved.links.matchLine.includes('JOIN LINE'), false, 'nothing used yet');
  const accepted = acceptProposal(saved, saved.proposals![0]!.id);
  assert.ok(accepted.links.matchLine.includes('JOIN LINE'));
  assert.deepEqual(accepted.chainage.alignments, ['MC07']);
  assert.equal(accepted.chainage.alignmentTemplate, 'MC##');
  assert.deepEqual(accepted.proposals, []);
});

test('examples go out with an exported standard; results and AI proposals stay in the profile', () => {
  const s = { ...meridian(), proposals: [{ id: 'p', at: 1, changes: { matchLineWords: ['JOIN LINE'] }, reasoning: 'x' }] };
  const back = parseStandardFile(exportStandard(s));
  assert.deepEqual(back.examples, s.examples);
  assert.equal(back.results, undefined);
  assert.equal(back.proposals, undefined);
  assert.throws(() => parseStandardFile(exportStandard({ ...s, examples: [{ ...s.examples![0]!, rect: { x: 2, y: 0, w: 0.1, h: 0.1 } }] })), /off the page/);
});

test('the prompt for an AI assistant names the steps left and the tools to use', () => {
  const s = meridian();
  assert.deepEqual(stepsForAi(s.results), ['details']);
  const prompt = aiPrompt(s, 'Set.pdf', stepsForAi(s.results));
  assert.match(prompt, /Set\.pdf is open with the drawing standard "Meridian"/);
  assert.match(prompt, /Details: 4 of 10 references linked; 1 of 2 checked links wrong; 3 marks found by shape but not read\./);
  for (const tool of ['get_drawing_standard', 'list_sheet_links', 'get_page_image', 'propose_sheet_links', 'propose_standard_hints']) assert.ok(prompt.includes(tool), tool);
});
