// Where a device went: its stretches on each client address from the activity log
// (connect, roam, disconnect), as visits to the places the map shows, folded into
// stays for the replay, and the replay's timeline and shimmer. No DOM here (see ./render).

import type { GeoPoint, LogEvent } from '../../shared/types';
import { locale } from '../../shared/i18n';

/** On one client address: from a connect or a roam to the next one, a disconnect or now. */
export interface Stretch {
  ip: string;
  from: number;
  to: number;
  live: boolean;
}

/**
 * A device's stretches in time order, from the activity log. A stretch the log leaves open
 * goes on until now while the device is online, and ends at `seen` (its latest handshake)
 * when it is not. Empty when the log has no connections (the category is off or cleared).
 */
export function stretches(events: LogEvent[], device: string, now: number, online: boolean, seen = 0): Stretch[] {
  const out: Stretch[] = [];
  let cur: Stretch | null = null;
  const close = (t: number) => {
    if (cur && t > cur.from) out.push({ ...cur, to: t });
    cur = null;
  };
  const mine = events.filter((e) => e.device === device).sort((a, b) => a.ts - b.ts);
  for (const e of mine) {
    if (e.type === 'connect') {
      close(e.ts);
      if (e.detail) cur = { ip: e.detail, from: e.ts, to: e.ts, live: false };
    } else if (e.type === 'roam') {
      // "old → new"
      const ip = e.detail?.split('→')[1]?.trim();
      close(e.ts);
      if (ip) cur = { ip, from: e.ts, to: e.ts, live: false };
    } else if (e.type === 'disconnect') close(e.ts);
  }
  const open = cur as Stretch | null;
  if (open && online) out.push({ ...open, to: Math.max(now, open.from), live: true });
  else close(Math.min(now, seen));
  return out;
}

/** A place as the map groups them: the city (or rounded coordinates where there is none) and the country. */
export function placeKey(p: Pick<GeoPoint, 'city' | 'lat' | 'lon' | 'cc'>): string {
  return `${p.city || `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`}|${p.cc}`;
}

/** A stretch at a located address: the place it was at. */
export interface Visit {
  key: string;
  point: GeoPoint;
  from: number;
  to: number;
  live: boolean;
}

/**
 * The stretches since `from` whose address has a location (the device's own point first, then
 * anyone's at that address), clipped to `from`. Addresses without one are left out, as on the map.
 */
export function visits(list: Stretch[], points: GeoPoint[], device: string, from: number): Visit[] {
  const at = new Map<string, GeoPoint>();
  for (const p of points) if (p.device === device || !at.has(p.ip)) at.set(p.ip, p);
  const out: Visit[] = [];
  for (const s of list) {
    const p = at.get(s.ip);
    if (!p || s.to <= from) continue;
    out.push({ key: placeKey(p), point: p, from: Math.max(s.from, from), to: s.to, live: s.live });
  }
  return out;
}

/** Each place's share of the time the visits cover (0–1), by place key. */
export function shares(v: Visit[]): Map<string, number> {
  const time = new Map<string, number>();
  let total = 0;
  for (const x of v) {
    time.set(x.key, (time.get(x.key) ?? 0) + (x.to - x.from));
    total += x.to - x.from;
  }
  return new Map([...time].map(([k, t]) => [k, total ? t / total : 0]));
}

/** Visits in a row at one place, with `short` visits elsewhere folded in. */
export interface Stay {
  key: string;
  point: GeoPoint;
  from: number;
  to: number;
  live: boolean;
  /** Visits elsewhere shorter than the fold (a phone flipping to mobile data and back), folded into this stay. */
  short: number;
}

/** Visits as stays: a place's visits in a row are one, and a visit elsewhere shorter than `fold` seconds joins the stay around it. */
export function stays(v: Visit[], fold = 45 * 60): Stay[] {
  const out: Stay[] = [];
  for (const x of v) {
    const last = out[out.length - 1];
    if (last && x.key !== last.key && !x.live && x.to - x.from < fold) {
      last.short++;
      last.to = x.to;
      continue;
    }
    if (last && last.key === x.key) {
      last.to = x.to;
      last.live = x.live;
      continue;
    }
    out.push({ key: x.key, point: x.point, from: x.from, to: x.to, live: x.live, short: 0 });
  }
  return out;
}

/**
 * Stays for a replay of at most `max` moves: every move while there are few, folding the
 * shortest visits (minutes on mobile data, then longer) only as far as needed.
 */
export function replayStays(v: Visit[], max = 24): Stay[] {
  for (const fold of [0, 5 * 60, 15 * 60, 45 * 60, 2 * 3600, 6 * 3600]) {
    const st = stays(v, fold);
    if (st.length - 1 <= max) return st;
  }
  return stays(v, 24 * 3600);
}

/* ---------- the replay ---------- */

