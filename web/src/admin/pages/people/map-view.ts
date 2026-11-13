// People › Map: where the people in the list connect from, as one stage (ui/split.ts): the admin's map (map.ts in
// widgets/map-box.ts) and beside it an inspector as high as the map, that scrolls inside itself however many places
// there are. The inspector's head counts the places and who is in one now, picks the period, and names the person
// or device the view is narrowed to (× lets go). Its body has two levels in one place:
// - the places: a row a city (who was there as faces, how many devices on which networks, now or how long ago, one
//   strip of when anyone was there over the period); a row under the pointer brings its city's markers forward;
// - a city, opened from its row or its marker: the way back, its words, and its devices as place rows
//   (widgets/place-rows.ts: who and which, the operator, the strip, when), each the way to its device's page. The
//   camera eases to the city and holds there while it is open; back, it frames everyone again and the list stands
//   where it was left with the city's row in sight.
// With a person or a device open (the route), the map and the list are their places alone. The list is the map's
// text alternative and what shows when WebGL is missing; nothing in it folds. Without geolocation the view says
// where it is turned on.

import type { Device, GeoPoint, LogEvent, Person } from '../../../shared/types';
import { api } from '../../api';
import { h } from '../../../portal/dom';
import { EASE_OUT, SMOOTH, still, play } from '../../../portal/motion';
import { fadeAway } from '../../../portal/ui/morph';
import { ago } from '../../../shared/format';
import { fmt, plural } from '../../../shared/i18n';
import { plainOrg } from '../../../shared/org';
import { emptyState } from '../../ui/empty';
import { face } from '../../ui/face';
import { ic } from '../../ui/icons';
import { refill } from '../../ui/reshape';
import { stage, type Stage } from '../../ui/split';
import { tabs } from '../../ui/tabs';
import { deviceUrl, settingsUrl } from '../../shell/routes';
import { mapBox, type MapBox } from '../../widgets/map-box';
import { deviceRuns, placeRow, runsStrip, spanOf } from '../../widgets/place-rows';
import { cities, inPeriod, union, type City } from '../../places/model';
import type { PeopleRoute, Range } from '../../people/route';
import type { PeopleHost } from './host';
import { putChildren } from '../../../portal/ui/put';

const DAYS30 = 30 * 86400;
/** The period the view opens on. */
const RANGE: Range = '30d';
const RANGES: Range[] = ['online', '24h', '7d', '30d'];
const rangeLabel = (r: Range): string => ({ online: _('Now', 'period'), '24h': _('24h'), '7d': _('7 days'), '30d': _('30 days') })[r];
/** Faces a city's row shows before «+N». */
const FACES = 4;

/** A device at a place, with its person. */
interface At {
  pt: GeoPoint;
  p: Person;
  d: Device;
}

export class MapView {
  el = h('div', { class: 'pp-mapview' });
  private map: MapBox | null = null;
  private stage: Stage | null = null;
  /** The inspector's head: the count, the scope, the period. */
  private count = h('div', { class: 'pp-insp-n' });
  private scopeBox = h('div', { class: 'pp-insp-scope' });
  /** The two levels of its body: the places, and the city open (kept apart, so the list keeps its rows and scroll). */
  private list = h('div', { class: 'pp-cities', 'aria-label': _('Places') });
  private place = h('div', { class: 'pp-city' });
  /** The city open in the inspector (placeKey); null: the places. */
  private city: string | null = null;
  /** The list's scroll when a city opened. */
  private listY = 0;
  /** Everyone's connections of the longest period (the strips); null: not read yet. */
  private events: LogEvent[] | null = null;
  private asked = false;
  private people: Person[] = [];
  private route: PeopleRoute = {};
  /** Whose places the map shows (everyone's, a person's, a device's): another scope is framed anew. */
  private scope = '';

  constructor(private host: PeopleHost) {}

  private range(): Range {
    return this.route.range ?? RANGE;
  }

  /** The person the view is narrowed to (a device's owner). */
  private owner(): string | undefined {
    const r = this.route;
    return r.device ? this.host.st().people.find((p) => p.devices.some((d) => d.id === r.device))?.id : r.id;
  }

