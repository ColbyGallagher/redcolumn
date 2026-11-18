// Changes a picture's pixels in the browser and writes it back as a data URL. Shared by Adjust Image
// and Picture Colours, so both keep a JPEG a JPEG, cap the working size, and free their canvases.

/** The longest side a picture is worked at; a larger one is shrunk to this when it is changed. */
export const BAKE_MAX_SIDE = 4096;

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Whether a data URL is a JPEG, so a change with no see-through pixels can stay one. */
export const isJpegSource = (source: string): boolean => /^data:image\/jpe?g[;,]/i.test(source);

/**
 * The picture after `change` has altered its RGBA pixels in place. A JPEG stays a JPEG while no pixel
 * is see-through (quality 0.9); anything else is a PNG. Yields to the page first, so a run over many
 * pictures does not freeze it, and releases the canvas when done.
 */
export async function bakePicture(source: string, change: (data: Uint8ClampedArray) => void): Promise<string> {
  await nextTurn();
  const img = new Image();
  img.src = source;
  await img.decode();
  const k = Math.min(1, BAKE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  try {
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
    change(pixels.data);
    g.putImageData(pixels, 0, 0);
    let opaque = isJpegSource(source);
    if (opaque) for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i]! < 255) {
      opaque = false;
      break;
    }
    return opaque ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
