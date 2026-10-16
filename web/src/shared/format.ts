// Formatting helpers shared by the admin UI and the portal (English only).

import type { Access, Kind, PersonState } from './types';

export function bytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Bytes per second as a bit rate. */
export function bits(bps: number): string {
  const b = bps * 8;
  if (b < 1000) return `${Math.round(b)} bit/s`;
  if (b < 1e6) return `${(b / 1e3).toFixed(b < 1e4 ? 1 : 0)} kbit/s`;
  if (b < 1e9) return `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} Mbit/s`;
  return `${(b / 1e9).toFixed(1)} Gbit/s`;
}

export function ago(ts: number, now = Date.now() / 1000): string {
  if (!ts) return 'never';
  const d = Math.max(0, Math.round(now - ts));
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} d ago`;
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function duration(sec: number): string {
  if (!sec || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function clock(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? t : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${t}`;
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
  return v.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

/** "1 event", "2,000 events". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}

/** Small sizes on flash and in memory: B, KB, MB. */
export function kb(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

export const ACCESS_LABEL: Record<Access, string> = {
  lan: 'Home network',
  internet: 'Internet',
  both: 'Home network + Internet',
};

export const ACCESS_SHORT: Record<Access, string> = { lan: 'LAN', internet: 'Internet', both: 'LAN + Internet' };

/** In picker order. */
export const KINDS: Kind[] = ['computer', 'phone', 'tablet', 'router', 'other'];

export const KIND_LABEL: Record<Kind, string> = {
  computer: 'PC',
  phone: 'Phone',
  tablet: 'Tablet',
  router: 'Router',
  other: 'Other',
};

export const STATE_LABEL: Record<PersonState, string> = {
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired',
  quota: 'Data limit reached',
  hours: 'Outside allowed hours',
  no_server: 'No server',
  server_off: 'Server is turned off',
};

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
  if (!quotaGb) return `${u} ${period === 'total' ? 'in total' : 'this month'}`;
  return `${u} of ${quotaGb} GB${period === 'total' ? '' : ' this month'}`;
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
