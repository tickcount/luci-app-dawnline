// Formatting helpers shared by the admin UI and the portal, in the page's
// language (shared/i18n.ts): units, relative times, dates, labels.

import type { Access, Kind, Person, PersonState, Server } from './types';
import { fmt, locale, num, plural } from './i18n';

/** A size with its unit: one decimal from 1 KB up to 100 of a unit ("1.5 GB", "120 MB"). */
function sized(v: number, units: string[], step: number): string {
  let i = 0;
  while (v >= step && i < units.length - 1) {
    v /= step;
    i++;
  }
  return `${v >= 100 || i === 0 ? num(Math.round(v)) : num(v, 1)} ${units[i]}`;
}

export function bytes(n: number): string {
  return sized(!n || n < 0 ? 0 : n, [_('B'), _('KB'), _('MB'), _('GB'), _('TB')], 1024);
}

/** Bytes per second as a bit rate. */
export function bits(bps: number): string {
  const b = bps * 8;
  const units = [_('bit/s'), _('kbit/s'), _('Mbit/s'), _('Gbit/s')];
  if (b < 1000) return `${num(Math.round(b))} ${units[0]}`;
  const i = b < 1e6 ? 1 : b < 1e9 ? 2 : 3;
  const v = b / 1000 ** i;
  return `${num(v, i === 3 || v < 10 ? 1 : 0)} ${units[i]}`;
}

export function ago(ts: number, now = Date.now() / 1000): string {
  if (!ts) return _('never');
  const d = Math.max(0, Math.round(now - ts));
  if (d < 60) return _('just now');
  if (d < 3600) return fmt(_('%s min ago'), Math.floor(d / 60));
  if (d < 86400) return fmt(_('%s h ago'), Math.floor(d / 3600));
  if (d < 86400 * 30) return fmt(_('%s d ago'), Math.floor(d / 86400));
  return new Date(ts * 1000).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function duration(sec: number): string {
  if (!sec || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return fmt(_('%sd %sh'), d, h);
  if (h) return fmt(_('%sh %sm'), h, m);
  return fmt(_('%sm'), m);
}

export function clock(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const t = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return sameDay ? t : `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} ${t}`;
}

/* ---------- days (YYYY-MM-DD, the router's calendar) ---------- */

/** A Date as YYYY-MM-DD in local time. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD as a local Date at noon: never shifted to another day by the time zone. */
export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

/** "1 Oct 2026". A YYYY-MM-DD is a calendar day; other strings and Dates are moments. */
export function fmtDay(d: Date | string): string {
  const v = typeof d === 'string' ? (/^\d{4}-\d{2}-\d{2}$/.test(d) ? parseDay(d) : new Date(d)) : d;
  return v.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function date(s: string): string {
  return s ? fmtDay(s) : '';
}

/** Whole days from `b` to `a` (both YYYY-MM-DD); negative when `a` is earlier. */
export function dayDiff(a: string, b: string): number {
  const utc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(a) - utc(b)) / 86400000);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Months later (or earlier), the day clamped to the month's end: 31 Jan + 1 month = 28 or 29 Feb, not 3 Mar. */
export function addMonthsClamped(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1, 12);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, last));
  return isoDay(t);
}

/** Today on the router: the last day of a router series, else the browser's. */
export function todayOf(series: { day: string }[] | undefined): string {
  return series?.length ? series[series.length - 1].day : isoDay(new Date());
}

export type DateStep = 'day' | 'week' | 'month' | 'year' | 'custom';

/** Move an end date by n steps (negative shortens). An empty date counts from `today`. */
export function shiftDay(cur: string, step: DateStep, n: number, today: string, customDays = 30): string {
  const from = cur || today;
  if (step === 'day') return addDays(from, n);
  if (step === 'week') return addDays(from, 7 * n);
  if (step === 'month') return addMonthsClamped(from, n);
  if (step === 'year') return addMonthsClamped(from, 12 * n);
  return addDays(from, customDays * n);
}

/**
 * Days of access left for an end date (YYYY-MM-DD), counting today: 1 on the
 * last day, negative once it has passed, null without one. `today` is the
 * router's day; a number (ms) is a moment in the browser's zone.
 */
export function daysLeft(s: string, today: string | number = Date.now()): number | null {
  if (!s) return null;
  const t = typeof today === 'number' ? isoDay(new Date(today)) : today;
  const diff = dayDiff(s, t);
  return diff >= 0 ? diff + 1 : diff;
}

/**
 * Whether an end date is close enough to warn about, by the person's own
 * setting (`expire_warn` days; 0 = never). `left` is daysLeft().
 */
export function endsSoon(p: { expire_warn: number }, left: number | null): boolean {
  return left != null && left > 0 && p.expire_warn > 0 && left <= p.expire_warn;
}

/** "ends today", "ends tomorrow", "ends in 7 days" for daysLeft() > 0. */
export function endsIn(left: number): string {
  return left <= 1 ? _('ends today') : left === 2 ? _('ends tomorrow') : plural(left, 'ends in %s day', 'ends in %s days');
}

/** Small sizes on flash and in memory: B, KB, MB. */
export function kb(n: number): string {
  if (n < 1024) return `${num(n)} ${_('B')}`;
  return n < 1048576 ? `${num(n / 1024, n < 10240 ? 1 : 0)} ${_('KB')}` : `${num(n / 1048576, 1)} ${_('MB')}`;
}

