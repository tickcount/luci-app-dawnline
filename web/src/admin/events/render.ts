// Log rows: an activity event as a sentence ("You added device Phone for
// Myata", one translated sentence per event with the names in it), its tile
// and time, and a service log line (its text comes from the router).

import type { LogEvent, Status } from '../../shared/types';
import type { ServiceLogEntry } from '../api';
import { E } from '../e';
import { icon } from '../../shared/icons';
import { ago, fmtDay } from '../../shared/format';
import { fill, fmt, locale, num } from '../../shared/i18n';
import {
  adminName,
  adminSentence,
  changedText,
  daysOf,
  deviceChangedText,
  eventBy,
  linkStatesText,
  logText,
  noteText,
  plainDetail,
  reasonText,
  sourceName,
} from './model';

/** What the people and servers in the log are called now. */
export type Names = Pick<Status, 'people' | 'servers'>;

const EVENT_TONE: Record<string, string> = {
  connect: 'ok',
  disconnect: '',
  roam: '',
  device_added: 'ok',
  device_removed: '',
  person_added: '',
  person_removed: '',
  paused: 'warn',
  resumed: 'ok',
  expiring: 'warn',
  expired_kept: '',
  portal_blocked: 'bad',
  person_changed: '',
  devices_removed: 'warn',
  device_failing: 'warn',
  device_recovered: 'ok',
};

/** The icon in an event's tile: the device's kind for device events, else what happened. */
const EVENT_ICON: Record<string, string> = {
  devices_removed: 'trash',
  link_changed: 'link',
  person_added: 'plus',
  person_removed: 'trash',
  person_changed: 'edit',
  paused: 'pause',
  resumed: 'play',
  expiring: 'calendar',
  expired_kept: 'calendar',
};

function eventIcon(st: Names, e: LogEvent): string {
  if (e.device) {
    const d = st.people.flatMap((p) => p.devices).find((x) => x.id === e.device);
    return d?.kind ?? e.dkind ?? 'other';
  }
  return EVENT_ICON[e.type] ?? 'activity';
}

/** A router day (YYYY-MM-DD) in the page's language; anything else as it came. */
const routerDay = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? fmtDay(s) : s);

