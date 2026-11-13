// The backend's RPC bindings (ubus object `dawnline`, the Go backend). The backend reports failures as { error }, and
// a change the router saved but could not fully put into effect (access rules
// that did not load, a server that refused its devices) as { warning }.

import type { Network, PortHold } from './netcheck';
import type {
  AwgCaps,
  AwgState,
  Circle,
  ClientConfig,
  DayUsage,
  HealthCheck,
  LogEvent,
  MeshMode,
  Pair,
  Person,
  Status,
} from '../shared/types';
import { notify } from './ui/toast';
import { lang } from '../shared/i18n';
import { markWritten, streamMeter, streamStatus } from './state/stream';

/** Throw a backend failure; show a warning the answer carries. */
function settle<T>(r: any): T {
  if (r && typeof r === 'object') {
    if (typeof r.error === 'string') throw new Error(r.error);
    if (typeof r.warning === 'string' && r.warning) notify(r.warning, 'warning', 12000);
  }
  return r as T;
}

/**
 * A method of the backend (`dawnline`). The page's language goes last, after the
 * method's own arguments: the router writes its messages in it.
 */
function call<T>(method: string, params: string[] = []) {
  const declare = (object: string) => rpc.declare<any>({ object, method, params: [...params, 'lang'] });
  const here = declare('dawnline');
  return async (...args: unknown[]): Promise<T> => {
    try {
      return settle<T>(await here(...params.map((_p, i) => args[i]), lang()));
    } finally {
      // anything but a question may have changed what the stream shows: the next status is read after it
      if (!ASKS.test(method)) markWritten();
    }
  };
}

/** The methods that only ask. */
const ASKS =
  /^(status|meter|rev|events|health|service_log|settings_get|portal_info|(server_)?interfaces|access_check|home_hosts|setup_defaults|endpoint_probe|person_(links|usage)|device_config|backup_(list|read)|export|updates_(status|releases|notes|changes))$/;

export interface SetupDefaults {
  id: string;
  name: string;
  ifname: string;
  port: number;
  subnet: string;
  endpoint: string;
  mtu: number;
  zones: string[];
  lan_zone: string;
  wan_zone: string;
  portal_port: number;
  /** Networks the tunnel must not overlap: the router's and the other servers'. */
  networks: Network[];
  /** UDP ports the server can't take, TCP ports the portal can't. */
  udp_taken: PortHold[];
  tcp_taken: PortHold[];
  awg: AwgCaps;
  awg_state?: AwgState;
  /** Where the suggested address came from: ddns, cert, wan, portal ('' = nothing found). */
  endpoint_from?: string;
  /** What the WAN's IPv4 is: public, private (behind another router), cgnat, none. */
  wan_kind?: 'public' | 'private' | 'cgnat' | 'none';
  wan_ip?: string | null;
}

/** Where a public address points (rpc endpoint_probe): the facts and their verdict in words. */
export interface EndpointProbe {
  host: string;
  ips: string[];
  wan: string | null;
  kind: 'public' | 'private' | 'cgnat' | 'none';
  cloudflare: boolean;
  here: boolean;
  v6_only: boolean;
  status: 'ok' | 'warn' | 'error';
  text: string;
  /** The router's public IPv6 addresses ([]: none; null: not read, the name has no IPv6). */
  router6?: string[] | null;
  /** The name's IPv6 addresses that are not the router's (null while router6 is). */
  foreign6?: string[] | null;
  /** The name has IPv6 and every address is the router's. */
  here6?: boolean;
}

/**
 * One second of the live meter: each server whose tunnel was read, [rx, tx] in bytes/s (rx = from devices, as
 * Server.rate), and each device that moved something (one left out moved nothing; an older agent sends none).
 */
export interface MeterPoint {
  ts: number;
  servers: Record<string, Pair>;
  dev?: Record<string, Pair>;
}

/**
 * The live meter (rpc meter): each call keeps the router sampling for `want`
 * seconds more; the first point comes about 2 s after the first call.
 */
export interface Meter {
  /** Router time. */
  now: number;
  /** Seconds the router keeps sampling after a call. */
  want: number;
  /** Points it keeps: one a second, the last 2 minutes. */
  keep: number;
  /** The newest point's time (0: none yet); it stops moving when the agent does. */
  ts: number;
  /** Oldest first; only those newer than `since` when it was given. */
  points: MeterPoint[];
}

/**
 * A device's own link values for device_update; left out = kept. Numbers go as text: '' = the server's, keep-alive
 * '0' = off. LAN Bypass: its own local network outside the tunnel (the device fetches its configuration again).
 */
