import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

export const MODEL = 'claude-opus-5';

/** Largest base64 image accepted per field (~3.75 MB decoded); the client sends ~1568 px JPEGs. */
const MAX_IMAGE_BASE64 = 5_000_000;

export const SheetRequest = z.object({
  /** Downscaled JPEG of the whole sheet, base64 without a data: prefix. */
  page: z.string().min(1).max(MAX_IMAGE_BASE64),
  /** Higher-resolution JPEG crop of the likely title-block region. */
  titleBlock: z.string().min(1).max(MAX_IMAGE_BASE64),
  /** What the offline text-layer pass found, if anything; treated as an unverified hint. */
  textHint: z
    .object({ number: z.string().max(40).nullable(), title: z.string().max(300).nullable() })
    .nullable()
    .optional(),
});
export type SheetRequest = z.infer<typeof SheetRequest>;

const SheetFields = z.object({
  sheet_number: z.string().nullable(),
  sheet_title: z.string().nullable(),
  discipline: z.string().nullable(),
  scale: z.string().nullable(),
  revision: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export interface SheetResult {
  number: string | null;
  title: string | null;
  discipline: string | null;
  scaleText: string | null;
  revision: string | null;
  confidence: number;
}

const SYSTEM = `You identify sheets in construction drawing sets (civil, architectural, structural, MEP).

You receive a downscaled image of a whole sheet and a higher-resolution crop of the region most likely to hold its title block. Read the title block and report:

- sheet_number: exactly as printed in the title block's sheet-number field (e.g. C-101, A2.01, S-201). Detail bubbles, section markers and "see sheet X" references elsewhere on the drawing are not the sheet's own number.
- sheet_title: the drawing title as printed, on one line, keeping its capitalization.
- discipline: the discipline the sheet belongs to (e.g. Civil, Architectural, Structural, Mechanical, Electrical, Plumbing, Landscape, General).
- scale: the scale printed in the title block, verbatim (e.g. 1" = 20', 1/4" = 1'-0", 1:100, AS NOTED).
- revision: the current revision number or letter from the title block's revision field or table.
- confidence: high when the fields are clearly legible, medium when something is partly obscured or the title block is ambiguous, low when you are mostly inferring.

Use null for any field you cannot read. A text-layer hint may be included; it comes from automated extraction and can be wrong, so confirm it against the images.`;

const CONFIDENCE = { high: 0.95, medium: 0.7, low: 0.35 } as const;

/** Request parameters for one sheet. Split out so it can be checked without calling the API. */
export function buildSheetParams(req: SheetRequest) {
  const hint = req.textHint && (req.textHint.number || req.textHint.title) ? `Text-layer hint: number ${req.textHint.number ?? 'unknown'}, title ${req.textHint.title ?? 'unknown'}.` : 'No text-layer hint (the sheet may be scanned).';
  return {
    model: MODEL,
    max_tokens: 4096,
    // Reading a title block is simple extraction; low effort keeps latency and cost down.
    output_config: { effort: 'low' as const, format: betaZodOutputFormat(SheetFields) },
    // If a safety classifier declines, the API retries on a fallback model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: SYSTEM,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Whole sheet:' },
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: req.page } },
          { type: 'text' as const, text: 'Title-block region:' },
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: req.titleBlock } },
          { type: 'text' as const, text: hint },
        ],
      },
    ],
  };
}

export function toSheetResult(fields: z.infer<typeof SheetFields>): SheetResult {
  const clean = (s: string | null) => (s && s.trim() ? s.trim() : null);
  return {
    number: clean(fields.sheet_number)?.toUpperCase() ?? null,
    title: clean(fields.sheet_title),
    discipline: clean(fields.discipline),
    scaleText: clean(fields.scale),
    revision: clean(fields.revision),
    confidence: CONFIDENCE[fields.confidence],
  };
}

export class SheetIndexError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function identifySheet(client: Anthropic, req: SheetRequest): Promise<SheetResult> {
  const response = await client.beta.messages.parse(buildSheetParams(req));
  if (response.stop_reason === 'refusal') throw new SheetIndexError('The model declined to read this sheet.', 422);
  if (!response.parsed_output) throw new SheetIndexError(`No structured result (stop reason: ${response.stop_reason}).`, 502);
  return toSheetResult(response.parsed_output);
}
