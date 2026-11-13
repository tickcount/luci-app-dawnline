// What a page does with an event of the stream: a JSON Merge Patch (RFC 7396)
// applied to a document, and new entries added to a list. Nothing is changed
// in place: the result shares every part the patch did not touch with the
// document it came from, so "is this part the same object as before" answers
// "did it change" (the store relies on it).

export type Doc = unknown;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `doc` with a merge patch applied: null removes a field, an object reaches into one, anything else replaces. */
export function merge(doc: Doc, patch: Doc): Doc {
  if (!isObject(patch)) return patch;
  const from = isObject(doc) ? doc : {};
  let out: Record<string, unknown> | null = isObject(doc) ? null : {};
  for (const [k, p] of Object.entries(patch)) {
    const had = Object.prototype.hasOwnProperty.call(from, k);
    if (p === null) {
      if (had) delete (out ??= { ...from })[k];
      continue;
    }
    const next = merge(had ? from[k] : undefined, p);
    if (!had || next !== from[k]) (out ??= { ...from })[k] = next;
  }
  return out ?? from;
}

/** A list with new entries at its end, holding its newest `keep` (0: all). */
export function appended(list: Doc, items: unknown[], keep: number): unknown[] {
  const all = [...(Array.isArray(list) ? list : []), ...items];
  return keep > 0 && all.length > keep ? all.slice(all.length - keep) : all;
}

/** A keyed list as the backend publishes lists of things with ids. */
export interface Keyed<T> {
  order: string[];
  items: Record<string, T>;
}

/** The entries of a keyed list, in its order (an entry named in `order` but not there yet is left out). */
export function rows<T>(k: Keyed<T> | undefined | null): T[] {
  if (!k || !Array.isArray(k.order)) return [];
  const out: T[] = [];
  for (const id of k.order) if (k.items[id] !== undefined) out.push(k.items[id]);
  return out;
}