  /** Draw for a route and the people in scope (the bar's filters and search). */
  paint(route: PeopleRoute, people: Person[]) {
    const was = this.route;
    this.route = route;
    this.people = people;
    const st = this.host.st();
    if (!st.geo.enabled) {
      this.map = null;
      this.stage = null;
      putChildren(this.el, [
        emptyState({
          icon: 'pin',
          title: _('No map of places'),
          text: _(
            'Dawnline does not look up the city and network of an address, so there is no map. It is turned on in System, under History and storage.',
          ),
          action: h('a', { class: 'btn soft sm', href: settingsUrl('history') }, h('span', {}, _('Open the setting'))),
        }),
      ]);
      return;
    }
    if (!this.asked) {
      this.asked = true;
      void api.events(5000, undefined, st.now - DAYS30 - 1).then(
        (r) => {
          this.events = r.events;
          this.paintSide();
        },
        () => undefined,
      );
    }
    const scope = route.device ? `d:${route.device}` : route.id ? `p:${route.id}` : '';
    if (!this.map || !this.stage) {
      this.map = mapBox({
        height: 'fill',
        range: this.range(),
        data: () => this.mapData(),
        cb: {
          openPerson: (id) => this.host.go({ ...this.route, id, device: undefined, s: undefined, sheet: undefined }),
          openDevice: (_p, d) => this.host.go({ ...this.route, device: d, id: undefined, s: undefined, sheet: undefined }),
          pickPlace: (key) => this.open(key, true),
        },
      });
      const period = tabs<Range>(
        RANGES.map((x) => ({ id: x, label: rangeLabel(x) })),
        this.range(),
        (v) => this.host.go({ ...this.route, range: v }, 'replace'),
        { cls: 'pp-insp-range', label: _('Period'), keep: 'map-range' },
      );
      const head = h('div', { class: 'pp-insp-head' }, h('div', { class: 'pp-insp-top' }, this.count, this.scopeBox), period.el);
      this.stage = stage({ map: this.map.el, head, skip: _('Skip to the list of places') });
      this.stage.body.append(this.list);
      putChildren(this.el, [this.stage.el]);
      requestAnimationFrame(() => this.stage?.fit());
    } else {
      this.map.refresh();
      // another period, or another scope (everyone's places, a person's, a device's): framed anew, the city let go
      if (was.range !== route.range || scope !== this.scope) {
        if (this.city) this.back(false);
        this.map.setRange(this.range());
      }
      this.stage.fit();
    }
    this.scope = scope;
    this.paintSide();
  }

  private mapData() {
    const st = this.host.st();
    const ids = new Set(this.people.map((p) => p.id));
    return {
      geo: { ...st.geo, points: st.geo.points.filter((x) => ids.has(x.person)) },
      people: st.people,
      now: this.host.now(),
      person: this.owner(),
      device: this.route.device,
    };
  }

  /** The places in the period and the scope, a city each. */
  private cities(): City[] {
    const st = this.host.st();
    const ids = new Set(this.people.map((p) => p.id));
    const owner = this.owner();
    const dev = this.route.device;
    return cities(
      st.geo.points.filter(
        (x) => ids.has(x.person) && inPeriod(x, this.range(), st.now) && (!owner || x.person === owner) && (!dev || x.device === dev),
      ),
    );
  }

  /** A city's devices with their people (those still known). */
  private at(c: City): At[] {
    const st = this.host.st();
    return c.points
      .map((pt) => {
        const p = st.people.find((x) => x.id === pt.person);
        const d = p?.devices.find((x) => x.id === pt.device);
        return p && d ? { pt, p, d } : null;
      })
      .filter((x): x is At => !!x);
  }