export interface DeviceLinkPatch {
  mtu?: string;
  keepalive?: string;
  lan_bypass?: boolean;
}

export interface Backup {
  name: string;
  created: number;
  size: number;
  reason: string;
}

export type AwgSource = 'slava' | 'grey';

export interface UpdateComponent {
  installed?: string | null;
  latest?: string | null;
  update?: boolean;
  /** latest | outdated | dev (installed is newer than the release) | '' (unknown). */
  status?: 'latest' | 'outdated' | 'dev' | '';
  /** When this component was last checked. */
  time?: number;
  url?: string | null;
  published?: string | null;
  note?: string;
  error?: string;
  repo?: string;
  tag?: string;
  packages?: Record<string, string | null>;
  // AmneziaWG: the installed build and both builds for this firmware
  current?: AwgSource | null;
  gen?: '2.0' | '3.1' | null;
  ru?: boolean;
  release?: string;
  sources?: Partial<
    Record<
      AwgSource,
      {
        label: string;
        repo: string;
        tag: string;
        version: string | null;
        gen: '2.0' | '3.1' | null;
        date: string | null;
        newer?: { tag: string; gen: '3.1' };
      }
    >
  >;
  // OpenWrt packages Dawnline uses
  pkgs?: Record<string, { installed: string | null; latest: string | null; with?: string[] }>;
  updates?: number;
}

export interface UpdatesStatus {
  version: string;
  firmware?: { version: string; target: string; arch: string };
  /** The personal portal is on: its HTTPS packages are listed too. */
  portal?: boolean;
  /** A server uses the home-like link. */
  home?: boolean;
  needs?: Needs;
  check: { time: number; components: Record<string, UpdateComponent> } | null;
  job: UpdateJob | null;
  /** Router time, for the job timer. */
  now: number;
  repo: string;
  policy: UpdatePolicy;
  /** Automatic runs: the last check and the last scheduled install day. */
  auto: { check?: number; install_day?: string };
  /** The version kept for Roll back, per component. */
  kept: Record<'app' | 'amneziawg', { version: string; build: AwgSource | null; saved: number | null } | null>;
  /** Components → Activity, newest first. */
  history: UpdateEvent[];
  /** AmneziaWG interfaces (their Dawnline names): switching builds restarts them. */
  tunnels: string[];
  /** The admin's translations installed (luci-i18n-dawnline-<lang>): "ru". */
  translations?: string[];
}

export interface UpdateEvent {
  ts: number;
  /** found: a check found updates; install: an update ran; error: a check or an update failed. */
  kind: 'found' | 'install' | 'error';
  auto?: boolean;
  items?: string[];
  component?: string | null;
  from?: string | null;
  to?: string | null;
  state?: 'done' | 'failed';
  error?: string | null;
  took?: number;
}

export interface UpdateJob {
  id: string;
  action: string;
  component: string | null;
  state: 'running' | 'done' | 'failed';
  started: number;
  finished: number | null;
  /** Started by Settings → Updates, not by a click. */
  auto?: boolean;
  phase: string;
  from: string | null;
  to: string | null;
  log: string[];
  error: string | null;
  result: Record<string, any> | null;
}

/** Settings → Updates. */
export interface UpdatePolicy {
  check: boolean;
  interval: '6h' | '12h' | '1d' | '7d';
  auto: boolean;
  mode: 'immediate' | 'scheduled';
  time: string;
  targets: ('app' | 'amneziawg' | 'packages')[];
  keep: boolean;
  mirrors: boolean;
}

export interface Release {
  tag: string;
  name: string;
  published: string | null;
  prerelease: boolean;
  url: string | null;
  body: string | null;
  assets: string[];
}

/** Missing packages by feature: the portal's HTTPS, ACME certificates, the home-like link, AmneziaWG itself. */
export interface Needs {
  https: string[];
  acme: string[];
  home: string[];
  /** amneziawg-tools and/or kmod-amneziawg (older backends leave it out). */
  awg?: string[];
}

/** The slow part of the portal settings, loaded after the page shows. */
export interface PortalInfo {
  /** Addresses the portal could use, found on the router. */
  candidates: { host: string; kind: 'name' | 'ip'; ips: string[]; here: boolean; cloudflare: boolean; cert: boolean }[];
  /** The portal's checks from Health. */
  checks: HealthCheck[];
}

