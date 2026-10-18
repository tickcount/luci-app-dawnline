// A new server's UDP port and device addresses, checked as the router checks
// them (rpc/servers.uc) and said in plain words for the setup wizard. The
// addresses are three numbers ("10.77.0"): the tunnel is that /24.

/** A network on the router, by name: an interface ("lan") or a server ("Home"). */
export interface Network {
  name: string;
  cidr: string;
}

/** UDP ports someone holds: a single port has from == to. */
export interface PortHold {
  from: number;
  to: number;
  who: string;
}

/** A help line under a field: what it means, or what is wrong (`bad`). */
export interface Help {
  text: string;
  bad: boolean;
}

interface Cidr {
  net: number;
  size: number;
}

/** "10.77.0.0/24" as its network and size, prefix 8-30 like util.uc's parse_cidr; null if not one. */
export function parseCidr(s: string): Cidr | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const [a, b, c, d] = m.slice(1, 5).map(Number);
  const prefix = Number(m[5]);
  if ([a, b, c, d].some((x) => x > 255) || prefix < 8 || prefix > 30) return null;
  const ip = a * 2 ** 24 + b * 2 ** 16 + c * 2 ** 8 + d;
  const size = 2 ** (32 - prefix);
  return { net: ip - (ip % size), size };
}

const overlaps = (x: Cidr, y: Cidr): boolean => x.net < y.net + y.size && y.net < x.net + x.size;

const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].map((c) => parseCidr(c) as Cidr);

/** The first three numbers of a subnet ("10.77.0.0/24" → "10.77.0"). */
export function rangeOf(subnet: string): string {
  return subnet.split('/')[0].split('.').slice(0, 3).join('.');
}

/** The tunnel subnet of a range ("10.77.0" → "10.77.0.0/24"). */
export function subnetOf(range: string): string {
  return `${range.trim()}.0/24`;
}

/** The device addresses: what they give, or why not (`suggest` is a free range to offer). */
export function rangeHelp(range: string, nets: Network[], suggest: string): Help {
  const r = range.trim();
  const c = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(r) ? parseCidr(subnetOf(r)) : null;
  if (!c) return { text: 'Three numbers, like 10.77.0.', bad: true };
  if (!PRIVATE.some((p) => c.net >= p.net && c.net + c.size <= p.net + p.size))
    return { text: 'Use a private range: 10.x.x, 172.16–31.x or 192.168.x.', bad: true };
  const hit = nets.find((n) => {
    const o = parseCidr(n.cidr);
    return o != null && overlaps(c, o);
  });
  if (hit) {
    const used = hit.cidr.endsWith('/24') ? `${rangeOf(hit.cidr)}.x` : hit.cidr;
    const other = suggest && suggest !== r ? ` Try ${suggest}.` : '';
    return { text: `${hit.name} already uses ${used}.${other}`, bad: true };
  }
  return { text: `Devices get ${r}.2 – ${r}.254, the router ${r}.1.`, bad: false };
}

const holder = (port: number, taken: PortHold[]): string | null => taken.find((t) => t.from <= port && port <= t.to)?.who ?? null;

const validPort = (port: number): boolean => Number.isInteger(port) && port >= 1 && port <= 65535;

/** A port: `free` when nobody holds it, or who does. */
export function portHelp(port: number, taken: PortHold[], free: string): Help {
  if (!validPort(port)) return { text: 'Use a port from 1 to 65535.', bad: true };
  const who = holder(port, taken);
  return who ? { text: `Used by ${who}. Choose another port.`, bad: true } : { text: free, bad: false };
}

/** The portal's TCP port; links on IP addresses (`ipLinks`) use plain HTTP on the next one too. */
export function portalPortHelp(port: number, taken: PortHold[], ipLinks: boolean): Help {
  const free = ipLinks ? `HTTPS here, plain HTTP for links on IP addresses on ${port + 1}.` : 'HTTPS on this port, opened on WAN.';
  const h = portHelp(port, taken, free);
  if (h.bad || !ipLinks) return h;
  if (port === 65535) return { text: 'Links on IP addresses also need the next port: choose a lower one.', bad: true };
  const who = holder(port + 1, taken);
  return who ? { text: `Links on IP addresses also need ${port + 1}, used by ${who}. Choose another port.`, bad: true } : h;
}