  /** The inspector: its head, and the level that stands. */
  private paintSide() {
    if (!this.stage) return;
    const st = this.host.st();
    const list = this.cities();
    const live = list.reduce((n, c) => n + c.live, 0);
    refill(this.count, [
      h('b', {}, plural(list.length, '%s place', '%s places')),
      live ? h('span', { class: 'pp-insp-live' }, plural(live, '%s device online', '%s devices online')) : '',
    ]);
    this.paintScope();
    // the city open, unless the period or the filters left it out
    const open = this.city ? list.find((c) => c.key === this.city) : null;
    if (this.city && !open) this.back(false);
    if (open) refill(this.place, this.cityLevel(open));
    if (!list.length) {
      const r = this.range();
      refill(this.list, [
        h(
          'div',
          { class: 'pp-insp-none' },
          h('b', {}, r === 'online' ? _('Nobody is online now') : _('No places in this period')),
          h(
            'span',
            {},
            r === 'online'
              ? _('Pick a period to see where they connected from before.')
              : _('No connections from a known place in this period.'),
          ),
        ),
      ]);
      return;
    }
    refill(
      this.list,
      list.map((c) => this.cityRow(c, st.now)),
    );
  }

  /** Whose places these are, with the way back to everyone's. */
  private paintScope() {
    const st = this.host.st();
    const r = this.route;
    const p = st.people.find((x) => x.id === this.owner());
    const d = r.device ? p?.devices.find((x) => x.id === r.device) : undefined;
    if (!p) return refill(this.scopeBox, []);
    const clear = h(
      'button',
      {
        type: 'button',
        class: 'kt-chip pp-insp-chip',
        'aria-label': fmt(_('Everyone’s places, not only %s'), d ? `${p.name} · ${d.name}` : p.name),
      },
      h('span', {}, d ? `${p.name} · ${d.name}` : p.name),
      ic('x'),
    );
    clear.addEventListener('click', () => this.host.go({ ...this.route, id: undefined, device: undefined }, 'replace'));
    refill(this.scopeBox, [clear]);
  }

  /** A city's strip: when any of its devices was there over the period. */
  private cityStrip(c: City, at: At[]): HTMLElement {
    const st = this.host.st();
    const span = spanOf(this.range());
    const runs = union(at.flatMap(({ pt, d }) => deviceRuns(st, pt, d, this.events, span).map(([l, w]) => [l, l + w] as [number, number])));
    return runsStrip(
      runs.map(([a, b]) => [a, b - a]),
      c.live > 0,
    );
  }

  /** Its networks, plain, the most used first. */
  private orgs(at: At[]): string {
    const n = new Map<string, number>();
    for (const { pt } of at) if (pt.org) n.set(plainOrg(pt.org), (n.get(plainOrg(pt.org)) ?? 0) + 1);
    return [...n]
      .sort((a, b) => b[1] - a[1])
      .map(([o]) => o)
      .join(', ');
  }

  /** A city of the list: who was there, how many devices on which networks, when, the strip; it opens the city. */
  private cityRow(c: City, now: number): HTMLElement {
    const at = this.at(c);
    const people = [...new Map(at.map((x) => [x.p.id, x])).values()];
    // the live ones first, as the map rings them
    people.sort(
      (a, b) =>
        Number(c.points.some((x) => x.person === b.p.id && x.online)) - Number(c.points.some((x) => x.person === a.p.id && x.online)),
    );
    const faces = h(
      'span',
      { class: 'pp-faces', 'aria-hidden': 'true' },
      ...people.slice(0, FACES).map(({ p }) => face(p.name, c.points.some((x) => x.person === p.id && x.online) ? 'ok' : '')),
      people.length > FACES ? h('span', { class: 'pav kt-face pp-more' }, `+${people.length - FACES}`) : null,
    );
    const orgs = this.orgs(at);
    const b = h(
      'button',
      {
        type: 'button',
        class: 'prow2 pp-cityrow',
        'data-key': c.key,
        'aria-label': `${c.name}: ${people.map(({ p }) => p.name).join(', ')}`,
      },
      h(
        'span',
        { class: 'prow2-t' },
        h(
          'span',
          { class: 'pp-cr-top' },
          h('b', {}, c.name),
          h('span', { class: `prow2-w${c.live ? ' now' : ''}` }, c.live ? plural(c.live, '%s now', '%s now') : ago(c.last, now)),
        ),
        h(
          'span',
          { class: 'pp-cr-who' },
          faces,
          h('span', {}, [plural(at.length, '%s device', '%s devices'), orgs].filter(Boolean).join(' · ')),
        ),
        this.cityStrip(c, at),
      ),
    );
    b.addEventListener('click', () => this.open(c.key, false));
    b.addEventListener('mouseenter', () => this.map?.hoverCity(c.key));
    b.addEventListener('mouseleave', () => this.map?.hoverCity(null));
    b.addEventListener('focus', () => this.map?.hoverCity(c.key));
    b.addEventListener('blur', () => this.map?.hoverCity(null));
    return b;
  }

