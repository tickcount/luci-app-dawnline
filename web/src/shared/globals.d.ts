// The translation globals: LuCI's own in the admin UI (cbi.js), installed by the
// portal from its catalog (portal/i18n.ts). How to use them: shared/i18n.ts.

declare global {
  /** `msg` in the page's language (English when the catalog has no translation). */
  const _: (msg: string, ctx?: string) => string;
  /** `singular` or `plural` for n, by the language's plural rules (Russian has three forms). */
  const N_: (n: number, singular: string, plural: string, ctx?: string) => string;
}

export {};
