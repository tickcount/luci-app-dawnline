// The backend's topics put back together as the `status` answer the pages were written for
// (backend/bridge/topics.go cuts it apart; this is its inverse, and backend/bridge/testdata holds the two to
// each other). While pages still read a whole Status, they get it from the stream this way instead of asking
// the router; a page that binds to the store directly (shared/live) does not come through here.
//
// Pure: documents in, a document out.

import type { Status } from '../../shared/types';

/** The topics a status is made of; all of them must have come before there is one. */
export const STATUS_TOPICS = ['router', 'clock', 'servers', 'people', 'circles', 'services', 'traffic', 'places', 'recent'] as const;

type Doc = unknown;
const isObject = (v: Doc): v is Record<string, Doc> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A document as the ucode backend sent it: a keyed list ({ order, items }) is a list again, in its order, and
 * { $null: true } is null. Everything else is copied as it is, at any depth.
 */
export function unkey(v: Doc): Doc {
  if (Array.isArray(v)) return v.map(unkey);
  if (!isObject(v)) return v;
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === '$null') return null;
  if (keys.length === 2 && Array.isArray(v.order) && isObject(v.items)) {
    const items = v.items;
    return (v.order as string[]).filter((id) => id in items).map((id) => unkey(items[id]));
  }
  const out: Record<string, Doc> = {};
  for (const k of keys) out[k] = unkey(v[k]);
  return out;
}

/** The status the topics make, or null while one of them has not come. */
export function joinStatus(topic: (name: string) => Doc): Status | null {
  const docs: Record<string, Doc> = {};
  for (const name of STATUS_TOPICS) {
    const d = topic(name);
    if (d === undefined) return null;
    docs[name] = unkey(d);
  }
  return {
    ...(docs.router as object),
    ...(docs.clock as object),
    ...(docs.traffic as object),
    servers: docs.servers,
    people: docs.people,
    circles: docs.circles,
    services: docs.services,
    geo: docs.places,
    events: docs.recent,
  } as Status;
}
