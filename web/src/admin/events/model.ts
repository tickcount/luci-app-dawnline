// The activity log's vocabulary: categories, who did what, problems, retention.
// No DOM and no RPC here (see ./render for rows).

import type { LogEvent } from '../../shared/types';
import type { LogCategory, LogsInfo, ServiceLogEntry } from '../api';
import { fmt, known, plural } from '../../shared/i18n';
import { LOG_TEMPLATES } from './log-templates';

/** Mirrors CATEGORY in dawnline.live. */
const CATEGORY: Record<string, LogCategory> = {
  connect: 'connections',
  disconnect: 'connections',
  roam: 'connections',
  device_added: 'people',
  device_removed: 'people',
  devices_removed: 'people',
  device_changed: 'people',
  device_keys: 'people',
  link_changed: 'people',
  person_added: 'people',
  person_removed: 'people',
  person_changed: 'people',
  paused: 'people',
  resumed: 'people',
  expiring: 'people',
  expired_kept: 'people',
  portal_blocked: 'problems',
};

export const CATEGORIES: LogCategory[] = ['connections', 'people', 'problems'];

export function categoryLabel(c: LogCategory): string {
  return { connections: _('Connections'), people: _('People'), problems: _('Problems') }[c];
}

export function categoryHelp(c: LogCategory): string {
  return {
    connections: _('Connects, disconnects and IP changes'),
    people: _('People and their devices added, changed, paused, removed'),
    problems: _('Blocked portal sign-ins (tunnels and services are in the service log)'),
  }[c];
}

export const categoryOf = (type: string): LogCategory => CATEGORY[type] ?? 'problems';

/** What a service log source is called; unknown ones by their id. */
export function sourceName(src: ServiceLogEntry['src']): string {
  return { awg: 'AmneziaWG', dawnline: 'Dawnline', portal: _('Portal') }[src] ?? src;
}

const ADMIN_TYPES = ['person_added', 'person_removed', 'person_changed'];

/** Who did it. Older events have no `by`: LuCI and the portal marked it in the detail. */
export function eventBy(e: LogEvent): 'admin' | 'portal' | null {
  if (e.by) return e.by;
  if (ADMIN_TYPES.includes(e.type) || e.detail === 'by admin' || e.detail?.endsWith(' (admin)')) return 'admin';
  if (e.detail?.endsWith(' (portal)')) return 'portal';
  return null;
}

/** The detail without the old "(admin)" / "(portal)" / "by admin" marks. */
export function plainDetail(e: LogEvent): string {
  return (e.detail ?? '').replace(/ \((admin|portal)\)$/, '').replace(/^by admin$/, '');
}

/** One line of the Log: an activity event or a service log entry. */
export type LogItem = { ts: number; ev?: LogEvent; sys?: ServiceLogEntry };

export const isProblem = (x: LogItem) =>
  x.sys ? ['error', 'repair', 'down'].includes(x.sys.level) : categoryOf(x.ev!.type) === 'problems';

export function retentionText(p: LogsInfo['policy']): string {
  const age = p.keep_days > 0 ? plural(p.keep_days, '%s day', '%s days') : _('no age limit');
  const where =
    p.persist === 'off'
      ? _('kept in memory only (lost on reboot)')
      : p.persist === '10min'
        ? _('saved to flash every 10 minutes')
        : _('saved to flash hourly');
  return fmt(_('Kept for %s, %s, %s.'), age, plural(p.max, 'up to %s event', 'up to %s events'), where);
}

/* ---------- the router's words, put into the page's language ----------
 * Events and service log lines are written once, in English, by whoever was
 * running (the agent has no language) and read later in any language: the
 * words below are their fixed vocabulary, translated when shown. Anything
 * else stays as written. */

/** Why someone was paused or resumed (the agent's REASON words). */
export function reasonText(detail: string): string {
  const t: Record<string, string> = {
    'paused by admin': _('paused by admin'),
    'end date reached': _('end date reached'),
    'data limit reached': _('data limit reached'),
    'outside allowed hours': _('outside allowed hours'),
    'no server': _('no server'),
    'server turned off': _('server turned off'),
  };
  return t[detail] ?? detail;
}

/** Days left in an "expiring" event's detail ("3 days"), or null. */
export function daysOf(detail: string): number | null {
  const m = /^(\d+) days?$/.exec(detail);
  return m ? Number(m[1]) : null;
}

/** The person's settings a person_changed event lists (option names, "moved to <server>"). */
export function changedText(detail: string): string {
  const f: Record<string, string> = {
    name: _('name'),
    access: _('access'),
    device_limit: _('device limit'),
    expires: _('end date'),
    expire_action: _('what happens at the end'),
    expire_warn: _('warning before the end'),
    quota_gb: _('data limit'),
    quota_period: _('data limit period'),
    bonus_gb: _('extra data'),
    hours: _('allowed hours'),
    dns_mode: _('DNS'),
    paused: _('pause'),
    services: _('home services'),
    circle: _('circle', 'setting'),
    home_nets: _('home networks'),
    server: _('server'),
  };
  return detail
    .split(', ')
    .map((k) => {
      const to = /^moved to (.+)$/.exec(k)?.[1];
      return to ? fmt(_('moved to %s'), to) : (f[k] ?? k.replace(/_/g, ' '));
    })
    .join(', ');
}

/**
 * The admin's own change in the service log ({ msg: 'changed', kind:
 * 'server', who: 'Home' }), as one sentence: with %s for the name it names,
 * or whole when the name is a fixed phrase ("the service log"); null for one
 * this page does not know.
 */
