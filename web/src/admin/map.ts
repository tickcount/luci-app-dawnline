// Connection map, drawn as mapcn's "Basic Arc" (mapcn.dev, MapLibre under a
// React wrapper; the same look here without React): MapLibre GL on a globe
// with a CARTO basemap (light or dark, following the Outline theme), the
// router as the hub and a dashed arc to each place devices connect from —
// blue while the tunnel is live, gray when seen recently. MapLibre loads from
// a CDN on first use.

import type { Geo, GeoPoint, Person } from '../shared/types';
import { E } from './e';
import { ago, initials } from '../shared/format';
import { icon, iconSvg } from '../shared/icons';
import { onNavigate } from './ui/nav';

// mapcn requires maplibre-gl ^6 (the globe projection came with 5): an ES module, its worker beside it.
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@6.14.0/dist';
// What those files must be (sha384): code from a CDN runs inside the LuCI
// page, where it could use the admin's session. A modulepreload with an
// integrity carries the check into the import(); the stylesheet has its own.
// The worker (loaded by the library) runs in its own context without the page
// or the session, so it goes unchecked.
const MAPLIBRE_SRI = {
  module: 'sha384-q26X6R1yFeg0QR9SHHn6U3Nb0ddRRTtwxsahubv5R89/v5nijKpk9KviUp9ZLySk',
  css: 'sha384-1TZtfVz7qtwR5vD7cMwjGT+9uiK4lqE3pbUOPwYO6OCpb+TYP0S9vLIhG02JCU04',
};
const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

export type Range = 'online' | '24h' | '7d' | '30d';
const WINDOW: Record<Range, number> = { online: 0, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };

let loading: Promise<any> | null = null;

/**
 * Load MapLibre once. The stylesheet goes into every map's own container:
 * Outline drops the previous page's DOM on navigation (and with it a shared
 * link), and without it HTML markers lose their positioning and vanish.
 * Since 6 it is an ES module: imported (the URL in a variable, so the bundler
 * leaves it alone), with the worker URL set as mapcn does.
 */
function loadMapLibre(host: HTMLElement): Promise<any> {
  host.appendChild(
    E('link', { rel: 'stylesheet', href: `${MAPLIBRE}/maplibre-gl.css`, integrity: MAPLIBRE_SRI.css, crossorigin: 'anonymous' }),
  );
  if (loading) return loading;
  const url = `${MAPLIBRE}/maplibre-gl.mjs`;
  // The preload fetches and checks the module; the module map keeps the
  // result, so the import() below gets the checked copy or fails with it.
  const preload = new Promise<void>((resolve, reject) => {
    const link = E('link', { rel: 'modulepreload', href: url, integrity: MAPLIBRE_SRI.module, crossorigin: 'anonymous' });
    link.addEventListener('load', () => resolve());
    link.addEventListener('error', () => reject(new Error('integrity')));
    document.head.appendChild(link);
  });
  loading = preload
    .then(() => import(/* @vite-ignore */ url))
    .then(
      (gl) => {
        if (!gl.getWorkerUrl()) gl.setWorkerUrl(`${MAPLIBRE}/maplibre-gl-worker.mjs`);
        return gl;
      },
      (e: Error) => {
        loading = null;
        throw new Error(
          e?.message === 'integrity'
            ? 'The map library from the CDN is not the expected file: not loading it.'
            : 'Could not load the map library (no internet access from this browser?)',
        );
      },
    );
  return loading;
}

function isDark(): boolean {
  const attr = document.documentElement.getAttribute('data-darkmode');
  if (attr != null) return attr === 'true';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** A click on a marker brings the map at least this close (a city). */
const CLICK_ZOOM = 10;
/** Places closer than this are one city: a click shows them together at city level. */
const CITY_KM = 30;
/** Screen distance at which two markers stand clear of each other (the server's plate and an avatar, with room). */
const PART_PX = 62;
/** Below these zooms plates turn compact (a continent) or mid-sized (a country). */
const LOD_FAR = 4.5;
const LOD_MID = 7;

/** mapcn's arc colours: its default blue for live tunnels, a neutral gray for recently seen. */
const LIVE = '#3b82f6';
const RECENT = '#8a8a8a';

/**
 * mapcn's arc (buildArcCoordinates): a quadratic Bézier between two
 * [lng, lat] points bent by `curvature` of their distance, `samples` steps.
 * The destination is unwrapped so |dx| <= 180: arcs across the antimeridian
 * take the short way (MapLibre draws longitudes past ±180 on the globe).
 */
export function arc(from: [number, number], to: [number, number], curvature = 0.2, samples = 64): [number, number][] {
  const [x0, y0] = from;
  const [xTo, y2] = to;
  const rawDx = xTo - x0;
  const x2 = rawDx > 180 ? xTo - 360 : rawDx < -180 ? xTo + 360 : xTo;
  const dx = x2 - x0;
  const dy = y2 - y0;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || curvature === 0) return [from, [x2, y2]];
  const nx = -dy / distance;
  const ny = dx / distance;
  const offset = distance * curvature;
  const cx = (x0 + x2) / 2 + nx * offset;
  const cy = (y0 + y2) / 2 + ny * offset;
  const points: [number, number][] = [];
  const segments = Math.max(2, Math.floor(samples));
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const inv = 1 - t;
    points.push([inv * inv * x0 + 2 * inv * t * cx + t * t * x2, inv * inv * y0 + 2 * inv * t * cy + t * t * y2]);
  }
  return points;
}

export interface MapCallbacks {
  openPerson: (personId: string) => void;
  openDevice: (personId: string, deviceId: string) => void;
}

export interface MapData {
  geo: Geo;
  people: Person[];
  now: number;
  /** Restrict to one person (person page). */
  person?: string;
  /** Restrict to one of their devices (device window): its places in time order. */
  device?: string;
}

/**
 * The latest point per device inside the time window: per device and city on a
 * person's page, per city in a device's window.
 */
export function visiblePoints(data: MapData, range: Range): GeoPoint[] {
  const best = new Map<string, GeoPoint>();
  for (const p of data.geo.points) {
    if (data.person && p.person !== data.person) continue;
    if (data.device && p.device !== data.device) continue;
    if (range === 'online' ? !p.online : data.now - p.ts > WINDOW[range]) continue;
    // Where people are: each device once. A person's page: every city each device was in.
    const key = data.device ? `${p.city}|${p.cc}` : data.person ? `${p.device}|${p.city}|${p.cc}` : p.device;
    const cur = best.get(key);
    if (!cur || (p.online && !cur.online) || (p.online === cur.online && p.ts > cur.ts)) best.set(key, p);
  }
  return [...best.values()];
}