/** One move (ms): the place it leaves lets go, the shimmer runs along the arc, the next place lights up. */
export const MOVE_MS = 1600;
/** The shimmer sets off once the place it leaves has started to go gray (a share of the move). */
const LEAVE = 0.12;
/** The shimmer's length, a share of the arc: longer than the arc, so most of it is lit mid-move. */
const BAND = 1.3;
/** ± this around the shimmer's middle is fully lit; it fades out to ±BAND/2. */
const FLAT = 0.32;

/** A move into stay `k` (from stay k − 1), or stay `k` itself, `ms` long from `start`. */
export interface Step {
  kind: 'move' | 'stay';
  k: number;
  start: number;
  ms: number;
}

/** The replay's steps: each stay held in proportion to how long it lasted (within bounds), a move before each but the first. */
export function timeline(st: Stay[], move = MOVE_MS): { steps: Step[]; total: number } {
  const steps: Step[] = [];
  let t = 0;
  st.forEach((s, k) => {
    if (k) {
      steps.push({ kind: 'move', k, start: t, ms: move });
      t += move;
    }
    const ms = Math.min(1100, Math.max(350, ((s.to - s.from) / 3600) * 45));
    steps.push({ kind: 'stay', k, start: t, ms });
    t += ms;
  });
  return { steps, total: t };
}

/** Where the replay is at `ms`: the step (its index), how far into it (0–1) and the moment shown. */
export function moment(st: Stay[], steps: Step[], ms: number): { i: number; step: Step; q: number; t: number } {
  let i = steps.findIndex((s) => ms >= s.start && ms < s.start + s.ms);
  if (i < 0) i = steps.length - 1;
  const step = steps[i];
  const q = Math.min(1, Math.max(0, (ms - step.start) / step.ms));
  const s = st[step.k];
  return { i, step, q, t: step.kind === 'move' ? s.from : s.from + (s.to - s.from) * q };
}

/** The replay's `ms` for moment `t` (a click on a strip): inside the stay it falls in. */
export function msAt(st: Stay[], steps: Step[], t: number): number {
  let k = st.findIndex((s) => t >= s.from && t < s.to);
  if (k < 0) k = t < (st[0]?.from ?? 0) ? 0 : st.length - 1;
  const step = steps.find((s) => s.kind === 'stay' && s.k === k)!;
  const s = st[k];
  return step.start + step.ms * Math.min(0.999, Math.max(0, (t - s.from) / Math.max(1, s.to - s.from)));
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/** The shimmer's middle (a share of the arc) `q` into a move: it enters before the place it leaves and runs out past the next. */
export function bandMiddle(q: number): number {
  return -BAND / 2 + (1 + BAND) * ease((q - LEAVE) / (1 - LEAVE));
}

/** The next place lights up once the shimmer's bright part reaches it. */
export const arrived = (middle: number) => middle + FLAT >= 1;

/**
 * The opacity of the arc's dots (each has its `pos` along the arc, 0–1) with the shimmer's middle
 * at `c`: beui's text shimmer along a line, the arc itself transparent. A MapLibre expression.
 */
export function shimmerOpacity(c: number): unknown[] {
  return ['interpolate', ['linear'], ['abs', ['-', ['get', 'pos'], c]], 0, 1, FLAT, 1, BAND / 2, 0];
}

/* ---------- labels ---------- */

/** Labels under the strips for a range ending `now`: [share of the range, label], in local time. */
export function ticks(range: '24h' | '7d' | '30d', now: number): [number, string][] {
  const span = range === '24h' ? 86400 : range === '7d' ? 7 * 86400 : 30 * 86400;
  const from = now - span;
  const out: [number, string][] = [];
  const put = (ts: number, label: string) => {
    const f = (ts - from) / span;
    if (f > 0.02 && f < 0.98) out.push([f, label]);
  };
  const d = new Date(from * 1000);
  if (range === '24h') {
    d.setMinutes(0, 0, 0);
    while (d.getTime() / 1000 <= now) {
      if (d.getHours() % 6 === 0) put(d.getTime() / 1000, `${String(d.getHours()).padStart(2, '0')}:00`);
      d.setHours(d.getHours() + 1);
    }
  } else if (range === '7d') {
    d.setHours(12, 0, 0, 0);
    for (; d.getTime() / 1000 <= now; d.setDate(d.getDate() + 1))
      put(d.getTime() / 1000, d.toLocaleDateString(locale(), { weekday: 'short' }));
  } else {
    const end = new Date(now * 1000);
    end.setHours(0, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      const w = new Date(end);
      w.setDate(end.getDate() - 7 * i);
      put(w.getTime() / 1000, w.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }));
    }
    out.reverse();
  }
  return out;
}

/** "14:05", local. */
export const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

/** "Today", "Yesterday" or "Wed 14 Oct" for a moment, against the router's `now`. */
export function dayName(ts: number, now: number): string {
  const day = (x: number) => new Date(x * 1000).toDateString();
  if (day(ts) === day(now)) return _('Today');
  if (day(ts) === day(now - 86400)) return _('Yesterday');
  return new Date(ts * 1000).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
}
