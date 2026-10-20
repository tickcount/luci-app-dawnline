// A .po catalog imported by the portal is its lookup table, made at build time
// (tsup.config.ts and vitest.config.ts read it with i18n/po.ts).
declare module '*.po' {
  const catalog: import('../../i18n/po').Catalog;
  export default catalog;
}
