// The router the admin's demo asks (serve.ts hands its questions here): what the backend answers besides the status
// (status.ts), made of the same cast at the same fixed moment: the log, the checks, the service log, a server's
// interfaces, a device's configuration, the live meter. It only answers questions: what changes something is not
// here, and serve.ts refuses it.
//
// Pure: no DOM and no LuCI. Its addresses are private or from the documentation ranges, its keys are not keys.

import type { ClientConfig, HealthCheck, Pair } from '../../shared/types';
import type { Health, InterfacesData, LogsInfo, MeterPoint, NetDevice, ServiceLog } from '../api';
import { CHECKS, PEOPLE, SERVER, SPARE, say, type Lang } from './cast';
import { DEVICES, HOUR, NOW, UP, chance, log, sum } from './past';
import { status } from './status';

const POLICY: LogsInfo['policy'] = {
  keep_days: 30,
  max: 20000,
  categories: ['connections', 'people', 'problems'],
  persist: '10min',
  usage_days: 60,
  usage_months: 12,
};

/** The newest `limit` events; a person's or a device's only, or only those after `since`, when given. */
export function events(lang: Lang, limit: number, who?: string, since?: number, dev?: string) {
  const all = log(lang).filter((e) => (!who || e.person === who) && (!dev || e.device === dev) && (!since || e.ts > since));
  return { events: all.slice(-(limit || 300)), total: all.length, policy: POLICY };
}

/** The service log: the watchdog at rest, and the one change the admin made to the server (the day before). */
export function serviceLog(): ServiceLog {
  const targets = [
    { id: 'awg', name: 'AmneziaWG' },
    { id: `up_${SERVER.id}`, name: SERVER.name },
    { id: 'nft', name: 'nftables' },
  ];
  return {
    watchdog: {
      enabled: true,
      last: NOW - 40,
      beat: NOW - 20,
      now: NOW,
      targets: targets.map((t) => ({ ...t, ok: true, tries: 0 })),
      repairs: [],
    },
    log: [
      {
        ts: NOW - 22 * HOUR,
        src: 'dawnline',
        level: 'info',
        msg: 'changed',
        by: 'admin',
        kind: 'server',
        who: SERVER.name,
        sid: SERVER.id,
        note: 'MTU',
      },
    ],
  };
}

/** The checks: every one passes but the cast's one finding, so a page shows where a fix stands. */
export function health(lang: Lang): Health {
  const checks: HealthCheck[] = CHECKS.map((c) => ({
    id: c.id,
    title: say(c.title, lang),
    status: c.warn ? 'warn' : 'ok',
    detail: c.detail ? say(c.detail, lang) : '',
    fix: null,
    problem: c.warn ? say(c.title, lang) : null,
  }));
  return { checks, ...serviceLog() };
}

/** What the router's interfaces are to the server: its WAN, its home network, and a guest network no firewall zone holds. */
export function interfaces(id: string): InterfacesData | null {
  if (id !== SERVER.id && id !== SPARE.id) return null;
  const ifname = id === SERVER.id ? SERVER.ifname : SPARE.ifname;
  const dev = (name: string, o: Partial<NetDevice>): NetDevice => ({
    name,
    category: 'ethernet',
    kind: 'ethernet',
    up: true,
    master: null,
    members: [],
    nets: [],
    addrs: [],
    logical: null,
    proto: 'static',
    zone: null,
    ...o,
  });
  return {
    server: id,
    ifname,
    detected: { wan: 'eth0', lan: 'br-lan' },
    saved: { wan: '', lan: '' },
    config: {
      auto_wan: true,
      wan_device: '',
      auto_lan: true,
      lan_devices: [],
      lan_like: false,
      device_mesh: true,
      mesh: id === SERVER.id ? 'circles' : 'off',
    },
    like_home: { active: false },
    effective: {
      wan: { dev: 'eth0', zone: 'wan', auto: true, missing: false },
      home: [{ dev: 'br-lan', auto: true, nets: [SERVER.home], zone: 'lan', missing: false }],
      nets: [SERVER.home],
      zones: ['lan'],
    },
    zones: ['lan', 'wan'],
    devices: [
      dev('eth0', { category: 'wan', kind: 'wan', addrs: ['203.0.113.1/24'], logical: 'wan', proto: 'dhcp', zone: 'wan' }),
      dev('br-lan', {
        kind: 'bridge',
        members: ['lan1', 'lan2', 'lan3'],
        nets: [SERVER.home],
        addrs: ['192.168.1.1/24'],
        logical: 'lan',
        zone: 'lan',
        home: true,
        auto: true,
      }),
      dev('br-guest', {
        category: 'wifi',
        kind: 'bridge',
        members: ['phy0-ap1'],
        nets: ['192.168.3.0/24'],
        addrs: ['192.168.3.1/24'],
        logical: 'guest',
      }),
      dev(ifname, { category: 'vpn', kind: 'vpn', up: id === SERVER.id, proto: 'amneziawg', zone: 'lan', own: true }),
    ],
    lan_only: PEOPLE.filter((p) => p.access === 'lan').length,
  };
}

