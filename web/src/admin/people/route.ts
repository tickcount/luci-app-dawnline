// Where the People page is, as its address says it: the panel open beside the list (a person, or a device, which
// takes the person's place), the view (the table, or the map), the filters (a chip, the server, «waiting for a new
// configuration»), the table's order, the map's period, and what to open on arrival (a block to scroll to, a
// sheet). Pure: the page keeps one of these and moves between them with pushState (a panel, the view: Back closes
// the panel) or replaceState (filters, the order).

/** A chip's people: who needs a decision, who is online, who is paused. */
export type Filter = 'need' | 'online' | 'paused';
/** The map view's period (places/model.ts Period). */
export type Range = 'online' | '24h' | '7d' | '30d';

export interface PeopleRoute {
  /** A person's panel. */
  id?: string;
  /** A device's panel (its person is read from the status). */
  device?: string;
  view?: 'map';
  group?: Filter;
  server?: string;
  need?: 'config';
  /** A column and its direction: 'name', '-traffic'… (none: by attention, in groups). */
  sort?: string;
  range?: Range;
  /** A block of the panel to bring into view: reach, term, traffic, places, log, config. */
  s?: string;
  /** A sheet to open on arrival: add (a person; with `id`, a device for them), setup and places (a device's). */
  sheet?: string;
}

const pick = <T extends string>(q: URLSearchParams, k: string, of: readonly T[]): T | undefined => {
  const v = q.get(k) as T | null;
  return v && of.includes(v) ? v : undefined;
};

/** The route an address' query says. */
export function parseRoute(query: string): PeopleRoute {
  const q = new URLSearchParams(query);
  const device = q.get('device') || undefined;
  return {
    // a device's panel takes the person's place; its person comes from the status
    id: device ? undefined : q.get('id') || undefined,
    device,
    view: pick(q, 'view', ['map'] as const),
    group: pick(q, 'group', ['need', 'online', 'paused'] as const),
    server: q.get('server') || undefined,
    need: pick(q, 'need', ['config'] as const),
    sort: q.get('sort') || undefined,
    range: pick(q, 'range', ['online', '24h', '7d', '30d'] as const),
    s: q.get('s') || undefined,
    // ?add=1 is the old way to ask for the Add sheet
    sheet: q.get('sheet') || (q.get('add') ? 'add' : undefined),
  };
}

/** A route as a query, its parts in one order (the same route is the same address). */
export function routeQuery(r: PeopleRoute): string {
  const q = new URLSearchParams();
  const put = (k: string, v: string | undefined) => v && q.set(k, v);
  put('view', r.view);
  put('id', r.device ? undefined : r.id);
  put('device', r.device);
  put('group', r.group);
  put('server', r.server);
  put('need', r.need);
  put('sort', r.sort);
  put('range', r.range);
  put('s', r.s);
  put('sheet', r.sheet);
  return q.toString();
}

/** What of a route is the list's: the view, the filters, the order, the period. */
export const listOf = (r: PeopleRoute): PeopleRoute => ({
  view: r.view,
  group: r.group,
  server: r.server,
  need: r.need,
  sort: r.sort,
  range: r.range,
});

/**
 * The route a link inside the page leads to. A link that names only an object (a person, a device: every such link
 * of the admin, shell/routes.ts personUrl / deviceUrl) opens its panel beside the list as it stands; one that names
 * a view or a filter is taken whole.
 */
export function follow(cur: PeopleRoute, to: PeopleRoute): PeopleRoute {
  const lists = to.view || to.group || to.server || to.need || to.sort || to.range;
  return lists ? to : { ...listOf(cur), id: to.id, device: to.device, s: to.s, sheet: to.sheet };
}
