// luci.dawnline RPC bindings. The backend reports failures as { error }, and
// a change the router saved but could not fully put into effect (access rules
// that did not load, a server that refused its devices) as { warning }.

import type { Network, PortHold } from './netcheck';
import type { AwgCaps, AwgState, Circle, ClientConfig, DayUsage, HealthCheck, LogEvent, MeshMode, Person, Status } from '../shared/types';
import { notify } from './ui/toast';

/** Throw a backend failure; show a warning the answer carries. */
function settle<T>(r: any): T {
  if (r && typeof r === 'object') {
    if (typeof r.error === 'string') throw new Error(r.error);
    if (typeof r.warning === 'string' && r.warning) notify(r.warning, 'warning', 12000);
  }
  return r as T;
}

function call<T>(method: string, params: string[] = []) {
  const fn = rpc.declare<any>({ object: 'luci.dawnline', method, params });
  return async (...args: unknown[]): Promise<T> => settle<T>(await fn(...args));
}

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
export interface LikeHome {
  active: boolean;
  dev?: string;
  address?: string;
  dns?: string;
  gateway?: string;
  bridged?: boolean;
  off?: boolean;
  error?: string;
}

export type IfaceCategory = 'wan' | 'ethernet' | 'wifi' | 'vpn' | 'other';

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
  Record<
    | 'name'
    | 'access'
    | 'device_limit'
    | 'expires'
    | 'expire_action'
    | 'expire_warn'
    | 'quota_gb'
    | 'quota_period'
    | 'bonus_gb'
    | 'hours'
    | 'note'
    | 'dns_mode'
    | 'server',
    string
  >
> & { paused?: boolean; services?: string[]; circle?: string; home_nets?: string[] };

const personUpdateRaw = rpc.declare<any>({
  object: 'luci.dawnline',
  method: 'person_update',
  params: [
    'id',
    'name',
    'access',
    'device_limit',
    'expires',
    'expire_action',
    'expire_warn',
    'quota_gb',
    'quota_period',
    'bonus_gb',
    'hours',
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
  const keys = [
    'name',
    'access',
    'device_limit',
    'expires',
    'expire_action',
    'expire_warn',
    'quota_gb',
    'quota_period',
    'bonus_gb',
    'hours',
    'note',
    'dns_mode',
  ] as const;
  const args: unknown[] = [id, ...keys.map((k) => patch[k]), patch.paused, patch.services, patch.circle, patch.home_nets, patch.server];
  return settle(await personUpdateRaw(...args));
}

const status = call<Status>('status', ['days']);

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
  rev: call<{ rev: number; version?: string }>('rev'),
  personUpdate,
  settingsGet: call<SettingsData>('settings_get'),
  portalInfo: call<PortalInfo>('portal_info'),
  settingsUpdate: call<SettingsData>('settings_update', ['values']),
  serviceSet: call<{ id: string }>('service_set', ['id', 'name', 'address', 'ports']),
  serviceDelete: call<unknown>('service_delete', ['id']),
  geoClear: call<unknown>('geo_clear'),
  /** The newest `limit` events; a person's only, or only those after `since` (a ts), when given. */
  events: call<{ events: LogEvent[]; total: number; policy: LogsInfo['policy'] }>('events', ['limit', 'person', 'since']),
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
  /** A new link; `remove` lists devices (ids) to take away with the old one. */
  personRegen: call<{ link: string | null; removed: number }>('person_regen', ['id', 'remove']),
  personDelete: call<unknown>('person_delete', ['id']),
  personUsage: call<{ person: DayUsage[]; devices: Record<string, DayUsage[]> }>('person_usage', ['id', 'days']),
  deviceCreate: call<{ id: string; config: ClientConfig }>('device_create', ['person', 'name', 'kind']),
  deviceConfig: call<ClientConfig>('device_config', ['id']),
  deviceUpdate: call<unknown>('device_update', ['id', 'name', 'disabled']),
  deviceDelete: call<unknown>('device_delete', ['id']),
  deviceRotate: call<ClientConfig>('device_rotate', ['id']),
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
