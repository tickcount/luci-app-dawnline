// Shapes returned by the luci.dawnline RPC object and the portal API.

export type Access = 'lan' | 'internet' | 'both';
export type Kind = 'computer' | 'phone' | 'tablet' | 'router' | 'other';
export type PersonState = 'active' | 'paused' | 'paused_all' | 'expired' | 'quota' | 'hours' | 'no_server';
export type Pair = [number, number]; // [rx, tx] from the router's point of view

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
  month: Pair;
  total: Pair;
  /** Daily totals (rx+tx) for the last 7 days, oldest first. */
  spark: number[];
  hostname: string;
  browser_key: boolean;
  /** Its configuration changed (networks, DNS, keys...) since it was last shown or downloaded. */
  config_stale: boolean;
}

export interface Person {
  id: string;
  name: string;
  server: string;
  access: Access;
  device_limit: number;
  expires: string;
  quota_gb: number;
  quota_period: 'month' | 'total';
  quota_used: number;
  /** Effective limit in bytes for the current period (incl. this month's extra), 0 = unlimited. */
  quota_limit: number;
  bonus_gb: number;
  expire_action: 'pause' | 'notify' | 'remove';
  expire_warn: number;
  /** Home-only access: the device keeps its own DNS, or uses home names through the tunnel. */
  dns_mode: 'device' | 'home';
  paused: boolean;
  hours: string;
  state: PersonState;
  month: Pair;
  total: Pair;
  online: number;
  last_seen: number;
  devices: Device[];
  /** Throughput, one point a minute (last 15): [ts, rx, tx] in bytes/s (rx = from devices); admin only. */
  rate?: [number, number, number][];
  // admin only
  code?: string;
  link?: string | null;
  /** Every link to the same portal (main first), one per address; admin only. */
  links?: string[];
  note?: string;
  services?: string[];
  created?: number;
}

export interface Server {
  id: string;
  name: string;
  ifname: string;
  port: number;
  subnet: string;
  endpoint: string;
  public_key: string;
  enabled: boolean;
  /** Internet traffic enters the router from the LAN, like a home device's. */
  lan_like: boolean;
  /** Devices of people with home access reach each other through the tunnel. */
  device_mesh: boolean;
  preset: string;
  mtu: number;
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
  online: number;
  obf: Record<string, string>;
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
}

export interface Status {
  geo: Geo;
  version: string;
  now: number;
  hostname: string;
  settings: {
    portal_enabled: boolean;
    portal_port: number;
    /** The port in personal links (443 when the portal also answers there). */
    portal_public_port?: number;
    portal_443?: boolean;
    portal_host: string;
    paused_all: boolean;
    default_device_limit: number;
    domain: string;
    hostnames: boolean;
    geo_enabled: boolean;
    home_dns_fallback: string;
  };
  servers: Server[];
  people: Person[];
  services: { id: string; name: string; address: string; ports: string[] }[];
  totals: { people: number; devices: number; online: number; active: number; today: Pair; month: Pair };
  series: DayUsage[];
  events: LogEvent[];
  /** What the installed AmneziaWG supports: v2 (1.5/2.0 parameters), v3 (3.1). */
  awg: AwgCaps;
  like_home: { active: boolean; dev?: string; address?: string; bridged?: boolean; off?: boolean; error?: string };
}

export interface AmneziaFields {
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
}

export interface ClientConfig {
  name: string;
  person: string;
  server: string;
  filename: string;
  conf: string;
  has_private_key: boolean;
  amnezia: AmneziaFields;
}

export interface HealthCheck {
  id: string;
  title: string;
  status: 'ok' | 'warn' | 'error' | 'skip';
  detail: string;
  fix: string | null;
}
