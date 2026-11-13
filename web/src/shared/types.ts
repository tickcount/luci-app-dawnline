// Shapes returned by the luci.dawnline RPC object and the portal API.

export type Access = 'lan' | 'internet' | 'both';
export type Kind = 'computer' | 'phone' | 'tablet' | 'router' | 'other';
type PersonState = 'active' | 'paused' | 'expired' | 'quota' | 'no_server' | 'server_off';
export type Pair = [number, number]; // [rx, tx] from the router's point of view

/**
 * A device's link failing in a named way (the agent's watcher), shown once it
 * held 3 minutes: trying (it knocks, never finishes connecting), shared (one
 * configuration on two devices), dropped (connected, but the router drops
 * what it sends), unstable (the connection keeps breaking).
 */
export type LinkState = 'trying' | 'shared' | 'dropped' | 'unstable';

interface DeviceLink {
  state: LinkState;
  /** When it began (router clock). */
  since: number;
}

/**
 * What a device's link does right now, without that hold, for the set-up
 * sheet: trying (its initiations reach the router, no handshake follows),
 * flowing (online, data came in during this session), nodata (online for
 * 15 s with nothing but handshakes and keepalives in, and the router
 * answering what it dropped: an old address in its configuration).
 */
export type SetupState = 'trying' | 'flowing' | 'nodata';

interface DeviceSetup {
  state: SetupState;
  /** When the watcher first saw it (router clock). */
  since: number;
}

export interface Device {
  id: string;
  name: string;
  kind: Kind;
  address: string;
  disabled: boolean;
  created: number;
  created_by: 'admin' | 'portal';
  online: boolean;
  handshake: number;
  endpoint: string;
  active: boolean;
  /** [rx, tx] of the last 30 days, today included (not the calendar month). */
  month: Pair;
  total: Pair;
  /** Each day's [rx, tx] for the last 7 days, oldest first. */
  spark: Pair[];
  hostname: string;
  browser_key: boolean;
  /** Its configuration changed (networks, DNS, keys...) since it was last shown or downloaded. */
  config_stale: boolean;
  /**
   * When its configuration was last shown or downloaded (router clock); 0: never, or only before the router kept the
   * time (its "stale" mark still works then).
   */
  config_issued: number;
  // How it connects (set by the admin, LAN Bypass also by the person when adding it).
  /** LAN Bypass: its own local network stays outside the tunnel (chosen when it was added). */
  lan_bypass: boolean;
  /** Its own MTU; 0 = the server's (automatic by kind and disguise). */
  mtu: number;
  /** Its own keep-alive in seconds (0 = off); null = the server's. */
  keepalive: number | null;
  /** The MTU and keep-alive its configuration carries now; null without a server. */
  mtu_used: number | null;
  keepalive_used: number | null;
  /** Its link failing in a named way; null when it is not. */
  link: DeviceLink | null;
  /**
   * What its link does right now (the set-up sheet); null for none of these. Without the router's agent a session
   * that lives counts as flowing (nobody tells data from a bare handshake then).
   */
  setup: DeviceSetup | null;
  // A router's networks (site to site) and what its owner asked for about them on their own page.
  /** The networks behind a router, which the tunnel carries both ways; absent: none. */
  behind?: string[];
  /** A router its owner added on their own page that the admin has not taken: it cannot connect yet. */
  waiting?: boolean;
  /** Networks its owner asked for besides the ones it has, not answered yet. */
  ask?: string[];
  /** When that, or the router itself, was asked for (router clock). */
  asked?: number;
  /** Why the admin turned the last of it down; absent: nothing is turned down. */
  declined?: Declined;
  /** The networks that was about; none: the router itself. */
  declined_nets?: string[];
}

/** Why a request was turned down: it shares addresses with a network here, is not needed here, «ask me first», or no reason. */
export type Declined = 'overlap' | 'unneeded' | 'talk' | 'plain';

/** What people may do about a router on their own pages: nothing, ask for one, add one at once. */
export type PortalRouters = 'off' | 'ask' | 'free';
/** And about the networks behind it: ask, or add at once. */
export type PortalNets = 'ask' | 'free';

