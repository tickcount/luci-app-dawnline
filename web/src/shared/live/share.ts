// Structural sharing: a new answer laid over the last one so that every part that did not change is the
// very object it was. What reads a part by identity (a row kept while its item is the same object, a signal
// that tells nobody of an equal value) then sees a change only where there is one, whether the answer came
// as patches of a stream or whole, from a router asked again.
//
// Pure. Lists of things with an `id` keep each thing's identity wherever it stands in the list.

const idOf = (v: unknown): unknown => (typeof v === 'object' && v !== null ? (v as { id?: unknown }).id : undefined);

/** `next`, with every part equal to its part of `old` replaced by that part; `old` itself when nothing differs. */
export function share<T>(old: unknown, next: T): T {
  if (Object.is(old, next)) return next;
  if (typeof old !== 'object' || typeof next !== 'object' || old === null || next === null) return next;
  const list = Array.isArray(next);
  if (Array.isArray(old) !== list) return next;
  if (list) {
    const o = old as unknown[];
    const n = next as unknown[];
    let same = o.length === n.length;
    let byId: Map<unknown, unknown> | null = null;
    const out = n.map((v, i) => {
      let was = o[i];
      const id = idOf(v);
      if (id !== undefined && idOf(was) !== id) {
        byId ??= new Map(o.map((x) => [idOf(x), x]));
        was = byId.get(id);
      }
      const s = share(was, v);
      if (s !== o[i]) same = false;
      return s;
    });
    return (same ? old : out) as T;
  }
  const o = old as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const keys = Object.keys(n);
  let same = keys.length === Object.keys(o).length;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = share(o[k], n[k]);
    if (out[k] !== o[k] || !(k in o)) same = false;
  }
  return (same ? old : out) as T;
}
