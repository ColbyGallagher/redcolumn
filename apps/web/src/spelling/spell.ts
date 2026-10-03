import nspell from 'nspell';

/** A Hunspell checker: whether a word is spelled right, and suggestions when not. */
export interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
  add(word: string): void;
}

/** A misspelled word and where it starts in its text. */
export interface Misspelling {
  word: string;
  index: number;
}

const PERSONAL_KEY = 'nb.spell.words';

/** The words the user added to the dictionary. */
export function personalWords(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PERSONAL_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

let loading: Promise<Speller> | null = null;

/** The English checker, loaded once (its dictionary is fetched on first use), with the user's own words. */
export function speller(): Promise<Speller> {
  loading ??= (async () => {
    const base = import.meta.env.BASE_URL;
    const [aff, dic] = await Promise.all(['aff', 'dic'].map((ext) => fetch(`${base}spell/en.${ext}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`The spelling dictionary could not be loaded (${r.status})`))))));
    const s = nspell(aff!, dic!) as Speller;
    for (const w of personalWords()) s.add(w);
    return s;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Adds a word to the user's dictionary (kept in this browser). */
export async function addToDictionary(word: string) {
  const words = personalWords();
  if (!words.includes(word)) localStorage.setItem(PERSONAL_KEY, JSON.stringify([...words, word]));
  (await speller()).add(word);
}

/** Takes a word out of the user's dictionary (from the next time the checker loads). */
export function removeFromDictionary(word: string) {
  localStorage.setItem(PERSONAL_KEY, JSON.stringify(personalWords().filter((w) => w !== word)));
  loading = null;
}

/**
 * Words in `text` the checker does not know. Numbers, words with digits (sheet numbers, sizes),
 * single letters and abbreviations with dots are skipped; so are `ignored` words.
 */
export function misspellings(s: Speller, text: string, ignored: ReadonlySet<string> = new Set()): Misspelling[] {
  const out: Misspelling[] = [];
  for (const m of text.matchAll(/[\p{L}][\p{L}'’]*[\p{L}]|[\p{L}]/gu)) {
    const raw = m[0].replace(/[’]/g, "'");
    const next = text[m.index! + m[0].length];
    if (raw.length < 2 || next === '.' || /\d/.test(text.slice(Math.max(0, m.index! - 1), m.index! + m[0].length + 1))) continue;
    const word = raw.replace(/'s$/i, '');
    if (ignored.has(word.toLowerCase()) || s.correct(word) || s.correct(word.toLowerCase())) continue;
    out.push({ word: m[0], index: m.index! });
  }
  return out;
}
