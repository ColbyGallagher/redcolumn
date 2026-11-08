import { CadReadError } from './dxf';

/**
 * Colour-dependent plot style tables (.ctb): how each ACI colour plots, by colour, greyscale,
 * screening and lineweight. The file is a short text header, then zlib-compressed text of
 * `key=value` lines grouped in `name{ … }` blocks.
 */

export interface PlotStyle {
  /** Plotted colour (0-1 RGB), or null to plot the object's own. */
  rgb: [number, number, number] | null;
  /** Plot in grey. */
  grey: boolean;
  /** 0-100: how much ink (100 = full colour, 0 = white). */
  screen: number;
  /** Lineweight in mm, or null to use the object's own. */
  lineweightMm: number | null;
}

export interface PlotStyleTable {
  name: string;
  /** Styles by ACI index (1-255); missing entries plot as drawn. */
  byAci: Map<number, PlotStyle>;
}

/** The colour value meaning "use object colour". */
const USE_OBJECT = -1006632961;
const MAX_TEXT = 4 << 20;

/** Inflates at most MAX_TEXT bytes: a small file that expands without end is stopped as it goes. */
async function inflate(bytes: Uint8Array): Promise<string> {
  const reader = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_TEXT) {
      await reader.cancel().catch(() => {});
      throw new CadReadError('This plot style table is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder('latin1').decode(out);
}

/** Nested `name{ … }` blocks of `key=value` lines. */
interface Block {
  values: Map<string, string>;
  blocks: Map<string, Block>;
}

function parseBlocks(text: string): Block {
  const root: Block = { values: new Map(), blocks: new Map() };
  const stack: Block[] = [root];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const top = stack[stack.length - 1]!;
    if (line.endsWith('{')) {
      const b: Block = { values: new Map(), blocks: new Map() };
      top.blocks.set(line.slice(0, -1).trim(), b);
      stack.push(b);
    } else if (line === '}') {
      if (stack.length > 1) stack.pop();
    } else {
      const eq = line.indexOf('=');
      if (eq > 0) top.values.set(line.slice(0, eq).trim(), line.slice(eq + 1).replace(/^"/, ''));
    }
  }
  return root;
}

export async function parseCtb(name: string, bytes: Uint8Array): Promise<PlotStyleTable> {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 48));
  if (!head.startsWith('PIAFILEVERSION') || !/CTBVER/.test(head)) throw new CadReadError(`${name} is not a colour-dependent plot style table (.ctb).`);
  let text: string;
  try {
    text = await inflate(bytes.subarray(60));
  } catch (err) {
    if (err instanceof CadReadError) throw err;
    throw new CadReadError(`${name} could not be read as a plot style table.`);
  }
  const root = parseBlocks(text);
  const weights = root.blocks.get('custom_lineweight_table');
  const styles = root.blocks.get('plot_style');
  const byAci = new Map<number, PlotStyle>();
  for (const [key, b] of styles?.blocks ?? []) {
    const i = Number(key);
    if (!Number.isInteger(i) || i < 0 || i > 254) continue;
    const color = Number(b.values.get('color') ?? USE_OBJECT);
    const policy = Number(b.values.get('color_policy') ?? 0);
    const lw = Number(b.values.get('lineweight') ?? 255);
    const mm = lw === 255 ? null : Number(weights?.values.get(String(lw)));
    // Colours are 0xC2RRGGBB-style 32-bit values; "use object" has its own value.
    const v = color >>> 0;
    const rgb: PlotStyle['rgb'] = color === USE_OBJECT ? null : [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    byAci.set(i + 1, { rgb, grey: (policy & 2) !== 0, screen: Number(b.values.get('screen') ?? 100), lineweightMm: mm !== null && Number.isFinite(mm) ? mm : null });
  }
  return { name, byAci };
}

/** A colour through a plot style: its colour (or the object's), greyed and screened. */
export function styledRgb(rgb: [number, number, number], style: PlotStyle | undefined): [number, number, number] {
  if (!style) return rgb;
  let out = style.rgb ?? rgb;
  if (style.grey) {
    const l = 0.299 * out[0] + 0.587 * out[1] + 0.114 * out[2];
    out = [l, l, l];
  }
  if (style.screen < 100) {
    const k = Math.max(0, style.screen) / 100;
    out = out.map((c) => 1 - (1 - c) * k) as [number, number, number];
  }
  return out;
}
