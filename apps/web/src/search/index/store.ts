import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import type { PageText, Word } from '@nb/sheets';
import type { IndexedText } from './chrome';
import { DIMS, similarity, type Chunk } from './semantic';
import { corrections, matchExpression } from './terms';

/**
 * Bumped when what is stored for a document changes (text extraction, the body/chrome split), so
 * documents indexed by an older version are read again.
 */
export const INDEX_VERSION = 1;

/** Ranking: words in the page body count fully, words only in repeated headers and title blocks a fifth. */
const RANK = 'bm25(pages_fts, 1.0, 0.2)';

/** The least recently used documents are dropped once the index holds more pages than this. */
export const MAX_PAGES = 100_000;

/** Words of the first query term listed when it may sit inside a longer word; more do not narrow the search. */
const MAX_MID_WORD = 200;

/** Fields kept per word, as float32: x0, y0, x1, y1, size, angle. */
const WORD_FIELDS = 6;
/** Separates the words of a page in the stored text (never part of extracted text). */
const SEP = '\u001f';

const TOKENIZE = "tokenize = 'unicode61 remove_diacritics 2'";

/**
 * The layout of the tables. The index is only a cache of the PDFs' text, so a database laid out
 * by another version is emptied and laid out again rather than migrated.
 */
const SCHEMA_VERSION = 2;
const TABLES = ['chunk_vectors', 'embedded', 'pages_vocab', 'pages_fts', 'pages', 'docs'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    version INTEGER NOT NULL,
    page_count INTEGER NOT NULL,
    info TEXT,
    notes TEXT,
    fields TEXT,
    used INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY,
    doc INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    words TEXT NOT NULL,
    boxes BLOB NOT NULL,
    -- One bit per word, set for words in the repeated header, footer or title block ("chrome").
    chrome BLOB NOT NULL,
    UNIQUE (doc, page)
  );
  -- Search by meaning: a vector per passage of a page (words first to last), by model.
  CREATE TABLE IF NOT EXISTS chunk_vectors (
    id INTEGER PRIMARY KEY,
    page INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    first INTEGER NOT NULL,
    last INTEGER NOT NULL,
    vec BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chunk_vectors_page ON chunk_vectors(page);
  -- Pages whose passages have vectors from a model (a page with none still gets a row).
  CREATE TABLE IF NOT EXISTS embedded (
    page INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    model TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
    body, chrome, ${TOKENIZE}, prefix = '2 3', content = '', contentless_delete = 1
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS pages_vocab USING fts5vocab(pages_fts, 'row');
  CREATE VIRTUAL TABLE IF NOT EXISTS temp.query_tokens USING fts5(t, ${TOKENIZE});
  CREATE VIRTUAL TABLE IF NOT EXISTS temp.query_terms USING fts5vocab(temp, query_tokens, 'instance');
`;

/** A form field, markup or annotation note: text that is not part of the page's own text. */
export interface Note {
  pageIndex: number;
  rect: { x: number; y: number; w: number; h: number };
  label: string;
  text: string;
}

/** What is stored for a document. `info` and `notes` are null when only the page text was read. */
export interface DocContent {
  pages: PageText[];
  text: IndexedText[];
  info: Record<string, unknown> | null;
  notes: Note[] | null;
}

/** The pages of the searched documents that can hold a match. */
export interface Candidates {
  /** Documents read into the index (by the current version); the others must be searched in full. */
  indexed: string[];
  /**
   * Pages to search in each indexed document, best match first (documents without any are left
   * out), with the document's best rank (lower is better). Null when the query cannot narrow the
   * pages, for example a single letter: every page of the indexed documents must be searched.
   */
  hits: Record<string, { pages: number[]; rank: number }> | null;
}

/** A page found by meaning, with the words of its passage most like the query. */
export interface Related {
  key: string;
  pageIndex: number;
  words: Word[];
  score: number;
}

const keysJson =(keys: readonly string[]) => JSON.stringify(keys);

function packBoxes(words: readonly Word[]): Uint8Array {
  const f = new Float32Array(words.length * WORD_FIELDS);
  words.forEach((w, i) => f.set([w.x0, w.y0, w.x1, w.y1, w.size, w.angle], i * WORD_FIELDS));
  return new Uint8Array(f.buffer);
}

/** Flags as a bitset, one bit per entry. */
function packBits(flags: readonly boolean[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(flags.length / 8));
  flags.forEach((f, i) => {
    if (f) out[i >> 3]! |= 1 << (i & 7);
  });
  return out;
}

/** Whether bit `i` of a bitset from `packBits` is set. */
export const bitSet = (bits: Uint8Array, i: number) => ((bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;

function unpackPage(width: number, height: number, text: string, boxes: Uint8Array): PageText {
  if (!text) return { width, height, words: [] };
  const f = new Float32Array(boxes.buffer.slice(boxes.byteOffset, boxes.byteOffset + boxes.byteLength));
  const words = text.split(SEP).map((t, i): Word => {
    const o = i * WORD_FIELDS;
    return { text: t, x0: f[o]!, y0: f[o + 1]!, x1: f[o + 2]!, y1: f[o + 3]!, size: f[o + 4]!, angle: f[o + 5]! };
  });
  return { width, height, words };
}

/**
 * The search index: every page's text in SQLite, with an FTS5 full-text index over it. Searching
 * asks the index which pages can hold the query and reads only those, so a search of a library or
 * folder that was read before needs no PDF opened at all.
 */
export class SearchStore {
  /** Indexed words and how many pages hold each, loaded when first needed. */
  private vocabulary: Map<string, number> | null = null;

  /** Stored vectors by document id, read when a search by meaning first needs them. */
  private vectors = new Map<number, { pages: Int32Array; firsts: Int32Array; lasts: Int32Array; vecs: Int8Array }>();
  /** The model the vectors in `vectors` are from. */
  private vectorsModel = '';

  constructor(
    private db: Database,
    private now: () => number = Date.now,
  ) {
    db.exec('PRAGMA foreign_keys = ON;');
    if (db.selectValue('PRAGMA user_version') !== SCHEMA_VERSION) {
      db.transaction(() => {
        for (const t of TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
        db.exec(SCHEMA);
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    }
    // The temporary tables are made again for each connection.
    db.exec(SCHEMA);
  }

  /** The words SQLite's tokenizer makes of `text`, in order: folded to lower case, accents removed. */
  tokenize(text: string): string[] {
    this.db.exec('DELETE FROM temp.query_tokens');
    this.db.exec({ sql: 'INSERT INTO temp.query_tokens(t) VALUES (?)', bind: [text] });
    return this.db.selectValues('SELECT term FROM temp.query_terms ORDER BY offset') as string[];
  }

  private words(): Map<string, number> {
    if (!this.vocabulary) this.vocabulary = new Map(this.db.selectArrays('SELECT term, doc FROM pages_vocab').map(([t, n]) => [t as string, n as number]));
    return this.vocabulary;
  }

  private docId(key: string): number | null {
    const id = this.db.selectValue('SELECT id FROM docs WHERE key = ? AND version = ?', [key, INDEX_VERSION]);
    return typeof id === 'number' ? id : null;
  }

  /**
   * Stores a document's pages and text under `key`, replacing what was there. Keys name the
   * contents (a file hash, or a path with size and date), so page text alone (no `info`) is
   * only stored when nothing is: what is there already has the same text.
   */
  put(key: string, content: DocContent): void {
    if (content.info === null && this.docId(key) !== null) return;
    this.db.transaction((db) => {
      this.remove(key);
      db.exec({
        sql: 'INSERT INTO docs(key, version, page_count, info, notes, used) VALUES (?, ?, ?, ?, ?, ?)',
        bind: [key, INDEX_VERSION, content.pages.length, content.info && JSON.stringify(content.info), content.notes && JSON.stringify(content.notes), this.now()],
      });
      const doc = db.selectValue('SELECT last_insert_rowid()') as number;
      const page = db.prepare('INSERT INTO pages(doc, page, width, height, words, boxes, chrome) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const fts = db.prepare('INSERT INTO pages_fts(rowid, body, chrome) VALUES (last_insert_rowid(), ?, ?)');
      try {
        content.pages.forEach((p, i) => {
          page.bind([doc, i, p.width, p.height, p.words.map((w) => w.text.replaceAll(SEP, ' ')).join(SEP), packBoxes(p.words), packBits(content.text[i]?.isChrome ?? [])]).stepReset();
          fts.bind([content.text[i]?.body ?? '', content.text[i]?.chrome ?? '']).stepReset();
        });
      } finally {
        page.finalize();
        fts.finalize();
      }
    });
    this.vocabulary = null;
    this.prune();
  }

  private remove(key: string): boolean {
    const id = this.db.selectValue('SELECT id FROM docs WHERE key = ?', [key]);
    if (typeof id !== 'number') return false;
    this.vectors.delete(id);
    this.db.exec({ sql: 'DELETE FROM pages_fts WHERE rowid IN (SELECT id FROM pages WHERE doc = ?)', bind: [id] });
    this.db.exec({ sql: 'DELETE FROM docs WHERE id = ?', bind: [id] });
    return true;
  }

  /** Forgets a document (its file was deleted, or its pages changed). */
  drop(key: string): void {
    if (this.db.transaction(() => this.remove(key))) this.vocabulary = null;
  }

  /** Drops the least recently used documents while the index holds more than `MAX_PAGES` pages. */
  private prune(): void {
    let total = this.db.selectValue('SELECT COALESCE(SUM(page_count), 0) FROM docs') as number;
    if (total <= MAX_PAGES) return;
    for (const [key, n] of this.db.selectArrays('SELECT key, page_count FROM docs ORDER BY used')) {
      if (total <= MAX_PAGES) break;
      this.drop(key as string);
      total -= n as number;
    }
  }

  /** A whole document as last stored, or null when it is not indexed or only its page text is. */
  load(key: string): { pages: PageText[]; info: Record<string, unknown>; notes: Note[] } | null {
    const row = this.db.selectArray('SELECT id, info, notes FROM docs WHERE key = ? AND version = ?', [key, INDEX_VERSION]);
    if (!row || row[1] === null || row[2] === null) return null;
    this.db.exec({ sql: 'UPDATE docs SET used = ? WHERE id = ?', bind: [this.now(), row[0]!] });
    const pages = this.db.selectArrays('SELECT width, height, words, boxes FROM pages WHERE doc = ? ORDER BY page', [row[0]!]).map(([w, h, t, b]) => unpackPage(w as number, h as number, t as string, b as Uint8Array));
    return { pages, info: JSON.parse(row[1] as string), notes: JSON.parse(row[2] as string) };
  }

  /**
   * Some pages of a document: every page is there, but only the ones asked for have words. Null
   * when the document is not indexed.
   */
  pages(key: string, wanted: readonly number[]): PageText[] | null {
    const row = this.db.selectArray('SELECT id, page_count FROM docs WHERE key = ? AND version = ?', [key, INDEX_VERSION]);
    if (!row) return null;
    const [id, count] = row as [number, number];
    const sizes = this.db.selectArrays('SELECT page, width, height FROM pages WHERE doc = ? ORDER BY page', [id]);
    const out: PageText[] = Array.from({ length: count }, (_, i) => ({ width: (sizes[i]?.[1] as number) ?? 0, height: (sizes[i]?.[2] as number) ?? 0, words: [] }));
    const rows = this.db.selectArrays('SELECT page, width, height, words, boxes FROM pages WHERE doc = ? AND page IN (SELECT value FROM json_each(?))', [id, JSON.stringify(wanted)]);
    for (const [p, w, h, t, b] of rows) out[p as number] = unpackPage(w as number, h as number, t as string, b as Uint8Array);
    this.db.exec({ sql: 'UPDATE docs SET used = ? WHERE id = ?', bind: [this.now(), id] });
    return out;
  }

  /** Indexed words containing `term` that do not start with it, or null when there are too many to list. */
  private midWord(term: string): string[] | null {
    const out: string[] = [];
    for (const w of this.words().keys()) {
      if (w.length <= term.length || w.startsWith(term) || !w.includes(term)) continue;
      if (out.length === MAX_MID_WORD) return null;
      out.push(w);
    }
    return out;
  }

  /** The pages of the documents `keys` that can hold `query` (see `Candidates`). */
  candidates(keys: readonly string[], query: string, wholeWord = false): Candidates {
    const indexed = this.db.selectValues('SELECT key FROM docs WHERE version = ? AND key IN (SELECT value FROM json_each(?))', [INDEX_VERSION, keysJson(keys)]) as string[];
    const expression = indexed.length ? matchExpression(query, this.tokenize(query), wholeWord, (t) => this.midWord(t)) : null;
    if (!expression) return { indexed, hits: null };
    const hits: NonNullable<Candidates['hits']> = {};
    const rows = this.db.selectArrays(
      `SELECT d.key, p.page, ${RANK} AS rank
         FROM pages_fts JOIN pages p ON p.id = pages_fts.rowid JOIN docs d ON d.id = p.doc
        WHERE pages_fts MATCH ? AND d.version = ? AND d.key IN (SELECT value FROM json_each(?))
        ORDER BY rank`,
      [expression, INDEX_VERSION, keysJson(indexed)],
    );
    for (const [key, page, rank] of rows as [string, number, number][]) {
      const h = (hits[key] ??= { pages: [], rank });
      h.pages.push(page);
    }
    return { indexed, hits };
  }

  /**
   * A respelling of `query` that matches pages of `keys`, for a search that found nothing: each
   * word the index does not know is replaced by a close indexed word (the closest, then the most
   * common). Null when there is none.
   */
  suggest(keys: readonly string[], query: string): string | null {
    const tokens = this.tokenize(query);
    const known = this.words();
    const options = tokens.map((t) => (known.has(t) ? [] : corrections(t, known)));
    const wrong = options.findIndex((o) => o.length > 0);
    if (wrong < 0) return null;
    const best = tokens.map((t, i) => options[i]![0] ?? t);
    // The best respelling first, then the other choices for the first misspelt word.
    for (const choice of options[wrong]!) {
      const words = best.map((t, i) => (i === wrong ? choice : t));
      const respelt = words.join(' ');
      const found = this.candidates(keys, respelt);
      if (found.hits && Object.keys(found.hits).length) return respelt;
    }
    return null;
  }

  /** Form fields read from a document before, or null when they have not been read. */
  fields(key: string): Note[] | null {
    const id = this.docId(key);
    if (id === null) return null;
    const v: SqlValue = this.db.selectValue('SELECT fields FROM docs WHERE id = ?', [id]) ?? null;
    return typeof v === 'string' ? JSON.parse(v) : null;
  }

  /** Keeps a document's form fields, when the document is indexed. */
  setFields(key: string, fields: readonly Note[]): void {
    this.db.exec({ sql: 'UPDATE docs SET fields = ? WHERE key = ? AND version = ?', bind: [JSON.stringify(fields), key, INDEX_VERSION] });
  }

  /** Empties the index. */
  clear(): void {
    this.db.transaction((db) => {
      db.exec("DELETE FROM pages_fts; INSERT INTO pages_fts(pages_fts) VALUES ('optimize'); DELETE FROM docs;");
    });
    this.vocabulary = null;
    this.vectors.clear();
  }

  /**
   * Pages that have no vectors from `model` yet, most recently used documents first, each with
   * its words and which of them are chrome (a bitset, see `bitSet`).
   */
  unembedded(model: string, limit: number): { id: number; words: string[]; chrome: Uint8Array }[] {
    return this.db
      .selectArrays(
        `SELECT p.id, p.words, p.chrome FROM pages p JOIN docs d ON d.id = p.doc
          LEFT JOIN embedded e ON e.page = p.id AND e.model = ?
          WHERE e.page IS NULL AND d.version = ? ORDER BY d.used DESC, p.doc, p.page LIMIT ?`,
        [model, INDEX_VERSION, limit],
      )
      .map(([id, words, chrome]) => ({ id: id as number, words: words ? (words as string).split(SEP) : [], chrome: chrome as Uint8Array }));
  }

  /** Keeps a page's passage vectors from `model`, replacing any it had. */
  setVectors(model: string, page: number, passages: readonly (Pick<Chunk, 'first' | 'last'> & { vec: Int8Array })[]): void {
    const doc = this.db.selectValue('SELECT doc FROM pages WHERE id = ?', [page]);
    // The document was dropped while its pages were being embedded.
    if (typeof doc !== 'number') return;
    this.db.transaction((db) => {
      db.exec({ sql: 'DELETE FROM chunk_vectors WHERE page = ?', bind: [page] });
      for (const c of passages) db.exec({ sql: 'INSERT INTO chunk_vectors(page, first, last, vec) VALUES (?, ?, ?, ?)', bind: [page, c.first, c.last, c.vec] });
      db.exec({ sql: 'INSERT OR REPLACE INTO embedded(page, model) VALUES (?, ?)', bind: [page, model] });
    });
    this.vectors.delete(doc);
  }

  /** How many of the pages of `keys` have vectors from `model`, of how many. */
  embedded(keys: readonly string[], model: string): { done: number; total: number } {
    const [done, total] = this.db.selectArray(
      `SELECT COUNT(e.page), COUNT(*) FROM pages p JOIN docs d ON d.id = p.doc
         LEFT JOIN embedded e ON e.page = p.id AND e.model = ?
        WHERE d.version = ? AND d.key IN (SELECT value FROM json_each(?))`,
      [model, INDEX_VERSION, keysJson(keys)],
    ) as [number, number];
    return { done, total };
  }

  private vectorsOf(doc: number, model: string) {
    if (model !== this.vectorsModel) {
      this.vectors.clear();
      this.vectorsModel = model;
    }
    const cached = this.vectors.get(doc);
    if (cached) return cached;
    const rows = this.db.selectArrays('SELECT p.page, c.first, c.last, c.vec FROM chunk_vectors c JOIN pages p ON p.id = c.page JOIN embedded e ON e.page = c.page AND e.model = ? WHERE p.doc = ?', [model, doc]);
    const v = { pages: new Int32Array(rows.length), firsts: new Int32Array(rows.length), lasts: new Int32Array(rows.length), vecs: new Int8Array(rows.length * DIMS) };
    rows.forEach(([page, first, last, vec], i) => {
      v.pages[i] = page as number;
      v.firsts[i] = first as number;
      v.lasts[i] = last as number;
      const b = vec as Uint8Array;
      v.vecs.set(new Int8Array(b.buffer, b.byteOffset, Math.min(DIMS, b.byteLength)), i * DIMS);
    });
    this.vectors.set(doc, v);
    return v;
  }

  /**
   * The pages of `keys` most like `query` (a vector from `model`), best first: at most
   * `limit` with a score of at least `minScore`, each with its closest passage (its words `first`
   * to `last`).
   */
  related(keys: readonly string[], model: string, query: Int8Array, limit: number, minScore: number): Related[] {
    const docs = this.db.selectArrays('SELECT id, key FROM docs WHERE version = ? AND key IN (SELECT value FROM json_each(?))', [INDEX_VERSION, keysJson(keys)]) as [number, string][];
    const best = new Map<string, { key: string; doc: number; page: number; first: number; last: number; score: number }>();
    for (const [doc, key] of docs) {
      const v = this.vectorsOf(doc, model);
      for (let i = 0; i < v.pages.length; i++) {
        const score = similarity(query, v.vecs, i * DIMS);
        if (score < minScore) continue;
        const id = `${doc}:${v.pages[i]}`;
        if ((best.get(id)?.score ?? -1) < score) best.set(id, { key, doc, page: v.pages[i]!, first: v.firsts[i]!, last: v.lasts[i]!, score });
      }
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((b) => {
        const [w, h, t, x] = this.db.selectArray('SELECT width, height, words, boxes FROM pages WHERE doc = ? AND page = ?', [b.doc, b.page])!;
        const page = unpackPage(w as number, h as number, t as string, x as Uint8Array);
        return { key: b.key, pageIndex: b.page, words: page.words.slice(b.first, b.last + 1), score: b.score };
      });
  }
}