/** A device's places, live first, then newest: `n` numbers the past ones (1 = most recent). */
export function devicePlaces(data: MapData, range: Range): (GeoPoint & { n: number })[] {
  let i = 0;
  return visiblePoints(data, range)
    .sort((a, b) => Number(b.online) - Number(a.online) || b.ts - a.ts)
    .map((p) => ({ ...p, n: p.online ? 0 : ++i }));
}

export class ConnectionMap {
  private map: any = null;
  private gl: any = null;
  private markers: any[] = [];
  /** The open card: it floats over the page (not clipped by the map), pinned to its marker. */
  private popup: { card: HTMLElement; off: () => void } | null = null;
  private theme: MutationObserver | null = null;
  private resize: ResizeObserver | null = null;
  /** The last fit ran while the map had no size (a folded card): it is redone once it has one. */
  private fitBlind = false;
  private data: MapData | null = null;
  private range: Range;
  private fitted = false;
  /** The places the view was last fitted to: a change (someone came online or left) refits. */
  private fitKey: string | null = null;
  /** People's markers, for the hover highlight; the person in focus, kept across redraws. */
  private people: { el: HTMLElement; person: string }[] = [];
  /** Markers on the map: the server stays put (`fixed`), the others move aside when crowded. */
  private slots: { marker: any; el: HTMLElement; at: [number, number]; fixed: boolean; who?: string; where?: string; g?: Group }[] = [];
  /** People docked in the server's plate while they would sit on top of it (their marker hidden). */
  private merged: Face[] = [];
  /** People crowding each other, one plate each (by who is in it); their own markers hidden. */
  private piles = new Map<string, { marker: any; el: HTMLElement; box: HTMLElement; faces: Face[] }>();
  /** The server plate's avatars, and what they show (repainted only when that changes). */
  private dock: HTMLElement | null = null;
  private dockKey = '';
  /** A redraw's new plate fills in place: no pop for avatars that were already there. */
  private dockQuiet = false;
  /** Who was in a pile at the last declutter: a redrawn marker starts hidden, as it was. */
  private piledKeys = new Set<string>();
  /** Which markers were folded at the last redraw (by place key): a new marker starts that way. */
  private foldedKeys = new Set<string>();
  /** The zoom a programmatic zoom-out is heading for: markers fold for it at once, not on the way. */
  private targetZoom: number | null = null;
  /** The view before a click zoomed in on a marker: closing its popup goes back to it. */
  private before: { center: [number, number]; zoom: number } | null = null;
  /** The folded keys the layers were last filtered for (a filter only changes when they do). */
  private hiddenKey = '';
  private focused: string | null = null;
  private card: HTMLElement;
  readonly el: HTMLElement;
  private status: HTMLElement;

  constructor(
    private cb: MapCallbacks,
    range: Range = 'online',
    height = 380,
  ) {
    this.range = range;
    this.status = E('div', { class: 'dl-map-status' });
    this.card = E('div', { class: 'dl-map-card', 'aria-live': 'polite' });
    this.el = E('div', { class: 'dl-geomap', style: `height:${height}px` }, [this.status, this.card]);
  }

  async mount(data: MapData) {
    this.data = data;
    try {
      this.gl = await loadMapLibre(this.el);
    } catch (e) {
      this.status.textContent = (e as Error).message;
      return;
    }
    this.map = new this.gl.Map({
      container: this.el,
      style: isDark() ? STYLE_DARK : STYLE_LIGHT,
      center: [data.geo.home?.lon ?? 20, data.geo.home?.lat ?? 50],
      zoom: 1,
      // mapcn's Map: MapLibre's own gestures (scroll zooms, drag spins the globe), no zoom buttons,
      // one world, the attribution behind its "i" (styled as mapcn's site, map.css).
      renderWorldCopies: false,
      attributionControl: { compact: true },
      // No further out than the whole globe filling the map.
      minZoom: 1,
    });
    // Every style load (the first, and each theme switch) starts bare: the globe and our layers again.
    this.map.on('style.load', () => this.layers());
    // Crowded markers spread and come back together as the map zooms and pans.
    this.map.on('move', () => this.declutter());
    // MapLibre opens the credits once the sources have them: fold them away when the map is drawn.
    this.map.once('idle', () => {
      const attrib = this.el.querySelector('.maplibregl-ctrl-attrib');
      attrib?.classList.remove('maplibregl-compact-show');
      attrib?.removeAttribute('open');
    });
    // MapLibre follows the window, not its container (a card unfolding, the page reflowing).
    this.resize = new ResizeObserver(() => {
      if (!this.map || !this.el.clientWidth || !this.el.clientHeight) return;
      this.map.resize();
      if (this.fitBlind) {
        this.fitKey = null;
        this.draw();
      }
    });
    this.resize.observe(this.el);
    // Outline switches light and dark in place (html[data-darkmode]): the basemap follows.
    let dark = isDark();
    this.theme = new MutationObserver(() => {
      if (!this.map || isDark() === dark) return;
      dark = isDark();
      this.map.setStyle(dark ? STYLE_DARK : STYLE_LIGHT);
    });
    this.theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-darkmode'] });
  }