export interface SettingsData {
  settings: Record<string, string>;
  needs?: Needs;
  effective: Record<string, unknown>;
  services: { id: string; name: string; address: string; ports: string[] }[];
  cert: { path: string; self_signed: boolean; expires: string | null } | null;
  /** TCP ports the portal can't take. */
  tcp_taken: PortHold[];
  wan443_taken?: boolean;
  portal_public_port?: number;
  geo_cached: number;
  logs: LogsInfo;
}

export type LogCategory = 'connections' | 'people' | 'problems';

export interface LogsInfo {
  policy: {
    keep_days: number;
    max: number;
    categories: LogCategory[];
    persist: '10min' | 'hourly' | 'off';
    usage_days: number;
    usage_months: number;
  };
  events: number;
  oldest: number;
  by_category: Record<LogCategory, number>;
  log_ram: number;
  log_flash: number;
  usage_flash: number;
  usage_since: string;
  usage_days: number;
  geo_flash: number;
}

/** The path that makes tunnel clients' internet traffic enter from the LAN. */
interface LikeHome {
  active: boolean;
  dev?: string;
  address?: string;
  dns?: string;
  gateway?: string;
  bridged?: boolean;
  off?: boolean;
  error?: string;
}

type IfaceCategory = 'wan' | 'ethernet' | 'wifi' | 'vpn' | 'other';

export interface NetDevice {
  name: string;
  category: IfaceCategory;
  kind: 'bridge' | IfaceCategory;
  up: boolean;
  master: string | null;
  members: string[];
  nets: string[];
  addrs: string[];
  logical: string | null;
  proto: string | null;
  zone: string | null;
  /** The server's own tunnel interface. */
  own?: boolean;
  /** Part of the server's home network (auto = via Auto-detect LAN). */
  home?: boolean;
  auto?: boolean;
  /** Saved but not present right now. */
  missing?: boolean;
}

export interface InterfacesData {
  server: string;
  /** Packages the home-like link still needs. */
  needs?: string[];
  ifname: string;
  detected: { wan: string | null; lan: string | null };
  saved: { wan: string; lan: string };
  config: {
    auto_wan: boolean;
    wan_device: string;
    auto_lan: boolean;
    lan_devices: string[];
    lan_like: boolean;
    device_mesh: boolean;
    mesh: MeshMode;
  };
  like_home: LikeHome;
  effective: {
    wan: { dev: string | null; zone: string; auto: boolean; missing: boolean };
    home: { dev: string; auto: boolean; nets: string[]; zone: string | null; missing: boolean }[];
    nets: string[];
    zones: string[];
  };
  zones: string[];
  devices: NetDevice[];
  /** People on this server with Home-only access (their AllowedIPs follow the home networks). */
  lan_only: number;
  nets_changed?: boolean;
}

/** "Check access": each rule on the way, in order; it stops at the first that fails. */
export interface AccessCheck {
  ok: boolean;
  steps: { ok: boolean; title: string; detail: string }[];
}

/** A device at home (DHCP lease or static host) and the services it announces over Bonjour. */
export interface HomeHost {
  address: string;
  name: string;
  mac: string;
  services: { type: string; name: string; port: number }[];
}

/** Filters for logs_clear; all empty clears the whole log. */
export interface LogFilter {
  person?: string;
  device?: string;
  category?: string;
  older_days?: string;
}

const logsClearRaw = call<{ removed: number }>('logs_clear', ['person', 'device', 'category', 'older_days']);
const logsClear = (f: LogFilter = {}) => logsClearRaw(f.person ?? '', f.device ?? '', f.category ?? '', f.older_days ?? '');

/** Fields for person_update; send strings ('' clears an optional value). */
export type PersonPatch = Partial<
  Record<'name' | 'access' | 'device_limit' | 'expires' | 'quota_gb' | 'quota_period' | 'bonus_gb' | 'note' | 'dns_mode' | 'server', string>
> & { paused?: boolean; services?: string[]; circle?: string; home_nets?: string[] };

const personUpdateRaw = rpc.declare<any>({
  object: 'dawnline',
  method: 'person_update',
  params: [
    'id',
    'name',
    'access',
    'device_limit',
    'expires',
    'quota_gb',
    'quota_period',
    'bonus_gb',
    'note',
    'dns_mode',
    'paused',
    'services',
    'circle',
    'home_nets',
    'server',
  ],
});

async function personUpdate(id: string, patch: PersonPatch): Promise<{ person: Person }> {
  const keys = ['name', 'access', 'device_limit', 'expires', 'quota_gb', 'quota_period', 'bonus_gb', 'note', 'dns_mode'] as const;
  const args: unknown[] = [id, ...keys.map((k) => patch[k]), patch.paused, patch.services, patch.circle, patch.home_nets, patch.server];
  try {
    return settle(await personUpdateRaw(...args));
  } finally {
    markWritten();
  }
}

