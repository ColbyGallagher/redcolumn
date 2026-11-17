import type { StampDef } from '@nb/markup';
import { updateWorkspace } from '../workspace/profiles';
import { commitPictureStamps, isImageFile, stampFromImage } from './pictureStamp';
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
    const r = commitPictureStamps(made, updateWorkspace);
    if (r.saved) added.push(...r.added);
    else failed.push('The pictures were not saved: the browser has no room left for stamps. Delete some stamps and try again.');
  }
  if (pdfs.length) {
    const r = await importRevuStamps(pdfs);
    added.push(...r.added);
    failed.push(...r.failed);
  }
  return { added, failed };
}
