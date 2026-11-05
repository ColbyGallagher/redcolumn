import { runJob } from '../jobs/jobs';
import { convertDrawing, defaultCadOptions, type CadConversion, type CadOptions } from './client';
import type { CadFile } from './convert';

/** A drawing converted as a job (shown in the jobs bar, cancellable). Rejects with an AbortError when cancelled. */
export function convertAsJob(source: CadFile, options: CadOptions = defaultCadOptions(), references: CadFile[] = []): Promise<CadConversion> {
  return runJob(
    `Convert · ${source.name}`,
    ({ signal, progress }) => {
      progress(0, 0, 'Converting the drawing…');
      return convertDrawing(source, options, references, signal);
    },
    { kind: 'convert' },
  );
}

/** A dropped or picked drawing file, converted with the remembered options. */
export async function convertFile(file: File): Promise<CadConversion> {
  return convertAsJob({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
}
