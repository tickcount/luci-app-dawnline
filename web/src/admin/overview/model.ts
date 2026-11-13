// What Overview says, as data: the router's state in one phrase that counts
// the checks, the checks as its list (the one notice, the other failing ones,
// what passed), where a problem is fixed and which keep their fix in the
// list, who waits for a decision and how many of them get a row, a server
// card's numbers and who of its rollout is named, who moved most this month,
// today by the hour, and the watchdog's news. Pure: no DOM.

import type { HealthCheck, Pair, Person, Server, Status } from '../../shared/types';
import type { ServiceLog } from '../api';
import { plural } from '../../shared/i18n';
import { settingsUrl } from '../shell/routes';
import { stageOf } from '../servers/path';
import { aboutPortal } from '../system/model';
import type { RolloutItem } from '../servers/rollout';
import { byAttention, cardParts } from '../people/card';
import type { Today } from '../people/lines';

/** The router's last-minute rate (status) stands for a speed while it is this fresh (s). */
export const RATE_FRESH = 180;
/** People who wait shown with their action (a phone: fewer); the rest are one link away. */
const WAIT_ROWS = 5;
const WAIT_ROWS_NARROW = 3;
/** Devices still waiting for a new configuration that a server's card names. */
const NAMED = 4;

const failing = (c: HealthCheck) => c.status === 'error' || c.status === 'warn';

/** The one problem the page puts in its notice: the first that failed, an error before a warning. */
export function topProblem(checks: HealthCheck[] | null): HealthCheck | null {
  const bad = (checks ?? []).filter(failing);
  return bad.find((c) => c.status === 'error') ?? bad[0] ?? null;
}

/**
 * The phrase under the router's name: the checks summed up, the worst first (it leads down to their list). Null
 * checks: not read yet, or (`failed`) the router did not answer the run.
 */
export function stateLine(checks: HealthCheck[] | null, failed = false): { text: string; tone: '' | 'ok' | 'warn' | 'bad' } {
  if (!checks) return { text: failed ? _('The checks did not run') : _('Checking…'), tone: '' };
  const bad = checks.filter((c) => c.status === 'error').length;
  const warn = checks.filter((c) => c.status === 'warn').length;
  if (bad) return { text: plural(bad, '%s problem', '%s problems'), tone: 'bad' };
  if (warn) return { text: plural(warn, '%s warning', '%s warnings'), tone: 'warn' };
  return { text: _('Everything works'), tone: 'ok' };
}

export interface CheckList {
  /** The page's one notice: the most pressing check that did not pass. */
  top: HealthCheck | null;
  /** The other checks that did not pass, errors first (the router's order within each). */
  failing: HealthCheck[];
  /** What passed and what was skipped, in the router's order: all of them stay on the page. */
  passed: HealthCheck[];
  /** How many passed, of how many ran (a skipped check did not run). */
  ok: number;
  of: number;
}

/** The checks as Overview lists them. */
export function checkList(checks: HealthCheck[]): CheckList {
  const top = topProblem(checks);
  const rest = checks.filter((c) => failing(c) && c !== top);
  return {
    top,
    failing: [...rest.filter((c) => c.status === 'error'), ...rest.filter((c) => c.status !== 'error')],
    passed: checks.filter((c) => !failing(c)),
    ok: checks.filter((c) => c.status === 'ok').length,
    of: checks.filter((c) => c.status !== 'skip').length,
  };
}

/** The checks about one thing: the router itself, one server, the portal. */
export interface CheckGroup {
  kind: 'router' | 'server' | 'portal';
  /** A server's group: its id and its name. */
  server?: string;
  name?: string;
  /** What passed and what was skipped, each under the name it has inside the group (the server's name is the group's). */
  passed: { check: HealthCheck; title: string }[];
  /** How many passed, of how many ran (a skipped check did not run). */
  ok: number;
  of: number;
  /** The worst of its checks; `off`: none of them ran (a server turned off). */
  tone: 'ok' | 'warn' | 'bad' | 'off';
}

/**
 * The checks by what they are about, as Overview lists what passed: the router's own first, then each server's (a
 * server's own check carries its id: `up_<id>`), then the portal's. A group with no check is left out. Inside a
 * server's group a check loses the « (name)» the router adds to tell servers apart.
 */
export function checkGroups(checks: HealthCheck[], servers: Pick<Server, 'id' | 'name'>[]): CheckGroup[] {
  // the longest id first: one server's id may end another's
  const byId = [...servers].sort((a, b) => b.id.length - a.id.length);
  const of = (c: HealthCheck) => (aboutPortal(c.id) ? 'portal' : (byId.find((s) => c.id.endsWith(`_${s.id}`))?.id ?? 'router'));
  const group = (kind: CheckGroup['kind'], key: string, srv?: Pick<Server, 'id' | 'name'>): CheckGroup | null => {
    const own = checks.filter((c) => of(c) === key);
    if (!own.length) return null;
    const label = srv ? ` (${srv.name})` : '';
    const ran = own.filter((c) => c.status !== 'skip');
    return {
      kind,
      server: srv?.id,
      name: srv?.name,
      passed: own
        .filter((c) => !failing(c))
        .map((c) => ({ check: c, title: label && c.title.endsWith(label) ? c.title.slice(0, -label.length) : c.title })),
      ok: own.filter((c) => c.status === 'ok').length,
      of: ran.length,
      tone: own.some((c) => c.status === 'error') ? 'bad' : own.some((c) => c.status === 'warn') ? 'warn' : ran.length ? 'ok' : 'off',
    };
  };
  return [group('router', 'router'), ...servers.map((s) => group('server', s.id, s)), group('portal', 'portal')].filter(
    (g): g is CheckGroup => !!g,
  );
}