export interface Person {
  id: string;
  name: string;
  server: string;
  access: Access;
  device_limit: number;
  expires: string;
  quota_gb: number;
  quota_period: 'month' | 'total';
  /** Bytes used in the limit's period: their limit month (quota_month summed), or all time. */
  quota_used: number;
  /** Effective limit in bytes for the current period (incl. the extra data while it lasts), 0 = unlimited. */
  quota_limit: number;
  /**
   * Their limit month: not the calendar's. It begins with their first traffic and ends a month later, to the
   * minute; the next one begins only when they connect again. [rx, tx] counted in the one that runs ([0, 0]: none).
   */
  quota_month: Pair;
  /** When the limit month that runs ends (epoch seconds); 0: none runs (it begins when they next connect). */
  quota_resets: number;
  /** The router's day of that moment ("YYYY-MM-DD"), '' when none runs. */
  quota_reset_day: string;
  /** Extra data on top of the limit until the limit month ends (0: none). */
  bonus_gb: number;
  /** Home-only access: the device keeps its own DNS, or uses home names through the tunnel. */
  dns_mode: 'device' | 'home';
  paused: boolean;
  state: PersonState;
  /** [rx, tx] of the last 30 days, today included (not the calendar month). */
  month: Pair;
  total: Pair;
  online: number;
  last_seen: number;
  devices: Device[];
  /** Each of the last 30 days' [rx, tx], today last; portal only. */
  month_days?: Pair[];
  /** Throughput, one point a minute (last 15): [ts, rx, tx] in bytes/s (rx = from devices); admin only. */
  rate?: [number, number, number][];
  // admin only (the personal link itself comes from person_links, not the status)
  /** A personal link exists (the portal is on); admin only. */
  has_link?: boolean;
  note?: string;
  services?: string[];
  /** Home networks (interfaces) this person reaches; empty = all; admin only. */
  home_nets?: string[];
  /** Circle id on their server (when the server uses circles); admin only. */
  circle?: string;
  created?: number;
  /** When the personal link was last made (0: unknown); admin only. */
  code_set?: number;
}

export type MeshMode = 'off' | 'all' | 'circles';

/** People whose devices reach each other (a server in circles mode). */
export interface Circle {
  id: string;
  server: string;
  name: string;
  /** Index into the circle palette. */
  color: number;
}

export interface Server {
  id: string;
  name: string;
  /** The tunnel core that serves it (see admin/cores); AmneziaWG when absent. */
  core?: string;
  /** Why the tunnel can't run: its interface name is taken by a network section Dawnline didn't make. */
  /** Why the server can't start: a whole sentence from the router, its name in it. */
  blocked?: string | null;
  ifname: string;
  port: number;
  subnet: string;
  endpoint: string;
  public_key: string;
  enabled: boolean;
  /** Internet traffic enters the router from the LAN, like a home device's. */
  lan_like: boolean;
  /** A person's own devices reach each other (mesh is not off). */
  device_mesh: boolean;
  /** Devices of different people: never, everyone with home access, or within a circle. */
  mesh: MeshMode;
  /** What people may do about routers and the networks behind them on their own pages. */
  portal_routers: PortalRouters;
  portal_nets: PortalNets;
  /** Home networks by interface, for the per-person picker. */
  home: { dev: string; nets: string[] }[];
  preset: string;
  /** The MTU set; 0 = automatic, by device type and disguise. */
  mtu: number;
  /** The MTU devices get now: computers and routers, phones and tablets. */
  mtus: { computer: number; phone: number };
  keepalive: number;
  /** DNS servers given to devices; empty = this router. */
  dns: string[];
  /** Daily traffic of the people on this server. */
  series: DayUsage[];
  /** Throughput, one point a minute: [ts, rx, tx] in bytes/s (rx = from devices). */
  rate: [number, number, number][];
  address: string;
  up: boolean;
  uptime: number;
  peers: number;
  /** The newest handshake from a public address that is not the router's own (0: never). */
  reached?: number;
  online: number;
  /** The disguise parameters, without the header protection key: only device configurations carry it. */
  obf: Record<string, string>;
  /** The disguise has a header protection key (AmneziaWG 3.1). */
  hpk: boolean;
}

export interface DayUsage {
  day: string;
  rx: number;
  tx: number;
}

