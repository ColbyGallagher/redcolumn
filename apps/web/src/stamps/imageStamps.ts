import type { StampDef } from '@nb/markup';
import { updateWorkspace } from '../workspace/profiles';
import { addPictureStamps, isImageFile, stampFromImage } from './pictureStamp';
import { importRevuStamps } from './revuStamps';

export { STAMP_FILE_ACCEPT } from './pictureStamp';

/** Imports stamp PDFs and pictures into the active profile's library. */
export async function importStampFiles(files: File[]): Promise<{ added: StampDef[]; failed: string[] }> {
  const pictures = files.filter(isImageFile);
  const pdfs = files.filter((f) => !isImageFile(f));
  const added: StampDef[] = [];
  const failed: string[] = [];
  const made: StampDef[] = [];
  for (const f of pictures) {
    try {
      made.push(await stampFromImage(f));
    } catch (err) {
      failed.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (made.length) {
    let result: ReturnType<typeof addPictureStamps> | null = null;
    const kept = updateWorkspace((w) => {
      result = addPictureStamps(w.stamps, made);
      return { ...w, stamps: result.stamps };
    });
    if (kept && result) added.push(...(result as ReturnType<typeof addPictureStamps>).added);
    else {
      // The browser would not keep them: take them out again, so the library is the same after a reload.
      const ids = new Set(made.map((s) => s.id));
      updateWorkspace((w) => ({ ...w, stamps: w.stamps.filter((s) => !ids.has(s.id)) }));
      failed.push('The pictures were not saved: the browser has no room left for stamps. Delete some stamps and try again.');
    }
  }
  if (pdfs.length) {
    const r = await importRevuStamps(pdfs);
    added.push(...r.added);
    failed.push(...r.failed);
  }
  return { added, failed };
}
