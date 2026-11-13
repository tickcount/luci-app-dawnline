// The networks behind people's routers (site to site), as the pages work with them: what a router has and what its
// owner asked for, which routers a server has, what a typed network must not share addresses with and why one is
// refused before the router is asked (shared/nets.ts), and which devices fetch their configuration again when a router's networks change
// (model.BehindReach). Pure: no DOM.

import type { Device, Person, Server } from '../../shared/types';
import { fmt } from '../../shared/i18n';
import type { Taken } from '../../shared/nets';
import { homeAccess } from './reach';
import { issued } from './rollout';

/** The networks a router has (none for anything else). */
export const netsOf = (d: Device): string[] => (d.kind === 'router' ? (d.behind ?? []) : []);

/** The router itself is asked for: its owner added it on their own page, and the admin has not answered. */
export const routerAsks = (d: Device): boolean => d.kind === 'router' && !!d.waiting && !d.declined;

/** A router asked for and turned down: it stays on its owner's page, for them to read why and remove. */
export const routerDeclined = (d: Device): boolean => d.kind === 'router' && !!d.waiting && !!d.declined;

/** The networks asked for behind a router that is a device already, not answered yet. */
export const asksOf = (d: Device): string[] =>
  d.kind === 'router' && !d.waiting ? (d.ask ?? []).filter((n) => !netsOf(d).includes(n)) : [];

/** The networks its owner named with a router that is asked for: taken with it. */
export const wishOf = (d: Device): string[] => (routerAsks(d) ? (d.ask ?? []) : []);

/** A device asks for something that is not answered yet: itself (a router), or a network behind it. */
export const asksNow = (d: Device): boolean => routerAsks(d) || asksOf(d).length > 0;

/** The routers among a server's people's devices, each with its person; those asked for and turned down are left out. */
export const routersOf = (people: Person[], srv: string): { p: Person; d: Device }[] =>
  people
    .filter((p) => p.server === srv)
    .flatMap((p) => p.devices.filter((d) => d.kind === 'router' && !routerDeclined(d)).map((d) => ({ p, d })));

/** How many of a server's devices ask for something. */
export const askCount = (people: Person[], srv: string): number =>
  people.filter((p) => p.server === srv).reduce((n, p) => n + p.devices.filter(asksNow).length, 0);

/**
 * Everything a network behind `d` must not share addresses with: every tunnel's network, the router's own networks
 * (`own`: each interface's, by its name) and what stands behind other devices (`nets`: a device's list as the page
 * has it now, a staged one included).
 */
export function takenFor(
  servers: Pick<Server, 'name' | 'subnet'>[],
  own: { name: string; nets: string[] }[],
  people: Person[],
  d: Pick<Device, 'id'>,
  nets: (o: Device) => string[] = netsOf,
): Taken[] {
  const out: Taken[] = [];
  for (const s of servers) if (s.subnet) out.push({ cidr: s.subnet, who: fmt(_('the tunnel network of %s'), s.name) });
  for (const x of own) for (const n of x.nets) out.push({ cidr: n, who: fmt(_('this router’s %s'), x.name) });
  for (const p of people)
    for (const o of p.devices)
      if (o.id !== d.id) for (const n of nets(o)) out.push({ cidr: n, who: fmt(_('the network behind %s'), o.name) });
  return out;
}

/** Whom a person's devices reach where the server keeps devices within circles: their circle, else their own. */
const group = (p: Person): string => (p.circle ? `c:${p.circle}` : `p:${p.id}`);

/**
 * The devices whose configuration names what is behind `router` (they fetch it again when its networks change):
 * those that reach it (everyone's on the server, or its circle's; nobody's while devices are kept apart), of people
 * who are part of home, that send only some networks into the tunnel (Home only, or both with LAN Bypass). The
 * router itself is never told its own networks.
 */
export function reachers(
  people: Person[],
  srv: Pick<Server, 'id' | 'mesh'>,
  owner: Person,
  router: Pick<Device, 'id'>,
): { p: Person; d: Device }[] {
  if (srv.mesh === 'off' || !homeAccess(owner)) return [];
  return people
    .filter((p) => p.server === srv.id && homeAccess(p) && (srv.mesh !== 'circles' || group(p) === group(owner)))
    .flatMap((p) =>
      p.devices
        .filter((d) => d.id !== router.id && !d.disabled && !d.waiting && (p.access === 'lan' || d.lan_bypass))
        .map((d) => ({ p, d })),
    );
}

/** ⟳N for a change of these routers' networks: the devices that hold a configuration and fetch it again, each once. */
export function behindRefetch(people: Person[], srv: Pick<Server, 'id' | 'mesh'>, routers: { p: Person; d: Pick<Device, 'id'> }[]): number {
  const ids = new Set<string>();
  for (const r of routers) for (const x of reachers(people, srv, r.p, r.d)) if (issued(x.d)) ids.add(x.d.id);
  return ids.size;
}
