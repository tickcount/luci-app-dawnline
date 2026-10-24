// The demo's made-up person ("User" on the server "Dawnline Preview"), their devices, and the
// page state the router would send for her in each scenario. Pure: no DOM, no
// storage, no fetch (router.ts keeps the devices and answers the API; the
// scenario picker is picker.ts).

import type { State } from '../state';
import type { Device, Kind, Pair, Person } from '../../shared/types';

const GB = 2 ** 30;
const HOUR = 3600;
const DAY = 86400;

export type ScenarioId = 'normal' | 'first' | 'stale' | 'quota' | 'hours' | 'paused' | 'expired' | 'http' | 'plain' | 'full';

export interface Scenario {
  id: ScenarioId;
  label: string;
  /** One line on what the page shows in it. */
  about: string;
}

/** What can be tried, in the picker's groups (their words are groups()). */
const GROUPS: ScenarioId[][] = [
  ['normal', 'first', 'stale'],
  ['quota', 'hours', 'paused', 'expired'],
  ['http', 'plain', 'full'],
];
export const SCENARIOS: { id: ScenarioId }[] = GROUPS.flat().map((id) => ({ id }));

/** The picker's groups in the page's language: made when it draws (the language changes in place). */
export function groups(): { title: string; items: Scenario[] }[] {
  const titles = [_('Your page'), _('Stopped by the admin'), _('Other cases')];
  const words: Record<ScenarioId, [label: string, about: string]> = {
    normal: [_('Everything works'), _('Three devices: one online, one waiting to be set up.')],
    first: [_('First visit'), _('A fresh link with no devices yet.')],
    stale: [_('Settings changed'), _('The admin changed something: a device needs an update.')],
    quota: [_('Out of data'), _('The month’s limit is used up.')],
    hours: [_('Outside allowed hours'), _('Access only at certain hours of the day.')],
    paused: [_('Paused by the admin'), _('The page turns into one card.')],
    expired: [_('Access ended'), _('The end date has passed.')],
    http: [_('Opened over plain HTTP'), _('Settings only travel over HTTPS.')],
    plain: [_('Plain WireGuard'), _('Disguise off: any WireGuard app connects.')],
    full: [_('No free slots'), _('Every device slot is taken.')],
  };
  return GROUPS.map((ids, i) => ({ title: titles[i], items: ids.map((id) => ({ id, label: words[id][0], about: words[id][1] })) }));
}
export const isScenario = (id: unknown): id is ScenarioId => SCENARIOS.some((s) => s.id === id);

/** A device as the demo keeps it; the page's Device is made from it on every answer. */
export interface DemoDevice {
  id: string;
  name: string;
  kind: Kind;
  /** The last part of its tunnel address (10.8.0.n). */
  n: number;
  /** Data this month, in GB. */
  gb: number;
  /** Last handshake (epoch seconds), 0: never. */
  hs: number;
  /** A device being set up "connects" at this time (0: not waiting). */
  connectAt: number;
  created: number;
  by: 'admin' | 'portal';
  stale: boolean;
  /** A set-up state the visitor picked in the sheet (way-pick.ts), held until they pick another; none: as it comes. */
  way?: DemoWay;
  /** When it was picked: the knocks' or the handshake's time. */
  wayAt?: number;
}

/** The set-up states the visitor can hold a device in (connected is a real handshake: router.ts). */
export type DemoWay = 'waiting' | 'trying' | 'nodata';

/** The scenario's own devices, as it starts. */
export function seedDevices(s: ScenarioId, t: number, id: () => string): DemoDevice[] {
  if (s === 'first') return [];
  const dev = (name: string, kind: Kind, n: number, gb: number, hs: number): DemoDevice => ({
    id: id(),
    name,
    kind,
    n,
    gb,
    hs,
    connectAt: 0,
    created: t - 40 * DAY,
    by: 'admin',
    stale: false,
  });
  return [
    dev('iPhone 16', 'phone', 2, 14.2, t - 40),
    { ...dev('MacBook Pro', 'computer', 3, 21.9, t - 3 * HOUR), stale: s === 'stale' },
    { ...dev('iPad Air', 'tablet', 4, 0, 0), created: t - 2 * DAY, by: 'portal' },
  ];
}

/** The person's state in the scenario: the four the admin's limits stop them in, else active. */
function personState(s: ScenarioId): Person['state'] {
  return s === 'quota' || s === 'hours' || s === 'paused' || s === 'expired' ? s : 'active';
}
const locked = (s: ScenarioId) => s === 'paused' || s === 'expired';
export const deviceLimit = (s: ScenarioId) => (s === 'full' ? 3 : 4);

/** The local day (YYYY-MM-DD) of a time: in the demo, the visitor's clock is the router's. */
function isoDay(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A name as a host label: what the router's DHCP names look like. */
const label = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'device';

/** How busy each day of the week is, Monday first. */
const WEEK = [0.9, 1.15, 0.8, 1.05, 1.3, 0.75, 1.1];

/** A day split into what the devices sent and received: about a tenth sent, more on a day something backed up. */
const split = (v: number, sent: number): Pair => [Math.round(v * sent), v - Math.round(v * sent)];

/** The month so far, day by day as [rx, tx], adding up to `total` bytes (today only partly gone). */
export function monthDays(total: number, t: number): Pair[] {
  const d = new Date(t * 1000);
  const days = d.getDate();
  const w = Array.from({ length: days }, (_, i) => {
    const wd = (new Date(d.getFullYear(), d.getMonth(), i + 1).getDay() + 6) % 7;
    return WEEK[wd] * (i === days - 1 ? 0.45 : 1) * (0.85 + ((i * 37) % 11) / 30);
  });
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x, i) => split(Math.round((x / sum) * total), i % 11 === 4 ? 0.4 : 0.08 + ((i * 17) % 9) / 100));
}

