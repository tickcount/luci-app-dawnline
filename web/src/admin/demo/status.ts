// The demo router's status (router.ts gives the other answers): the cast (cast.ts) and what it did (past.ts) in the
// shape the backend sends, in the language the page asks in. Each person's state follows from their own numbers
// (a limit reached, a term ended, paused), as on a router.
//
// Pure: no DOM and no LuCI.

import type { DayUsage, Device, Pair, Person, Server, Status } from '../../shared/types';
import { CIRCLES, PEOPLE, PLACES, SERVER, SERVICES, SPARE, say, type CastDevice, type CastPerson, type Lang } from './cast';
import { DAY, DAYS, DEVICES, GB, HOUR, MIN, NOW, TZ, UP, add, addressAt, chance, daily, dayOf, log, midnight, places, sum } from './past';

function device(p: CastPerson, d: CastDevice, lang: Lang, n: number): Device {
  const days = daily(d);
  const small = d.kind === 'phone' || d.kind === 'tablet';
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return {
    id: d.id,
    name: say(d.name, lang),
    kind: d.kind,
    address: `10.8.0.${10 + n}`,
    disabled: !!d.disabled,
    created: NOW - d.added * DAY,
    created_by: d.portal ? 'portal' : 'admin',
    online: !!d.on,
    handshake: NOW - d.seen,
    endpoint: `${addressAt(d, d.at ?? 'home')}:${40000 + n}`,
    active: !!d.on,
    month: sum(days.slice(-30)),
    // what it moved before these two months, by how long it has been here
    total: sum(days).map((b) => Math.round(b * Math.max(1, d.added / 20))) as Pair,
    spark: days.slice(-7),
    hostname: `${slug(say(d.name, 'en'))}.${slug(say(p.name, 'en').split(' ')[0])}.lan`,
    browser_key: !!d.portal,
    config_stale: !!d.stale,
    config_issued: NOW - d.seen - HOUR,
    lan_bypass: d.kind !== 'router',
    mtu: 0,
    keepalive: d.keepalive ?? null,
    mtu_used: small ? 1280 : 1380,
    keepalive_used: d.keepalive ?? 0,
    link: d.link ? { state: d.link, since: NOW - (d.on ? 10 * MIN : 4 * HOUR) } : null,
    setup: null,
    ...(d.behind ? { behind: d.behind } : {}),
  };
}

/** Throughput a minute apart for the last quarter of an hour, [ts, rx, tx] in bytes/s: a few hundred KB/s down. */
function rate(id: string, live: boolean): [number, number, number][] {
  if (!live) return [];
  const down = 3e5 + chance(id, 'speed') * 1.4e6;
  return Array.from({ length: 15 }, (_x, i) => {
    const tx = Math.round(down * (0.6 + 0.8 * chance(id, 'minute', i)));
    return [NOW - (14 - i) * MIN, Math.round(tx * UP), tx];
  });
}

function person(p: CastPerson, lang: Lang, first: number): Person {
  const devices = p.devices.map((d, j) => device(p, d, lang, first + j));
  const month = sum(devices.map((d) => d.month));
  const total = sum(devices.map((d) => d.total));
  const [quota, period] = p.quota ?? [0, 'month' as const];
  const used = period === 'total' ? total : month;
  const expires = p.ends === undefined ? '' : dayOf(NOW + p.ends * DAY);
  const over = quota > 0 && used[0] + used[1] >= quota * GB;
  // their limit month began with their first traffic and ends a month later, twelve days from now
  const resets = NOW + 12 * DAY + 5 * HOUR;
  return {
    id: p.id,
    name: say(p.name, lang),
    server: SERVER.id,
    access: p.access,
    device_limit: p.limit,
    expires,
    quota_gb: quota,
    quota_period: period,
    quota_used: used[0] + used[1],
    quota_limit: quota * GB,
    quota_month: month,
    quota_resets: resets,
    quota_reset_day: dayOf(resets),
    bonus_gb: 0,
    dns_mode: 'device',
    paused: p.paused !== undefined,
    state: p.paused !== undefined ? 'paused' : over ? 'quota' : expires && expires < dayOf(NOW) ? 'expired' : 'active',
    month,
    total,
    online: devices.filter((d) => d.online).length,
    last_seen: Math.max(...devices.map((d) => d.handshake)),
    devices,
    rate: rate(
      p.id,
      devices.some((d) => d.online),
    ),
    has_link: true,
    note: p.note ? say(p.note, lang) : '',
    services: [],
    home_nets: [],
    ...(p.circle ? { circle: p.circle } : {}),
    created: NOW - p.joined * DAY,
    code_set: NOW - p.joined * DAY,
  };
}

