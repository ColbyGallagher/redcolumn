/// <reference lib="webworker" />
import { CadReadError, convertCad, type CadFile, type ConversionReport, type ConvertOptions } from './convert';
import type { CadFonts } from './pdf';

/** Converts one drawing off the main thread. Fonts are fetched once per worker. */

export interface CadConvertRequest {
  name: string;
  bytes: Uint8Array;
  options: Omit<ConvertOptions, 'fonts' | 'references'>;
  references: CadFile[];
}

export type CadConvertResponse = { ok: true; pdf: Uint8Array; report: ConversionReport } | { ok: false; error: string; readError: boolean };

const FONT_FILES: Record<keyof CadFonts, string> = { sans: 'LiberationSans-Regular.ttf', serif: 'LiberationSerif-Regular.ttf', mono: 'LiberationMono-Regular.ttf' };

async function fonts(): Promise<CadFonts> {
  const entries = await Promise.all(
    Object.entries(FONT_FILES).map(async ([key, file]) => {
      const r = await fetch(`${import.meta.env.BASE_URL}fonts/${file}`);
      if (!r.ok) throw new Error(`Could not load the font ${file} (${r.status}).`);
      return [key, new Uint8Array(await r.arrayBuffer())] as const;
    }),
  );
  return Object.fromEntries(entries) as CadFonts;
}

self.onmessage = async (e: MessageEvent<CadConvertRequest>) => {
  const { name, bytes, options, references } = e.data;
  let reply: CadConvertResponse;
  try {
    const { pdf, report } = await convertCad(name, bytes, { ...options, references, fonts: await fonts() });
    reply = { ok: true, pdf, report };
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err), readError: err instanceof CadReadError };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply, reply.ok ? [reply.pdf.buffer] : []);
};
