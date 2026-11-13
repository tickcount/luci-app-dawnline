// What Settings' router-wide sections say, as pure functions (no DOM, no
// RPC): why a backup was made, which devices fetch their configuration again
// when the fallback DNS changes, a release note's point shortened for the
// update notice, a portal link's base on an address, the days its
// certificate has left and when that is soon; the Health checks that are
// about the portal or are fixed in Updates; what the log and the traffic
// history hold against their limits; and each section's state in a few
// words, as its rail entry says it under its name.

import type { HealthCheck, Status } from '../../shared/types';
import type { LogsInfo, UpdatesStatus } from '../api';
import { fmt, plural } from '../../shared/i18n';

/** An address that is an IPv4 address, not a name: its links are plain HTTP. */
export const isIp = (x: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(x);

/** Why a backup was made, from its reason id; an unknown id as it is. */
export function reasonLabel(r: string): string {
  const label: Record<string, string> = {
    manual: _('Made by hand'),
    auto: _('Nightly'),
    'pre-restore': _('Before restore'),
    'pre-import': _('Before import'),
    'pre-delete': _('Before removing a server'),
    'pre-update': _('Before update'),
    'pre-remove': _('Before removing Dawnline'),
  };
  return label[r] ?? r;
}

/** Devices that fetch their configuration again when the fallback DNS changes: Home-only people's that use home names. */
export function fallbackRefetch(st: Pick<Status, 'people'>): number {
  return st.people
    .filter((p) => p.access === 'lan' && p.dns_mode === 'home')
    .reduce((n, p) => n + p.devices.filter((d) => !d.disabled && (d.handshake || d.config_issued)).length, 0);
}

/** One change as a short line: the part before "; " or ": " when that says enough, else 90 characters at a word. */
export function shortPoint(p: string): string {
  const clean = p.replace(/\*\*|`|\[([^\]]+)\]\([^)]*\)/g, (_m, t) => t ?? '').trim();
  const head = /^(.{20,}?)(?:;\s|:\s)/.exec(clean)?.[1];
  if (head) return head;
  if (clean.length <= 90) return clean;
  return `${clean.slice(0, 90).replace(/[\s,;:]+\S*$/, '')}…`;
}

/** A link's base on `host`: the portal's port (the next one for plain HTTP on an IP address). */
export function linkBase(host: string, port: number): string {
  const ip = isIp(host);
  const p = ip ? port + 1 : port;
  return `${ip ? 'http' : 'https'}://${host}${p === (ip ? 80 : 443) ? '' : `:${p}`}/`;
}

/** Days until the certificate ends (router clock), or null: none, self-signed or no date. */
export function certDays(cert: { self_signed: boolean; expires: string | null } | null, now: number): number | null {
  if (!cert || cert.self_signed || !cert.expires) return null;
  const t = Date.parse(cert.expires);
  return Number.isNaN(t) ? null : Math.round((t / 1000 - now) / 86400);
}

/** A certificate with fewer days left than this is a warning: in the portal's section and on its rail entry. */
const CERT_SOON = 21;

/** The term a certificate's bar is drawn against: the 90 days of a Let's Encrypt one. */
const CERT_TERM = 90;

export const certSoon = (days: number | null): boolean => days != null && days < CERT_SOON;

/** How much of its term a certificate has left, 0..1; null: it has no end to count to. */
export const certPart = (days: number | null): number | null => (days == null ? null : Math.max(0, Math.min(1, days / CERT_TERM)));

const failing = (k: HealthCheck) => k.status === 'error' || k.status === 'warn';

/**
 * A Health check that is about the personal portal, by its id (health.uc portal_checks: portal, portal_host,
 * portal_dns, portal_reply, portal_http, cert). Overview sends such a check to the portal's section, which shows it:
 * the two read this one rule.
 */
export const aboutPortal = (id: string): boolean => /^(portal|cert)/.test(id);

/** The portal's Health checks: those that did not pass, and how many passed. */
export function portalHealth(checks: HealthCheck[]): { failed: HealthCheck[]; passed: number } {
  const own = checks.filter((k) => aboutPortal(k.id));
  return { failed: own.filter(failing), passed: own.filter((k) => k.status === 'ok').length };
}

/**
 * The checks that are fixed in Updates (their fix only leads there): shown at the top of that section, where the
 * fix would lead to itself, so without it.
 */
export const updatesHealth = (checks: HealthCheck[]): HealthCheck[] =>
  checks.filter((k) => failing(k) && k.fix === 'updates').map((k) => ({ ...k, fix: null }));

/** What the log and the traffic history hold against their limits. */
export interface Storage {
  /** How far back the log goes, in days. */
  age: number;
  /** 0..1 of each limit used; null: no limit. */
  events: number | null;
  depth: number | null;
  usage: number | null;
  /** Bytes on flash: the log, the traffic history and the location cache. */
  flash: number;
}

export function storage(l: LogsInfo, now: number): Storage {
  const p = l.policy;
  const age = l.oldest ? Math.max(0, Math.round((now - l.oldest) / 86400)) : 0;
  return {
    age,
    events: p.max > 0 ? l.events / p.max : null,
    depth: p.keep_days > 0 ? age / p.keep_days : null,
    usage: p.usage_days > 0 ? l.usage_days / p.usage_days : null,
    flash: l.log_flash + l.usage_flash + l.geo_flash,
  };
}

/** A section's state in a few words, as its rail entry says it under its name; a tone when it is not fine. */
export interface RailWord {
  text: string;
  tone?: 'warn' | 'bad' | 'off';
}

/** Checks that did not pass, in a few words: the one's problem, or how many (problems when one is an error). */
function failedWord(failed: HealthCheck[]): RailWord & { tone: 'warn' | 'bad' } {
  const tone = failed.some((k) => k.status === 'error') ? 'bad' : 'warn';
  const one = failed.length === 1 ? (failed[0].problem ?? failed[0].title) : null;
  const n = failed.length;
  return { text: one ?? (tone === 'bad' ? plural(n, '%s problem', '%s problems') : plural(n, '%s warning', '%s warnings')), tone };
}

type Upd = Pick<UpdatesStatus, 'version' | 'needs' | 'check' | 'job'>;

/**
 * The tone of Updates' glass: red or orange while a check fixed here did not pass (`failed`: updatesHealth), orange
 * while AmneziaWG is missing, blue while something waits or runs.
 */
export function updatesTone(u: Upd, failed: HealthCheck[] = []): 'red' | 'orange' | 'blue' | 'grey' {
  if (failed.length) return failedWord(failed).tone === 'bad' ? 'red' : 'orange';
  if ((u.needs?.awg ?? []).length) return 'orange';
  const all = u.check?.components ?? {};
  return all.app?.update || all.amneziawg?.update || u.job?.state === 'running' ? 'blue' : 'grey';
}

/**
 * Updates on the rail: a job under way, a check fixed here that did not pass (`failed`: updatesHealth), AmneziaWG
 * missing, Dawnline's new version, else the one installed.
 */
export function updatesWord(u: Upd, failed: HealthCheck[] = []): RailWord {
  if (u.job?.state === 'running') return { text: u.job.action === 'check' ? _('a check is running') : _('an update is running') };
  if (failed.length) return failedWord(failed);
  if ((u.needs?.awg ?? []).length) return { text: _('AmneziaWG not installed'), tone: 'warn' };
  const app = u.check?.components?.app;
  if (app?.update && app.latest) return { text: fmt(_('%s is available'), app.latest) };
  return { text: `Dawnline ${u.version}` };
}

/** What the portal's state is read from. */
export interface PortalFacts {
  enabled: boolean;
  /** The main address ('': none set). */
  host: string;
  /** The HTTPS packages are missing: it cannot start. */
  blocked: boolean;
  /** Days its certificate has left (certDays). */
  days: number | null;
  /** Its checks that did not pass (portalHealth). */
  failed: HealthCheck[];
}

type PortalState = 'off' | 'blocked' | 'failed' | 'cert' | 'fine';

/**
 * How the portal stands, the most pressing first: off; cannot start; a check other than the certificate's did not
 * pass; the certificate ends soon (said in days, also when its own check is what failed); only the certificate's
 * check did not pass (self-signed, or not covering the address); fine.
 */
export function portalState(f: PortalFacts): { state: PortalState; tone: '' | 'warn' | 'bad' } {
  if (!f.enabled) return { state: 'off', tone: '' };
  if (f.blocked) return { state: 'blocked', tone: 'bad' };
  const tone = f.failed.some((k) => k.status === 'error') ? 'bad' : 'warn';
  if (f.failed.some((k) => k.id !== 'cert')) return { state: 'failed', tone };
  if (certSoon(f.days)) return { state: 'cert', tone: 'warn' };
  return f.failed.length ? { state: 'failed', tone } : { state: 'fine', tone: '' };
}

/** The portal on the rail: off, why it does not work, its certificate's days, else its main address. */
export function portalWord(f: PortalFacts): RailWord {
  const { state } = portalState(f);
  if (state === 'off') return { text: _('off', 'portal'), tone: 'off' };
  if (state === 'blocked') return { text: _('can’t start'), tone: 'bad' };
  if (state === 'cert') return { text: fmt(_('certificate: %s d'), Math.max(0, f.days ?? 0)), tone: 'warn' };
  if (state === 'failed') return failedWord(f.failed);
  return { text: f.host || _('on', 'portal') };
}

/** New people on the rail: how many devices a person starts with. */
export const defaultsWord = (limit: number): RailWord => ({ text: plural(limit, 'up to %s device', 'up to %s devices') });

/** History and storage on the rail: how long the log is kept. */
export const historyWord = (keepDays: number): RailWord => ({ text: keepDays > 0 ? fmt(_('log: %s d'), keepDays) : _('log: no limit') });