/** One person's changes in a people_update list. */
export interface PeopleChange {
  id: string;
  patch: Pick<PersonPatch, 'expires' | 'bonus_gb' | 'quota_gb' | 'device_limit'> & {
    paused?: boolean;
  };
}

/**
 * From the backend's stream (state/stream.ts: the backend reads the router once for every open tab, when
 * something changed). The stream's status holds the longest history a page asks for; one that asked for
 * fewer days gets more. A backend that does not answer yet (it is starting, or was just restarted) is waited
 * for a quarter of a minute; then the page says so, and fills in when it does.
 */
const status = async (_days: number): Promise<Status> => {
  for (let i = 0; i < 6; i++) {
    const st = await streamStatus();
    if (st) return st;
    await new Promise((done) => setTimeout(done, 2500));
  }
  throw new Error(_('Dawnline is starting on the router: this page fills in when it answers.'));
};

const deviceUpdateRaw = call<unknown>('device_update', ['id', 'name', 'disabled', 'mtu', 'keepalive', 'lan_bypass']);
/** Rename, turn off or on, or change how a device connects; what is undefined stays as it is. */
const deviceUpdate = (id: string, name?: string, disabled?: boolean, link: DeviceLinkPatch = {}) =>
  deviceUpdateRaw(id, name, disabled, link.mtu, link.keepalive, link.lan_bypass);

/** One line of the service log: tunnel and service starts, stops, watchdog repairs, errors. */
export interface ServiceLogEntry {
  ts: number;
  src: 'awg' | 'dawnline' | 'portal';
  level: 'info' | 'up' | 'down' | 'repair' | 'error';
  msg: string;
  detail?: string;
  /** Subject shown first: a server's name, "Personal portal", "Dawnline" (older entries have none). */
  who?: string;
  /** The admin's own changes read "You <msg> <kind> <who> · <note>". */
  by?: 'admin';
  kind?: string;
  note?: string;
  /** The server an admin's change was made on (older entries have only its name, in `who`). */
  sid?: string;
}

export interface ServiceLog {
  watchdog: {
    enabled: boolean;
    /** Last watchdog pass and last agent tick (null: never). */
    last: number | null;
    beat: number | null;
    now: number;
    targets: { id: string; name: string; ok: boolean; tries: number }[];
    /** Repairs in the last 24 hours; id is the Health check id. */
    repairs: { ts: number; id: string; name: string }[];
  };
  log: ServiceLogEntry[];
}

export type Health = { checks: HealthCheck[] } & ServiceLog;

