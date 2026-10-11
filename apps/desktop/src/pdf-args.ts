import fs from 'node:fs';

/** PDF paths on a command line. Flags and missing paths are ignored. */
export function pdfArguments(argv: readonly string[], exists: (filePath: string) => boolean = fs.existsSync): string[] {
  const out: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith('-')) continue;
    if (!/\.pdf$/i.test(arg)) continue;
    if (!exists(arg)) continue;
    out.push(arg);
  }
  return out;
}