/** A window of the day that leaves `t` out (the visitor's hours): the hours scenario is outside it. */
export function hoursAway(t: number): string {
  const at = new Date(t * 1000).getHours();
  const p = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;
  return `${p(at + 2)}-${p(at + 10)}`;
}

/** The handshake the page sees: a device being set up has "connected" once its time came. */
export const handshakeOf = (d: DemoDevice, t: number) => (d.connectAt && t >= d.connectAt ? d.connectAt : d.hs);

function device(d: DemoDevice, t: number, st: Person['state']): Device {
  // Held waiting or knocking: no handshake; no data: one handshake when it was picked, nothing after it.
  const at = d.wayAt ?? t;
  const hs = d.way === 'nodata' ? at : d.way ? 0 : handshakeOf(d, t);
  const month = d.gb * GB;
  // A stopped person's tunnels are down; the rest count as online for three minutes after a handshake.
  const online = !!hs && t - hs < 180 && st !== 'paused' && st !== 'expired';
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    address: `10.8.0.${d.n}`,
    disabled: false,
    created: d.created,
    created_by: d.by,
    online,
    handshake: hs,
    endpoint: hs ? `203.0.113.${20 + d.n}` : '',
    active: true,
    month: [Math.round(month / 8), Math.round((month * 7) / 8)],
    total: [Math.round(month / 4), Math.round((month * 7) / 4)],
    spark: [0.8, 1.3, 0.6, 1.1, 1.6, 0.9, 1].map((f, i) =>
      split(hs ? Math.round(((month / 4) * f) / 7) : 0, [0.1, 0.14, 0.08, 0.35, 0.11, 0.09, 0.12][i]),
    ),
    hostname: `${label(d.name)}.user.lan`,
    browser_key: false,
    config_stale: d.stale,
    lan_bypass: false,
    mtu: 0,
    keepalive: null,
    // The server's for its kind, as the router works it out (the portal never shows it).
    mtu_used: d.kind === 'phone' || d.kind === 'tablet' ? 1280 : 1368,
    keepalive_used: 25,
    link: null,
    // The demo's devices pass data whenever they are connected: the set-up sheet sees one arrive.
    setup:
      d.way === 'trying'
        ? { state: 'trying', since: at }
        : d.way === 'nodata'
          ? { state: 'nodata', since: at }
          : online
            ? { state: 'flowing', since: hs }
            : null,
  };
}

/** Everything the page shows, as portal.uc's state() sends it. `secureUrl`: this page over HTTPS, for the plain-HTTP scenario. */
export function pageState(s: ScenarioId, devs: DemoDevice[], t: number, secureUrl: string): State {
  const st = personState(s);
  const devices = devs.map((d) => device(d, t, st));
  const quota = s === 'quota' ? 20 : 100;
  // Out of data: a little over the limit. Otherwise what the devices used, and a bit from one removed (a fresh link: nothing).
  const removed = s === 'first' ? 0 : 2.5 * GB;
  const used = s === 'quota' ? 20.4 * GB : devices.reduce((a, d) => a + d.month[0] + d.month[1], 0) + removed;
  const limit = deviceLimit(s);
  const person: Person = {
    id: 'user',
    name: 'User',
    server: 'home',
    access: 'both',
    device_limit: limit,
    expires: isoDay(t + (s === 'expired' ? -3 : 41) * DAY),
    quota_gb: quota,
    quota_period: 'month',
    quota_used: used,
    quota_limit: quota * GB,
    bonus_gb: 0,
    expire_action: 'pause',
    expire_warn: 7,
    dns_mode: 'home',
    paused: s === 'paused',
    hours: s === 'hours' ? hoursAway(t) : '',
    state: st,
    month: [Math.round(used / 8), Math.round((used * 7) / 8)],
    total: [Math.round(used / 3), Math.round((used * 7) / 3)],
    online: devices.filter((d) => d.online).length,
    last_seen: Math.max(0, ...devices.map((d) => d.handshake)),
    devices,
    month_days: monthDays(used, t),
  };
  return {
    person,
    here: null,
    server: {
      name: 'Dawnline Preview',
      endpoint: ENDPOINT,
      device_mesh: true,
      awg_disguise: s !== 'plain',
      preset: s === 'plain' ? 'off' : 'max',
      // A home network as most routers come with it: LAN Bypass then says those addresses still lead home.
      home: ['192.168.1.0/24'],
    },
    can_add: devs.length < limit,
    locked: locked(s),
    https_url: s === 'http' ? secureUrl : null,
    kinds: ['computer', 'phone', 'tablet', 'router', 'other'],
    version: 'demo',
    today: isoDay(t),
    now: t,
    tz_offset: -new Date(t * 1000).getTimezoneOffset(),
  };
}

/** Where Dawnline lives: the breadcrumb's GitHub pill, on a phone the drawer's GitHub button. */
export const REPO = 'https://github.com/tickcount/luci-app-dawnline';

/** The server's address in every configuration: a name that never resolves (RFC 2606). */
export const ENDPOINT = 'demo.dawnline.invalid';
