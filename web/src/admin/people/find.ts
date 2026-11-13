// Finding people on People's search: every word typed is somewhere in what
// the admin knows them by (their name and note, their devices' names, tunnel
// addresses, names in the network and the client address each last came
// from). Case and «ё» do not matter. A word found on a device rather than on
// the person says which device and by what, so the row can show it and lead
// straight to that device. Pure.

import type { Device, Person } from '../../shared/types';

/** Lower case, «ё» as «е»: what is typed and what is searched compare the same way. */
const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

/** The client address of an endpoint "host:port", IPv6 without its brackets. */
export const endpointHost = (ep: string): string => (ep ? ep.replace(/^\[?(.*?)\]?:\d+$/, '$1') : '');

/** The words of a query (none: everyone matches). */
export const words = (q: string): string[] => norm(q).split(/\s+/).filter(Boolean);

/** What of a device answered the search: the device, the value that matched and what it is. */
export interface Match {
  device: Device;
  value: string;
  what: 'name' | 'address' | 'hostname' | 'ip';
}

/** Whether `p` has every word, and the first device a word was found on rather than on the person. */
export function find(p: Person, ws: string[]): { hit: boolean; match: Match | null } {
  if (!ws.length) return { hit: true, match: null };
  const own = norm(`${p.name} ${p.note ?? ''}`);
  const fields = (d: Device): [Match['what'], string][] => [
    ['name', d.name],
    ['address', d.address],
    ['hostname', d.hostname ?? ''],
    ['ip', endpointHost(d.endpoint)],
  ];
  let match: Match | null = null;
  for (const w of ws) {
    if (own.includes(w)) continue;
    let found = false;
    for (const d of p.devices) {
      const f = fields(d).find(([, v]) => v && norm(v).includes(w));
      if (!f) continue;
      found = true;
      match ??= { device: d, what: f[0], value: f[1] };
      break;
    }
    if (!found) return { hit: false, match: null };
  }
  return { hit: true, match };
}

/** Where in `text` the longest searched word stands: [start, length], or null. */
export function litAt(text: string, ws: string[]): [number, number] | null {
  const low = norm(text);
  let at = -1;
  let len = 0;
  for (const w of ws) {
    const i = low.indexOf(w);
    if (i >= 0 && w.length > len) {
      at = i;
      len = w.length;
    }
  }
  return at < 0 ? null : [at, len];
}
