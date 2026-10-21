// The demo's router: portal.uc's API (state, add a device, its settings,
// rename / reconnect / remove) answered from the demo's own devices, which it
// keeps per visitor. The refusals are the router's (paused, ended, plain HTTP,
// no free slot, a name taken). Nothing is installed and no tunnel exists: the
// keys are random and the server's address never resolves. The page state
// itself is data.ts; serve.ts puts this router behind the page's fetch.

import type { AwgConfig, Kind } from '../../shared/types';
import { DEVICE_NAME_MAX, validDeviceName } from '../../shared/format';
import {
  ENDPOINT,
  deviceLimit,
  isScenario,
  pageState,
  seedDevices,
  type DemoDevice,
  type DemoWay,
  type ScenarioId,
  handshakeOf,
} from './data';

/** What the router remembers for this visitor. */
export interface DemoDb {
  scenario: ScenarioId;
  devs: DemoDevice[];
  /** The next tunnel address (10.8.0.n). */
  next: number;
}

/** Where the devices are kept between visits (localStorage in the page, a map in tests). */
export interface Keep {
  load(): unknown;
  save(db: DemoDb): void;
}

export interface Answer {
  status: number;
  body: unknown;
}

export interface RouterOpts {
  keep: Keep;
  /** The scenario the link asks for (?s=), if any: it wins over the one kept. */
  want: string | null;
  /** This page over HTTPS, for the plain-HTTP scenario's refusals. */
  secureUrl: () => string;
  /** Epoch seconds. */
  clock?: () => number;
  /** Random bytes (the keys and ids). */
  random?: (n: number) => Uint8Array;
}

/** A settings sheet waits for the first connection: it comes this long after the settings are shown. */
export const CONNECT_AFTER = [6, 9];

class Refusal {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {}
}
function refuse(status: number, error: string, extra: Record<string, unknown> = {}): never {
  throw new Refusal(status, { error, ...extra });
}

/** A kept db that still fits the demo, or null (an older demo, a hand-edited one). */
function valid(v: unknown): DemoDb | null {
  const db = v as DemoDb | null;
  return db && isScenario(db.scenario) && Array.isArray(db.devs) && Number.isInteger(db.next) ? db : null;
}

const KINDS: Kind[] = ['computer', 'phone', 'tablet', 'router', 'other'];

