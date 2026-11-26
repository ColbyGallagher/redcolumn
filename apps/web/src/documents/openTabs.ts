import type { PdfDocument } from '@nb/pdf-core';
import type { MarkupStore } from '@nb/markup';
import type { StoredFile } from '../storage/fileStore';

/** A PDF open in a tab, with its markups. */
export interface OpenFile {
  kind?: 'pdf';
  file: StoredFile;
  doc: PdfDocument;
  store: MarkupStore;
}

/** A 3D view of a model, drawn into its own element (see model3d/host.ts). */
export interface ModelView {
  /** What the view draws into; the stage shows it while the model's tab is in front. */
  element: HTMLElement;
  /** Draws while on screen and stops while not (another tab in front, or the window hidden). */
  setVisible: (visible: boolean) => void;
  /** Frees the view's WebGL context, workers and memory. */
  dispose: () => void;
}

/** A 3D model open in a tab (issue #191). Its viewer is loaded only when a model opens, so PDFs never pay for it. */
export interface OpenModel {
  kind: 'model';
  file: StoredFile;
  view: ModelView;
}

/** What a document tab holds: a PDF (with its markups) or a 3D model. */
export type OpenTab = OpenFile | OpenModel;

/** The tab's PDF, or null for a 3D model tab, so PDF-only code skips model tabs. */
export function pdfOf(t: OpenTab | null | undefined): OpenFile | null {
  return t && t.kind !== 'model' ? t : null;
}

/** Only the PDF tabs of a tab list, in order. */
export function pdfTabs(tabs: readonly OpenTab[]): OpenFile[] {
  return tabs.filter((t): t is OpenFile => t.kind !== 'model');
}