/**
 * Where a check is fixed: what it is about (a stage of its server's path on the server's page; the portal or
 * Updates in Settings), or null: it is about none of them and its fix stands beside it in Overview's own list.
 */
export function fixPlace(c: Pick<HealthCheck, 'id' | 'fix'>, servers: string[]): string | null {
  if (c.fix === 'updates') return settingsUrl('updates');
  if (aboutPortal(c.id)) return settingsUrl('portal');
  for (const s of servers) {
    const own = c.id.endsWith(`_${s}`);
    const stage = stageOf(c.id, s);
    if (stage) return settingsUrl(stage, own && servers.length > 1 ? s : undefined);
    if (own) return settingsUrl(undefined, servers.length > 1 ? s : undefined);
  }
  return null;
}

/**
 * The fix a check keeps in Overview's own list: only one that nothing in Settings is about (the clock, the agent,
 * the flash, the data) has it here; the others are fixed in their Settings section. Null: no fix here.
 */
export const ownFix = (c: Pick<HealthCheck, 'id' | 'fix'>, servers: string[]): string | null =>
  fixPlace(c, servers) === null ? c.fix : null;

/**
 * People who wait for a decision, the most pressing first: the cards' «Needs a decision» group in its order
 * (people/card.ts), the one People's chip and group head count, so the two pages count and list alike.
 */
export function waiting(people: Person[], t: Today): Person[] {
  const need = people
    .map((p) => ({ p, parts: cardParts(p, undefined, t), speed: 0, week: 0, pausedAt: '' }))
    .filter((x) => x.parts.group === 'need');
  return byAttention(need, t.today).map((x) => x.p);
}

/** The people who wait that get a row (`narrow`: a phone's fewer), how many wait in all, how many are left to People. */
export function waitRows(people: Person[], t: Today, narrow: boolean): { rows: Person[]; total: number; more: number } {
  const w = waiting(people, t);
  const rows = w.slice(0, narrow ? WAIT_ROWS_NARROW : WAIT_ROWS);
  return { rows, total: w.length, more: w.length - rows.length };
}

/**
 * A server card's numbers: its people, its speed to the devices now (bytes/s; null: it does not run, or the
 * router's last minute is stale) and what moved today (null: no day counted yet; `today`: the router's day).
 */
export function serverNumbers(
  s: Pick<Server, 'id' | 'enabled' | 'up' | 'rate' | 'series'>,
  st: Pick<Status, 'people' | 'now'>,
  today: string,
): { people: number; down: number | null; today: number | null } {
  const r = s.rate?.[s.rate.length - 1];
  const day = s.series?.[s.series.length - 1];
  return {
    people: st.people.filter((p) => p.server === s.id).length,
    down: s.enabled && s.up && r && st.now - r[0] < RATE_FRESH ? r[2] : null,
    today: !day ? null : day.day === today ? day.rx + day.tx : 0,
  };
}

/**
 * Of a rollout's devices, those that still wait: the first few named on the server's card, how many more are
 * left to People, and how many people they all belong to (the reminder says it).
 */
export function stillWaiting(items: RolloutItem[], named = NAMED): { named: RolloutItem[]; more: number; people: number } {
  const w = items.filter((i) => i.d.config_stale);
  return { named: w.slice(0, named), more: Math.max(0, w.length - named), people: new Set(w.map((i) => i.p.id)).size };
}

/** Who moved most this month (`n` of them, only those who moved anything). */
export function topMonth(people: Person[], n = 3): { p: Person; bytes: number }[] {
  return people
    .map((p) => ({ p, bytes: p.month[0] + p.month[1] }))
    .filter((x) => x.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, n);
}

/**
 * The last 24 hours, a bar an hour, the current hour last: each hour's share of the busiest one (0..1); null
 * only where the router sent fewer than 24 (an older one). `hours` is status.hours.
 */
export function hourBars(hours: Pair[]): { share: number | null; bytes: number }[] {
  const sums = hours.map((v) => v[0] + v[1]);
  const hi = Math.max(1, ...sums);
  return Array.from({ length: 24 }, (_x, i) => (i < sums.length ? { share: sums[i] / hi, bytes: sums[i] } : { share: null, bytes: 0 }));
}

/** The watchdog's news for the checks' foot: the agent gone quiet, else its last repair today; null: nothing new. */
export function systemNews(
  sl: ServiceLog | null,
): { kind: 'quiet'; minutes: number } | { kind: 'repair'; ts: number; name: string } | null {
  const wd = sl?.watchdog;
  if (!wd) return null;
  if (wd.beat != null && wd.now - wd.beat > 180) return { kind: 'quiet', minutes: Math.round((wd.now - wd.beat) / 60) };
  const last = wd.repairs.filter((r) => wd.now - r.ts < 86400).sort((a, b) => b.ts - a.ts)[0];
  return last ? { kind: 'repair', ts: last.ts, name: last.name } : null;
}
