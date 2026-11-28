import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';

export type PageRotation = 0 | 90 | 180 | 270;

export interface PdfPageMetadata {
  /** Zero-based page index in the PDF. */
  position: number;
  /** Width in PDF points, rotation applied. */
  width: number;
  /** Height in PDF points, rotation applied. */
  height: number;
  /** Clockwise page rotation in degrees (0, 90, 180, or 270). */
  rotation: PageRotation;
}

export interface PdfByteSource {
  readonly byteLength: number;
  /**
   * Copies `target.byteLength` bytes starting at `position` into `target`.
   * Returns true on success, false if the read is out of bounds or fails.
   */
  readBlock(position: number, target: Uint8Array): boolean;
}

const ROTATIONS: readonly PageRotation[] = [0, 90, 180, 270];

let modulePromise: Promise<WrappedPdfiumModule> | null = null;

function isWasmAbort(err: unknown): boolean {
  return /Aborted\(|RuntimeError|memory access out of bounds|unreachable/.test(
    err instanceof Error ? `${err.name} ${err.message}` : String(err),
  );
}

function getPdfium(wasmBinary: ArrayBuffer): Promise<WrappedPdfiumModule> {
  modulePromise ??= (async () => {
    const m = await init({ wasmBinary });
    m.PDFiumExt_Init();
    return m;
  })();
  return modulePromise;
}

function normalizeRotation(raw: number): PageRotation {
  const index = ((raw % 4) + 4) % 4;
  return ROTATIONS[index] ?? 0;
}

/**
 * Reads authoritative page count, dimensions, and rotation directly from a PDF using PDFium's
 * custom block reader (`FPDF_LoadCustomDocument`), so large PDFs never need to be copied into
 * the wasm heap or loaded wholly into memory.
 */
export async function inspectPdfPages(
  wasmBinary: ArrayBuffer,
  source: PdfByteSource,
  password = '',
): Promise<PdfPageMetadata[]> {
  if (!Number.isSafeInteger(source.byteLength) || source.byteLength <= 0) {
    throw new Error('PDF source is empty');
  }
  if (source.byteLength > 0xffff_ffff) {
    throw new Error('PDF exceeds 4 GiB PDFium custom reader limit');
  }

  let m: WrappedPdfiumModule;
  try {
    m = await getPdfium(wasmBinary);
  } catch (err) {
    modulePromise = null;
    throw err;
  }

  const { malloc, free } = m.pdfium.wasmExports;
  let scratch = new Uint8Array(0);
  const getBlock = m.pdfium.addFunction((_param: number, position: number, buf: number, size: number) => {
    const pos = position >>> 0;
    const len = size >>> 0;
    if (len === 0) return 1;
    if (pos + len > source.byteLength) return 0;
    if (scratch.byteLength < len) {
      scratch = new Uint8Array(len);
    }
    const slice = scratch.subarray(0, len);
    if (!source.readBlock(pos, slice)) return 0;
    m.pdfium.HEAPU8.set(slice, buf);
    return 1;
  }, 'iiiii');

  let access = 0;
  let handle = 0;
  let sizePtr = 0;
  let aborted = false;

  try {
    access = malloc(12);
    if (!access) {
      throw new Error('PDFium failed to allocate file access struct');
    }
    m.pdfium.HEAPU32.set([source.byteLength, getBlock, 0], access >> 2);
    handle = m.FPDF_LoadCustomDocument(access, password);
    if (!handle) {
      const code = m.FPDF_GetLastError();
      if (code === 4) {
        throw new Error('PDF requires a password');
      }
      throw new Error(`PDFium failed to open document (error ${code})`);
    }

    const count = m.FPDF_GetPageCount(handle);
    if (count < 0) {
      throw new Error('PDFium returned an invalid page count');
    }

    sizePtr = malloc(8);
    if (!sizePtr) {
      throw new Error('PDFium failed to allocate page size buffer');
    }
    const pages: PdfPageMetadata[] = [];
    for (let i = 0; i < count; i++) {
      const ok = m.FPDF_GetPageSizeByIndexF(handle, i, sizePtr);
      if (!ok) {
        throw new Error(`PDFium failed to read dimensions for page ${i}`);
      }
      const f32 = m.pdfium.HEAPF32;
      const width = f32[sizePtr >> 2]!;
      const height = f32[(sizePtr >> 2) + 1]!;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(`PDFium returned invalid dimensions for page ${i}`);
      }

      const page = m.FPDF_LoadPage(handle, i);
      if (!page) {
        throw new Error(`PDFium failed to load page ${i}`);
      }
      let rotation: PageRotation;
      try {
        rotation = normalizeRotation(m.FPDFPage_GetRotation(page));
      } catch (pageErr) {
        if (isWasmAbort(pageErr)) {
          aborted = true;
          modulePromise = null;
        }
        throw pageErr;
      } finally {
        if (!aborted) {
          try {
            m.FPDF_ClosePage(page);
          } catch {
            // Never mask the root error during page cleanup.
          }
        }
      }

      pages.push({ position: i, width, height, rotation });
    }

    return pages;
  } catch (err) {
    if (isWasmAbort(err)) {
      aborted = true;
      modulePromise = null;
    }
    throw err;
  } finally {
    if (!aborted) {
      try {
        if (sizePtr) free(sizePtr);
      } catch {
        // Ignore cleanup errors to avoid masking the root error.
      }
      try {
        if (handle) m.FPDF_CloseDocument(handle);
      } catch {
        // Ignore cleanup errors to avoid masking the root error.
      }
      try {
        m.pdfium.removeFunction(getBlock);
      } catch {
        // Ignore cleanup errors to avoid masking the root error.
      }
      try {
        if (access) free(access);
      } catch {
        // Ignore cleanup errors to avoid masking the root error.
      }
    }
  }
}

/** Convenience wrapper for inspecting an in-memory PDF buffer. */
export async function inspectPdfPagesFromBytes(
  wasmBinary: ArrayBuffer,
  bytes: Uint8Array,
  password = '',
): Promise<PdfPageMetadata[]> {
  return inspectPdfPages(
    wasmBinary,
    {
      byteLength: bytes.byteLength,
      readBlock(position, target) {
        if (position + target.byteLength > bytes.byteLength) return false;
        target.set(bytes.subarray(position, position + target.byteLength));
        return true;
      },
    },
    password,
  );
}