/** Keys that open nothing: "demo-device-key--not-a-real-one!" and "demo-shared-key--not-a-real-one!". */
const NO_KEY = 'ZGVtby1kZXZpY2Uta2V5LS1ub3QtYS1yZWFsLW9uZSE=';
const NO_PSK = 'ZGVtby1zaGFyZWQta2V5LS1ub3QtYS1yZWFsLW9uZSE=';

/** A device's configuration as its set-up shows it. It connects nowhere: the server's name does not exist. */
export function config(id: string, lang: Lang): ClientConfig | null {
  const p = status(lang).people.find((x) => x.devices.some((d) => d.id === id));
  const d = p?.devices.find((x) => x.id === id);
  if (!p || !d) return null;
  const allowed = p.access === 'lan' ? [SERVER.home] : ['0.0.0.0/0'];
  const conf = [
    '[Interface]',
    `PrivateKey = ${NO_KEY}`,
    `Address = ${d.address}/32`,
    `DNS = ${SERVER.address}`,
    `MTU = ${d.mtu_used}`,
    '',
    '[Peer]',
    `PublicKey = ${SERVER.public_key}`,
    `PresharedKey = ${NO_PSK}`,
    `Endpoint = ${SERVER.endpoint}:${SERVER.port}`,
    `AllowedIPs = ${allowed.join(', ')}`,
    '',
  ].join('\n');
  return {
    name: d.name,
    person: p.name,
    server: SERVER.name,
    filename: `${d.hostname.split('.')[0]}.conf`,
    conf,
    has_private_key: true,
    amnezia: {
      host: SERVER.endpoint,
      port: SERVER.port,
      mtu: String(d.mtu_used),
      dns: [SERVER.address],
      allowed_ips: allowed,
      client_ip: d.address,
      client_priv_key: NO_KEY,
      client_pub_key: NO_KEY,
      psk_key: NO_PSK,
      server_pub_key: SERVER.public_key,
      persistent_keep_alive: String(d.keepalive_used ?? 0),
      obfuscation: {},
    },
  };
}

/** The live meter's last two minutes: each online device streaming a little unevenly, the server their sum. */
export function meter(): MeterPoint[] {
  const live = DEVICES.filter((d) => d.on);
  return Array.from({ length: 120 }, (_x, i) => {
    const ts = NOW - 119 + i;
    const dev: Record<string, Pair> = {};
    for (const d of live) {
      const down = (3e5 + chance(d.id, 'speed') * 1.4e6) * (1 + 0.4 * Math.sin(ts / (7 + d.id.length)) + 0.2 * Math.sin(ts / 3));
      dev[d.id] = [Math.round(down * UP), Math.round(down)];
    }
    return { ts, servers: { [SERVER.id]: sum(Object.values(dev)) }, dev };
  });
}
