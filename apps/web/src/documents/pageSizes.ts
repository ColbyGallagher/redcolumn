/** Standard sheet sizes for new PDFs and blank pages, portrait, in PDF points (72 per inch). */
export interface PageSizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

const inch = (w: number, h: number) => ({ width: w * 72, height: h * 72 });
const mm = (w: number, h: number) => ({ width: (w * 72) / 25.4, height: (h * 72) / 25.4 });

export const PAGE_SIZES: PageSizePreset[] = [
  { id: 'letter', label: 'Letter (8.5 × 11 in)', ...inch(8.5, 11) },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', ...inch(8.5, 14) },
  { id: 'tabloid', label: 'Tabloid / ANSI B (11 × 17 in)', ...inch(11, 17) },
  { id: 'ansi-c', label: 'ANSI C (17 × 22 in)', ...inch(17, 22) },
  { id: 'ansi-d', label: 'ANSI D (22 × 34 in)', ...inch(22, 34) },
  { id: 'ansi-e', label: 'ANSI E (34 × 44 in)', ...inch(34, 44) },
  { id: 'arch-a', label: 'ARCH A (9 × 12 in)', ...inch(9, 12) },
  { id: 'arch-b', label: 'ARCH B (12 × 18 in)', ...inch(12, 18) },
  { id: 'arch-c', label: 'ARCH C (18 × 24 in)', ...inch(18, 24) },
  { id: 'arch-d', label: 'ARCH D (24 × 36 in)', ...inch(24, 36) },
  { id: 'arch-e1', label: 'ARCH E1 (30 × 42 in)', ...inch(30, 42) },
  { id: 'arch-e', label: 'ARCH E (36 × 48 in)', ...inch(36, 48) },
  { id: 'a4', label: 'A4 (210 × 297 mm)', ...mm(210, 297) },
  { id: 'a3', label: 'A3 (297 × 420 mm)', ...mm(297, 420) },
  { id: 'a2', label: 'A2 (420 × 594 mm)', ...mm(420, 594) },
  { id: 'a1', label: 'A1 (594 × 841 mm)', ...mm(594, 841) },
  { id: 'a0', label: 'A0 (841 × 1189 mm)', ...mm(841, 1189) },
];

/** The preset matching a size in either orientation (within half a point), if any. */
export function presetFor(width: number, height: number): PageSizePreset | undefined {
  const [a, b] = [Math.min(width, height), Math.max(width, height)];
  return PAGE_SIZES.find((p) => Math.abs(p.width - a) < 0.5 && Math.abs(p.height - b) < 0.5);
}