/** The server everyone is on, and the one that is turned off. */
function servers(series: DayUsage[], people: Person[], lang: Lang): Server[] {
  const online = people.reduce((n, p) => n + p.online, 0);
  const home: Server = {
    id: SERVER.id,
    name: SERVER.name,
    ifname: SERVER.ifname,
    port: SERVER.port,
    subnet: SERVER.subnet,
    endpoint: SERVER.endpoint,
    public_key: SERVER.public_key,
    enabled: true,
    lan_like: false,
    device_mesh: true,
    mesh: 'circles',
    portal_routers: 'ask',
    portal_nets: 'ask',
    home: [{ dev: 'br-lan', nets: [SERVER.home] }],
    preset: 'balanced',
    mtu: 0,
    mtus: { computer: 1380, phone: 1280 },
    keepalive: 0,
    dns: [],
    series,
    rate: rate(SERVER.id, true).map(([ts, rx, tx]) => [ts, rx * online, tx * online]),
    address: SERVER.address,
    up: true,
    uptime: SERVER.uptime,
    peers: DEVICES.length,
    reached: NOW - 15,
    online,
    obf: {},
    hpk: false,
  };
  const spare: Server = {
    ...home,
    id: SPARE.id,
    name: say(SPARE.name, lang),
    ifname: SPARE.ifname,
    port: SPARE.port,
    subnet: SPARE.subnet,
    address: SPARE.address,
    endpoint: '',
    enabled: false,
    mesh: 'off',
    preset: 'off',
    series: series.map((d) => ({ day: d.day, rx: 0, tx: 0 })),
    rate: [],
    up: false,
    uptime: 0,
    peers: 0,
    reached: 0,
    online: 0,
  };
  return [home, spare];
}

const made = new Map<Lang, Status>();

/** The status, in the language the page asks in (the cast's names and places are said in it). */
export function status(lang: Lang): Status {
  const kept = made.get(lang);
  if (kept) return kept;
  let n = 0;
  const people = PEOPLE.map((p) => person(p, lang, (n += p.devices.length) - p.devices.length));
  const days = add(DEVICES.map(daily));
  const series = days.map(([rx, tx], i) => ({ day: dayOf(midnight(DAYS - 1 - i)), rx, tx }));
  const today = days[DAYS - 1];
  // today by the router's hour, midnight to now: quiet at night, busier towards noon
  const hours = Array.from({ length: Math.floor((NOW - midnight(0)) / HOUR) + 1 }, (_x, h) => 0.3 + h / 6 + chance('hour', h));
  const all = hours.reduce((s, w) => s + w, 0);
  const home = PLACES[lang].home;
  const st: Status = {
    version: 'demo',
    now: NOW,
    tz: TZ,
    hostname: 'OpenWrt',
    settings: {
      portal_enabled: true,
      portal_port: 8443,
      portal_host: SERVER.endpoint,
      default_device_limit: 3,
      domain: 'lan',
      hostnames: true,
      geo_enabled: true,
      home_dns_fallback: '',
    },
    servers: servers(series, people, lang),
    people,
    services: [...SERVICES],
    circles: CIRCLES.map((c) => ({ id: c.id, server: SERVER.id, name: say(c.name, lang), color: c.color })),
    totals: {
      people: people.length,
      devices: DEVICES.length,
      online: people.filter((p) => p.online).length,
      active: people.filter((p) => p.state === 'active').length,
      today,
      month: sum(days.slice(-30)),
    },
    series,
    hours: hours.map((w) => [Math.round((today[0] * w) / all), Math.round((today[1] * w) / all)]),
    events: log(lang).slice(-60),
    awg: { v2: true, v3: true },
    awg_state: { tools: true, kmod: true, loaded: true, handler: true, missing: [], ok: true },
    wan: '203.0.113.1',
    like_home: { active: false },
    geo: {
      enabled: true,
      home: { lat: home.lat, lon: home.lon, city: home.city, country: home.country, cc: home.cc, asn: 0, org: home.org },
      points: places(lang),
    },
  };
  made.set(lang, st);
  return st;
}

/** A person's traffic and each of their devices', a day at a time, for the last `days` days. */
export function usage(id: string, days: number): { person: DayUsage[]; devices: Record<string, DayUsage[]> } | null {
  const p = PEOPLE.find((x) => x.id === id);
  if (!p) return null;
  const take = Math.min(DAYS, Math.max(1, days));
  const named = (pairs: Pair[]): DayUsage[] => pairs.slice(-take).map(([rx, tx], i) => ({ day: dayOf(midnight(take - 1 - i)), rx, tx }));
  const each = p.devices.map(daily);
  return { person: named(add(each)), devices: Object.fromEntries(p.devices.map((d, i) => [d.id, named(each[i])])) };
}