  /** An open city: the way back, its words, its devices as place rows. */
  private cityLevel(c: City): HTMLElement[] {
    const st = this.host.st();
    const at = this.at(c);
    const backBtn = h('button', { type: 'button', class: 'pill-link pp-back' }, ic('chevron'), _('All places'));
    backBtn.addEventListener('click', () => this.back(true));
    const country = c.points[0]?.country || c.points[0]?.cc || '';
    return [
      h(
        'div',
        { class: 'pp-city-head' },
        backBtn,
        h('b', { class: 'pp-city-name' }, c.name),
        h(
          'span',
          { class: 'pp-city-meta' },
          [country, this.orgs(at), c.live ? plural(c.live, '%s now', '%s now') : ago(c.last, st.now)].filter(Boolean).join(' · '),
        ),
        this.cityStrip(c, at),
      ),
      h(
        'div',
        { class: 'pp-city-rows' },
        ...at.map(({ pt, p, d }) =>
          placeRow({ st, pt, p, d, events: this.events, range: this.range(), href: deviceUrl(d.id), current: d.id === this.route.device }),
        ),
      ),
    ];
  }

  /** A city opened (its row, or its marker: `fromMap`): it takes the body's place, the camera eases to it. */
  private open(key: string, fromMap: boolean) {
    const s = this.stage;
    const c = this.cities().find((x) => x.key === key);
    if (!s || !c) return;
    const swap = this.city !== key;
    if (!this.city) this.listY = s.scroll.get();
    this.city = key;
    this.map?.showCity(key);
    this.map?.hoverCity(key);
    refill(this.place, this.cityLevel(c));
    if (!swap) return;
    // another city while one is open: it changes in place
    if (this.place.parentElement === s.body) return s.scroll.set(0);
    this.cross(this.place, 1, 0);
    if (!fromMap) this.place.querySelector<HTMLElement>('.pp-back')?.focus({ preventScroll: true });
  }

  /** Back to the places (`animate`: a press, not a period or a filter that left the city out). */
  private back(animate: boolean) {
    const s = this.stage;
    const was = this.city;
    if (!s || !was) return;
    this.city = null;
    this.map?.showCity(null);
    this.map?.hoverCity(null);
    if (animate) this.cross(this.list, -1, this.listY);
    else {
      putChildren(s.body, [this.list]);
      s.scroll.set(this.listY);
    }
    const row = this.list.querySelector<HTMLElement>(`[data-key="${CSS.escape(was)}"]`);
    if (row) {
      s.reveal(row);
      if (animate) row.focus({ preventScroll: true });
    }
  }

  /**
   * `next` in the body's place: what stood there fades where it stood (out, b4, 180 EASE_IN), the new level comes in
   * from 10 px aside (`dir`: 1 from the right, a city; -1 from the left, the list) with its opacity, on SMOOTH, as a
   * page of the list does (ui/subpage.ts). The body then scrolls to `y`; the old one stays where it was seen.
   */
  private cross(next: HTMLElement, dir: 1 | -1, y: number) {
    const s = this.stage!;
    const body = s.body;
    const old = [...body.children].find((x) => x !== next && !x.hasAttribute('aria-hidden')) as HTMLElement | undefined;
    if (old && !still() && body.getClientRects().length) {
      const b = body.getBoundingClientRect();
      // placed in the body's content, which scrolls to y under it
      fadeAway(old, old.getBoundingClientRect(), body, new DOMRect(b.x, b.y - y, b.width, b.height));
    } else old?.remove();
    body.append(next);
    s.scroll.set(y);
    if (still()) return;
    play(next, [{ transform: `translateX(${10 * dir}px)` }, { transform: 'none' }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
    play(
      next,
      [
        { opacity: 0, filter: 'blur(4px)' },
        { opacity: 1, filter: 'blur(0px)' },
      ],
      { duration: 280, delay: 60, easing: EASE_OUT, fill: 'backwards' },
    );
  }
}
