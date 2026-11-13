// A device's link over its last 30 days, from the log: whether it worked,
// hour by hour, as runs in a state (in the network; failing in a named way,
// the agent's device_failing until device_recovered; let in only to the portal
// and the router's DNS, between the person's quota_reached and
// quota_restored), and ticks where something changed what it gets (its
// own settings or keys, the person's, its server's). Also the line that says
// at rest since when it is the way it is. Days and times are the router's
// (status.tz). Pure: no DOM (widgets/timeline.ts draws it).

import type { Device, LogEvent, Person, Server } from '../../shared/types';
import type { ServiceLogEntry } from '../api';
import { ago, duration } from '../../shared/format';
import { fmt, plural } from '../../shared/i18n';
import { plainWhere } from '../../shared/org';
import { routerDay, routerTime } from './clock';
import { changedServer, linkStateText } from './model';

export type RunState = 'ok' | 'warn' | 'bad';

/** A stretch of time in one state, where the device connected from (City · Operator, '' unknown). */
export interface Run {
  a: number;
  b: number;
  s: RunState;
  where: string;
}

/** A change that rewrote what the device gets: the event (or the service log's line) that says so. */
export interface Tick {
  t: number;
  ev?: LogEvent;
  sys?: ServiceLogEntry;
}

export type Span = '24h' | '7d' | '30d';
export const SPAN: Record<Span, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
const H = 3600;

export interface LinkTimeline {
  runs: Run[];
  ticks: Tick[];
}

export interface TimelineInput {
  device: Device;
  person: Person;
  server?: Server;
  /** The device's and its person's events (any order). */
  events: LogEvent[];
  /** The service log (its server's changes). */
  system?: ServiceLogEntry[];
  now: number;
  tz?: number;
}

type Interval = [number, number];

/** The device's sessions: connect (and roam) to the next disconnect, the last one open to now while it is online. */
function sessions(ev: LogEvent[], d: Device, now: number): Run[] {
  const out: Run[] = [];
  let cur: Run | null = null;
  const close = (t: number) => {
    if (cur && t > cur.a) out.push({ ...cur, b: t });
    cur = null;
  };
  for (const e of ev) {
    if (e.type === 'connect') {
      close(e.ts);
      cur = { a: e.ts, b: e.ts, s: 'ok', where: e.where ? plainWhere(e.where) : '' };
    } else if (e.type === 'roam') {
      const where: string = (cur as Run | null)?.where ?? '';
      close(e.ts);
      cur = { a: e.ts, b: e.ts, s: 'ok', where: e.where ? plainWhere(e.where) : where };
    } else if (e.type === 'disconnect') close(e.ts);
  }
  if (cur) close(d.online ? now : Math.min(now, Math.max(d.handshake, (cur as Run).a)));
  return out;
}

/** From each `start` event to its `stop` (or, the last one, to now while `still`). */
function intervals(ev: LogEvent[], start: string, stop: string, still: boolean, now: number): Interval[] {
  const out: Interval[] = [];
  let from: number | null = null;
  for (const e of ev) {
    if (e.type === start && from == null) from = e.ts;
    else if (e.type === stop && from != null) {
      out.push([from, e.ts]);
      from = null;
    }
  }
  if (from != null && still) out.push([from, now]);
  return out;
}

const inAny = (t: number, list: Interval[]) => list.some(([a, b]) => t >= a && t < b);

/**
 * The device's runs and ticks over the last 30 days. A failing link counts
 * whether or not it was connected (trying: it knocks without a session); the
 * limit only colours the time it was connected.
 */
export function linkTimeline(o: TimelineInput): LinkTimeline {
  const { device: d, person: p, now } = o;
  const from = now - SPAN['30d'];
  const sorted = [...o.events].sort((a, b) => a.ts - b.ts);
  const mine = sorted.filter((e) => e.device === d.id);
  const own = sorted.filter((e) => e.person === p.id && !e.device);
  const sess = sessions(mine, d, now).filter((r) => r.b > from);
  const failing = intervals(mine, 'device_failing', 'device_recovered', !!d.link && !d.disabled, now);
  const quota = intervals(own, 'quota_reached', 'quota_restored', p.state === 'quota', now);
  // Every moment the state may change; between two of them it holds.
  const cuts = new Set<number>([from, now]);
  for (const r of sess) cuts.add(r.a).add(r.b);
  for (const [a, b] of [...failing, ...quota]) cuts.add(a).add(b);
  const points = [...cuts].filter((t) => t >= from && t <= now).sort((a, b) => a - b);
  const runs: Run[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (b <= a) continue;
    const mid = (a + b) / 2;
    const s = sess.find((r) => mid >= r.a && mid < r.b);
    let state: RunState | null = s ? 'ok' : null;
    if (inAny(mid, failing)) state = 'warn';
    else if (state === 'ok' && inAny(mid, quota)) state = 'bad';
    if (!state) continue;
    const where = s?.where ?? '';
    const last = runs[runs.length - 1];
    if (last && last.b === a && last.s === state && last.where === where) last.b = b;
    else runs.push({ a, b, s: state, where });
  }
  const ticks: Tick[] = [
    ...mine.filter((e) => e.type === 'device_changed' || e.type === 'device_keys').map((e) => ({ t: e.ts, ev: e })),
    ...own.filter((e) => e.type === 'person_changed').map((e) => ({ t: e.ts, ev: e })),
    ...(o.system ?? []).filter((x) => x.msg === 'changed' && !!o.server && changedServer(x, o.server)).map((x) => ({ t: x.ts, sys: x })),
  ].filter((k) => k.t > from && k.t <= now);
  return { runs, ticks: ticks.sort((a, b) => a.t - b.t) };
}

