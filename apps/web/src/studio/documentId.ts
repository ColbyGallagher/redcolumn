/** Library IDs retain their existing format so cached PDFs and markups keep working. */
export function studioFileId(sessionId: string, docId: string): string {
  return `studio:${sessionId}:${docId}`;
}

export function studioDocOf(fileId: string | undefined): { sessionId: string; docId: string } | null {
  // Folder IDs contain colons (lf:<root>:<relative path>); document IDs are
  // OneDrive item IDs or folder filename hashes, neither of which contains colons.
  const m = fileId ? /^studio:(.+):([^:]+)$/.exec(fileId) : null;
  return m ? { sessionId: m[1]!, docId: m[2]! } : null;
}
