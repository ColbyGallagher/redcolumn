/**
 * The tokenizer of BERT-style embedding models (search by meaning, see semantic.ts): Hugging Face's
 * BertNormalizer (lower case, accents removed, control characters dropped, Chinese characters
 * split), BertPreTokenizer (whitespace and punctuation) and WordPiece with "##" continuations,
 * read from the model's tokenizer.json. Only what those settings need; any other tokenizer.json is
 * refused.
 */

interface TokenizerJson {
  normalizer?: { type?: string; lowercase?: boolean; strip_accents?: boolean | null; handle_chinese_chars?: boolean; clean_text?: boolean };
  pre_tokenizer?: { type?: string };
  model?: { type?: string; vocab?: Record<string, number>; unk_token?: string; continuing_subword_prefix?: string; max_input_chars_per_word?: number };
}

export interface Encoding {
  ids: number[];
}

const isControl = (ch: string) => ch !== '\t' && ch !== '\n' && ch !== '\r' && /[\p{Cc}\p{Cf}]/u.test(ch);
const isWhitespace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || /\p{Zs}/u.test(ch);
/** BERT's punctuation: ASCII symbols as well as Unicode punctuation. */
function isPunctuation(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
  return /\p{P}/u.test(ch);
}
function isChinese(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

export class WordPiece {
  private vocab: Map<string, number>;
  private unk: number;
  readonly cls: number;
  readonly sep: number;
  private lowercase: boolean;
  private stripAccents: boolean;
  private prefix: string;
  private maxChars: number;

  constructor(json: TokenizerJson) {
    const n = json.normalizer;
    const m = json.model;
    if (n?.type !== 'BertNormalizer' || json.pre_tokenizer?.type !== 'BertPreTokenizer' || m?.type !== 'WordPiece' || !m.vocab) throw new Error('Not a BERT WordPiece tokenizer');
    this.vocab = new Map(Object.entries(m.vocab));
    const id = (t: string) => {
      const v = this.vocab.get(t);
      if (v === undefined) throw new Error(`The tokenizer has no ${t}`);
      return v;
    };
    this.unk = id(m.unk_token ?? '[UNK]');
    this.cls = id('[CLS]');
    this.sep = id('[SEP]');
    this.lowercase = n.lowercase ?? true;
    // Hugging Face: unset strip_accents follows lowercase.
    this.stripAccents = n.strip_accents ?? this.lowercase;
    this.prefix = m.continuing_subword_prefix ?? '##';
    this.maxChars = m.max_input_chars_per_word ?? 100;
  }

  private normalize(text: string): string {
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
      if (isWhitespace(ch)) out += ' ';
      else if (isChinese(cp)) out += ` ${ch} `;
      else out += ch;
    }
    if (this.lowercase) out = out.toLowerCase();
    if (this.stripAccents) out = out.normalize('NFD').replace(/\p{Mn}/gu, '');
    return out;
  }

  /** Words and punctuation marks, in order. */
  private words(text: string): string[] {
    const out: string[] = [];
    let word = '';
    for (const ch of this.normalize(text)) {
      if (ch === ' ') {
        if (word) out.push(word);
        word = '';
      } else if (isPunctuation(ch)) {
        if (word) out.push(word);
        out.push(ch);
        word = '';
      } else word += ch;
    }
    if (word) out.push(word);
    return out;
  }

  private piece(word: string, into: number[]) {
    const chars = [...word];
    if (chars.length > this.maxChars) {
      into.push(this.unk);
      return;
    }
    const pieces: number[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found: number | undefined;
      while (start < end) {
        const sub = (start > 0 ? this.prefix : '') + chars.slice(start, end).join('');
        found = this.vocab.get(sub);
        if (found !== undefined) break;
        end--;
      }
      if (found === undefined) {
        into.push(this.unk);
        return;
      }
      pieces.push(found);
      start = end;
    }
    into.push(...pieces);
  }

  /** Token ids of `text` with [CLS] and [SEP], cut to `maxLength` tokens in all. */
  encode(text: string, maxLength = 128): Encoding {
    const ids: number[] = [];
    for (const w of this.words(text)) {
      this.piece(w, ids);
      if (ids.length >= maxLength - 2) break;
    }
    return { ids: [this.cls, ...ids.slice(0, maxLength - 2), this.sep] };
  }
}
