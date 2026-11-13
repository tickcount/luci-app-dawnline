// Who reaches what on a server, from its rules (core.uc and nft.uc): for each
// kind of access, how many people have it, how their internet goes, what of
// home they reach, the router, and each other. Also whether a person's devices
// can be reached at home at all (the mesh and home devices). Pure: no DOM.

import type { Person, Server } from '../../shared/types';

/** People whose devices can be reached at home (the mesh and home devices): home access, not limited to services. */
export const homeAccess = (p: Person): boolean => p.access === 'both' || (p.access === 'lan' && !p.services?.length);

export interface Reach {
  access: Person['access'];
  people: number;
  /** Their internet: through the tunnel straight out, like a home device, or their own connection. */
  internet: 'direct' | 'home' | 'own';
  /** What of home: every network, the networks their pages picked, home services only; null: nothing. */
  home: ('all' | 'some' | 'services')[] | null;
  /** The router: DNS only, or the router itself. */
  router: 'dns' | 'all';
  /** Their devices and the others': never, everyone with home access, within their circle. */
  each: 'no' | 'yes' | 'circle';
}

/** The three kinds of access on this server, in order: internet only, home only, both. */
export function whoReaches(people: Person[], srv: Server): Reach[] {
  const mine = people.filter((p) => p.server === srv.id);
  const net = srv.lan_like ? 'home' : 'direct';
  const each = srv.mesh === 'off' ? 'no' : srv.mesh === 'circles' ? 'circle' : 'yes';
  const home = (list: Person[]): Reach['home'] => {
    const kinds = new Set(list.map((p) => (p.access === 'lan' && p.services?.length ? 'services' : p.home_nets?.length ? 'some' : 'all')));
    return kinds.size ? [...kinds] : ['all'];
  };
  const by = (a: Person['access']) => mine.filter((p) => p.access === a);
  return [
    { access: 'internet', people: by('internet').length, internet: net, home: null, router: 'dns', each: 'no' },
    { access: 'lan', people: by('lan').length, internet: 'own', home: home(by('lan')), router: 'all', each },
    { access: 'both', people: by('both').length, internet: net, home: home(by('both')), router: 'all', each },
  ];
}
