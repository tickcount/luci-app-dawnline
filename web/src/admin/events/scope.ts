// What the Log is asked for, as its address says it: the kind of entries and
// the words searched (events/find.ts matches those), and the scope: one
// person's, one device's or one server's rows, one day (today, yesterday, the
// last 7 days). Here: the address read and written, which rows a scope keeps,
// and how many rows each choice of a filter would leave (the lists under the
// «Person», «Device» and «Server» chips). Pure: no DOM (pages/log draws it).

import type { Status } from '../../shared/types';
import type { FeedItem } from './sessions';
import { dayBefore, routerDay } from './clock';
import { KINDS, type LogKind } from './find';

/** A day filter: the router's today, its yesterday, or the last 7 × 24 hours. */
export type LogDay = 'today' | 'yesterday' | '7d';
export const DAYS: LogDay[] = ['today', 'yesterday', '7d'];

export interface LogQuery {
  kind: LogKind;
  day: LogDay | '';
  person: string;
  device: string;
  server: string;
  /** The words typed into the search. */
  q: string;
}

/** Nothing asked: the whole log. */
export const WHOLE: LogQuery = { kind: 'all', day: '', person: '', device: '', server: '', q: '' };

/** Who the scope is read against: the people with their devices, the servers. */
export type Who = Pick<Status, 'people' | 'servers'>;

/** The router's clock: now (s) and its UTC offset (minutes). */
export interface Clock {
  now: number;
  tz?: number;
}

/** What an address' query asks for; anything it does not know is left out (`day=week` is the 7 days' older name). */
export function parseLogQuery(query: string): LogQuery {
  const p = new URLSearchParams(query);
  const kind = p.get('kind') as LogKind | null;
  const day = p.get('day') === 'week' ? '7d' : (p.get('day') as LogDay | null);
  return {
    kind: kind && KINDS.includes(kind) ? kind : 'all',
    day: day && DAYS.includes(day) ? day : '',
    person: p.get('person') ?? '',
    device: p.get('device') ?? '',
    server: p.get('server') ?? '',
    q: (p.get('q') ?? '').trim(),
  };
}

/** A query as the address' parameters (shell/routes.ts logUrl takes them): only what narrows the log. */
export function logQueryParams(q: LogQuery): {
  kind?: string;
  day?: string;
  person?: string;
  device?: string;
  server?: string;
  q?: string;
} {
  return {
    kind: q.kind === 'all' ? undefined : q.kind,
    day: q.day || undefined,
    person: q.person || undefined,
    device: q.device || undefined,
    server: q.server || undefined,
    q: q.q || undefined,
  };
}

/** Something narrows the log (its way off, «Reset», is offered). */
export const narrowed = (q: LogQuery): boolean => !!(q.kind !== 'all' || q.day || q.person || q.device || q.server || q.q);

/**
 * A query with filters changed. A device is someone's: picking one drops a person it is not of, and picking a
 * person drops a device that is not theirs (the two together would leave nothing).
 */
export function withFilters(q: LogQuery, patch: Partial<LogQuery>, people: Who['people']): LogQuery {
  const next = { ...q, ...patch };
  const has = (person: string, device: string) => !!people.find((p) => p.id === person)?.devices.some((d) => d.id === device);
  if (patch.device && next.person && !has(next.person, patch.device)) next.person = '';
  else if (patch.person && next.device && !has(patch.person, next.device)) next.device = '';
  return next;
}

/**
 * The server a row happened on: a person's event on their server (as the row says it), another event on the one
 * the router wrote into it; a service line on the server it names (older lines have only its name).
 */
function serverOf(x: FeedItem, who: Who, ofPerson: Map<string, string>): string | undefined {
  if (x.ev) return (x.ev.person ? ofPerson.get(x.ev.person) : undefined) ?? x.ev.server;
  return x.sys?.sid ?? (x.sys?.who ? who.servers.find((s) => s.name === x.sys!.who)?.id : undefined);
}

/**
 * Whether a row is in the query's scope: who, where and when (not its kind and not the search). A person's or a
 * device's log has no service lines: those are no one's.
 */
export function inScope(q: LogQuery, who: Who, clock: Clock): (x: FeedItem) => boolean {
  const ofPerson = new Map(who.people.map((p) => [p.id, p.server]));
  const today = routerDay(clock.now, clock.tz);
  const yesterday = dayBefore(today);
  const weekAgo = clock.now - 7 * 86400;
  return (x) => {
    if (q.person && x.ev?.person !== q.person) return false;
    if (q.device && x.ev?.device !== q.device) return false;
    if (q.server && serverOf(x, who, ofPerson) !== q.server) return false;
    if (q.day === 'today') return routerDay(x.ts, clock.tz) === today;
    if (q.day === 'yesterday') return routerDay(x.ts, clock.tz) === yesterday;
    if (q.day === '7d') return x.ts >= weekAgo;
    return true;
  };
}

/** One choice of a filter and how many rows it would leave. */
interface Choice {
  id: string;
  n: number;
}

export interface Choices {
  people: Choice[];
  devices: Choice[];
  servers: Choice[];
}

const tally = (items: FeedItem[], key: (x: FeedItem) => string | undefined): Map<string, number> => {
  const n = new Map<string, number>();
  for (const x of items) {
    const k = key(x);
    if (k) n.set(k, (n.get(k) ?? 0) + 1);
  }
  return n;
};

/** Those with rows, the most first (equal ones in the order given), and the picked one whatever it has. */
const ranked = (ids: string[], n: Map<string, number>, picked: string): Choice[] =>
  [...new Set(picked ? [...ids, picked] : ids)]
    .map((id) => ({ id, n: n.get(id) ?? 0 }))
    .filter((c) => c.n > 0 || c.id === picked)
    .sort((a, b) => b.n - a.n);

/**
 * What each filter's list offers, with the rows each choice would leave under the other filters of the scope:
 * people (whatever device is picked: another person takes it off), the devices of the picked person (of
 * everyone, with none picked), every server in the router's order. A picked one that is gone from the router
 * (removed since) is still listed, so it can be seen checked.
 */
export function choices(items: FeedItem[], q: LogQuery, who: Who, clock: Clock): Choices {
  const ofPerson = new Map(who.people.map((p) => [p.id, p.server]));
  const left = (lift: Partial<LogQuery>) => items.filter(inScope({ ...q, ...lift }, who, clock));
  const devices = who.people.filter((p) => !q.person || p.id === q.person).flatMap((p) => p.devices.map((d) => d.id));
  const perServer = tally(left({ server: '' }), (x) => serverOf(x, who, ofPerson));
  return {
    people: ranked(
      who.people.map((p) => p.id),
      tally(left({ person: '', device: '' }), (x) => x.ev?.person),
      q.person,
    ),
    devices: ranked(
      devices,
      tally(left({ device: '' }), (x) => x.ev?.device),
      q.device,
    ),
    servers: who.servers.map((s) => ({ id: s.id, n: perServer.get(s.id) ?? 0 })),
  };
}
