import { settings } from '../settings/settings';
import type { CadFile, ConversionReport, ConvertOptions } from './convert';
import type { CadConvertRequest, CadConvertResponse } from './convert.worker';

/**
 * Converting DWG/DXF to PDF from the app: each conversion runs in its own worker (the converter is
 * its own chunk, loaded only when a drawing is opened), and can be cancelled.
 */

export type CadOptions = Omit<ConvertOptions, 'fonts' | 'references'>;

export interface CadConversion {
  /** The original drawing, kept for converting again (with other options or reference files). */
  source: CadFile;
  options: CadOptions;
  references: CadFile[];
  pdf: ArrayBuffer;
  report: ConversionReport;
}

/** The options a drawing is converted with when nothing else is chosen: the remembered ones. */
export function defaultCadOptions(): CadOptions {
  const s = settings.get();
  const colorMode = s.cadColorMode === 'grey' || s.cadColorMode === 'mono' ? s.cadColorMode : 'color';
  return { colorMode, lineweights: s.cadLineweights !== false };
}

export class CadConvertError extends Error {
  /** The file could not be read as a drawing (as opposed to the converter failing). */
  readonly unreadable: boolean;
  constructor(message: string, unreadable: boolean) {
    super(message);
    this.unreadable = unreadable;
  }
}

export function convertDrawing(source: CadFile, options: CadOptions = defaultCadOptions(), references: CadFile[] = [], signal?: AbortSignal): Promise<CadConversion> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => {
      worker.terminate();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', stop, { once: true });
    const done = () => {
      signal?.removeEventListener('abort', stop);
      worker.terminate();
    };
    worker.onmessage = (e: MessageEvent<CadConvertResponse>) => {
      done();
      const r = e.data;
      if (!r.ok) return reject(new CadConvertError(r.error, r.readError));
      const pdf = r.pdf.buffer.slice(r.pdf.byteOffset, r.pdf.byteOffset + r.pdf.byteLength) as ArrayBuffer;
      resolve({ source, options, references, pdf, report: r.report });
    };
    worker.onerror = (e) => {
      e.preventDefault();
      done();
      reject(new CadConvertError(e.message || 'The drawing could not be converted.', false));
    };
    // Copies, so the caller keeps its bytes for converting again.
    const req: CadConvertRequest = { name: source.name, bytes: source.bytes.slice(), options, references: references.map((r) => ({ name: r.name, bytes: r.bytes.slice() })) };
    worker.postMessage(req, [req.bytes.buffer, ...req.references.map((r) => r.bytes.buffer)]);
  });
}

/** The PDF's file name for a drawing: report.dwg -> report.pdf. */
export const pdfNameFor = (name: string) => name.replace(/\.(dwg|dxf)$/i, '') + '.pdf';
