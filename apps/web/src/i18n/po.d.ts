/** A translation catalog, compiled by vite.config.ts's po-catalogs plugin: message key → translation. */
declare module '*.po' {
  const catalog: Readonly<Record<string, string>>;
  export default catalog;
}
