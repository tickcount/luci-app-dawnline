// Log rows: an activity event as a sentence ("You added device Phone for
// Myata"), its tile and time, and a service log line.

import type { LogEvent, Status } from '../../shared/types';
import type { ServiceLogEntry } from '../api';
import { E } from '../e';
import { icon } from '../../shared/icons';
import { ago } from '../../shared/format';
import { SYSTEM_SOURCE, eventBy, plainDetail } from './model';

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
  portal_blocked: 'bad',
  person_changed: '',
  devices_removed: 'warn',
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
};

function eventIcon(st: Names, e: LogEvent): string {
  if (e.device) {
    const d = st.people.flatMap((p) => p.devices).find((x) => x.id === e.device);
    return d?.kind ?? e.dkind ?? 'other';
  }
  return EVENT_ICON[e.type] ?? 'activity';
}

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
  // What the bold name is (a person, a device), said before it in grey.
  const kind = (t: string) => E('span', { class: 'dl-ev-kind' }, `${t} `);
  const wd = dev ? `${who} · ${dev}` : who;
  const detail = plainDetail(e);
  const devName = detail || dev || 'a device';
  // The admin's own actions start with an accent "You".
  const you = (verb: string) => [E('span', { class: 'dl-you' }, 'You'), m(` ${verb} `)];
  if (eventBy(e) === 'admin')
    switch (e.type) {
      case 'device_added':
        return [...you('added'), kind('device'), b(devName), m(' for '), b(who)];
      case 'device_removed':
        return [...you('removed'), kind('device'), b(devName), m(' from '), b(who)];
      case 'paused':
        return [...you('paused'), kind('person'), b(who)];
      case 'resumed':
        return [...you('resumed'), kind('person'), b(who)];
      case 'device_changed': {
        const renamed = detail.startsWith('renamed from ');
        return [
          ...you(renamed ? 'renamed' : detail),
          kind('device'),
          b(dev || 'a device'),
          m(' of '),
          b(who),
          ...(renamed ? [m(` · was ${detail.slice(13)}`)] : []),
        ];
      }
      case 'device_keys':
        return [...you('issued new keys for'), kind('device'), b(devName), m(' of '), b(who), m(' · it needs its new configuration')];
      case 'link_changed':
        return [...you('issued a new link for'), kind('person'), b(who), m(' · the old link stopped working')];
    }
  switch (e.type) {
    case 'connect':
      return [
        kind('Device'),
        b(wd),
        m(' connected'),
        ...(e.detail ? [m(' from '), ...addr(e.detail)] : []),
        ...(e.where ? [m(` · ${e.where}`)] : []),
      ];
    case 'disconnect':
      return [kind('Device'), b(wd), m(' went offline')];
    case 'roam':
      return [
        kind('Device'),
        b(wd),
        m(' changed network '),
        ...(e.detail ?? '').split(' → ').flatMap((ip, i) => (i ? [m(' → '), ...addr(ip)] : addr(ip))),
      ];
    case 'device_added':
      return [
        kind('Person'),
        b(who),
        m(' added '),
        kind('device'),
        b(devName),
        ...(eventBy(e) === 'portal' ? [m(' on their portal')] : []),
      ];
    case 'device_removed':
      return [
        kind('Person'),
        b(who),
        m(' removed '),
        kind('device'),
        b(devName),
        ...(eventBy(e) === 'portal' ? [m(' on their portal')] : []),
      ];
    case 'device_keys':
      return [kind('Person'), b(who), m(' issued new keys for '), kind('device'), b(devName), m(' on their portal')];
    case 'person_added':
      return [...you('added'), kind('person'), b(e.detail ?? who)];
    case 'person_removed':
      return [...you('removed'), kind('person'), b(e.detail ?? who)];
    case 'person_changed':
      // The detail lists changed fields by their option names (device_limit, expire_action).
      return [...you('changed'), kind('person'), b(who), ...(detail ? [m(` · ${detail.replace(/_/g, ' ')}`)] : [])];
    case 'paused':
      return [kind('Person'), b(who), m(` paused — ${e.detail ?? ''}`)];
    case 'resumed':
      return [kind('Person'), b(who), m(' resumed'), ...(e.detail && e.detail !== 'active' ? [m(` — ${e.detail}`)] : [])];
    case 'portal_blocked':
      return [
        E('b', { class: 'dl-sys-src' }, 'Personal portal'),
        m(' blocked '),
        mono(e.detail ?? ''),
        m(' for 15 min after too many wrong codes'),
      ];
    case 'devices_removed':
      return [kind('Person'), b(who), m(' — all devices removed, end date reached')];
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
  return srv ? E('span', { class: 'dl-ev-srv', title: 'Server' }, srv.name) : '';
}

