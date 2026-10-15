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

export function date(s: string): string {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole days until the end of the given YYYY-MM-DD (negative when past). */
export function daysLeft(s: string, now = Date.now()): number | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  const end = new Date(y, m - 1, d, 23, 59, 59).getTime();
  return Math.ceil((end - now) / 86400000);
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
  paused_all: 'Paused (everyone)',
  expired: 'Expired',
  quota: 'Data limit reached',
  hours: 'Outside allowed hours',
  no_server: 'No server',
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
