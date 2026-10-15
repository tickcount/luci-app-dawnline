// Connection map: MapLibre GL with a CARTO basemap (light or dark, following
// the Outline theme), the router as origin, one marker per device and an arc
// from the router to each one — solid and animated while the tunnel is live,
// dashed for recently seen. MapLibre loads from a CDN on first use.

import type { Geo, GeoPoint, Person } from '../shared/types';
import { E } from './e';
import { ago } from '../shared/format';
import { icon, iconSvg } from '../shared/icons';

const MAPLIBRE = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

export type Range = 'online' | '24h' | '7d' | '30d';
const WINDOW: Record<Range, number> = { online: 0, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };

let loading: Promise<any> | null = null;

/**
 * Load MapLibre once; tags go inside `host` so Outline's router is not
 * disturbed. The stylesheet goes into every map's own container: Outline
 * drops the previous page's DOM on navigation (and with it a shared link),
 * and without it HTML markers lose their positioning and vanish.
 */
function loadMapLibre(host: HTMLElement): Promise<any> {
  const w = window as any;
  host.appendChild(E('link', { rel: 'stylesheet', href: `${MAPLIBRE}.css` }));
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = E('script', { src: `${MAPLIBRE}.js` }) as HTMLScriptElement;
    s.onload = () => (w.maplibregl ? resolve(w.maplibregl) : reject(new Error('MapLibre failed to load')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load the map library (no internet access from this browser?)'));
    };
    host.appendChild(s);
  });
  return loading;
}

function isDark(): boolean {
  const attr = document.documentElement.getAttribute('data-darkmode');
  if (attr != null) return attr === 'true';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** A gentle arc between two [lng, lat] points (quadratic Bézier in map space). */
function arc(a: [number, number], b: [number, number], steps = 48): [number, number][] {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  // Bend to the left of the direction of travel, proportional to distance.
  const k = Math.min(0.25 * len, 12);
  const cx = mx - (dy / len) * k;
  const cy = my + (dx / len) * k;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
  }
  return out;
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
}

/** Latest point per device inside the time window. */
export function visiblePoints(data: MapData, range: Range): GeoPoint[] {
  const best = new Map<string, GeoPoint>();
  for (const p of data.geo.points) {
    if (data.person && p.person !== data.person) continue;
    if (range === 'online' ? !p.online : data.now - p.ts > WINDOW[range]) continue;
    const cur = best.get(p.device);
    if (!cur || (p.online && !cur.online) || (p.online === cur.online && p.ts > cur.ts)) best.set(p.device, p);
  }
  return [...best.values()];
}

export class ConnectionMap {
  private map: any = null;
  private gl: any = null;
  private markers: any[] = [];
  private popup: any = null;
  private anim = 0;
  private data: MapData | null = null;
  private range: Range;
  private fitted = false;
  readonly el: HTMLElement;
  private status: HTMLElement;