export function adminSentence(msg: string, kind?: string | null, who?: string | null): { text: string; named: boolean } | null {
  const fixed: Record<string, string> = {
    'cleared|the service log': _('You cleared the service log'),
    'cleared|the activity log': _('You cleared the activity log'),
    'exported|all settings': _('You exported all settings'),
    'imported|settings from a file': _('You imported settings from a file'),
    'restored|from a file': _('You restored a backup from a file'),
    'turned on|the personal portal': _('You turned on the personal portal'),
    'turned off|the personal portal': _('You turned off the personal portal'),
    'changed|the personal portal': _('You changed the personal portal'),
    'turned on|the watchdog': _('You turned on the watchdog'),
    'turned off|the watchdog': _('You turned off the watchdog'),
    'reset traffic history|for everyone': _('You reset traffic history for everyone'),
  };
  const whole = fixed[`${msg}|${who ?? ''}`];
  if (whole) return { text: whole, named: false };
  const named: Record<string, string> = {
    'created|server': _('You created server %s'),
    'changed|server': _('You changed server %s'),
    'removed|server': _('You removed server %s'),
    'turned on|server': _('You turned on server %s'),
    'turned off|server': _('You turned off server %s'),
    'added|circle': _('You added circle %s'),
    'changed|circle': _('You changed circle %s'),
    'removed|circle': _('You removed circle %s'),
    'restored|backup': _('You restored backup %s'),
  };
  const t = named[`${msg}|${kind ?? ''}`];
  if (t) return { text: t, named: true };
  // "reset traffic history" "for Anna": the name after "for".
  const forWho = msg === 'reset traffic history' && /^for (.+)$/.exec(who ?? '')?.[1];
  return forWho ? { text: _('You reset traffic history for %s'), named: true } : null;
}

/** The name in a sentence adminSentence() made with %s (its "for …" taken off). */
export const adminName = (msg: string, who: string) => (msg === 'reset traffic history' ? who.replace(/^for /, '') : who);

/** The note after an admin's change: its known pieces translated, the rest as written. */
export function noteText(note: string): string {
  const one = (p: string): string => {
    const t: Record<string, string> = {
      'other addresses': _('other addresses'),
      certificate: _('certificate'),
      redirect: _('redirect'),
      'devices kept apart': _('devices kept apart'),
      'devices reach each other': _('devices reach each other'),
      'devices reach each other in circles': _('devices reach each other in circles'),
      'home network and internet path': _('home network and internet path'),
      'the file holds private keys': _('the file holds private keys'),
      'problems are only logged, nothing is repaired': _('problems are only logged, nothing is repaired'),
      name: _('name'),
      'public address': _('public address'),
      'AmneziaWG port': _('AmneziaWG port'),
      'tunnel network': _('tunnel network'),
      connections: categoryLabel('connections'),
      people: categoryLabel('people'),
      problems: categoryLabel('problems'),
    };
    if (t[p]) return t[p];
    let m: RegExpExecArray | null;
    if ((m = /^port (\d+)$/.exec(p))) return fmt(_('port %s'), m[1]);
    if ((m = /^address (.+)$/.exec(p))) return fmt(_('address %s'), m[1]);
    if ((m = /^disguise: (.+)$/.exec(p))) return fmt(_('disguise: %s'), m[1]);
    if ((m = /^(\d+) events?$/.exec(p))) return plural(Number(m[1]), '%s event', '%s events');
    if ((m = /^older than (\d+) days$/.exec(p))) return plural(Number(m[1]), 'older than %s day', 'older than %s days');
    if ((m = /^with (\d+) (person|people)$/.exec(p))) return plural(Number(m[1]), 'with %s person', 'with %s people');
    if ((m = /^(\d+) entr(y|ies)( older than (\d+) days)?$/.exec(p)))
      return m[4]
        ? `${plural(Number(m[1]), '%s entry', '%s entries')}, ${plural(Number(m[4]), 'older than %s day', 'older than %s days')}`
        : plural(Number(m[1]), '%s entry', '%s entries');
    return p;
  };
  return note
    .split(' · ')
    .map((part) => part.split(', ').map(one).join(', '))
    .join(' · ');
}

/* ---------- the service log's lines ----------
 * The router writes them in English from its L_() templates (the generated
 * list in ./log-templates); a line is put into the page's language by the
 * template it matches, its values (versions, ports, names, or another
 * template's words) put back in place. Lines written before the plain dash
 * have "—" where the templates have "-". */

let patterns: { t: string; re: RegExp }[] | null = null;
const LOG_EXACT = new Set(LOG_TEMPLATES);

/** The templates with values in them, the most specific (most fixed text) first. */
function logPatterns() {
  return (patterns ??= LOG_TEMPLATES.filter((t) => /%[sd]/.test(t) && t.replace(/%[sd]/g, '').trim())
    .map((t) => ({
      t,
      fixed: t.replace(/%[sd]/g, '').length,
      re: new RegExp(
        `^${t
          .split(/(%[sd])/)
          .map((p) => (p === '%s' ? '(.+?)' : p === '%d' ? '(\\d+)' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
          .join('')}$`,
      ),
    }))
    .sort((a, b) => b.fixed - a.fixed));
}

/** A service log line (or its subject, or a line of its details) in the page's language; one it does not know as written. */
export function logText(line: string, depth = 0): string {
  const s = line.replace(/ — /g, ' - ');
  if (LOG_EXACT.has(s)) return known(s);
  if (depth > 2) return line;
  for (const p of logPatterns()) {
    const m = p.re.exec(s);
    if (m) return fmt(known(p.t), ...m.slice(1).map((v) => logText(v, depth + 1)));
  }
  // A list ("Dawnline 0.3.3, 2 system packages"): each item on its own.
  return s.includes(', ')
    ? s
        .split(', ')
        .map((x) => logText(x, depth + 1))
        .join(', ')
    : line;
}
