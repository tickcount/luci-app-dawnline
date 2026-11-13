// What the demo's cast did before its moment (cast.ts says who they are): the clock every answer is given on, each
// device's traffic a day at a time, when it was on and where, and from those the log and the places. Made by rule
// from the cast, the same every time, so every capture of a page shows the same day.
//
// Pure: no DOM and no LuCI. Every public address is from the ranges kept for documentation (203.0.113.0/24,
// 198.51.100.0/24): nobody's.

import type { Device, GeoPoint, LogEvent, Pair } from '../../shared/types';
import { PEOPLE, PLACES, SERVER, type CastDevice, type Lang, type PlaceId } from './cast';

/** The moment every answer is given at: Sunday 8 November 2026, 12:40 on the router's clock. */
export const NOW = Date.UTC(2026, 10, 8, 9, 40) / 1000;
/** The router's offset from UTC, minutes. */
export const TZ = 180;

export const MIN = 60;
export const HOUR = 3600;
export const DAY = 86400;
/** The admin counts in binary units: "50 GB" is 50 GiB. */
export const GB = 2 ** 30;
/** Days of traffic the status holds: the longest history a page asks for. */
export const DAYS = 60;
/** What a device sends is about a tenth of what it moves. */
export const UP = 0.1;
/** How busy each day of the week is, Sunday first. */
const WEEK = [1.1, 0.9, 1.15, 0.8, 1.05, 1.3, 0.75];
/** When a device of each kind is usually on, on the router's clock: [from, for] in hours. */
const HABITS: Record<Device['kind'], readonly (readonly [number, number])[]> = {
  phone: [
    [7.2, 1.75],
    [17.6, 5.4],
  ],
  computer: [[19, 3]],
  tablet: [[20.5, 1.5]],
  router: [[16, 11.6]],
  other: [[10, 6]],
};

/** The same number from 0 to 1 for the same words: what makes one made-up day unlike the next, every time alike. */
export function chance(...words: (string | number)[]): number {
  let h = 2166136261;
  for (const c of words.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/** The router's midnight `ago` days back, and the router's day a moment falls on ("YYYY-MM-DD"). */
export const midnight = (ago: number): number => Math.floor((NOW + TZ * MIN) / DAY) * DAY - TZ * MIN - ago * DAY;
export const dayOf = (t: number): string => new Date((t + TZ * MIN) * 1000).toISOString().slice(0, 10);

export const DEVICES = PEOPLE.flatMap((p) => p.devices);
const pair = (bytes: number): Pair => [Math.round(bytes * UP), Math.round(bytes * (1 - UP))];
export const sum = (pairs: Pair[]): Pair => pairs.reduce<Pair>((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
export const add = (lists: Pair[][]): Pair[] => Array.from({ length: DAYS }, (_x, i) => sum(lists.map((l) => l[i])));

/** A device's address at a place: the same one every time, from a documentation range (home: 203.0.113.x). */
export function addressAt(d: CastDevice, at: PlaceId): string {
  const n = 10 + DEVICES.indexOf(d);
  return at === 'home' ? `203.0.113.${n}` : `198.51.100.${n + 40 * (Object.keys(PLACES.en).indexOf(at) - 1)}`;
}

/** Each of the last DAYS days' [rx, tx] of a device, oldest first: nothing before it was added or after it was last seen. */
export function daily(d: CastDevice): Pair[] {
  const last = Math.floor(d.seen / DAY);
  const weights = Array.from({ length: DAYS }, (_x, i) => {
    const ago = DAYS - 1 - i;
    if (ago > d.added || ago < last) return 0;
    const weekday = new Date((midnight(ago) + TZ * MIN + DAY / 2) * 1000).getUTCDay();
    // today is only partly gone
    return WEEK[weekday] * (0.5 + chance(d.id, ago)) * (ago ? 1 : (NOW - midnight(0)) / DAY);
  });
  const month = weights.slice(-30).reduce((s, w) => s + w, 0) || 1;
  return weights.map((w) => pair((w / month) * d.gb * GB));
}

interface Session {
  from: number;
  /** 0: it is still on. */
  to: number;
  at: PlaceId;
}

/** When a device was on in the last 30 days, oldest first, by the habits of its kind; the last one is how it stands now. */
function sessions(d: CastDevice): Session[] {
  const at = d.at ?? 'home';
  const seen = NOW - d.seen;
  const last: Session = d.on ? { from: NOW - d.on * HOUR, to: 0, at } : { from: seen - HABITS[d.kind][0][1] * HOUR, to: seen, at };
  const out: Session[] = [];
  for (let ago = Math.min(30, d.added); ago >= 0; ago--)
    for (const [start, hours] of HABITS[d.kind]) {
      const from = midnight(ago) + (start + chance(d.id, ago, start) - 0.5) * HOUR;
      const to = from + (hours + chance(d.id, ago, hours) - 0.5) * HOUR;
      // a computer stays shut some evenings; nothing overlaps how the device stands now
      if (to > last.from - HOUR / 2 || (d.kind !== 'phone' && chance(d.id, 'shut', ago) < 0.15)) continue;
      out.push({ from: Math.round(from), to: Math.round(to), at: d.was?.find(([, days]) => days === ago)?.[0] ?? at });
    }
  return [...out, last];
}

/** The log of the last 30 days, oldest first: every device coming and going, and what the router noticed. */
export function log(lang: Lang): LogEvent[] {
  const out: LogEvent[] = [];
  for (const p of PEOPLE) {
    for (const d of p.devices) {
      const who = { person: p.id, device: d.id, server: SERVER.id };
      for (const s of sessions(d)) {
        const place = PLACES[lang][s.at];
        out.push({ ...who, ts: s.from, type: 'connect', detail: addressAt(d, s.at), where: `${place.city} · ${place.org}` });
        if (s.to) out.push({ ...who, ts: s.to, type: 'disconnect' });
      }
      if (d.link) out.push({ ...who, ts: NOW - (d.on ? 10 * MIN : 4 * HOUR), type: 'device_failing', detail: d.link });
    }
    if (p.paused !== undefined) out.push({ person: p.id, server: SERVER.id, ts: NOW - p.paused * DAY, type: 'paused', by: 'admin' });
  }
  return out.filter((e) => e.ts > NOW - 30 * DAY).sort((a, b) => a.ts - b.ts);
}

/** Where every device was seen in the last 30 days: the newest moment at each place. */
export function places(lang: Lang): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (const p of PEOPLE)
    for (const d of p.devices) {
      const newest = new Map<PlaceId, Session>();
      for (const s of sessions(d)) newest.set(s.at, s);
      for (const [at, s] of newest) {
        if ((s.to || NOW) < NOW - 30 * DAY) continue;
        const { city, country, cc, lat, lon, org } = PLACES[lang][at];
        out.push({
          person: p.id,
          device: d.id,
          ip: addressAt(d, at),
          ts: s.to || NOW,
          online: !s.to,
          lat,
          lon,
          city,
          country,
          cc,
          asn: 0,
          org,
        });
      }
    }
  return out.sort((a, b) => b.ts - a.ts);
}
