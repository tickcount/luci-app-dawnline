// A network typed to stand behind a router (site to site), checked where it is typed, on the admin's pages and on a
// person's own: what one is, how it is kept, and why one is refused before the router is asked. The router decides
// (backend/model/behind.go has the rule, and its answer names whose a network is); this is the same rule said at
// once, as far as the page knows. Pure: no DOM.

import { fmt, plural } from './i18n';

interface Cidr {
  net: number;
  size: number;
}

/** "192.168.2.0/24" as its first address and size, a prefix 8 to 30 written out; null if it is not one. */
function parseCidr(s: string): Cidr | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const [a, b, c, d] = m.slice(1, 5).map(Number);
  const prefix = Number(m[5]);
  if ([a, b, c, d].some((x) => x > 255) || prefix < 8 || prefix > 30) return null;
  const ip = a * 2 ** 24 + b * 2 ** 16 + c * 2 ** 8 + d;
  const size = 2 ** (32 - prefix);
  return { net: ip - (ip % size), size };
}

/** How many networks one router may have behind it. */
export const BEHIND_MOST = 8;

/** A network something already has, with whose it is in the reader's words. */
export interface Taken {
  cidr: string;
  who: string;
}

const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
const over = (a: string, b: string): boolean => {
  const x = parseCidr(a);
  const y = parseCidr(b);
  return !!x && !!y && x.net < y.net + y.size && y.net < x.net + x.size;
};
const inside = (a: string, b: string): boolean => {
  const x = parseCidr(a);
  const y = parseCidr(b);
  return !!x && !!y && x.net >= y.net && x.net + x.size <= y.net + y.size;
};

/** A network as the router keeps it: its first address and prefix («192.168.2.7/24» is «192.168.2.0/24»). */
export function normNet(v: string): string {
  const c = parseCidr(v);
  if (!c) return v.trim();
  return `${[24, 16, 8, 0].map((sh) => Math.floor(c.net / 2 ** sh) % 256).join('.')}/${32 - Math.log2(c.size)}`;
}

/** Why a network cannot stand behind a router, or null: no private network of a site's size, or one something has. */
export function netRefusal(n: string, taken: Taken[]): string | null {
  const c = parseCidr(n);
  if (!c) return fmt(_('“%s” is not a network like 192.168.2.0/24.'), n);
  if (!PRIVATE.some((p) => inside(n, p))) return fmt(_('%s is not a private network (10.x, 172.16–31.x, 192.168.x).'), n);
  // one site's own network, never a whole private range
  if (c.size > 2 ** 16) return fmt(_('%s is too wide: /16 at the most.'), n);
  const hit = taken.find((t) => over(n, t.cidr));
  return hit ? fmt(_('%s is taken: it is %s. The two ends need different ranges.'), hit.cidr, hit.who) : null;
}

/** Why a list is refused as a whole: more than a router may have. */
export const tooMany = (count: number): string | null =>
  count > BEHIND_MOST
    ? plural(BEHIND_MOST, '%s network behind one router at the most.', '%s networks behind one router at the most.')
    : null;
