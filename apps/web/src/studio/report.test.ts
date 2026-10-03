import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { sessionReportPdf } from './report.ts';
import type { SessionMeta } from './protocol.ts';

test('the session report lists attendees, documents, markups and the Record', async () => {
  const meta: SessionMeta = {
    id: '123-456-789',
    name: 'Level 2 review',
    host: 'Hana',
    createdAt: Date.UTC(2026, 8, 1),
    status: 'finished',
    endedAt: Date.UTC(2026, 8, 2),
    permissions: { markup: true, addDocuments: true },
    documents: [{ id: 'd1', name: 'A-101.pdf', size: 1000, addedBy: 'Hana', addedAt: Date.UTC(2026, 8, 1), version: 2 }],
    attendees: [
      { name: 'Hana', firstJoined: 1, lastSeen: 2 },
      { name: 'Ari', email: 'ari@example.com', firstJoined: 1, lastSeen: 2 },
    ],
  };
  const markups = Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, type: 'cloud', pageIndex: i % 3, points: [], style: {}, status: i % 2 ? 'accepted' : 'none', author: i % 2 ? 'Ari' : 'Hana', createdAt: i, modifiedAt: i, comment: `Check the door ${i} — “fire rating”` })) as never;
  const bytes = await sessionReportPdf(
    meta,
    [
      { id: 'r1', at: 1, author: 'Hana', kind: 'chat', text: 'Starting now' },
      { id: 'r2', at: 2, author: 'Ari', kind: 'alert', text: 'Look at this', docId: 'd1', page: 0, markupId: 'm1' },
    ],
    [{ name: 'A-101.pdf', markups, describe: () => 'Cloud', pageLabel: (i) => `A-10${i + 1}` }],
  );
  const doc = await PDFDocument.load(bytes);
  // 120 markups need more than one page.
  assert.ok(doc.getPageCount() >= 3, `${doc.getPageCount()} pages`);
  assert.equal(doc.getTitle(), 'Level 2 review — Session Report');
});
