import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studioDocOf, studioFileId } from './documentId';

test('Session document IDs preserve folder tokens when matching their Session', () => {
  for (const sessionId of ['lf:host-root:c2Vzc2lvbg', 'lf:guest-root:', 'ABC123!456']) {
    assert.deepEqual(studioDocOf(studioFileId(sessionId, 'document-123')), { sessionId, docId: 'document-123' });
  }
  // Already persisted IDs must remain readable without migrating PDF/markup caches.
  assert.deepEqual(studioDocOf('studio:lf:root::document-123'), { sessionId: 'lf:root:', docId: 'document-123' });
});

test('ordinary documents and incomplete Session IDs are not Session documents', () => {
  for (const value of [undefined, 'local-document', 'studio:', 'studio::doc', 'studio:session:']) {
    assert.equal(studioDocOf(value), null);
  }
});
