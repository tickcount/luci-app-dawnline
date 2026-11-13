// Addresses of Dawnline's admin pages, and which section each belongs to.
// Three sections, each a LuCI view of its own (menu.d), so Back and bookmarks
// work; the page draws its own section row (shell/nav.ts): Overview · Log ·
// Settings. A server is a page of its own behind Overview (the owner's
// structure of 2026-11-11): the `server` view is its Overview and its
// settings (?server=&p=general|core|network), the `people` view its people
// and their places inside the same frame (?id=, ?device=, ?view=map,
// ?server=). Settings keeps the router's own sections (?p=). The old views
// (person, device, places, system and those before them) and the old
// queries of `server` and `settings` only send the browser on
// (redirects.ts).

import { routeQuery, type PeopleRoute } from '../people/route';

/** The sections of the page's own row, in its order. */
export type Section = 'overview' | 'log' | 'settings';
export const SECTIONS: Section[] = ['overview', 'log', 'settings'];

/** The parts of a server's page: its own Overview, its people and their places, its settings in three. */
export type ServerPart = 'overview' | 'people' | 'places' | 'general' | 'core' | 'network';

/** The settings part of a server's page a stage of its path is set on (the path check and a rollout: its Overview). */
export const STAGE_PART: Record<string, ServerPart> = {
  entry: 'general',
  devices: 'core',
  disguise: 'core',
  tunnel: 'network',
  internet: 'network',
  home: 'network',
  check: 'overview',
  rollout: 'overview',
};

/** The router-wide sections of Settings. */
export const ROUTER_SECTIONS = ['updates', 'portal', 'defaults', 'history', 'backups', 'remove'] as const;

const BASE = 'admin/services/dawnline';

/** A view's path under Dawnline (its menu.d node) and its query: what L.url gets. */
export interface Place {
  view: string;
  query?: string;
}

/** Where a section opens: each is a view of its own name. */
export const sectionPlace = (s: Section): Place => ({ view: s });

/** The section a view (with its query) belongs to, for the row's current tab; null: none of them. */
export function sectionOf(view: string, query: string): Section | null {
  const q = new URLSearchParams(query);
  switch (view) {
    case 'log':
    case 'activity':
      return 'log';
    // a server's page, with its people and places, stands behind Overview
    case 'people':
    case 'person':
    case 'device':
    case 'places':
    case 'server':
    case 'overview':
    // Dawnline's own menu item (an alias of Overview).
    case 'dawnline':
    // Health is Overview's now (redirects.ts sends both on).
    case 'health':
      return 'overview';
    case 'diagnostics':
      return q.get('tab') === 'log' ? 'log' : 'overview';
    case 'system':
      return q.get('open') === 'health' ? 'overview' : 'settings';
    case 'settings':
    case 'updates':
      return 'settings';
    default:
      return null;
  }
}

/** The view this page is (the last part of LuCI's path under Dawnline), and its query. */
export function here(): Place {
  const parts = location.pathname.split('/');
  return { view: parts[parts.length - 1] ?? '', query: location.search.replace(/^\?/, '') };
}

/** A place as an address. */
export const href = (p: Place): string => `${L.url(`${BASE}/${p.view}`)}${p.query ? `?${p.query}` : ''}`;

const query = (o: Record<string, string | undefined>): string =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();

/** People as a route says them (people/route.ts): the panel, the view, the filters. */
export const peopleAt = (r: PeopleRoute): string => href({ view: 'people', query: routeQuery(r) });

/** People; one server's only, or (`need`: 'config') only those whose devices wait for a new configuration. */
export const peopleUrl = (server?: string, need?: 'config'): string => peopleAt({ server, need });

/**
 * A server's page: its Overview (no part), its people or places (the People page inside its frame), or a part of
 * its settings; `s`: a section of that part brought into view (a stage of its path). No server: the first one.
 */
export const serverUrl = (server?: string, part: ServerPart = 'overview', s?: string): string =>
  part === 'people'
    ? peopleAt({ server })
    : part === 'places'
      ? peopleAt({ view: 'map', server })
      : href({ view: 'server', query: query({ server, p: part === 'overview' ? undefined : part, s }) });

/**
 * Where something is set: one of the router's own sections of Settings (`p`: updates, portal, defaults, history,
 * backups, remove), or, for a stage of a server's path (`p`: entry, devices, disguise, tunnel, internet, home; also
 * check, rollout; none: the server itself), that server's page at the part the stage is on.
 */
export const settingsUrl = (p?: string, server?: string): string =>
  p && (ROUTER_SECTIONS as readonly string[]).includes(p)
    ? href({ view: 'settings', query: query({ p }) })
    : serverUrl(server, p ? (STAGE_PART[p] ?? 'overview') : 'overview', p);

/** Overview's health checks (the one place a check is listed with its state; its fix is in its Settings section). */
export const healthUrl = (): string => href({ view: 'overview', query: 's=health' });

/** A person: their panel on People; `s`: a block of it brought into view (traffic, term…). */
export const personUrl = (id: string, s?: string): string => peopleAt({ id, s });

/** A device: its panel on People; `sheet`: one of its sheets open on it (`setup`: its set-up, as after adding it elsewhere). */
export const deviceUrl = (id: string, sheet?: 'setup'): string => peopleAt({ device: id, sheet });

/**
 * Places, the map view of People: one person's only (`person`), one server's (`server`); or a device's panel with
 * its close-up open on it (`device`: what a reload or Back keeps).
 */
export const placesUrl = (o: { person?: string; server?: string; device?: string } = {}): string =>
  o.device ? peopleAt({ device: o.device, sheet: 'places' }) : peopleAt({ view: 'map', id: o.person, server: o.server });

/**
 * A close-up's own address: the page under it with `sheet=places&device=` (a reload opens it again); null: closed.
 * On a person's page (`own`) the page stays theirs: `sheet=places`, the device picked on its track as `pick=` (none:
 * all of their devices).
 */
export function withCloseUp(url: string, device: string | null, own = false): string {
  const u = new URL(url, 'http://router');
  u.searchParams.delete('pick');
  if (own) {
    u.searchParams.set('sheet', 'places');
    if (device) u.searchParams.set('pick', device);
  } else if (device) {
    u.searchParams.set('sheet', 'places');
    u.searchParams.set('device', device);
  } else {
    u.searchParams.delete('sheet');
    // the Log filters by a ?device= of its own and on People it is the open panel: it stays; elsewhere it was the
    // close-up's
    if (!/\/(log|people)$/.test(u.pathname)) u.searchParams.delete('device');
  }
  return `${u.pathname}${u.search}${u.hash}`;
}

/** The log; one device's, one person's or one server's only, one kind of entry, one day (today, yesterday, 7d), a search. */
export const logUrl = (o: { device?: string; person?: string; kind?: string; day?: string; server?: string; q?: string } = {}): string =>
  href({ view: 'log', query: query({ kind: o.kind, day: o.day, person: o.person, device: o.device, server: o.server, q: o.q }) });
