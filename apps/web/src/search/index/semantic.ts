import { WordPiece } from './wordpiece';

/**
 * Search by meaning: a small embedding model turns text into vectors, and pages whose vectors
 * point the same way as the query's are about the same thing, whatever words they use. The model
 * and ONNX Runtime Web (which runs it) ship with the desktop app, served at /semantic/ (see
 * apps/desktop/scripts/fetch-search-models.mjs); elsewhere there is no model and this is off.
 */

/** What the desktop app ships, from semantic/manifest.json. */
export interface Manifest {
  model: string;
  revision: string;
  queryPrompt: string;
  documentPrompt: string;
  output: string;
  maxTokens: number;
  /** `data`: the weights, when the model keeps them in a file of their own. */
  files: { model: string; data?: string; tokenizer: string; ort: string };
}

/** Dimensions kept of each vector (the model is trained so its leading dimensions stand alone). */
export const DIMS = 256;
/** Vectors are kept as int8: component / RANGE, times 127. Unit vectors' components stay well inside it. */
const RANGE = 0.3;

/** The parts of ONNX Runtime Web used here. */
interface Ort {
  env: { wasm: { wasmPaths?: string; numThreads?: number; proxy?: boolean } };
  Tensor: new (type: 'int64', data: BigInt64Array, dims: number[]) => unknown;
  InferenceSession: {
    create(model: Uint8Array, options: { executionProviders: string[]; externalData?: { path: string; data: Uint8Array }[]; graphOptimizationLevel?: string }): Promise<Session>;
  };
}
interface Session {
  inputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
}

export type EmbedKind = 'query' | 'document';

/** A vector cut to `DIMS`, made unit length and stored as int8. */
export function quantize(v: Float32Array | readonly number[]): Int8Array {
  const n = Math.min(DIMS, v.length);
  let norm = 0;
  for (let i = 0; i < n; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  const out = new Int8Array(DIMS);
  for (let i = 0; i < n; i++) out[i] = Math.max(-127, Math.min(127, Math.round((v[i]! / norm / RANGE) * 127)));
  return out;
}

/** Cosine of two stored vectors (int8); `b` may hold many, this one starting at `bOffset`. */
export function similarity(a: Int8Array, b: Int8Array, bOffset = 0): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < DIMS; i++) {
    const x = a[i]!;
    const y = b[bOffset + i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export class Embedder {
  /** One run at a time: ONNX Runtime Web does not run a session twice at once. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly manifest: Manifest,
    private ort: Ort,
    private session: Session,
    private tokenizer: WordPiece,
  ) {}

  /**
   * Loads the model from `base` (a URL ending in /). `read` fetches a file under it; `load`
   * imports ONNX Runtime Web from a URL. Null when there is no model there.
   */
  static async load(base: string, read: (name: string) => Promise<Uint8Array | null>, load: (url: string) => Promise<unknown>): Promise<Embedder | null> {
    const raw = await read('manifest.json');
    if (!raw) return null;
    let manifest: Manifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      // A dev server answers any path with the app's page: no model here.
      return null;
    }
    if (!manifest?.files?.model) return null;
    const ort = (await load(new URL(manifest.files.ort, base).href)) as Ort;
    ort.env.wasm.wasmPaths = new URL('ort/', base).href;
    // Threads need a cross-origin isolated page, which the app is not; one thread is plenty for a
    // query, and indexing runs in the background.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const { files } = manifest;
    const [model, tokenizer, data] = await Promise.all([read(files.model), read(files.tokenizer), files.data ? read(files.data) : null]);
    if (!model || !tokenizer || (files.data && !data)) return null;
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      // The weights are in a second file, under the name the model gives it.
      ...(files.data && data ? { externalData: [{ path: files.data, data }] } : {}),
    });
    return new Embedder(manifest, ort, session, new WordPiece(JSON.parse(new TextDecoder().decode(tokenizer))));
  }

  /** Vectors for `texts` (as stored: see `quantize`). */
  embed(texts: readonly string[], kind: EmbedKind): Promise<Int8Array[]> {
    const run = this.queue.then(() => this.run(texts, kind));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(texts: readonly string[], kind: EmbedKind): Promise<Int8Array[]> {
    if (!texts.length) return [];
    const prompt = kind === 'query' ? this.manifest.queryPrompt : this.manifest.documentPrompt;
    const encoded = texts.map((t) => this.tokenizer.encode(prompt + t, this.manifest.maxTokens).ids);
    const width = Math.max(...encoded.map((e) => e.length));
    const ids = new BigInt64Array(texts.length * width);
    const mask = new BigInt64Array(texts.length * width);
    encoded.forEach((e, row) =>
      e.forEach((id, col) => {
        ids[row * width + col] = BigInt(id);
        mask[row * width + col] = 1n;
      }),
    );
    const dims = [texts.length, width];
    const feeds: Record<string, unknown> = {
      input_ids: new this.ort.Tensor('int64', ids, dims),
      attention_mask: new this.ort.Tensor('int64', mask, dims),
    };
    if (this.session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new this.ort.Tensor('int64', new BigInt64Array(ids.length), dims);
    const out = (await this.session.run(feeds))[this.manifest.output];
    if (!out) throw new Error(`The model has no ${this.manifest.output} output`);
    const size = out.dims[out.dims.length - 1]!;
    return texts.map((_, row) => quantize(out.data.subarray(row * size, (row + 1) * size)));
  }
}

/** Words per passage embedded, and how far each passage starts after the last. */
export const CHUNK_WORDS = 64;
const CHUNK_STEP = 48;
/** Passages embedded per page at most (a crowded sheet's notes). */
const MAX_CHUNKS = 12;

/** A passage of a page: words `first` to `last` (inclusive) of the page's own text. */
export interface Chunk {
  first: number;
  last: number;
  text: string;
}

/**
 * A page's text split into overlapping passages for embedding. `words` are the page's words and
 * `skip` marks the ones left out (headers, footers and title blocks, which every sheet repeats).
 */
export function chunks(words: readonly string[], skip: (i: number) => boolean): Chunk[] {
  const wordy = (i: number) => /[\p{L}\p{N}]/u.test(words[i]!);
  let kept = words.flatMap((_, i) => (!skip(i) && wordy(i) ? [i] : []));
  // A page whose text is nearly all where every page has text (a short set's titles and notes
  // near the top) still says something: then its passages include that text.
  if (kept.length < 3) kept = words.flatMap((_, i) => (wordy(i) ? [i] : []));
  if (kept.length < 3) return [];
  const out: Chunk[] = [];
  for (let start = 0; start < kept.length && out.length < MAX_CHUNKS; start += CHUNK_STEP) {
    const span = kept.slice(start, start + CHUNK_WORDS);
    out.push({ first: span[0]!, last: span[span.length - 1]!, text: span.map((i) => words[i]).join(' ') });
    if (start + CHUNK_WORDS >= kept.length) break;
  }
  return out;
}
