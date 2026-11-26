import { msg } from '@nb/i18n';
import { saveAsWithPicker } from '../storage/diskHandles';

/** Destructive closeout must never treat starting a download as a completed save. */
export async function saveConfirmedArchiveFile(name: string, blob: Blob, save = saveAsWithPicker): Promise<void> {
  const result = await save(name, blob.type, blob);
  if (result === null) throw new Error(msg('Saving {name} was cancelled. The session has not been removed.', { name }));
  if (result === 'unsupported') throw new Error(msg('Could not confirm that {name} was saved. The session has not been removed. Use the redcolumn desktop app or choose a Project or OneDrive destination.', { name }));
}
