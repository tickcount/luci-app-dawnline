// Tests read English: _() and N_() as LuCI has them with no catalog loaded.
// The portal's own (portal/i18n.ts) replace these where a test imports it.
Object.assign(globalThis, {
  _: (s: string) => s,
  N_: (n: number, s: string, p: string) => (n === 1 ? s : p),
});
