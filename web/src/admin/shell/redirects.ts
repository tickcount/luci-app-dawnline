// Old addresses and where they lead now: pages that moved keep their old
// menu.d node (bookmarks, links in notes and the history), whose view only
// sends the browser on; Settings and the server's page send their own old
// queries on.
// Pure: the views call `target()` and go there with location.replace
// (shell/moved.ts).

import { routeQuery, type PeopleRoute } from '../people/route';
import { ROUTER_SECTIONS, STAGE_PART, type Place } from './routes';

/** The person page's old rows (?open=) as the blocks of their panel (people?id=…&s=). */
const PERSON_BLOCKS: Record<string, string> = {
  networks: 'reach',
  traffic: 'traffic',
  term: 'term',
  places: 'places',
  log: 'log',
};

const people = (r: PeopleRoute): Place => ({ view: 'people', query: routeQuery(r) || undefined });

/** The Servers page's old sections (and their names before that) as the stages of a server's path. */
const SERVER_SECTIONS: Record<string, string> = {
  connection: 'entry',
  general: 'entry',
  network: 'entry',
  access: 'home',
  interfaces: 'home',
  awg: 'disguise',
  core: 'disguise',
  disguise: 'disguise',
  advanced: 'devices',
  tunnel: 'tunnel',
};

/** The Server page's old rows (?open=): the stages of its path, the check and the rollout. */
const SERVER_ROWS = ['devices', 'disguise', 'entry', 'tunnel', 'internet', 'home', 'check', 'rollout'];

/** The System page's rows (?open=) that are sections of Settings by the same names (Health is Overview's). */
const SYSTEM_ROWS: readonly string[] = ROUTER_SECTIONS;

/** The Settings page before the System page: its sections (?section=, and ?tab= before that) as today's. */
const OLD_SETTINGS: Record<string, string> = {
  portal: 'portal',
  defaults: 'defaults',
  map: 'history',
  logs: 'history',
  updates: 'updates',
  backups: 'backups',
  danger: 'remove',
};

/** Settings at one of the router's sections. */
const settings = (p: string): Place => ({ view: 'settings', query: `p=${p}` });

/** A server's page at the part a stage of its path is set on (none: its Overview). */
const server = (stage?: string | null, id?: string | null): Place => {
  const q = new URLSearchParams();
  if (id) q.set('server', id);
  const part = stage ? STAGE_PART[stage] : undefined;
  if (part && part !== 'overview') q.set('p', part);
  if (stage) q.set('s', stage);
  return { view: 'server', query: q.toString() || undefined };
};

/** Overview at its health checks. */
const health: Place = { view: 'overview', query: 's=health' };

/** Where an old address goes now (`view` is the node's last path part), or null: it is a page of its own. */
export function target(view: string, query: string): Place | null {
  const q = new URLSearchParams(query);
  switch (view) {
    // Activity, and later Diagnostics' Log tab, became the Log.
    case 'activity':
      return { view: 'log' };
    // Diagnostics (and Health before it) became Overview's health checks, its Log tab the Log.
    case 'diagnostics':
      return q.get('tab') === 'log' ? { view: 'log' } : health;
    case 'health':
      return health;
    // Settings is a page again: its sections of before the System page (?section=, ?tab=) are today's (?p=).
    case 'settings': {
      const old = q.get('section') ?? q.get('tab');
      if (old != null) return settings(OLD_SETTINGS[old] ?? 'updates');
      // a server's path was Settings' own (?p=<stage>, ?server=): it is the server's page now; Settings keeps the
      // router's sections (none named: Updates)
      const p = q.get('p');
      const srv = q.get('server');
      if (p && SYSTEM_ROWS.includes(p)) return srv ? settings(p) : null;
      const stage = p && p in STAGE_PART ? p : null;
      return stage || srv ? server(stage, srv) : null;
    }
    // Components became Settings' Updates.
    case 'updates':
      return settings('updates');
    // The System page became the router's own sections of Settings; its Health row is Overview's.
    case 'system': {
      const open = q.get('open');
      if (open === 'health') return health;
      return settings(open && SYSTEM_ROWS.includes(open) ? open : 'updates');
    }
    // A server's page: its old rows (?open=) and the Servers page's sections before them (?section=) are parts of
    // it now; People was a section of it once and is the People view inside its frame.
    case 'server': {
      const srv = q.get('server');
      const s = q.get('section');
      if (s === 'people') return { view: 'people', query: srv ? new URLSearchParams({ server: srv }).toString() : undefined };
      const open = q.get('open');
      // the page's own address (?server=&p=<part>): nothing old in it
      if (s == null && open == null) return null;
      return server(s ? SERVER_SECTIONS[s] : open && SERVER_ROWS.includes(open) ? open : null, srv);
    }
    // A person's page became their panel on People; before that, with a device's drawer open, that device's page,
    // which is its panel now.
    case 'person': {
      const device = q.get('device');
      if (device) return people({ device });
      const id = q.get('id') ?? undefined;
      return people({ id, s: PERSON_BLOCKS[q.get('open') ?? ''], sheet: id && q.get('add') ? 'add' : undefined });
    }
    // A device's page became its panel; its set-up and its places' close-up open on it as before.
    case 'device': {
      const sheet = q.get('sheet');
      return people({ device: q.get('id') ?? undefined, sheet: sheet === 'setup' || sheet === 'places' ? sheet : undefined });
    }
    // Places became the map view of People; a device's close-up opens on its panel.
    case 'places': {
      const device = q.get('sheet') === 'places' ? q.get('device') : null;
      if (device) return people({ device, sheet: 'places' });
      return people({ view: 'map', id: q.get('person') ?? undefined, server: q.get('server') ?? undefined });
    }
    default:
      return null;
  }
}
