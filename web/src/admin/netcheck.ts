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
