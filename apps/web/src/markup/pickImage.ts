import type { Attachment } from '@nb/markup';

/** Longest side, in pixels, of pictures stored in markups (they are synced and saved inline). */
const MAX_SIDE = 2048;

/**
 * Asks the user for a picture file and returns it as a data URL, scaled down so its longest side
 * is at most 2048 px, with its width / height. Resolves null if the user cancels or the file is
 * not a readable image.
 */
export function pickImage(): Promise<{ image: string; aspect: number } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/bmp,image/webp';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      imageToDataUrl(file).then(resolve, (err) => {
        console.error('Reading the image failed', err);
        alert(`Could not read ${file.name} as an image.`);
        resolve(null);
      });
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Decodes an image file and re-encodes it (PNG keeps transparency; photos become JPEG). */
export async function imageToDataUrl(file: Blob): Promise<{ image: string; aspect: number }> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const photo = file.type === 'image/jpeg' || file.type === 'image/webp';
  return { image: canvas.toDataURL(photo ? 'image/jpeg' : 'image/png', 0.9), aspect: w / h };
}

/** Largest file the File Attachment tool embeds (it is synced and saved inside the PDF). */
const MAX_ATTACHMENT = 25 * 1024 * 1024;

/** Asks the user for any file to attach; resolves null if they cancel or it is too large. */
export function pickAttachment(): Promise<Attachment | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > MAX_ATTACHMENT) {
        alert(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB; attachments can be up to 25 MB.`);
        return resolve(null);
      }
      void fileToAttachment(file).then(resolve, () => resolve(null));
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** A file (or recording) as an attachment: its name, type, size and base64 bytes. */
export async function fileToAttachment(file: File): Promise<Attachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: file.name, mime: file.type || 'application/octet-stream', size: bytes.length, data: btoa(s) };
}

/** An attachment's bytes as a Blob, to open or save. */
export function attachmentBlob(a: Attachment): Blob {
  const bin = atob(a.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: a.mime });
}