export const api = {
  /** The live meter's points newer than `since` (0: all); polled while the Overview shows it. */
  meter: async (since: number): Promise<Meter> =>
    (await streamMeter(since)) ?? { now: Date.now() / 1000, want: 10, keep: 120, ts: since, points: [] },
  personUpdate,
  settingsGet: call<SettingsData>('settings_get'),
  portalInfo: call<PortalInfo>('portal_info'),
  settingsUpdate: call<SettingsData>('settings_update', ['values']),
  serviceSet: call<{ id: string }>('service_set', ['id', 'name', 'address', 'ports']),
  serviceDelete: call<unknown>('service_delete', ['id']),
  geoClear: call<unknown>('geo_clear'),
  /** The newest `limit` events; a person's or a device's only, or only those after `since` (a ts), when given. */
  events: call<{ events: LogEvent[]; total: number; policy: LogsInfo['policy'] }>('events', ['limit', 'person', 'since', 'device']),
  logsClear,
  interfaces: call<InterfacesData>('interfaces', ['id']),
  serverInterfaces: call<InterfacesData>('server_interfaces', [
    'id',
    'auto_wan',
    'wan_device',
    'auto_lan',
    'lan_devices',
    'lan_like',
    'device_mesh',
    'mesh',
  ]),
  circleSet: call<{ id: string; circles: Circle[] }>('circle_set', ['id', 'server', 'name', 'color', 'members']),
  circleDelete: call<{ circles: Circle[] }>('circle_delete', ['id']),
  accessCheck: call<AccessCheck>('access_check', ['from', 'to']),
  homeHosts: call<{ hosts: HomeHost[]; mdns: boolean }>('home_hosts', ['id']),
  usageClear: call<unknown>('usage_clear', ['scope', 'id']),
  uninstall: call<unknown>('uninstall', ['confirm']),
  status,
  setupDefaults: call<SetupDefaults>('setup_defaults'),
  serverCreate: call<{ id: string; network_restart?: boolean }>('server_create', [
    'id',
    'name',
    'ifname',
    'port',
    'subnet',
    'endpoint',
    'mtu',
    'preset',
    'lan_zone',
    'wan_zone',
    'lan_like',
    'portal_enabled',
    'portal_port',
  ]),
  serverObfuscation: call<unknown>('server_obfuscation', ['id', 'preset']),
  serverUpdate: call<unknown>('server_update', ['id', 'values']),
  /** What an existing server's ports and a new tunnel network must avoid (checked as you type). */
  serverPorts: call<{ udp_taken: PortHold[]; tcp_taken: PortHold[]; networks?: Network[] }>('server_ports', ['id']),
  /** Where a public address points, for the live help under the field (debounced by the caller). */
  endpointProbe: call<EndpointProbe>('endpoint_probe', ['host', 'id', 'port']),
  serverDelete: call<unknown>('server_delete', ['id']),
  /** The personal link, its code and every address it works on (main first); not part of the status. */
  personLinks: call<{ code: string; link: string | null; links: string[] }>('person_links', ['id']),
  personCreate: call<{ id: string; link: string | null }>('person_create', [
    'name',
    'slug',
    'server',
    'access',
    'device_limit',
    'expires',
    'quota_gb',
    'quota_period',
  ]),
  personPause: call<unknown>('person_pause', ['id', 'paused']),
  /** Several people at once, all or nothing (one transaction, one apply): People's picks and their undo. */
  peopleUpdate: call<{ changed: number }>('people_update', ['list']) as (list: PeopleChange[]) => Promise<{ changed: number }>,
  /** A new link; `remove` lists devices (ids) to take away with the old one. */
  personRegen: call<{ link: string | null; removed: number }>('person_regen', ['id', 'remove']),
  personDelete: call<unknown>('person_delete', ['id']),
  personUsage: call<{ person: DayUsage[]; devices: Record<string, DayUsage[]> }>('person_usage', ['id', 'days']),
  /** A new device; `lan_bypass` (true) keeps its own local network outside the tunnel. */
  /** `networks`: what stands behind a new router, its own from the start. */
  deviceCreate: call<{ id: string; config: ClientConfig }>('device_create', ['person', 'name', 'kind', 'lan_bypass', 'networks']),
  /** The networks behind a router, all of them at once; the router applies everything (its routes move). */
  deviceNetworks: call<{ networks: string[] }>('device_networks', ['id', 'networks']),
  /**
   * The answer to what a router's owner asked for on their own page: `accept` or `decline` (with a reason they
   * read), for the networks named or for all that is asked; `reopen` puts the question back (the undo of either).
   */
  deviceAnswer: call<unknown>('device_answer', ['id', 'answer', 'reason', 'router', 'networks']),
  /** A device's configuration, to show it; showing marks nothing as given out (that is the portal's fetch, a new device, new keys). */
  deviceConfig: call<ClientConfig>('device_config', ['id']),
  deviceUpdate,
  deviceDelete: call<unknown>('device_delete', ['id']),
  /** New keys: the device is set up again; `kind` and `lan_bypass` (asked again) change with them when given. */
  deviceRotate: call<ClientConfig>('device_rotate', ['id', 'kind', 'lan_bypass']),
  apply: call<unknown>('apply'),
  health: call<Health>('health'),
  healthFix: call<Health>('health_fix', ['id']),
  serviceLog: call<ServiceLog>('service_log'),
  serviceLogClear: call<{ removed: number }>('service_log_clear', ['older_days']),
  backupList: call<{ backups: Backup[] }>('backup_list'),
  backupCreate: call<{ name: string }>('backup_create'),
  backupRestore: call<unknown>('backup_restore', ['name']),
  backupDelete: call<unknown>('backup_delete', ['name']),
  backupRead: call<{ data: string }>('backup_read', ['name']),
  backupUpload: call<unknown>('backup_upload', ['data']),
  exportJson: call<Record<string, unknown>>('export'),
  importJson: call<unknown>('import', ['data']),
  updatesStatus: call<UpdatesStatus>('updates_status'),
  updatesRun: call<{ started: boolean; job: UpdateJob | null }>('updates_run', ['what']),
  updatesReleases: call<{ releases: Release[]; page: number }>('updates_releases', ['page']),
  updatesNotes: call<Release & { repo: string }>('updates_notes', ['component', 'tag', 'build']),
  updatesChanges: call<{ items: string[] }>('updates_changes', ['from', 'to']),
};
