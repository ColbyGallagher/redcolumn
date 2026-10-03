import { detectLinks, type DetectedLink, type PageText } from '@nb/sheets';

/** A file taking part in Auto-Link Sheets: its pages' text and sheet numbers. */
export interface LinkFile {
  fileId: string;
  name: string;
  pages: PageText[];
  numbers: (string | null)[];
}

export interface CrossFileLink {
  /** File and page the link is on. */
  fileId: string;
  pageIndex: number;
  rect: DetectedLink['rect'];
  label: string;
  confidence: number;
  target: { fileId: string; name: string; pageIndex: number; rect: DetectedLink['rect'] | null; label: string | null };
}

/**
 * Auto-Link Sheets: sheet and detail references are found across all the files as if they were one set
 * (so "3/S-201" in the architectural file finds S-201 in the structural one). Only links that point
 * into another file are returned; links within a file are found when it is opened.
 */
export function crossFileLinks(files: readonly LinkFile[], minConfidence = 0.6): CrossFileLink[] {
  const where: { file: number; page: number }[] = [];
  files.forEach((f, file) => f.pages.forEach((_, page) => where.push({ file, page })));
  const pages = files.flatMap((f) => f.pages);
  const numbers = files.flatMap((f) => f.pages.map((_, i) => f.numbers[i] ?? null));
  const out: CrossFileLink[] = [];
  for (const link of detectLinks(pages, numbers)) {
    const from = where[link.pageIndex]!;
    const to = where[link.targetPage]!;
    if (from.file === to.file || link.confidence < minConfidence) continue;
    const target = files[to.file]!;
    out.push({
      fileId: files[from.file]!.fileId,
      pageIndex: from.page,
      rect: link.rect,
      label: link.label,
      confidence: link.confidence,
      target: { fileId: target.fileId, name: target.name, pageIndex: to.page, rect: link.targetRect, label: target.numbers[to.page] ?? null },
    });
  }
  return out;
}
