export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}

/** CSS px of desk left on each side of a fitted page. */
export const FIT_WIDTH_MARGIN = 24;

/**
 * Fit Width without continuous scrolling: `bounds` (world space, everything shown) fills the viewport
 * width and is centred across it. The point at the middle of the view keeps its height, moved only as
 * far as needed to leave no empty desk past the top or bottom; content shorter than the view is
 * centred in it.
 */
export function fitWidthView(i: {
  bounds: { x: number; y: number; w: number; h: number };
  viewport: { width: number; height: number };
  camera: Camera;
  minZoom: number;
  maxZoom: number;
}): Camera {
  const { bounds: b, viewport, camera } = i;
  const margin = FIT_WIDTH_MARGIN;
  const zoom = Math.max(i.minZoom, Math.min(i.maxZoom, (viewport.width - margin * 2) / b.w));
  const panX = (viewport.width - b.w * zoom) / 2 - b.x * zoom;
  if (b.h * zoom <= viewport.height - margin * 2) {
    return { zoom, panX, panY: (viewport.height - b.h * zoom) / 2 - b.y * zoom };
  }
  const middle = (viewport.height / 2 - camera.panY) / camera.zoom;
  const highest = viewport.height - margin - (b.y + b.h) * zoom;
  const lowest = margin - b.y * zoom;
  const panY = Math.max(highest, Math.min(lowest, viewport.height / 2 - middle * zoom));
  return { zoom, panX, panY };
}