export function eventText(st: Pick<Status, 'people'>, e: LogEvent): Node[] {
  const person = st.people.find((p) => p.id === e.person);
  const who = person?.name ?? e.pname ?? e.person ?? '';
  const dev = person?.devices.find((d) => d.id === e.device)?.name ?? e.dname ?? '';
  const b = (t: string) => E('b', {}, t);
  const m = (t: string) => E('span', { class: 'dl-muted' }, t);
  const mono = (t: string) => E('span', { class: 'dl-mono' }, t);
  /** An address; at home, the name of the device that has it, with the address in brackets. */
  const addr = (ip: string) =>
    e.hosts?.[ip]
      ? [E('span', { class: 'dl-ev-host' }, [E('b', {}, e.hosts[ip]), E('span', { class: 'dl-faint' }, ` (${ip})`)])]
      : [mono(ip)];
  // A sentence in grey around its bold names, people and devices.
  const say = (s: string, ...args: Node[]): Node[] => fill(s, ...args).map((x) => (typeof x === 'string' ? m(x) : x));
  // The admin's own actions start with an accent "You".
  const you = (s: string, ...args: Node[]): Node[] => {
    const w = _('You');
    return s.startsWith(`${w} `) ? [E('span', { class: 'dl-you' }, w), ...say(s.slice(w.length), ...args)] : say(s, ...args);
  };
  const wd = b(dev ? `${who} · ${dev}` : who);
  const detail = plainDetail(e);
  const devName = b(detail || dev || _('a device'));
  const by = eventBy(e);
  if (by === 'admin')
    switch (e.type) {
      case 'device_added':
        return you(_('You added device %s for %s'), devName, b(who));
      case 'device_removed':
        return you(_('You removed device %s from %s'), devName, b(who));
      case 'paused':
        return you(_('You paused person %s'), b(who));
      case 'resumed':
        return you(_('You resumed person %s'), b(who));
      case 'device_changed': {
        const d = b(dev || _('a device'));
        if (detail.startsWith('renamed from '))
          return [...you(_('You renamed device %s of %s'), d, b(who)), m(` · ${fmt(_('was %s'), detail.slice(13))}`)];
        if (detail === 'turned off') return you(_('You turned off device %s of %s'), d, b(who));
        if (detail === 'turned on') return you(_('You turned on device %s of %s'), d, b(who));
        // Its own link options by name ("mtu, keepalive"), as person_changed lists a person's.
        return [...you(_('You changed device %s of %s'), d, b(who)), ...(detail ? [m(` · ${deviceChangedText(detail)}`)] : [])];
      }
      case 'device_keys':
        return [...you(_('You issued new keys for device %s of %s'), devName, b(who)), m(` · ${_('it needs its new configuration')}`)];
      case 'link_changed':
        return [...you(_('You issued a new link for person %s'), b(who)), m(` · ${_('the old link stopped working')}`)];
    }
  switch (e.type) {
    case 'connect':
      return [
        ...(e.detail ? say(_('Device %s connected from %s'), wd, E('span', {}, addr(e.detail))) : say(_('Device %s connected'), wd)),
        ...(e.where ? [m(` · ${e.where}`)] : []),
      ];
    case 'disconnect':
      return say(_('Device %s went offline'), wd);
    case 'roam':
      return say(
        _('Device %s changed network %s'),
        wd,
        E(
          'span',
          {},
          (e.detail ?? '').split(' → ').flatMap((ip, i) => (i ? [m(' → '), ...addr(ip)] : addr(ip))),
        ),
      );
    case 'device_added':
      return by === 'portal'
        ? say(_('Person %s added device %s on their portal'), b(who), devName)
        : say(_('Person %s added device %s'), b(who), devName);
    case 'device_removed':
      return by === 'portal'
        ? say(_('Person %s removed device %s on their portal'), b(who), devName)
        : say(_('Person %s removed device %s'), b(who), devName);
    case 'device_keys':
      return say(_('Person %s issued new keys for device %s on their portal'), b(who), devName);
    case 'person_added':
      return you(_('You added person %s'), b(e.detail ?? who));
    case 'person_removed':
      return you(_('You removed person %s'), b(e.detail ?? who));
    case 'person_changed':
      // The detail lists changed fields by their option names (device_limit, expire_action).
      return [...you(_('You changed person %s'), b(who)), ...(detail ? [m(` · ${changedText(detail)}`)] : [])];
    case 'expiring': {
      const n = daysOf(e.detail ?? '');
      return n != null
        ? say(N_(n, 'Person %s’s access ends in %s day', 'Person %s’s access ends in %s days'), b(who), m(num(n)))
        : say(_('Person %s’s access ends in a few days'), b(who));
    }
    case 'expired_kept':
      return say(_('Person %s’s end date passed (%s) · access kept'), b(who), m(routerDay(e.detail ?? '')));
    case 'paused':
      return e.detail ? say(_('Person %s paused - %s'), b(who), m(reasonText(e.detail))) : say(_('Person %s paused'), b(who));
    case 'resumed':
      return e.detail && e.detail !== 'active'
        ? say(_('Person %s resumed - %s'), b(who), m(reasonText(e.detail)))
        : say(_('Person %s resumed'), b(who));
    case 'portal_blocked':
      return say(
        _('%s blocked %s for 15 min after too many wrong codes'),
        E('b', { class: 'dl-sys-src' }, _('Personal portal')),
        e.detail === 'all Cloudflare visitors' ? m(_('all Cloudflare visitors')) : mono(e.detail ?? ''),
      );
    case 'devices_removed':
      return say(_('Person %s - all devices removed, end date reached'), b(who));
    case 'device_failing':
      return [...say(_('Device %s has a connection problem'), wd), ...(e.detail ? [m(` · ${linkStatesText(e.detail)}`)] : [])];
    case 'device_recovered':
      return say(_('Device %s connects normally again'), wd);
    default:
      return [m(`${e.type}${e.detail ? `: ${e.detail}` : ''}`)];
  }
}

/** Events about the router rather than people look like service log lines: icon tile, colour by outcome. */
const SYSTEM_EVENT: Record<string, [string, string]> = {
  portal_blocked: ['globe', 'bad'],
};

/** With several servers, which one a person's event happened on (left out where that is clear). */
function serverPill(st: Names, e: LogEvent): HTMLElement | '' {
  if (st.servers.length < 2 || !e.person) return '';
  const p = st.people.find((x) => x.id === e.person);
  const srv = p && st.servers.find((s) => s.id === p.server);
  return srv ? E('span', { class: 'dl-ev-srv', title: _('Server') }, srv.name) : '';
}

/** An activity event as a row; `time` replaces the "5 min ago" (`now` is the router's clock). */
export function eventRow(st: Names & { now?: number }, e: LogEvent, opts: { server?: boolean; time?: string } = {}): HTMLElement {
  const sys = SYSTEM_EVENT[e.type];
  const by = eventBy(e);
  return E('div', { class: `dl-row${by === 'admin' ? ' dl-ev-by-admin' : sys ? ` dl-ev-by-system ${sys[1]}` : ''}` }, [
    by === 'admin'
      ? E('span', { class: 'dl-ev-tile', title: _('Done by you in LuCI') }, icon('admin'))
      : sys
        ? E('span', { class: 'dl-ev-tile sys' }, icon(sys[0]))
        : E('span', { class: `dl-ev-tile ev ${EVENT_TONE[e.type] ?? ''}` }, icon(eventIcon(st, e))),
    E('span', { class: 'dl-row-main' }, eventText(st, e)),
    opts.server === false ? '' : serverPill(st, e),
    E('span', { class: 'dl-faint dl-nowrap', title: new Date(e.ts * 1000).toLocaleString(locale()) }, opts.time ?? ago(e.ts, st.now)),
  ]);
}

