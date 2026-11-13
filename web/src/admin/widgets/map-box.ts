// A page's map: the admin's own (map.ts: MapLibre on a globe, the router as
// the hub, an arc to each place) in a box that keeps its place. The map lives
// in a module of its own (shell/maps.ts): the box holds its height on the
// field while the module loads the first time, and says so when it could not.
// What it shows is read from the page each time (`data`), so a filter or a
// fresh status is one refresh. A phone keeps one WebGL map alive: while a
// close-up holds its own, the page's maps step aside (park) and come back when
// it closes.

import type { ConnectionMap, MapCallbacks, MapData, Range } from '../map';
import { h } from '../../portal/dom';
import { onNavigate } from '../ui/nav';
import { loadMaps, type MapKit } from '../shell/maps';
import { errorText } from '../ui/toast';
import { putChildren } from '../../portal/ui/put';

export interface MapBox {
  el: HTMLElement;
  /** Another period. */
  setRange(r: Range): void;
  /** What it shows changed (filters, a new status): read again. */
  refresh(): void;
  /** A city's markers in focus (null: none), and the camera held on a city (null: everyone again): ConnectionMap's. */
  hoverCity(key: string | null): void;
  showCity(key: string | null): void;
}

/** The page maps on screen now, for park(). */
const boxes = new Set<{ park(): void; unpark(): void; el: HTMLElement }>();

/** Every page map out of the way (its place kept); returns the way back. */
export function parkMaps(): () => void {
  const now = [...boxes].filter((b) => b.el.isConnected);
  now.forEach((b) => b.park());
  return () => now.forEach((b) => b.unpark());
}

/** `height`: px, or 'fill': as high as the box its page gives it (People › Map's stage). */
export function mapBox(o: { height: number | 'fill'; range: Range; data: () => MapData; cb: MapCallbacks }): MapBox {
  let range = o.range;
  let map: ConnectionMap | null = null;
  let kit: MapKit | null = null;
  let parked = false;
  /** The city the page has open: kept across a park. */
  let city: string | null = null;
  const el = h('div', { class: 'map-box' });
  /** Its place held on the field (`words`: why there is no map). */
  const hold = (words?: string) => {
    const gap = h('div', { class: 'map-park' }, words ? h('span', { class: 'map-why' }, words) : null);
    gap.style.height = o.height === 'fill' ? '100%' : `${o.height}px`;
    putChildren(el, [gap]);
  };
  const make = () => {
    if (!kit || parked) return;
    const m = (map = new kit.ConnectionMap(o.cb, range, o.height === 'fill' ? 380 : o.height));
    if (o.height === 'fill') m.el.style.height = '100%';
    // what the page held while the map was away (parked, loading) is put back once it stands
    if (city) void m.drawn.then(() => map === m && (m.hoverCity(city), m.showCity(city)));
    putChildren(el, [m.el]);
    // Mounted once it is in the page and laid out.
    requestAnimationFrame(() => {
      if (map === m && el.isConnected) void m.mount(o.data());
    });
  };
  const self = {
    el,
    park() {
      parked = true;
      if (!map) return;
      map.destroy();
      map = null;
      hold();
    },
    unpark() {
      parked = false;
      if (!map && el.isConnected) make();
    },
  };
  boxes.add(self);
  const off = onNavigate(() => {
    boxes.delete(self);
    off();
  });
  hold();
  loadMaps().then(
    (k) => {
      kit = k;
      make();
    },
    (e) => hold(errorText(e)),
  );
  return {
    el,
    setRange(r) {
      range = r;
      map?.setRange(r);
    },
    refresh() {
      map?.update(o.data());
    },
    hoverCity(k) {
      map?.hoverCity(k ?? city);
    },
    showCity(k) {
      city = k;
      map?.showCity(k);
    },
  };
}
