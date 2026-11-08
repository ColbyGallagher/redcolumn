import { askText } from '../components/AskText';
import { runJob } from '../jobs/jobs';
import { CadConvertError, convertDrawing, defaultCadOptions, type CadConversion, type CadOptions } from './client';
import type { CadFile } from './convert';
import { UNIT_CHOICES } from './units';

/** A drawing converted as a job (shown in the jobs bar, cancellable). Rejects with an AbortError when cancelled. */
function jobFor(source: CadFile, options: CadOptions, references: CadFile[]): Promise<CadConversion> {
  return runJob(
    `Convert · ${source.name}`,
    ({ signal, progress }) => {
      progress(0, 0, 'Converting the drawing…');
      return convertDrawing(source, options, references, signal);
    },
    { kind: 'convert' },
  );
}

/** Asks which units a drawing is drawn in, with `guess` chosen; resolves null when cancelled. */
export async function askDrawingUnits(name: string, guess: number): Promise<number | null> {
  const choices = UNIT_CHOICES.map((u) => ({ value: String(u.code), label: u.label }));
  const initial = choices.some((c) => c.value === String(guess)) ? String(guess) : choices[0]!.value;
  const picked = await askText('Drawing Units', initial, {
    label: `${name} does not say what units it is drawn in. Measurements and scales depend on them: pick the one it uses (the suggestion is a guess from the drawing).`,
    confirm: 'Convert',
    choices,
  });
  return picked === null ? null : Number(picked);
}

/**
 * Converts a drawing as a job. One that does not state its units (and has none in `options`) is
 * stopped before drawing, the person is asked for them, and it is converted with their choice.
 */
export async function convertAsJob(source: CadFile, options: CadOptions = defaultCadOptions(), references: CadFile[] = []): Promise<CadConversion> {
  if (options.units !== undefined) return jobFor(source, options, references);
  try {
    return await jobFor(source, { ...options, askUnits: true }, references);
  } catch (err) {
    if (!(err instanceof CadConvertError) || err.unitsGuess === undefined) throw err;
    const units = await askDrawingUnits(source.name, err.unitsGuess);
    if (units === null) throw new DOMException('Cancelled', 'AbortError');
    const conversion = await jobFor(source, { ...options, units }, references);
    // Converting again keeps the units chosen, without the question.
    return { ...conversion, options: { ...conversion.options, askUnits: undefined } };
  }
}

/** A dropped or picked drawing file, converted with the remembered options. */
export async function convertFile(file: File): Promise<CadConversion> {
  return convertAsJob({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
}