/** Colour per service log level (tile, source and row): neutral unless something came up, was repaired or failed. */
// "down" is a tunnel that stopped without Dawnline asking (its own stops are "info").
const SYS_TONE: Record<ServiceLogEntry['level'], string> = { info: '', up: 'ok', down: 'warn', repair: 'warn', error: 'bad' };
const SYS_ICON: Record<ServiceLogEntry['src'], string> = { awg: 'tunnel', dawnline: 'sunrise', portal: 'globe' };

/** A service log level as its tile's tooltip says it. */
function levelLabel(l: ServiceLogEntry['level']): string {
  return { info: _('info'), up: _('up'), down: _('down'), repair: _('repair'), error: _('error') }[l] ?? l;
}

/**
 * The admin's own change: "You changed server Home" as one sentence of the
 * page's language, "You" in the accent; one this page does not know is put
 * together from the router's words as before.
 */
function adminLine(e: ServiceLogEntry): (Node | string)[] {
  const s = adminSentence(e.msg, e.kind, e.who);
  const you = _('You');
  if (!s)
    return [
      E('span', { class: 'dl-you' }, you),
      E('span', { class: 'dl-muted' }, ` ${e.msg} `),
      e.kind ? E('span', { class: 'dl-ev-kind' }, `${e.kind} `) : '',
      e.who ? E('b', {}, e.who) : '',
    ];
  const parts = (s.named ? fill<Node | string>(s.text, E('b', {}, adminName(e.msg, e.who ?? ''))) : [s.text]).map((x) =>
    typeof x === 'string' ? E('span', { class: 'dl-muted' }, x) : x,
  );
  // The accent on "You" where the sentence starts with it.
  const first = parts[0]?.textContent ?? '';
  return first.startsWith(`${you} `)
    ? [E('span', { class: 'dl-you' }, you), E('span', { class: 'dl-muted' }, first.slice(you.length)), ...parts.slice(1)]
    : parts;
}

/** A log line's details: its sentences in the page's language, command output as it is. */
const detailText = (d: string) =>
  d
    .split('\n')
    .map((l) => logText(l))
    .join('\n');

/** A service log line: source, message, folded details; click to unfold. */
export function systemRow(e: ServiceLogEntry, open: boolean, toggle: () => void, time: string): HTMLElement {
  const admin = e.by === 'admin';
  const msg = logText(e.msg);
  const row = E(
    'div',
    {
      class: `dl-row dl-slog-row ${admin ? 'dl-ev-by-admin' : `dl-ev-by-system ${SYS_TONE[e.level] ?? ''}`}${e.detail ? ' has-detail' : ''}`,
    },
    [
      admin
        ? E('span', { class: 'dl-ev-tile', title: _('Done by you in LuCI') }, icon('admin'))
        : E('span', { class: 'dl-ev-tile sys', title: levelLabel(e.level) }, icon(SYS_ICON[e.src] ?? 'zap')),
      E(
        'span',
        { class: 'dl-row-main' },
        admin
          ? [
              ...adminLine(e),
              e.note ? E('span', { class: 'dl-muted' }, ` · ${noteText(e.note)}`) : '',
              e.detail ? E('span', { class: `dl-slog-more${open ? ' open' : ''}` }, icon('chevron')) : '',
              e.detail && open ? E('pre', { class: 'dl-slog-detail' }, detailText(e.detail)) : '',
            ]
          : [
              // Servers have names people chose: say it is a server. Services name themselves.
              e.src === 'awg' && e.who && e.who !== 'AmneziaWG' ? E('span', { class: 'dl-ev-kind' }, `${_('Server')} `) : '',
              // A server's name as it is; Dawnline's own subjects ("Access rules") in the page's language.
              E(
                'b',
                { class: 'dl-sys-src', title: sourceName(e.src) },
                e.who ? (e.src === 'awg' ? e.who : logText(e.who)) : sourceName(e.src),
              ),
              // A translation may go on from the subject with a colon ("Home: AmneziaWG isn't running").
              /^[:,]/.test(msg) ? '' : ' ',
              E('span', { class: 'dl-muted' }, msg),
              e.detail ? E('span', { class: `dl-slog-more${open ? ' open' : ''}` }, icon('chevron')) : '',
              e.detail && open ? E('pre', { class: 'dl-slog-detail' }, detailText(e.detail)) : '',
            ],
      ),
      E('span', { class: 'dl-faint dl-nowrap', title: new Date(e.ts * 1000).toLocaleString(locale()) }, time),
    ],
  );
  if (e.detail)
    row.addEventListener('click', (ev) => {
      if (!(ev.target as HTMLElement).closest('pre')) toggle();
    });
  return row;
}

/** "Today", "Yesterday" or "Monday 12 October" (capitalised: Russian names weekdays in lower case). */
export function dayTitle(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return _('Today');
  if (d.toDateString() === y.toDateString()) return _('Yesterday');
  const t = d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toLocaleUpperCase(locale()) + t.slice(1);
}