export function createRouter(o: RouterOpts) {
  const clock = o.clock ?? (() => Math.floor(Date.now() / 1000));
  const random = o.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const hex = (n: number) => [...random(n)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = () => btoa(String.fromCharCode(...random(32)));
  const newId = () => `d_${hex(4)}`;
  const soon = () => clock() + CONNECT_AFTER[0] + (random(1)[0] % (CONNECT_AFTER[1] - CONNECT_AFTER[0] + 1));

  const seed = (s: ScenarioId): DemoDb => ({ scenario: s, devs: seedDevices(s, clock(), newId), next: 5 });
  const kept = valid(o.keep.load());
  let db = kept && (!o.want || kept.scenario === o.want) ? kept : seed(isScenario(o.want) ? o.want : 'normal');

  const state = () => pageState(db.scenario, db.devs, clock(), o.secureUrl());
  /** The device whose settings went out last: the one the set-up sheet is open for. */
  let issued = '';

  function needOpen() {
    if (db.scenario === 'paused') refuse(403, 'Your access is paused.');
    if (db.scenario === 'expired') refuse(403, 'Your access has ended.');
  }
  function needHttps() {
    if (db.scenario === 'http') refuse(403, 'Open this link over HTTPS to get the connection settings.', { https_url: o.secureUrl() });
  }
  function own(id: string): DemoDevice {
    return db.devs.find((x) => x.id === id) ?? refuse(404, 'Device not found.');
  }
  function checkName(v: unknown, self?: DemoDevice): string {
    const name = String(v ?? '').trim();
    if (!name) refuse(400, 'Give the device a name.');
    if (!validDeviceName(name)) refuse(400, `Enter a device name: up to ${DEVICE_NAME_MAX} letters, digits, spaces and - _ .`);
    if (db.devs.some((d) => d !== self && d.name.toLowerCase() === name.toLowerCase()))
      refuse(409, 'You already have a device with this name.');
    return name;
  }

  /** A configuration that looks the part and connects nowhere: random keys, the server's address never resolves. */
  function config(d: DemoDevice): AwgConfig {
    const plain = db.scenario === 'plain';
    const priv = key();
    const psk = key();
    const srv = 'DEMOdemoDEMOdemoDEMOdemoDEMOdemoDEMOdemo0k=';
    const mtu = d.kind === 'phone' || d.kind === 'tablet' ? '1280' : '1376';
    const obf: Record<string, string> = plain ? {} : OBF;
    const lines = ['[Interface]', `PrivateKey = ${priv}`, `Address = 10.8.0.${d.n}/32`, 'DNS = 10.8.0.1', `MTU = ${mtu}`];
    // The .conf names: jc → Jc, jmin → Jmin, h1 → H1.
    for (const [k, v] of Object.entries(obf)) lines.push(`${k[0].toUpperCase()}${k.slice(1)} = ${v}`);
    lines.push('', '[Peer]', `PublicKey = ${srv}`, `PresharedKey = ${psk}`, 'AllowedIPs = 0.0.0.0/0, ::/0');
    lines.push(`Endpoint = ${ENDPOINT}:51820`, 'PersistentKeepalive = 25');
    return {
      name: d.name,
      person: 'User',
      server: 'Dawnline Preview',
      filename: 'Dawnline-Preview.conf',
      conf: lines.join('\n') + '\n',
      has_private_key: true,
      amnezia: {
        host: ENDPOINT,
        port: 51820,
        mtu,
        dns: ['10.8.0.1'],
        allowed_ips: ['0.0.0.0/0', '::/0'],
        client_ip: `10.8.0.${d.n}`,
        client_priv_key: priv,
        client_pub_key: key(),
        psk_key: psk,
        server_pub_key: srv,
        persistent_keep_alive: '25',
        obfuscation: obf,
      },
    };
  }

  function add(b: Record<string, unknown>) {
    needOpen();
    needHttps();
    if (db.devs.length >= deviceLimit(db.scenario)) refuse(409, 'All your device slots are taken.');
    const d: DemoDevice = {
      id: newId(),
      name: checkName(b.name),
      kind: KINDS.includes(b.kind as Kind) ? (b.kind as Kind) : 'other',
      n: db.next++,
      gb: 0,
      hs: 0,
      connectAt: soon(),
      created: clock(),
      by: 'portal',
      stale: false,
    };
    db.devs.push(d);
    issued = d.id;
    return { id: d.id, config: config(d), state: state() };
  }

  /** Showing the settings is "issuing" them: no longer stale, and a device never set up connects soon. */
  function settings(id: string) {
    const d = own(id);
    needOpen();
    needHttps();
    d.stale = false;
    if (!d.hs && !d.connectAt) d.connectAt = soon();
    issued = d.id;
    return config(d);
  }

  function act(id: string, b: Record<string, unknown>) {
    const d = own(id);
    needOpen();
    let extra = {};
    if (b.action === 'rename') d.name = checkName(b.name, d);
    else if (b.action === 'reconnect') {
      needHttps();
      // New keys: the old handshake no longer counts, the device connects again once set up.
      d.hs = 0;
      d.stale = false;
      d.connectAt = soon();
      issued = d.id;
      extra = { config: config(d) };
    } else if (b.action === 'delete') db.devs = db.devs.filter((x) => x !== d);
    else refuse(400, 'Unknown action.');
    return { ok: true, ...extra, state: state() };
  }

  /** One API call: `path` is what follows /<code>/api/. */
  function answer(method: string, path: string, body: Record<string, unknown> = {}): Answer {
    const segs = path.split('/').filter(Boolean);
    const route = `${method} ${segs.map((s, i) => (i === 1 && segs[0] === 'devices' ? '*' : s)).join('/')}`;
    try {
      let res: unknown;
      if (route === 'GET state') res = state();
      else if (route === 'POST devices') res = add(body);
      else if (route === 'GET devices/*/config') res = settings(segs[1]);
      else if (route === 'POST devices/*') res = act(segs[1], body);
      else refuse(404, 'Not found.');
      o.keep.save(db);
      return { status: 200, body: res };
    } catch (e) {
      if (e instanceof Refusal) return { status: e.status, body: e.body };
      throw e;
    }
  }

  return {
    answer,
    scenario: () => db.scenario,
    /** The device being set up (its settings went out last), if it is still there. */
    settingUp: () => (db.devs.some((d) => d.id === issued) ? issued : null),
    /** The set-up state `id` is held in, 'auto' when none. */
    wayOf: (id: string): DemoWay | 'auto' => db.devs.find((d) => d.id === id)?.way ?? 'auto',
    /**
     * Hold `id` in a set-up state, or let it go: 'connected' is a handshake now with data after it, 'auto' the
     * demo's own timing (it connects a few seconds on, unless it already has).
     */
    holdWay(id: string, w: DemoWay | 'connected' | 'auto') {
      const d = db.devs.find((x) => x.id === id);
      if (!d) return;
      const t = clock();
      delete d.way;
      delete d.wayAt;
      if (w === 'connected') {
        d.hs = t;
        d.connectAt = 0;
      } else if (w === 'auto') {
        if (!handshakeOf(d, t)) d.connectAt = soon();
      } else {
        d.way = w;
        d.wayAt = t;
        d.hs = 0;
        d.connectAt = 0;
      }
      o.keep.save(db);
    },
    /** Start a scenario over: its own devices, nothing added. */
    use(s: ScenarioId) {
      db = seed(s);
      o.keep.save(db);
    },
  };
}

export type DemoRouter = ReturnType<typeof createRouter>;

/** The disguise the demo's server would hand out (AmneziaWG 2.0 shapes, made-up values). */
const OBF: Record<string, string> = {
  jc: '4',
  jmin: '40',
  jmax: '70',
  s1: '57',
  s2: '121',
  s3: '29',
  s4: '18',
  h1: '1293844551-1293844599',
  h2: '2741190832-2741190880',
  h3: '3820045117-3820045165',
  h4: '918274635-918274683',
};