/** An activity event as a row; `time` replaces the "5 min ago" (`now` is the router's clock). */
export function eventRow(st: Names & { now?: number }, e: LogEvent, opts: { server?: boolean; time?: string } = {}): HTMLElement {
  const sys = SYSTEM_EVENT[e.type];
  const by = eventBy(e);
  return E('div', { class: `dl-row${by === 'admin' ? ' dl-ev-by-admin' : sys ? ` dl-ev-by-system ${sys[1]}` : ''}` }, [
    by === 'admin'
      ? E('span', { class: 'dl-ev-tile', title: 'Done by you in LuCI' }, icon('admin'))
      : sys
        ? E('span', { class: 'dl-ev-tile sys' }, icon(sys[0]))
        : E('span', { class: `dl-ev-tile ev ${EVENT_TONE[e.type] ?? ''}` }, icon(eventIcon(st, e))),
    E('span', { class: 'dl-row-main' }, eventText(st, e)),
    opts.server === false ? '' : serverPill(st, e),
    E('span', { class: 'dl-faint dl-nowrap', title: new Date(e.ts * 1000).toLocaleString() }, opts.time ?? ago(e.ts, st.now)),
  ]);
}

/** Colour per service log level (tile, source and row): neutral unless something came up, was repaired or failed. */
// "down" is a tunnel that stopped without Dawnline asking (its own stops are "info").
const SYS_TONE: Record<ServiceLogEntry['level'], string> = { info: '', up: 'ok', down: 'warn', repair: 'warn', error: 'bad' };
const SYS_ICON: Record<ServiceLogEntry['src'], string> = { awg: 'tunnel', dawnline: 'sunrise', portal: 'globe' };

/** A service log line: source, message, folded details; click to unfold. */
export function systemRow(e: ServiceLogEntry, open: boolean, toggle: () => void, time: string): HTMLElement {
  const admin = e.by === 'admin';
  const row = E(
    'div',
    {
      class: `dl-row dl-slog-row ${admin ? 'dl-ev-by-admin' : `dl-ev-by-system ${SYS_TONE[e.level] ?? ''}`}${e.detail ? ' has-detail' : ''}`,
    },
    [
      admin
        ? E('span', { class: 'dl-ev-tile', title: 'Done by you in LuCI' }, icon('admin'))
        : E('span', { class: 'dl-ev-tile sys', title: e.level }, icon(SYS_ICON[e.src] ?? 'zap')),
      E(
        'span',
        { class: 'dl-row-main' },
        admin
          ? [
              E('span', { class: 'dl-you' }, 'You'),
              E('span', { class: 'dl-muted' }, ` ${e.msg} `),
              e.kind ? E('span', { class: 'dl-ev-kind' }, `${e.kind} `) : '',
              e.who ? E('b', {}, e.who) : '',
              e.note ? E('span', { class: 'dl-muted' }, ` · ${e.note}`) : '',
              e.detail ? E('span', { class: `dl-slog-more${open ? ' open' : ''}` }, icon('chevron')) : '',
              e.detail && open ? E('pre', { class: 'dl-slog-detail' }, e.detail) : '',
            ]
          : [
              // Servers have names people chose: say it is a server. Services name themselves.
              e.src === 'awg' && e.who && e.who !== 'AmneziaWG' ? E('span', { class: 'dl-ev-kind' }, 'Server ') : '',
              E('b', { class: 'dl-sys-src', title: SYSTEM_SOURCE[e.src] ?? e.src }, e.who ?? SYSTEM_SOURCE[e.src] ?? e.src),
              ' ',
              E('span', { class: 'dl-muted' }, e.msg),
              e.detail ? E('span', { class: `dl-slog-more${open ? ' open' : ''}` }, icon('chevron')) : '',
              e.detail && open ? E('pre', { class: 'dl-slog-detail' }, e.detail) : '',
            ],
      ),
      E('span', { class: 'dl-faint dl-nowrap', title: new Date(e.ts * 1000).toLocaleString() }, time),
    ],
  );
  if (e.detail)
    row.addEventListener('click', (ev) => {
      if (!(ev.target as HTMLElement).closest('pre')) toggle();
    });
  return row;
}

/** "Today", "Yesterday" or "Monday 12 October". */
export function dayTitle(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}