  constructor(
    private cb: MapCallbacks,
    range: Range = 'online',
    height = 380,
  ) {
    this.range = range;
    this.status = E('div', { class: 'dl-map-status' });
    this.el = E('div', { class: 'dl-geomap', style: `height:${height}px` }, this.status);
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
      zoom: 3,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: true,
    });
    this.map.addControl(new this.gl.NavigationControl({ showCompass: false }), 'bottom-right');
    this.map.on('load', () => {
      // City-level accuracy: a soft zone instead of a precise pin.
      this.map.addSource('dl-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      this.map.addLayer({
        id: 'dl-area',
        type: 'circle',
        source: 'dl-areas',
        paint: {
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 2, 6, 6, 26, 9, 140, 12, 900],
          'circle-color': ['case', ['get', 'online'], '#40c977', isDark() ? '#ededed' : '#0d0d0d'],
          'circle-opacity': ['case', ['get', 'online'], 0.12, 0.06],
          'circle-stroke-width': 1,
          'circle-stroke-color': ['case', ['get', 'online'], '#40c977', isDark() ? '#ededed' : '#0d0d0d'],
          'circle-stroke-opacity': ['case', ['get', 'online'], 0.35, 0.15],
        },
      });
      this.map.addSource('dl-arcs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      this.map.addLayer({
        id: 'dl-arc-recent',
        type: 'line',
        source: 'dl-arcs',
        filter: ['==', ['get', 'online'], false],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': isDark() ? '#ededed' : '#0d0d0d', 'line-opacity': 0.35, 'line-width': 1.5, 'line-dasharray': [2, 3] },
      });
      this.map.addLayer({
        id: 'dl-arc-glow',
        type: 'line',
        source: 'dl-arcs',
        filter: ['==', ['get', 'online'], true],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#40c977', 'line-opacity': 0.18, 'line-width': 7 },
      });
      this.map.addLayer({
        id: 'dl-arc-live',
        type: 'line',
        source: 'dl-arcs',
        filter: ['==', ['get', 'online'], true],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#40c977', 'line-width': 2 },
      });
      this.map.addLayer({
        id: 'dl-arc-flow',
        type: 'line',
        source: 'dl-arcs',
        filter: ['==', ['get', 'online'], true],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [0, 4, 3] },
      });
      this.animate();
      this.draw();
    });
  }

  setRange(r: Range) {
    this.range = r;
    this.fitted = false;
    this.draw();
  }

  update(data: MapData) {
    this.data = data;
    this.draw();
  }

  destroy() {
    cancelAnimationFrame(this.anim);
    this.map?.remove();
    this.map = null;
  }

  /** Moving highlight along live arcs (MapLibre "animated line" technique). */
  private animate() {
    const seq = [
      [0, 4, 3],
      [0.5, 4, 2.5],
      [1, 4, 2],
      [1.5, 4, 1.5],
      [2, 4, 1],
      [2.5, 4, 0.5],
      [3, 4, 0],
      [0, 0.5, 3, 3.5],
      [0, 1, 3, 3],
      [0, 1.5, 3, 2.5],
      [0, 2, 3, 2],
      [0, 2.5, 3, 1.5],
      [0, 3, 3, 1],
      [0, 3.5, 3, 0.5],
    ];
    let step = -1;
    let last = 0;
    const tick = (t: number) => {
      if (!this.map) return;
      if (t - last > 70) {
        last = t;
        step = (step + 1) % seq.length;
        if (this.map.getLayer('dl-arc-flow')) this.map.setPaintProperty('dl-arc-flow', 'line-dasharray', seq[step]);
      }
      this.anim = requestAnimationFrame(tick);
    };
    this.anim = requestAnimationFrame(tick);
  }

  /** Devices grouped by network operator and city: one marker per group. */
  private groups(pts: GeoPoint[]): Group[] {
    const map = new Map<string, Group>();
    for (const p of pts) {
      const key = `${p.asn || p.org || p.ip}|${p.city}|${p.cc}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
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
    const home = data.geo.home;
    for (const m of this.markers) m.remove();
    this.markers = [];

    // Operators in the same city sit side by side so every marker stays clickable.
    const perCity = new Map<string, number>();
    const placed = groups.map((g) => {
      const c = `${g.lat.toFixed(2)},${g.lon.toFixed(2)}`;
      const n = perCity.get(c) ?? 0;
      perCity.set(c, n + 1);
      return { g, at: [g.lon + n * 0.25, g.lat] as [number, number] };
    });

    this.map.getSource('dl-areas').setData({
      type: 'FeatureCollection',
      features: placed.map(({ g, at }) => ({
        type: 'Feature',
        properties: { online: g.online },
        geometry: { type: 'Point', coordinates: at },
      })),
    });
    this.map.getSource('dl-arcs').setData({
      type: 'FeatureCollection',
      features: home
        ? placed.map(({ g, at }) => ({
            type: 'Feature',
            properties: { online: g.online },
            geometry: { type: 'LineString', coordinates: arc([home.lon, home.lat], at) },
          }))
        : [],
    });

    if (home) {
      const el = E('div', {
        class: 'dl-mk-home',
        title: `Home router${home.city ? ` · ${home.city}` : ''}${home.org ? ` · ${home.org}` : ''}`,
      });
      el.innerHTML = iconSvg('home', 'dl-mk-home-ic');
      this.markers.push(new this.gl.Marker({ element: el }).setLngLat([home.lon, home.lat]).addTo(this.map));
    }

    for (const { g, at } of placed) {
      const n = g.points.length;
      const el = E(
        'button',
        {
          type: 'button',
          class: `dl-mk${g.online ? ' online' : ''}${n > 1 ? ' multi' : ''}`,
          'aria-label': `${n} device${n === 1 ? '' : 's'} via ${g.org || 'unknown network'} in ${g.city || 'unknown city'}`,
        },
        n > 1 ? E('span', { class: 'dl-mk-count' }, String(n)) : E('span', { class: 'dl-mk-dot' }),
      );
      const nearHome = !!home && Math.abs(at[0] - home.lon) < 0.02 && Math.abs(at[1] - home.lat) < 0.02;
      const shift: [number, number] = nearHome ? [22, -16] : [0, 0];
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.openPopup(g, at, shift);
      });
      this.markers.push(new this.gl.Marker({ element: el, offset: shift }).setLngLat(at).addTo(this.map));
    }

    if (!this.fitted) {
      const coords: [number, number][] = placed.map((x) => x.at);
      if (home && (coords.length === 0 || this.range !== 'online' || placed.some((x) => x.g.online))) coords.push([home.lon, home.lat]);
      this.fit(coords);
      this.fitted = true;
    }
    this.status.textContent = placed.length || home ? '' : 'No locations yet';
    this.status.style.display = this.status.textContent ? '' : 'none';
  }

  /**
   * Zoom to what matters: a single city fills the map at city level, a few
   * places get just enough room, and lone outliers never shrink everything to
   * a continent (the farthest 10% are left out when the rest are clustered).
   */
  private fit(coords: [number, number][]) {
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
    const spread = Math.max(...pts.map((c) => km(center, c)));
    if (spread < 25) {
      // Everyone in one city: show the city, accuracy zones included.
      this.map.jumpTo({ center, zoom: 9.5 });
      return;
    }
    const b = new this.gl.LngLatBounds(pts[0], pts[0]);
    pts.forEach((c) => b.extend(c));
    const h = this.el.clientHeight || 380;
    this.map.fitBounds(b, {
      padding: { top: Math.min(90, h / 4), bottom: Math.min(70, h / 5), left: 60, right: 60 },
      maxZoom: 9,
      duration: 0,
    });
  }

  private openPopup(g: Group, at: [number, number], shift: [number, number] = [0, 0]) {
    const data = this.data!;
    this.popup?.remove();
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
    // Make room above the marker so the popup is never cut by the map edge.
    const h = this.el.clientHeight || 380;
    this.map.easeTo({ center: at, offset: [0, Math.min(140, h * 0.32)], duration: 300 });
    this.popup = new this.gl.Popup({
      offset: [shift[0], shift[1] - 18],
      anchor: 'bottom',
      closeButton: false,
      focusAfterOpen: false,
      maxWidth: '300px',
      className: 'dl-popup',
    })
      .setLngLat(at)
      .setDOMContent(body)
      .addTo(this.map);
  }
}

interface Group {
  key: string;
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