  /** The globe (as mapcn's examples: projection={{ type: "globe" }}), accuracy zones and arcs. */
  private layers() {
    if (!this.map) return;
    this.hiddenKey = '';
    this.map.setProjection({ type: 'globe' });
    // City-level accuracy: a soft zone instead of a precise pin.
    this.map.addSource('dl-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this.map.addLayer({
      id: 'dl-area',
      type: 'circle',
      source: 'dl-areas',
      paint: {
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 2, 6, 6, 26, 9, 140, 12, 900],
        'circle-color': ['case', ['get', 'online'], LIVE, RECENT],
        'circle-opacity': ['case', ['get', 'online'], 0.12, 0.06],
        'circle-stroke-width': 1,
        'circle-stroke-color': ['case', ['get', 'online'], LIVE, RECENT],
        'circle-stroke-opacity': ['case', ['get', 'online'], 0.35, 0.15],
      },
    });
    // A device's trail through its places in time order (its window): fine gray dots.
    this.map.addSource('dl-trail', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this.map.addLayer({
      id: 'dl-trail',
      type: 'line',
      source: 'dl-trail',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': RECENT, 'line-width': 1.5, 'line-opacity': 0.85, 'line-dasharray': [0, 2.5] },
    });
    // mapcn's MapArc paint (width 2, opacity 0.85, rounded) with the Basic Arc example's dashes;
    // recent arcs under live ones.
    this.map.addSource('dl-arcs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    for (const live of [false, true])
      this.map.addLayer({
        id: live ? 'dl-arc-live' : 'dl-arc-recent',
        type: 'line',
        source: 'dl-arcs',
        filter: ['==', ['get', 'online'], live],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': live ? LIVE : RECENT, 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [2, 2] },
      });
    this.draw();
  }

  setRange(r: Range) {
    this.range = r;
    this.fitKey = null;
    this.draw();
  }

  update(data: MapData) {
    this.data = data;
    this.draw();
  }

  destroy() {
    this.dropCard();
    for (const p of this.piles.values()) p.marker.remove();
    this.piles.clear();
    this.theme?.disconnect();
    this.resize?.disconnect();
    this.map?.remove();
    this.map = null;
  }

  /** A person's devices grouped by city: one marker per person and place. */
  private groups(pts: GeoPoint[]): Group[] {
    const map = new Map<string, Group>();
    for (const p of pts) {
      const key = `${p.person}|${p.city || `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`}|${p.cc}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          person: p.person,
          lat: p.lat,
          lon: p.lon,
          city: p.city,
          country: p.country,
          cc: p.cc,
          asn: p.asn,
          org: p.org,
          online: false,
          ts: 0,
          points: [],
        };
        map.set(key, g);
      }
      g.points.push(p);
      g.online ||= p.online;
      g.ts = Math.max(g.ts, p.ts);
    }
    return [...map.values()];
  }

  private draw() {
    if (!this.map || !this.data || !this.map.getSource('dl-arcs')) return;
    const data = this.data;
    const groups = this.groups(visiblePoints(data, this.range));
    // A person's page and a device's window are about their places alone: no server, no arcs to it.
    const home = data.person || data.device ? null : data.geo.home;
    for (const m of this.markers) m.remove();
    this.markers = [];

    // Every marker in its city: the IP gives no more, so people sharing a city (or the server's)
    // each get their own spot in it; ones that would still cover each other share a plate (declutter).
    const spots = data.person || data.device ? null : cityPlaces(groups, home);
    const placed = groups.map((g) => ({ g, at: spots?.get(g.key) ?? ([g.lon, g.lat] as [number, number]) }));
    this.slots = [];

    this.map.getSource('dl-areas').setData({
      type: 'FeatureCollection',
      // The accuracy zone stays on the city itself.
      features: placed.map(({ g }) => ({
        type: 'Feature',
        properties: { online: g.online, key: g.key },
        geometry: { type: 'Point', coordinates: [g.lon, g.lat] },
      })),
    });
    this.map.getSource('dl-arcs').setData({
      type: 'FeatureCollection',
      features: home
        ? placed.map(({ g, at }) => ({
            type: 'Feature',
            properties: { online: g.online, person: g.person, key: g.key },
            geometry: { type: 'LineString', coordinates: arc([home.lon, home.lat], at) },
          }))
        : [],
    });

    // The server, where every arc starts: a tile in the theme's inverse colours (as the white
    // main buttons) on a frosted plate, its city on a blurred chip. People are round: who (their
    // initials) and from what (a device badge), blue while live, gray when seen recently.
    if (home) {
      const host = E('span', { class: 'dl-mk-host' });
      host.innerHTML = `<span class="dl-mk-host-tile">${iconSvg('server', 'dl-mk-host-ic')}</span>`;
      this.dock = host.appendChild(E('span', { class: 'dl-mk-dock' }));
      this.dockQuiet = this.dockKey !== '';
      this.dockKey = '';
      const el = E(
        'div',
        { class: 'dl-mk-hub', title: `Home router${home.city ? ` · ${home.city}` : ''}${home.org ? ` · ${home.org}` : ''}` },
        [host, E('span', { class: 'dl-mk-label chip' }, home.city || 'Home')],
      );
      // Who is docked here: listed on hover; a click on the plate zooms to them (an avatar opens its card).
      el.addEventListener('mouseenter', () => this.showMerged(home.city || 'the server'));
      el.addEventListener('mouseleave', () => this.focus(this.focused));
      el.addEventListener('click', () => this.zoomToMerged());
      this.add(el, [home.lon, home.lat], true);
    }

    // A device's places joined oldest to newest, each step bowed like an arc.
    const steps = data.device ? [...placed].sort((a, b) => Number(a.g.online) - Number(b.g.online) || a.g.ts - b.g.ts) : [];
    this.map.getSource('dl-trail')?.setData({
      type: 'FeatureCollection',
      features:
        steps.length > 1
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: steps.slice(1).flatMap((x, i) => arc(steps[i].at, x.at)) },
              },
            ]
          : [],
    });
    const numbers = new Map(data.device ? devicePlaces(data, this.range).map((p) => [`${p.city}|${p.cc}`, p.n]) : []);

    this.people = [];
    for (const { g, at } of placed) {
      const n = g.points.length;
      const person = data.people.find((x) => x.id === g.person);
      if (data.person) {
        const el = data.device
          ? this.stepMarker(g, at, person, numbers.get(`${g.points[0].city}|${g.points[0].cc}`) ?? 0)
          : this.placeMarker(g, at, person);
        this.add(el, at);
        continue;
      }
      const kinds = g.points.map((p) => person?.devices.find((d) => d.id === p.device)?.kind ?? 'other');
      // One device: its icon; two: both; more: how many (the hover card lists them).
      const badge = E('span', { class: 'dl-mk-badge' });
      badge.innerHTML = n <= 2 ? kinds.map((k) => iconSvg(k, 'dl-mk-badge-ic')).join('') : String(n);
      const el = E(
        'button',
        {
          type: 'button',
          class: `dl-mk${g.online ? ' online' : ''}`,
          'aria-label': `${person?.name ?? 'Someone'}: ${n} device${n === 1 ? '' : 's'} in ${g.city || 'an unknown city'}`,
        },
        [
          E('span', { class: 'dl-mk-av' }, [initials(person?.name ?? '?'), badge]),
          E('span', { class: 'dl-mk-label below' }, g.city || g.cc || '?'),
        ],
      );
      el.addEventListener('mouseenter', () => this.focus(g.person));
      el.addEventListener('mouseleave', () => this.focus(null));
      this.people.push({ el, person: g.person });
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.openPopup(g, at, el);
      });
      this.add(el, at, false, person?.name ?? 'Someone', `${g.city || g.cc || '?'} · ${g.online ? 'now' : ago(g.ts, data.now)}`, g.key, g);
    }
    this.declutter();

    // The view follows the places shown: the first one is set at once, later ones glide there.
    // Not while a popup is open (it would leave its marker); the next update catches up.
    const key = placed
      .map((x) => x.g.key)
      .sort()
      .join(';');
    if (key !== this.fitKey && !this.popup) {
      const animate = this.fitted && !this.fitBlind;
      this.fitBlind = !this.el.clientWidth || !this.el.clientHeight;
      this.fitKey = key;
      this.fitted = true;
      if (home && !placed.length) {
        // Nobody to show: the router up close, at the same zoom as the closest fit.
        const view = { center: [home.lon, home.lat], zoom: 12 };
        if (animate) this.glide(12, () => this.map.flyTo({ ...view, duration: 1200 }));
        else this.map.jumpTo(view);
      } else {
        const coords: [number, number][] = placed.map((x) => x.at);
        if (home && (coords.length === 0 || this.range !== 'online' || placed.some((x) => x.g.online))) coords.push([home.lon, home.lat]);
        this.fit(coords, animate);
      }
    }
    this.status.textContent = placed.length || home ? '' : 'No locations yet';
    this.status.style.display = this.status.textContent ? '' : 'none';
    this.focus(this.focused && this.people.some((x) => x.person === this.focused) ? this.focused : null);
  }

  private add(el: HTMLElement, at: [number, number], fixed = false, who?: string, where?: string, key?: string, g?: Group) {
    // A redrawn marker keeps how it was (folded or not), with no fade in its first frame.
    if (key && this.foldedKeys.has(key)) el.classList.add('merged');
    if (key && this.piledKeys.has(key)) el.classList.add('piled');
    el.dataset.key = key ?? '';
    el.classList.add('dl-mk-new');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('dl-mk-new')));
    const marker = new this.gl.Marker({ element: el }).setLngLat(at).addTo(this.map);
    this.markers.push(marker);
    this.slots.push({ marker, el, at, fixed, who, where, g });
  }

  /**
   * Markers that would cover each other: someone on top of the server folds into a count on
   * its plate (moved aside they would look like another region, a dot would hide under it) and
   * comes back once there is room; markers crowding each other are pushed just clear, a thin
   * line pointing back to the real spot. The push grows with the overlap and fades to nothing
   * as the map zooms in, so markers glide back to their places instead of jumping.
   */
  private declutter() {
    if (!this.map) return;
    // Plates by distance (sizes first: the spreading below measures them): compact far out
    // (small avatars that overlap, no device badges), small round badges at country level,
    // full size from a region in.
    const zoom = this.map.getZoom();
    this.el.classList.toggle('dl-lod-far', zoom < LOD_FAR);
    this.el.classList.toggle('dl-lod-mid', zoom >= LOD_FAR && zoom < LOD_MID);
    const items = this.slots.map((m) => {
      const p = this.map.project(m.at);
      const body = m.el.querySelector(':scope > .dl-mk-host, :scope > .dl-mk-av, :scope > .dl-mk-tile') as HTMLElement | null;
      return { x: p.x as number, y: p.y as number, r: (body?.offsetWidth || 24) / 2 + 3, fixed: m.fixed };
    });
    const fixed = items.filter((i) => i.fixed);
    this.merged = [];
    this.foldedKeys.clear();
    // Zooming out on its own (a new fit): distances as they will be, so folding happens at once.
    const ahead = this.targetZoom == null ? 1 : Math.min(1, 2 ** (this.targetZoom - this.map.getZoom()));
    items.forEach((it, i) => {
      if (it.fixed) return;
      const slot = this.slots[i];
      // A little more room to come back than to fold, so it doesn't flicker at the edge.
      const room = slot.el.classList.contains('merged') ? 12 : 6;
      const near = fixed.find((f) => Math.hypot(f.x - it.x, f.y - it.y) * ahead < f.r + it.r + room);
      slot.el.classList.toggle('merged', !!near);
      if (!near) return;
      if (slot.el.dataset.key) this.foldedKeys.add(slot.el.dataset.key);
      this.merged.push(face(slot));
      Object.assign(it, { r: 0, fixed: true });
    });
    this.pileUp(items);
    // A folded person leaves no trace either: their accuracy zone and arc go with their marker.
    const hidden = [...this.foldedKeys].sort().join('|');
    if (hidden !== this.hiddenKey) {
      this.hiddenKey = hidden;
      const shown = ['!', ['in', ['get', 'key'], ['literal', [...this.foldedKeys]]]];
      if (this.map.getLayer('dl-area')) this.map.setFilter('dl-area', shown);
      for (const live of [false, true]) {
        const id = live ? 'dl-arc-live' : 'dl-arc-recent';
        if (this.map.getLayer(id)) this.map.setFilter(id, ['all', ['==', ['get', 'online'], live], shown]);
      }
    }
    this.paintDock();
    // Hovering lights a person. A marker or avatar that went from under the pointer (a plate split
    // or closed as the map zoomed) sends no mouseleave: the light goes once nothing is hovered.
    if (this.focused && !this.el.querySelector('.dl-mk:hover, .dl-mk-face:hover')) this.focus(null);
    // Past the markers come the people plates (fixed, in the spreading only to be moved clear of).
    separate(items).forEach(([dx, dy], i) => {
      const m = this.slots[i];
      if (!m || m.fixed) return;
      if (items[i].fixed) [dx, dy] = [0, 0];
      m.marker.setOffset([dx, dy]);
      pointer(m.el, dx, dy);
    });
  }

  /**
   * The card fades out and goes; the map goes back to the view before a click zoomed in. Closed
   * by a press, that waits for the release: MapLibre stops a camera move when a press begins.
   */
  private closePopup(pressed = false) {
    const open = this.popup;
    if (!open || open.card.classList.contains('leaving')) return;
    open.card.classList.add('leaving');
    setTimeout(() => {
      if (this.popup === open) this.dropCard();
    }, 140);
    const back = this.before;
    this.before = null;
    if (!back) return;
    const go = () => this.map?.flyTo({ ...back, duration: 800 });
    if (!pressed) return go();
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      window.removeEventListener('pointerup', once, true);
      window.removeEventListener('pointercancel', once, true);
      // After MapLibre has taken the release too.
      setTimeout(go, 0);
    };
    window.addEventListener('pointerup', once, true);
    window.addEventListener('pointercancel', once, true);
    setTimeout(once, 1500);
  }

  /** The card gone at once (another one replaces it, or the map goes away). */
  private dropCard() {
    this.popup?.off();
    this.popup?.card.remove();
    this.popup = null;
  }

  /** The people folded into the server, in the corner card. */
  private showMerged(place: string) {
    if (!this.merged.length) return;
    dom.content(this.card, [
      E('div', { class: 'dl-map-card-head' }, [E('b', {}, `Near ${place}`), ' · click to zoom in']),
      ...this.merged.map((m) => E('div', { class: 'dl-map-card-row' }, [E('span', {}, m.who), E('span', { class: 'dl-faint' }, m.where)])),
    ]);
    this.card.classList.add('on');
  }

  /** The people on top of the server as avatars in its plate, which slides out for them and back. */
  private paintDock() {
    const dock = this.dock;
    if (!dock) return;
    const key = this.merged.map((m) => `${m.key}:${m.online ? 1 : 0}`).join('|');
    if (key === this.dockKey) return;
    this.dockKey = key;
    dock.parentElement?.classList.toggle('docked', this.merged.length > 0);
    // Emptied, it keeps its last avatars while it slides back.
    const home = this.slots.find((x) => x.fixed)!.at;
    if (this.merged.length)
      fillFaces(
        dock,
        this.merged,
        this.faceActions(() => [home]),
        this.dockQuiet,
      );
    this.dockQuiet = false;
  }

  /** What an avatar in a plate does: a click opens its card, hovering lights its person. */
  private faceActions(spot: () => [number, number][]) {
    return {
      click: (f: Face, b: HTMLElement) => this.openFace(f, b, spot()),
      hover: (f: Face | null) => this.focus(f?.g?.person ?? null),
    };
  }

  /**
   * People whose markers would cover each other (one city, or close at this zoom): one plate with
   * their avatars and the city once, where they are. Items of those in a plate leave the
   * spreading; the plate takes their place. Not on a person's page (their places spread).
   */
  private pileUp(items: { x: number; y: number; r: number; fixed: boolean }[]) {
    const live = new Set<string>();
    if (!this.data?.person && !this.data?.device) {
      const free = items.flatMap((it, i) => (!it.fixed && this.slots[i].el.querySelector(':scope > .dl-mk-av') ? [i] : []));
      const root = new Map(free.map((i) => [i, i]));
      const find = (i: number): number => (root.get(i) === i ? i : find(root.get(i)!));
      for (const a of free)
        for (const b of free) {
          if (b <= a) continue;
          const was = this.slots[a].el.classList.contains('piled') && this.slots[b].el.classList.contains('piled');
          if (Math.hypot(items[a].x - items[b].x, items[a].y - items[b].y) < items[a].r + items[b].r + (was ? 12 : 6))
            root.set(find(b), find(a));
        }
      const sets = new Map<number, number[]>();
      for (const i of free) sets.set(find(i), [...(sets.get(find(i)) ?? []), i]);
      for (const idx of sets.values()) {
        if (idx.length < 2) continue;
        const slots = idx.map((i) => this.slots[i]);
        const faces = slots.map(face);
        const key = faces
          .map((f) => f.key)
          .sort()
          .join(',');
        live.add(key);
        const at: [number, number] = [
          slots.reduce((s, x) => s + x.at[0], 0) / slots.length,
          slots.reduce((s, x) => s + x.at[1], 0) / slots.length,
        ];
        let pile = this.piles.get(key);
        if (!pile) {
          const box = E('span', { class: 'dl-mk-pile-box' });
          const cities = [...new Set(slots.map((x) => x.g?.city || x.g?.cc || '?'))];
          const el = E('div', { class: 'dl-mk-pile' }, [
            box,
            E('span', { class: 'dl-mk-label below' }, cities.length === 1 ? cities[0] : `${slots.length} people`),
          ]);
          pile = { marker: new this.gl.Marker({ element: el }).setLngLat(at).addTo(this.map), el, box, faces };
          el.addEventListener('mouseleave', () => this.focus(this.focused));
          const p = pile;
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.zoomInTo(
              p.faces.map((f) => f.at),
              false,
            );
          });
          this.piles.set(key, pile);
        }
        pile.faces = faces;
        const p = pile;
        fillFaces(
          pile.box,
          faces,
          this.faceActions(() => p.faces.map((x) => x.at)),
        );
        for (const i of idx) {
          this.slots[i].el.classList.add('piled');
          // In the spreading as the plate: it stays on its spot, others move clear of it.
          Object.assign(items[i], { r: 0, fixed: true });
        }
        const c = this.map.project(at);
        items.push({ x: c.x, y: c.y, r: (pile.el.offsetWidth || 60) / 2 + 3, fixed: true });
      }
    }
    this.piledKeys = new Set(this.slots.filter((x) => x.el.classList.contains('piled')).map((x) => x.el.dataset.key ?? ''));
    // Plates nobody is in any more fade out; their people show again.
    this.slots.forEach((x, i) => {
      if (!items[i].fixed || x.fixed || x.el.classList.contains('merged')) x.el.classList.remove('piled');
    });
    for (const [key, p] of this.piles)
      if (!live.has(key)) {
        this.piles.delete(key);
        p.el.classList.add('out');
        setTimeout(() => p.marker.remove(), 200);
      }
  }

  /**
   * The plate clicked: the server and everyone docked in it. All in the server's city: that city;
   * someone further: the server and them filling the map.
   */
  private zoomToMerged() {
    if (!this.map || !this.merged.length) return;
    this.zoomInTo([this.slots.find((m) => m.fixed)!.at, ...this.merged.map((m) => m.at)], false);
  }

  /**
   * An avatar in a plate clicked: its card. Sharing the plate's spot (the same city as everyone
   * else in it), it stays in the plate and the card opens there; further away, the map flies to
   * them first and the card opens on their own marker once it stands apart.
   */
  private openFace(f: Face, avatar: HTMLElement, spot: [number, number][]) {
    if (!f.g) return;
    if (spot.every((p) => km(p, f.at) < 1)) return this.openPopup(f.g, f.at, avatar);
    const open = () => {
      const slot = this.slots.find((x) => x.el.dataset.key === f.key);
      if (slot?.g && !slot.el.classList.contains('merged') && !slot.el.classList.contains('piled'))
        this.openPopup(slot.g, slot.at, slot.el);
    };
    if (this.zoomInTo(this.nearby(f.at), true)) this.map.once('moveend', open);
    else open();
  }

  /** Where the people around a place are (in the same city, the place itself included). */
  private nearby(at: [number, number]): [number, number][] {
    return [at, ...this.slots.filter((x) => !x.fixed && x.at !== at && km(x.at, at) <= CITY_KM).map((x) => x.at)];
  }

  /**
   * Closer, to show these places together: city level (zoom 10) when they are one city, else
   * fitted (never past 12). Never zooms out. `remember` keeps the view to fly back to when the
   * card closes. True when the map moves.
   */
  private zoomInTo(pts: [number, number][], remember: boolean): boolean {
    const b = new this.gl.LngLatBounds();
    for (const p of pts) b.extend(p);
    const wide = pts.some((p) => pts.some((q) => km(p, q) > CITY_KM));
    const cam = this.map.cameraForBounds(b, { padding: 50, maxZoom: wide ? 12 : CLICK_ZOOM });
    const zoom = this.map.getZoom();
    // And close enough for markers on different spots to stand apart (those on one spot never do).
    const px = pts.map((p) => this.map.project(p));
    let part = 0;
    px.forEach((a, i) =>
      px.slice(i + 1).forEach((c) => {
        const d = Math.hypot(a.x - c.x, a.y - c.y);
        const z = zoom + Math.log2(PART_PX / Math.max(d, 1e-6));
        if (z <= 12) part = Math.max(part, z);
      }),
    );
    const target = Math.min(12, Math.max(cam?.zoom ?? 0, part));
    if (target <= zoom + 0.05) return false;
    if (remember && !this.before) this.before = { center: this.map.getCenter().toArray(), zoom };
    this.map.flyTo({ center: cam?.center ?? b.getCenter(), zoom: target, duration: 800 });
    return true;
  }

  /**
   * A place on a person's page: a rounded tile with the latest device's icon (and how many
   * devices, when several), blue while one is live, gray and fainter the longer ago it was
   * (down to 40% at 30 days); the city and when below.
   */
  private placeMarker(g: Group, at: [number, number], person: Person | undefined): HTMLElement {
    const now = this.data!.now;
    const latest = [...g.points].sort((a, b) => Number(b.online) - Number(a.online) || b.ts - a.ts)[0];
    const kind = person?.devices.find((d) => d.id === latest.device)?.kind ?? 'other';
    const n = g.points.length;
    const tile = E('span', { class: 'dl-mk-tile' });
    tile.innerHTML = iconSvg(kind, 'dl-mk-tile-ic') + (n > 1 ? `<span class="dl-mk-tile-n">${n}</span>` : '');
    const when = g.online ? 'now' : ago(g.ts, now);
    const el = E(
      'button',
      {
        type: 'button',
        class: `dl-mk place${g.online ? ' online' : ''}`,
        style: g.online ? null : `--dl-mk-fade:${Math.max(0.4, 1 - (0.6 * (now - g.ts)) / (30 * 86400)).toFixed(2)}`,
        'aria-label': `${n} device${n === 1 ? '' : 's'} in ${g.city || 'an unknown city'}, ${when}`,
      },
      [tile, E('span', { class: 'dl-mk-label below' }, [g.city || g.cc || '?', E('span', { class: 'dl-mk-when' }, when)])],
    );
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.openPopup(g, at, el);
    });
    return el;
  }

  /**
   * A place in a device's window: the live one as a blue tile with the device's icon and
   * "now", the earlier ones as small gray tiles numbered by recency (1 = most recent).
   */
  private stepMarker(g: Group, at: [number, number], person: Person | undefined, n: number): HTMLElement {
    if (g.online) return this.placeMarker(g, at, person);
    const when = ago(g.ts, this.data!.now);
    const el = E('button', { type: 'button', class: 'dl-mk place step', 'aria-label': `${n}: ${g.city || 'an unknown city'}, ${when}` }, [
      E('span', { class: 'dl-mk-tile sm' }, String(n)),
      E('span', { class: 'dl-mk-label below' }, [g.city || g.cc || '?', ` · ${when}`]),
    ]);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.openPopup(g, at, el);
    });
    return el;
  }

  /**
   * One person in focus (hovering any of their markers): all their places and arcs stay,
   * everyone else fades, and a card lists their devices with where and when.
   */
  private focus(person: string | null) {
    this.focused = person;
    for (const x of this.people) {
      x.el.classList.toggle('dim', !!person && x.person !== person);
      x.el.classList.toggle('hl', x.person === person);
    }
    const opacity = person ? ['case', ['==', ['get', 'person'], person], 0.85, 0.15] : 0.85;
    for (const id of ['dl-arc-live', 'dl-arc-recent']) if (this.map?.getLayer(id)) this.map.setPaintProperty(id, 'line-opacity', opacity);
    this.card.classList.toggle('on', !!person);
    if (!person || !this.data) return;
    const data = this.data;
    const who = data.people.find((x) => x.id === person);
    const pts = visiblePoints(data, this.range)
      .filter((p) => p.person === person)
      .sort((a, b) => Number(b.online) - Number(a.online) || b.ts - a.ts);
    dom.content(this.card, [
      E('div', { class: 'dl-map-card-head' }, [E('b', {}, who?.name ?? person), ` · ${pts.length} device${pts.length === 1 ? '' : 's'}`]),
      ...pts.map((p) =>
        E('div', { class: 'dl-map-card-row' }, [
          E('span', {}, who?.devices.find((d) => d.id === p.device)?.name ?? 'Device'),
          E('span', { class: 'dl-faint' }, `${p.city || p.cc || '?'} · ${p.online ? 'now' : ago(p.ts, data.now)}`),
        ]),
      ),
    ]);
  }

  /**
   * Zoom to what matters: the points fill the map, never closer than zoom 12 (11 on a person's page)
   * (one place, or a few in one city, shows the neighbourhood), and lone
   * outliers never shrink everything to a continent (the farthest 10% are
   * left out when the rest are clustered).
   */
  private fit(coords: [number, number][], animate = false) {
    if (!coords.length) return;
    const km = (a: [number, number], b: [number, number]) => {
      const r = Math.PI / 180;
      const dLat = (b[1] - a[1]) * r,
        dLon = (b[0] - a[0]) * r;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
      return 12742 * Math.asin(Math.sqrt(h));
    };
    const center: [number, number] = [
      coords.reduce((s, c) => s + c[0], 0) / coords.length,
      coords.reduce((s, c) => s + c[1], 0) / coords.length,
    ];
    let pts = coords;
    if (coords.length >= 5) {
      const sorted = [...coords].sort((a, b) => km(center, a) - km(center, b));
      pts = sorted.slice(0, Math.ceil(sorted.length * 0.9));
    }
    const b = new this.gl.LngLatBounds(pts[0], pts[0]);
    pts.forEach((c) => b.extend(c));
    const h = this.el.clientHeight || 380;
    const opts = {
      // Just enough room for the labels: the server's chip above its plate, a place's name above its dot.
      padding: { top: Math.min(60, h / 5), bottom: Math.min(40, h / 8), left: 48, right: 48 },
      // A person's page shows a little more around a single place.
      maxZoom: this.data?.person ? 11 : 12,
    };
    if (!animate) this.map.fitBounds(b, { ...opts, duration: 0 });
    else this.glide(this.map.cameraForBounds(b, opts)?.zoom ?? null, () => this.map.fitBounds(b, { ...opts, duration: 1200 }));
  }

  /** A programmatic move to `zoom`: markers are decluttered for where it ends, then follow it. */
  private glide(zoom: number | null, move: () => void) {
    this.targetZoom = zoom;
    this.declutter();
    this.map.once('moveend', () => {
      this.targetZoom = null;
      this.declutter();
    });
    move();
  }

  private openPopup(g: Group, at: [number, number], el?: HTMLElement) {
    const data = this.data!;
    const where = [g.city, g.cc || g.country].filter(Boolean).join(', ');
    const people = [...new Set(g.points.map((p) => p.person))];
    const rows = g.points
      .sort((a, b) => Number(b.online) - Number(a.online) || b.ts - a.ts)
      .map((p) => {
        const person = data.people.find((x) => x.id === p.person);
        const dev = person?.devices.find((d) => d.id === p.device);
        return E('button', { type: 'button', class: 'dl-pop-row', click: () => this.cb.openDevice(p.person, p.device) }, [
          E('span', { class: `dl-pop-dot${p.online ? ' on' : ''}` }),
          E('span', { class: 'dl-pop-name' }, [E('b', {}, person?.name ?? p.person), ` · ${dev?.name ?? 'device'}`]),
          E('span', { class: 'dl-faint dl-nowrap' }, p.online ? 'now' : ago(p.ts, data.now)),
        ]);
      });
    const body = E('div', { class: 'dl-pop' }, [
      E('div', { class: 'dl-pop-head' }, [
        E('span', { class: 'dl-pop-net' }, icon('globe')),
        E('div', { class: 'dl-stack' }, [
          E('strong', {}, g.org || 'Unknown network'),
          E('span', { class: 'dl-faint' }, [g.asn ? `AS${g.asn} · ` : '', where ? `${where} · approximate` : 'approximate location']),
        ]),
      ]),
      E('div', { class: 'dl-pop-list' }, rows),
      people.length === 1
        ? E('div', { class: 'dl-pop-actions' }, [
            E(
              'button',
              { type: 'button', class: 'cbi-button cbi-button-positive important', click: () => this.cb.openPerson(people[0]) },
              `Open ${data.people.find((x) => x.id === people[0])?.name ?? 'person'}`,
            ),
          ])
        : '',
    ]);
    // Closer to a marker clicked from afar: its city, with whoever else is there; the card itself never moves the map.
    this.zoomInTo(this.nearby(at), true);
    this.dropCard();
    const card = E('div', { class: 'dl-root dl-popcard', role: 'dialog' }, [E('span', { class: 'dl-popcard-tip' }), body]);
    document.body.appendChild(card);
    const mapEl = this.el;
    const marker = (el?.querySelector('.dl-mk-av, .dl-mk-tile') as HTMLElement | null) ?? el ?? null;
    // Above the marker when the window has room there, else below; inside the window sideways;
    // hidden while the marker is outside the map.
    const place = () => {
      if (!marker) return;
      const r = marker.getBoundingClientRect();
      const m = mapEl.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      card.classList.toggle('away', cx < m.left || cx > m.right || cy < m.top || cy > m.bottom);
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const above = r.top - h - 12 >= 8 || r.top > window.innerHeight - r.bottom;
      const left = Math.min(Math.max(8, cx - w / 2), window.innerWidth - w - 8);
      card.classList.toggle('above', above);
      card.classList.toggle('below', !above);
      card.style.left = `${left}px`;
      card.style.top = `${above ? r.top - h - 12 : r.bottom + 12}px`;
      card.style.setProperty('--tip-x', `${cx - left}px`);
    };
    // A press anywhere but the card or a marker (a marker opens its own) closes it, as do Esc,
    // scrolling the page (not the card's own list) and going to another page.
    const outside = (ev: Event) => {
      if (!(ev.target as HTMLElement | null)?.closest('.dl-popcard, .maplibregl-marker')) this.closePopup(true);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') this.closePopup();
    };
    const scrolled = (ev: Event) => {
      if (!(ev.target instanceof Element && ev.target.closest('.dl-popcard'))) this.closePopup();
    };
    const close = () => this.closePopup();
    this.map.on('move', place);
    window.addEventListener('scroll', scrolled, { capture: true, passive: true });
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc);
    const offNav = onNavigate(close);
    window.addEventListener('pagehide', close);
    this.popup = {
      card,
      off: () => {
        this.map?.off('move', place);
        window.removeEventListener('scroll', scrolled, true);
        window.removeEventListener('resize', place);
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', esc);
        offNav();
        window.removeEventListener('pagehide', close);
      },
    };
    // Hidden with its page section (another one shown): gone too.
    const watch = window.setInterval(() => {
      if (this.popup?.card !== card) return clearInterval(watch);
      if (!mapEl.isConnected || !mapEl.getClientRects().length) this.dropCard();
    }, 400);
    place();
  }
}

/**
 * How far each circle has to move (screen px) so none overlap by more than nothing, with `gap`
 * between them: overlapping pairs are pushed apart by the overlap, half each, all of it on the
 * one that isn't `fixed`. A few rounds settle a crowd; the result follows the input smoothly.
 */
export function separate(items: { x: number; y: number; r: number; fixed?: boolean }[], gap = 6): [number, number][] {
  const p = items.map((i) => ({ x: i.x, y: i.y }));
  for (let round = 0; round < 16; round++) {
    let moved = false;
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i],
          b = items[j];
        if (a.fixed && b.fixed) continue;
        let dx = p[j].x - p[i].x,
          dy = p[j].y - p[i].y,
          d = Math.hypot(dx, dy);
        const push = a.r + b.r + gap - d;
        if (push <= 0) continue;
        if (d < 0.01) {
          // On the very same spot: a fixed direction per pair, so they part the same way every time.
          const t = (i + 1) * 2.399 + j;
          [dx, dy, d] = [Math.cos(t), Math.sin(t), 1];
        }
        const wa = a.fixed ? 0 : b.fixed ? 1 : 0.5;
        const wb = 1 - wa;
        p[i].x -= (dx / d) * push * wa;
        p[i].y -= (dy / d) * push * wa;
        p[j].x += (dx / d) * push * wb;
        p[j].y += (dy / d) * push * wb;
        moved = true;
      }
    if (!moved) break;
  }
  return p.map((q, i) => [q.x - items[i].x, q.y - items[i].y]);
}

/** The line from a moved marker back to its real spot, with a dot there (hidden when in place). */
/**
 * Where each person stands in their city. The IP gives the city alone, so everyone gets their
 * own spot in it, fixed by who they are and the city (a hash, the same on every redraw),
 * 1.5-5 km from its centre. One that would land within 1.3 km of someone placed
 * before (in key order) or of the server turns further round the city until clear, so all of
 * them part by zoom 12.
 */
export function cityPlaces(
  items: { key: string; lat: number; lon: number }[],
  home: { lat: number; lon: number } | null,
): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const taken: [number, number][] = home ? [[home.lon, home.lat]] : [];
  const near = (p: [number, number]) => taken.some((q) => km(p, q) < 1.3);
  for (const it of [...items].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    const h = hash(it.key);
    const r0 = 1.5 + 3.5 * ((h >>> 12) / 0xfffff);
    const a0 = ((h & 0xfff) / 0x1000) * 2 * Math.PI;
    let at: [number, number] = [it.lon, it.lat];
    // Golden-angle turns (and a little further out each time) until clear.
    for (let i = 0; i < 24; i++) {
      const a = a0 + i * 2.39996;
      const r = Math.min(8, r0 + i * 0.25);
      at = [it.lon + (r * Math.sin(a)) / (111.32 * Math.cos((it.lat * Math.PI) / 180)), it.lat + (r * Math.cos(a)) / 111.32];
      if (!near(at)) break;
    }
    taken.push(at);
    out.set(it.key, at);
  }
  return out;
}

/** FNV-1a: a small stable number for a string. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Someone in a plate (the server's, or a pile of people): who, where, and their place. */
export interface Face {
  key: string;
  who: string;
  where: string;
  online: boolean;
  at: [number, number];
  /** The device badge of their own marker (one or two icons, or how many). */
  badge: string;
  g?: Group;
}

function face(slot: { el: HTMLElement; at: [number, number]; who?: string; where?: string; g?: Group }): Face {
  return {
    key: slot.el.dataset.key ?? '',
    who: slot.who ?? 'Someone',
    where: slot.where ?? '',
    online: !!slot.g?.online,
    at: slot.at,
    badge: slot.el.querySelector('.dl-mk-badge')?.innerHTML ?? '',
    g: slot.g,
  };
}

/**
 * Avatars in a plate, by person, each with their marker's device badge. Three at most (two and
 * "+N"). Changes glide (FLIP): avatars that stay slide to their new places, new ones pop in (not
 * when `quiet`: a redraw), gone ones leave the row at once and shrink away where they were, the
 * "+N" is one element whose number changes, and the plate's width follows smoothly.
 */
export function fillFaces(
  box: HTMLElement,
  faces: Face[],
  on: { click: (f: Face, b: HTMLElement) => void; hover: (f: Face | null) => void },
  quiet = false,
) {
  const many = faces.length > 3;
  const live = () => [...box.children].filter((c) => !c.classList.contains('out')) as HTMLElement[];
  const was = new Map(live().map((c) => [c, c.getBoundingClientRect().left]));
  const width0 = box.getBoundingClientRect().width;
  const keep = new Map<string, HTMLElement>();
  box.querySelectorAll<HTMLElement>('.dl-mk-face:not(.out)').forEach((b) => keep.set(b.dataset.key ?? '', b));
  let more = box.querySelector<HTMLElement>('.dl-mk-more:not(.out)');
  const leave = (el: HTMLElement) => {
    // Out of the row at once, where it was: the others close up while it shrinks away.
    Object.assign(el.style, { position: 'absolute', left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, transform: '' });
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };
  const row: HTMLElement[] = [];
  for (const f of faces.slice(0, many ? 2 : 3)) {
    let b = keep.get(f.key);
    keep.delete(f.key);
    if (!b) {
      const nb = E('button', { type: 'button', class: `dl-mk-face${quiet ? '' : ' in'}`, 'data-key': f.key }, [
        E('span', { class: 'dl-mk-av' }, initials(f.who)),
        // Beside the avatar, not over it: the plate makes room for one icon, two, or a number.
        E('span', { class: 'dl-mk-badge' }),
      ]);
      nb.addEventListener('animationend', () => nb.classList.remove('in'), { once: true });
      b = nb;
    }
    const el = b;
    const badge = el.querySelector('.dl-mk-badge') as HTMLElement;
    if (badge.innerHTML !== f.badge) badge.innerHTML = f.badge;
    el.title = `${f.who} · ${f.where}`;
    el.setAttribute('aria-label', `${f.who}, ${f.where}`);
    el.classList.toggle('on', f.online);
    el.onclick = (ev) => {
      ev.stopPropagation();
      on.click(f, el);
    };
    el.onmouseenter = () => on.hover(f);
    el.onmouseleave = () => on.hover(null);
    row.push(el);
  }
  for (const b of keep.values()) leave(b);
  if (many) {
    if (!more) {
      more = E('span', { class: `dl-mk-more${quiet ? '' : ' in'}` });
      const m = more;
      m.addEventListener('animationend', () => m.classList.remove('in'), { once: true });
    }
    more.textContent = `+${faces.length - 2}`;
    row.push(more);
  } else if (more) leave(more);
  // In order, moving only what is out of place (moving a node restarts nothing, but costs a reflow).
  let prev: Element | null = null;
  for (const el of row) {
    const want: Element | null = prev ? prev.nextElementSibling : box.firstElementChild;
    if (want !== el) {
      if (prev) prev.after(el);
      else box.prepend(el);
    }
    prev = el;
  }
  // FLIP: from where each one was to where it is now.
  for (const el of row) {
    const x0 = was.get(el);
    if (x0 == null) continue;
    const dx = x0 - el.getBoundingClientRect().left;
    if (Math.abs(dx) < 0.5) continue;
    el.style.transition = 'none';
    el.style.transform = `translateX(${dx}px)`;
    void el.offsetWidth;
    el.style.transition = '';
    el.style.transform = '';
  }
  // And the plate's width, from what it was to what it now needs.
  box.style.width = '';
  const width1 = box.getBoundingClientRect().width;
  if (width0 && Math.abs(width1 - width0) > 0.5) {
    box.style.width = `${width0}px`;
    void box.offsetWidth;
    box.style.width = `${width1}px`;
    const done = () => {
      box.style.width = '';
      box.removeEventListener('transitionend', done);
    };
    box.addEventListener('transitionend', done);
    setTimeout(done, 400);
  }
}

/** Great-circle distance in km. */
function km(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pointer(el: HTMLElement, dx: number, dy: number) {
  let ptr = el.querySelector(':scope > .dl-mk-ptr') as HTMLElement | null;
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    ptr?.remove();
    return;
  }
  if (!ptr) {
    ptr = E('span', { class: 'dl-mk-ptr' }, [E('i', { class: 'line' }), E('i', { class: 'spot' })]);
    el.prepend(ptr);
  }
  const line = ptr.firstElementChild as HTMLElement;
  const spot = ptr.lastElementChild as HTMLElement;
  line.style.width = `${len}px`;
  line.style.transform = `rotate(${Math.atan2(-dy, -dx)}rad)`;
  spot.style.transform = `translate(${-dx}px, ${-dy}px)`;
}

interface Group {
  key: string;
  person: string;
  lat: number;
  lon: number;
  city: string;
  country: string;
  cc: string;
  asn: number;
  org: string;
  online: boolean;
  ts: number;
  points: GeoPoint[];
}

/** Segmented range control for the map header. */
export function rangeControl(initial: Range, onChange: (r: Range) => void, online = true): HTMLElement {
  const opts: [Range, string][] = [
    ['online', 'Online now'],
    ['24h', '24h'],
    ['7d', '7 days'],
    ['30d', '30 days'],
  ];
  const el = E('div', { class: 'dl-seg', role: 'tablist' });
  for (const [v, label] of opts) {
    if (v === 'online' && !online) continue;
    el.appendChild(
      E(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: v === initial ? 'on' : '',
          'data-v': v,
          click: () => {
            el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
            onChange(v);
          },
        },
        label,
      ),
    );
  }
  return el;
}