export interface LogEvent {
  ts: number;
  type: string;
  person?: string;
  device?: string;
  server?: string;
  detail?: string;
  /** City · network operator, when known at the time of the event. */
  where?: string | null;
  /** Who did it, when a person did: the admin in LuCI or the person on their portal. */
  by?: 'admin' | 'portal';
  /** Names at the time of the event, for people and devices removed since. */
  pname?: string;
  dname?: string;
  dkind?: string;
  /** Addresses in `detail` that belong to devices at home, with their DHCP names. */
  hosts?: Record<string, string>;
}

export interface GeoPoint {
  person: string;
  device: string;
  ip: string;
  ts: number;
  online: boolean;
  lat: number;
  lon: number;
  city: string;
  country: string;
  cc: string;
  /** Network operator (from the geolocation service); 0 / '' when unknown. */
  asn: number;
  org: string;
}

export interface Geo {
  enabled: boolean;
  provider?: string;
  cached?: number;
  home: { lat: number; lon: number; city: string; country: string; cc: string; asn?: number; org?: string } | null;
  points: GeoPoint[];
}

export interface AwgCaps {
  v2: boolean;
  v3: boolean;
  /** Generations of the tools and the kernel module ('1.0' | '2.0' | '3.1'; null unknown). */
  tools?: string | null;
  kmod?: string | null;
  /** The two differ: a feature counts only when both have it. */
  mismatch?: boolean;
  /** An installed kernel module waits for a reboot (kmod is the one that runs until then). */
  pending?: boolean;
}

/** Whether AmneziaWG can run here: tools and kernel module installed, the module loaded, netifd's proto handler present. */
export interface AwgState {
  tools: boolean;
  kmod: boolean;
  loaded: boolean;
  handler: boolean;
  /** Packages still to install (amneziawg-tools, kmod-amneziawg). */
  missing: string[];
  ok: boolean;
}

export interface Status {
  geo: Geo;
  version: string;
  now: number;
  /** The router's offset from UTC in minutes: days and times are drawn in its time. Absent from older backends. */
  tz?: number;
  hostname: string;
  settings: {
    portal_enabled: boolean;
    portal_port: number;
    /** The port in personal links (the portal's own). */
    portal_public_port?: number;
    portal_host: string;
    default_device_limit: number;
    domain: string;
    hostnames: boolean;
    geo_enabled: boolean;
    home_dns_fallback: string;
  };
  servers: Server[];
  people: Person[];
  services: { id: string; name: string; address: string; ports: string[] }[];
  circles: Circle[];
  /** `month`: the last 30 days, today included. */
  totals: { people: number; devices: number; online: number; active: number; today: Pair; month: Pair };
  series: DayUsage[];
  /** Today's traffic of every device by the router's hour, midnight to now ([rx, tx]); absent from older backends. */
  hours?: Pair[];
  events: LogEvent[];
  /** What the installed AmneziaWG supports: v2 (1.5/2.0 parameters), v3 (3.1). */
  awg: AwgCaps;
  /** Absent from routers that run an older backend: treat as fine. */
  awg_state?: AwgState;
  /** The router's public IPv4 (null when none or private). */
  wan?: string | null;
  like_home: { active: boolean; dev?: string; address?: string; bridged?: boolean; off?: boolean; error?: string };
}

interface AmneziaFields {
  host: string;
  port: number;
  mtu: string;
  dns: string[];
  allowed_ips: string[];
  client_ip: string;
  client_priv_key: string;
  client_pub_key: string;
  psk_key: string;
  server_pub_key: string;
  persistent_keep_alive: string;
  obfuscation: Record<string, string>;
  /** The server's address as an IP, from the portal (null: the name does not resolve; older routers leave it out). */
  host_ip?: string | null;
}

export interface AwgConfig {
  name: string;
  person: string;
  server: string;
  filename: string;
  conf: string;
  has_private_key: boolean;
  amnezia: AmneziaFields;
}

export type ClientConfig = AwgConfig;

export interface HealthCheck {
  id: string;
  title: string;
  status: 'ok' | 'warn' | 'error' | 'skip';
  detail: string;
  fix: string | null;
  /** A failed check in words ("Clock isn't set"), for notices; null when it passed. */
  problem?: string | null;
}