export function accessLabel(a: Access): string {
  return { lan: _('Home network'), internet: _('Internet'), both: _('Home network + Internet') }[a];
}

/** The longest name a device takes, in characters (the router's DEVICE_NAME_MAX, util.uc). */
export const DEVICE_NAME_MAX = 20;

/**
 * Past ASCII, the blocks a device's name doesn't take: symbols, punctuation, arrows, maths, emoji and invisibles
 * (the router refuses the same, util.uc NAME_SYMBOLS). Code point ranges, both ends in.
 */
const NAME_SYMBOLS: [number, number][] = [
  [0x80, 0xbf],
  [0xd7, 0xd7],
  [0xf7, 0xf7],
  [0x2000, 0x2bff],
  [0x3000, 0x303f],
  [0xd800, 0xf8ff],
  [0xfe00, 0xfe0f],
  [0xfe30, 0xfe4f],
  [0xfeff, 0xfeff],
  [0xfff0, 0xffff],
  [0x1f000, 0x1fbff],
  [0xe0000, 0xe007f],
];
const ASCII_NAME = /^[A-Za-z0-9 ._-]$/;
const LETTER = /^[\p{L}\p{M}\p{N}]$/u;

/**
 * One character a device's name may hold: a letter of any language (with its marks) or a digit, a space, - _ or
 * . (the router checks the ASCII ones and refuses the symbol blocks past it; this also asks Unicode it is a letter).
 */
export function deviceNameChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return ASCII_NAME.test(ch);
  return !NAME_SYMBOLS.some(([a, b]) => cp >= a && cp <= b) && LETTER.test(ch);
}

/** `s` could still become a device's name as it is typed: only those characters, no more than DEVICE_NAME_MAX. */
export function deviceNameFits(s: string): boolean {
  const chars = [...s];
  return chars.length <= DEVICE_NAME_MAX && chars.every(deviceNameChar);
}

/** A device's name the router takes: not blank, and it fits (spaces around are trimmed). */
export const validDeviceName = (s: string): boolean => !!s.trim() && deviceNameFits(s.trim());

/**
 * A name made up for a device (its kind, the phone's model), as the router takes it: what it refuses stripped
 * ("Galaxy S24+" → "Galaxy S24"), cut to fit with `suffix` after it ("Phone 2"), not left ending in a space.
 * Nothing left: the kind-less "Device".
 */
export function fitName(base: string, suffix = ''): string {
  const clean =
    [...base]
      .map((c) => (deviceNameChar(c) ? c : ' '))
      .join('')
      .replace(/\s+/g, ' ')
      .trim() || _('Device');
  const cut = [...clean]
    .slice(0, Math.max(1, DEVICE_NAME_MAX - [...suffix].length))
    .join('')
    .trimEnd();
  return cut + suffix;
}

/** The name a device of kind `k` gets when nobody gives it one, in the page's language: "Phone", "Device". */
export function defaultName(k: Kind): string {
  return k === 'other' ? _('Device') : kindLabel(k);
}

/** In picker order. */
export const KINDS: Kind[] = ['computer', 'phone', 'tablet', 'router', 'other'];

export function kindLabel(k: Kind): string {
  return { computer: _('PC'), phone: _('Phone'), tablet: _('Tablet'), router: _('Router'), other: _('Other') }[k];
}

export function stateLabel(s: PersonState): string {
  return {
    active: _('Active'),
    paused: _('Paused'),
    expired: _('Expired'),
    quota: _('Data limit reached'),
    hours: _('Outside allowed hours'),
    no_server: _('No server'),
    server_off: _('Server is turned off'),
  }[s];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] ?? '';
  const b = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0][1] ?? '');
  return (a + b).toUpperCase();
}

/** "1.2 GB of 50 GB" style quota text, or just usage when unlimited. */
export function quotaText(used: number, quotaGb: number, period: 'month' | 'total'): string {
  const u = bytes(used);
  if (!quotaGb) return fmt(period === 'total' ? _('%s in total') : _('%s this month'), u);
  return fmt(period === 'total' ? _('%s of %s GB') : _('%s of %s GB this month'), u, num(quotaGb));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** Online, then offline, then not set up yet, then turned off; the order they were added within each. */
export function byDeviceState<T extends { online: boolean; handshake: number; disabled: boolean }>(list: T[]): T[] {
  const rank = (d: T) => (d.disabled ? 3 : d.online ? 0 : d.handshake ? 1 : 2);
  return list
    .map((d, i) => [d, i] as const)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([d]) => d);
}

/** Networks as people read them: a /24 as its first three numbers and x ("10.0.1.x"), others as they are. */
export function netsLabel(nets: string[]): string {
  return nets.map((n) => (n.endsWith('.0/24') ? `${n.slice(0, -5)}.x` : n)).join(', ');
}

/**
 * The home networks a device of `p` with LAN Bypass still sends into the tunnel: with home and internet access,
 * the server's home networks they reach (all of them, or the ones picked for them). None otherwise.
 */
export function homeOf(p: Person, srv: Server | undefined): string[] {
  if (p.access !== 'both' || !srv) return [];
  const pick = p.home_nets ?? [];
  return srv.home.filter((h) => !pick.length || pick.includes(h.dev)).flatMap((h) => h.nets);
}
