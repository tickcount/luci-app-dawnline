// The People list as data: who is in scope of the address (the server, «waiting for a new configuration», a
// chip), the order the «Order» chip picks, where a person was last, and what the «Online» group's head owes the
// page's count. The groups themselves are the cards' (card.ts). Pure: no DOM.

import type { Geo, GeoPoint, Person } from '../../shared/types';
import { locale } from '../../shared/i18n';
import { groupOf } from './card';
import { share, type Today } from './lines';
import type { Filter, PeopleRoute } from './route';

/** A chip's people: who needs a decision (the cards' first group), who has a device online, who is paused (their group). */
export const inFilter = (p: Person, f: Filter, t: Today): boolean => (f === 'online' ? p.online > 0 : groupOf(p, t) === f);

/** Someone whose enabled, set-up device has not fetched its new configuration yet (a rollout waits on them). */
export const waitsForConfig = (p: Person): boolean => p.devices.some((d) => d.config_stale && !!d.handshake && !d.disabled);

/** People in scope of the address: the server, «waiting for a new configuration» and (unless `chip` is false) the chip. */
export function scoped(people: Person[], r: Pick<PeopleRoute, 'server' | 'need' | 'group'>, t: Today, chip = true): Person[] {
  return people.filter(
    (p) => (!r.server || p.server === r.server) && (!r.need || waitsForConfig(p)) && (!chip || !r.group || inFilter(p, r.group, t)),
  );
}

export type SortKey = 'name' | 'devices' | 'traffic' | 'term' | 'seen';
/** The orders, and the direction each sorts first: names and end dates up, the rest the biggest and newest first. */
export const SORTS: Record<SortKey, 1 | -1> = { name: 1, devices: -1, traffic: -1, term: 1, seen: -1 };

/** What they used this period, in bytes (of the limit, or the month). */
const used = (p: Person): number => (p.quota_limit ? p.quota_used : p.month[0] + p.month[1]);

/** An order as the address keeps it: a key, '-' before it for the other way round. */
export function sortOf(s: string | undefined): { key: SortKey; dir: 1 | -1 } | null {
  if (!s) return null;
  const key = s.replace(/^-/, '') as SortKey;
  return key in SORTS ? { key, dir: s.startsWith('-') ? -1 : 1 } : null;
}

/** An order picked from the chip's menu, as the address keeps it: its natural direction. */
export const sortBy = (key: SortKey): string => (SORTS[key] === 1 ? key : `-${key}`);

export function sortPeople(list: Person[], s: { key: SortKey; dir: 1 | -1 }): Person[] {
  const v: Record<SortKey, (a: Person, b: Person) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, locale()),
    devices: (a, b) => a.devices.length - b.devices.length || a.online - b.online,
    traffic: (a, b) => share(a) - share(b) || used(a) - used(b),
    // no end date sorts as the farthest
    term: (a, b) => (a.expires || '9999').localeCompare(b.expires || '9999'),
    seen: (a, b) => Number(a.online > 0) - Number(b.online > 0) || a.last_seen - b.last_seen,
  };
  return [...list].sort((a, b) => v[s.key](a, b) * s.dir || a.name.localeCompare(b.name, locale()));
}

/** Where a person was last: their live place, else the newest. */
export function lastPlace(p: Person, geo: Geo): GeoPoint | null {
  const pts = geo.points.filter((x) => x.person === p.id);
  if (!pts.length) return null;
  return pts.sort((a, b) => Number(b.online) - Number(a.online) || b.ts - a.ts)[0];
}

/**
 * People online who stand in the group above «Online» (they need a decision): the head of «Online» says them
 * beside its own count, so it and the page's «N online» count the same people.
 */
export const onlineAbove = (list: Person[], t: Today): number => list.filter((p) => p.online > 0 && groupOf(p, t) === 'need').length;
