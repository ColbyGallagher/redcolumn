import { activate, fallbackChain, localeInfo, messagesBeforeActivation, type Catalog } from '@nb/i18n';
import { browserLanguages, resolveLanguage } from './language';

// Each language's catalog is its own chunk, fetched only when that language is chosen.
const catalogs = import.meta.glob<Catalog>('../../../../packages/i18n/catalogs/*.po', { import: 'default' });

async function loadCatalog(code: string): Promise<Catalog> {
  const merged: Record<string, string> = {};
  // Least specific first, so `de-AT` overrides `de`.
  for (const c of fallbackChain(code).reverse()) {
    const load = catalogs[`../../../../packages/i18n/catalogs/${c}.po`];
    if (load) Object.assign(merged, await load());
  }
  return merged;
}

/**
 * Chooses the interface language and loads its translations, before the first render (main.tsx).
 * A catalog that fails to load leaves English.
 */
export async function startI18n(choice: unknown): Promise<void> {
  const code = resolveLanguage(choice, browserLanguages());
  let catalog: Catalog = {};
  try {
    catalog = await loadCatalog(code);
  } catch (e) {
    console.warn(`i18n: could not load the ${code} translations`, e);
  }
  activate(code, catalog);
  const info = localeInfo(code)!;
  document.documentElement.lang = info.rules ?? info.code;
  document.documentElement.dir = info.dir;
  const early = messagesBeforeActivation();
  if (import.meta.env.DEV && early.length) console.warn('i18n: text built before the language was chosen stays English. Build this text when rendering, not at module top level:', early);
}