/* ---------- other fields, mirroring the router's rules (dawnline.util, schema, core) ---------- */

/** Characters, not UTF-16 units or bytes: what the router counts (util.ulength). */
export const chars = (s: string): number => Array.from(s).length;

const NAME_MAX = 48;
const BAD_NAME = /[<>"\\\u0000-\u001f\u007f]/;

/**
 * A name people see (util.valid_name): 1–48 characters, none of < > " \.
 * `taken` are names already used where it must be unique (case-insensitive).
 */
export function nameHelp(s: string, taken: string[] = [], good = ''): Help {
  const t = s.trim();
  if (!t) return { text: 'Enter a name.', bad: true };
  if (chars(s) > NAME_MAX) return { text: `Up to ${NAME_MAX} characters (${chars(s)} now).`, bad: true };
  if (BAD_NAME.test(s)) return { text: 'Names can’t contain < > " or \\.', bad: true };
  if (taken.some((x) => x.toLowerCase() === t.toLowerCase())) return { text: `“${t}” already exists — pick another name.`, bad: true };
  return { text: good, bad: false };
}

/** A circle's name: like a name, up to 32 characters. */
export function circleNameHelp(s: string, taken: string[] = []): Help {
  if (chars(s) > 32) return { text: `Up to 32 characters (${chars(s)} now).`, bad: true };
  return nameHelp(s, taken, 'Shown on the person cards.');
}

const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isIpv4(s: string): boolean {
  const m = IPV4.exec(s);
  return !!m && m.slice(1).every((x) => Number(x) <= 255);
}

export function isIpv6(s: string): boolean {
  return /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(s) && !/:::/.test(s);
}

/**
 * The public address of a server or the portal (util.valid_host): a hostname
 * or an IP address, nothing else. `port` names what devices connect to when
 * it is fine; `empty` is what an empty field means (null: it is required).
 */
export function hostHelp(s: string, port?: number, empty: string | null = null): Help {
  const t = s.trim();
  if (!t) return empty != null ? { text: empty, bad: false } : { text: 'Enter a hostname or IP address.', bad: true };
  if (/^[a-z]+:\/\//i.test(t)) return { text: 'Leave out https:// — just the name.', bad: true };
  if (/\/.*/.test(t)) return { text: 'Just the name, without a path.', bad: true };
  if (/^[^:\[]+:\d+$/.test(t)) return { text: 'Just the name, without a port (the port is on AmneziaWG).', bad: true };
  if (/\s/.test(t)) return { text: 'A hostname has no spaces.', bad: true };
  if (t.length > 253 || !(HOSTNAME.test(t) || isIpv4(t) || isIpv6(t))) return { text: 'Use a hostname or an IP address.', bad: true };
  const shown = isIpv6(t) ? `[${t}]` : t;
  return { text: port ? `Devices connect to ${shown}:${port}.` : `Links use ${shown}.`, bad: false };
}

/** The DNS list a server hands to devices (rpc/servers.uc dns_list): IPs, comma-separated; empty = this router. */
export function dnsHelp(s: string, routerAddr: string): Help {
  const items = s.split(/[ ,]+/).filter(Boolean);
  if (!items.length)
    return { text: `This router (${routerAddr}): queries go where your home network sends them, and home names work.`, bad: false };
  const bad = items.find((x) => !isIpv4(x) && !isIpv6(x));
  if (bad) return { text: `“${bad}” is not an IP address. Separate several with commas.`, bad: true };
  return { text: `Devices use ${items.join(' and ')} — home names and your LAN’s DNS filters no longer apply to them.`, bad: false };
}

/** MTU (rpc/servers.uc check_mtu): empty = automatic, else 1280–1500. */
export function mtuHelp(s: string, mtus: { computer: number; phone: number }): Help {
  const t = s.trim();
  if (!t)
    return {
      text: `Automatic by device type and disguise: ${mtus.computer} for computers and routers, ${mtus.phone} for phones and tablets.`,
      bad: false,
    };
  if (!/^\d{1,4}$/.test(t) || Number(t) < 1280 || Number(t) > 1500)
    return { text: 'MTU must be 1280–1500, or empty for automatic.', bad: true };
  const n = Number(t);
  return { text: `Computers and routers get ${n}, phones and tablets ${Math.min(n, 1280)}.`, bad: false };
}

/** Keep-alive (rpc/servers.uc): 0–600 s; empty = 25. */
export function keepaliveHelp(s: string): Help {
  const t = s.trim();
  if (!t) return { text: 'Default: a packet every 25 s keeps NAT open and “Connected” accurate.', bad: false };
  if (!/^\d{1,3}$/.test(t) || Number(t) > 600) return { text: 'Use 0–600 seconds.', bad: true };
  if (Number(t) === 0) return { text: 'Off: NAT may close the tunnel when idle, and “Connected” lags.', bad: false };
  return { text: `Devices send a packet every ${t} s to keep NAT open (a little battery on phones).`, bad: false };
}

/** Device limit (core.create_person): 1–32; `have` is how many they have now (an edit). */
export function limitHelp(s: string, have = 0): Help {
  const t = s.trim();
  if (!/^\d{1,2}$/.test(t) || Number(t) < 1 || Number(t) > 32) return { text: 'Use 1–32.', bad: true };
  const n = Number(t);
  if (have > n)
    return { text: `Already has ${have} devices: remove ${have - n === 1 ? 'one' : `${have - n}`} first, or allow more.`, bad: true };
  return { text: `They can add ${n} device${n === 1 ? '' : 's'} themselves.`, bad: false };
}

/** Monthly data in GB (core.create_person): empty = unlimited, else 0–100000. */
export function quotaHelp(s: string, monthly = true): Help {
  const t = s.trim();
  if (!t) return { text: 'Optional. No data limit.', bad: false };
  const n = Number(t);
  if (!/^\d+(\.\d+)?$/.test(t) || n < 0 || n > 100000) return { text: 'A number of GB, up to 100000.', bad: true };
  if (n === 0) return { text: 'Optional. No data limit.', bad: false };
  return { text: monthly ? `Paused after ${t} GB this month, resumed on the 1st.` : `Paused after ${t} GB in total.`, bad: false };
}

/** An end date (YYYY-MM-DD) against the router's day; empty = none. */
export function expiresHelp(
  s: string,
  today: string,
  daysLeft: (d: string, t: string) => number | null,
  date: (d: string) => string,
): Help {
  const t = s.trim();
  if (!t) return { text: 'Optional. No end date.', bad: false };
  const left = daysLeft(t, today);
  if (left == null) return { text: 'Use a date.', bad: true };
  if (left < 0) return { text: 'That date has passed: access would end at once.', bad: true };
  return { text: left === 1 ? `Access ends today (${date(t)}).` : `Access ends in ${left} days (${date(t)}).`, bad: false };
}

/** A home service's address (rpc/home.uc): IPv4; `homeNets` warn when it is outside every home network. */
export function ipv4Help(s: string, inHome: ((ip: string) => boolean) | null = null): Help {
  const t = s.trim();
  if (!t) return { text: 'The device’s address at home.', bad: true };
  if (!isIpv4(t)) return { text: 'Use an IPv4 address, like 192.168.1.10.', bad: true };
  if (inHome && !inHome(t)) return { text: `${t} is not in any home network of this server: nobody would reach it.`, bad: false };
  return { text: '', bad: false };
}

/** A service's ports: empty = all, else numbers 1–65535. */
export function portsHelp(s: string): Help {
  const items = s.split(/[ ,]+/).filter(Boolean);
  if (!items.length) return { text: 'All ports.', bad: false };
  const bad = items.find((x) => !/^\d{1,5}$/.test(x) || Number(x) < 1 || Number(x) > 65535);
  if (bad) return { text: `“${bad}” is not a port (1–65535).`, bad: true };
  return { text: `Port${items.length === 1 ? '' : 's'} ${items.join(', ')}.`, bad: false };
}

/** The portal's redirect for unknown links (schema portal_redirect): a full http(s) URL, or empty. */
export function urlHelp(s: string): Help {
  const t = s.trim();
  if (!t) return { text: 'Wrong links get a bare “Not found”.', bad: false };
  if (!/^https?:\/\//i.test(t)) return { text: 'Must start with http:// or https://.', bad: true };
  if (t.length > 300 || !/^https?:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[^\s"'<>]*)?$/.test(t))
    return { text: 'Not a usable address (no spaces or quotes).', bad: true };
  return { text: 'Wrong links are sent there instead of a “Not found”.', bad: false };
}

/** The portal's title: up to 64 characters on one line. */
export function titleHelp(s: string): Help {
  if (chars(s) > 64) return { text: `Up to 64 characters (${chars(s)} now).`, bad: true };
  if (/[\u0000-\u001f\u007f]/.test(s)) return { text: 'One line, please.', bad: true };
  return { text: 'Shown in the browser tab and at the top of the portal.', bad: false };
}

/** The home domain for device hostnames (schema domain): lowercase letters, digits, dashes, dots. */
export function domainHelp(s: string, example = 'phone.myata'): Help {
  const t = s.trim();
  // Empty keeps the default (the router stores nothing then).
  if (!t) return { text: `The default, lan: devices get names like ${example}.lan.`, bad: false };
  if (!/^[a-z0-9-]{1,32}(\.[a-z0-9-]{1,32})*$/.test(t))
    return { text: /[A-Z]/.test(t) ? 'Lowercase only.' : 'Lowercase letters, digits, dashes and dots.', bad: true };
  return { text: `Devices get names like ${example}.${t}.`, bad: false };
}

/** The fallback DNS for home-names devices: an IPv4 address, or empty for none. */
export function fallbackDnsHelp(s: string): Help {
  const t = s.trim();
  if (!t) return { text: 'None: without the tunnel those devices have no DNS.', bad: false };
  if (!isIpv4(t)) return { text: 'Use an IPv4 address, or leave it empty.', bad: true };
  return { text: `${t} takes over when the tunnel is down.`, bad: false };
}

/** The daily update time (schema update_time): HH:MM. */
export function timeHelp(s: string): Help {
  const t = s.trim();
  if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(t)) return { text: 'Use HH:MM, 00:00–23:59.', bad: true };
  return { text: `Runs within an hour after ${t} (router time).`, bad: false };
}

/**
 * A public address checked on the router as it is typed (rpc endpoint_probe:
 * where it points, CGNAT, Cloudflare), debounced so a keystroke is not a
 * lookup. `help()` is the row's: the syntax first (hostHelp), then the
 * router's verdict once it arrives, "Checking…" in between.
 */
export function endpointProbe(
  get: () => { host: string; port: number; id?: string },
  probe: (host: string, id: string | undefined, port: number) => Promise<{ text: string; status?: string }>,
  onResult: () => void,
  opts: { empty?: string | null; idle?: () => string } = {},
) {
  let timer = 0;
  let asked = '';
  let result: { host: string; text: string; bad: boolean } | null = null;
  const schedule = () => {
    const { host } = get();
    const h = hostHelp(host, get().port, opts.empty ?? null);
    if (h.bad || !host.trim() || host.trim() === result?.host) return;
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const want = host.trim();
      asked = want;
      try {
        const { id, port } = get();
        const r = await probe(want, id, port);
        if (asked !== want) return;
        result = { host: want, text: r.text, bad: r.status === 'error' };
      } catch {
        if (asked !== want) return;
        result = { host: want, text: h.text, bad: false };
      }
      onResult();
    }, 700);
  };
  const help = (): Help => {
    const { host, port } = get();
    const h = hostHelp(host, port, opts.empty ?? null);
    if (h.bad || !host.trim()) return h;
    if (result && result.host === host.trim()) return { text: result.text, bad: result.bad };
    const idle = opts.idle?.();
    return { text: idle ? `${idle} Checking where it points…` : `${h.text} Checking where it points…`, bad: false };
  };
  return { help, schedule };
}