/** Seconds in state `s` within the last `span`. */
export function timeIn(runs: Run[], span: Span, now: number, s: RunState = 'ok'): number {
  const from = now - SPAN[span];
  return runs.filter((r) => r.s === s).reduce((n, r) => n + Math.max(0, Math.min(r.b, now) - Math.max(r.a, from)), 0);
}

/** Times its link failed within the last `span` (runs of warn that began in it). */
const failures = (runs: Run[], span: Span, now: number) => runs.filter((r) => r.s === 'warn' && r.a >= now - SPAN[span]).length;

/** "the last 7 days", for the line's label. */
export const spanWords = (s: Span): string => ({ '24h': _('last 24 hours'), '7d': _('last 7 days'), '30d': _('last 30 days') })[s];

/** "08:40" today, else "4 Nov 08:40" (router time). */
function since(t: number, now: number, tz?: number, day?: (d: string) => string): string {
  const time = routerTime(t, tz);
  return routerDay(t, tz) === routerDay(now, tz) || !day ? time : `${day(routerDay(t, tz))} ${time}`;
}

export interface Summary {
  value: string;
  tone: 'ok' | 'warn' | 'bad' | '';
  sub: string;
}

/**
 * What the line says at rest for a period: since when the device is the way it
 * is, and under it how the period went. `day` writes a router day ("4 Nov").
 */
export function summary(t: LinkTimeline, o: TimelineInput, span: Span, day: (d: string) => string): Summary {
  const { device: d, person: p, now, tz } = o;
  const on = timeIn(t.runs, span, now);
  const fails = failures(t.runs, span, now);
  const hours = on ? fmt(_('online %s in the %s'), plural(Math.round(on / H), '%s hour', '%s hours'), spanWords(span)) : '';
  const how = [hours, fails ? plural(fails, '%s failure', '%s failures') : on ? _('no failures') : ''].filter(Boolean).join(' · ');
  const lastSeen = d.handshake ? fmt(_('Last online %s'), ago(d.handshake, now)) : _('It has not connected yet');
  if (d.disabled) return { value: _('Disabled by you'), tone: '', sub: lastSeen };
  const cur = t.runs[t.runs.length - 1];
  const live = cur && cur.b >= now - 60 ? cur : null;
  if (d.link) {
    const w = linkStateText(d.link.state)?.title ?? '';
    return { value: fmt(_('%s since %s'), w, since(d.link.since, now, tz, day)), tone: 'warn', sub: d.online ? how || lastSeen : lastSeen };
  }
  if (d.online && p.state === 'quota') {
    const q = live?.s === 'bad' ? live.a : null;
    return {
      value: q ? fmt(_('Data limit reached %s'), since(q, now, tz, day)) : _('Data limit reached'),
      tone: 'bad',
      sub: _('Online, but only the portal and the router’s DNS open.'),
    };
  }
  if (d.online && !live) return { value: _('Online'), tone: 'ok', sub: how };
  if (d.online) {
    // Since the session in the network began: runs back to back of any state but a failure count as one.
    let a = live?.a ?? now;
    for (let i = t.runs.length - 1; i > 0 && t.runs[i - 1].b >= t.runs[i].a && t.runs[i - 1].s !== 'warn'; i--) a = t.runs[i - 1].a;
    return { value: fmt(_('Online since %s'), since(a, now, tz, day)), tone: 'ok', sub: how };
  }
  // a router its owner asked for has been given nothing yet: it waits for the admin's answer
  if (!d.handshake && d.waiting && !d.declined)
    return {
      value: _('Waits for your answer'),
      tone: 'warn',
      sub: _('Asked for on its owner’s page. It can connect once you accept it.'),
    };
  if (!d.handshake)
    return {
      value: _('It has not connected yet'),
      tone: '',
      sub: _('Its configuration was given out, but the device has never connected.'),
    };
  return {
    value: fmt(_('Offline for %s'), duration(now - d.handshake)),
    tone: '',
    sub: how || fmt(_('No connections in the %s'), spanWords(span)),
  };
}
