// Places as rows with a strip of when the device was there (the close-up's form).
// - A device's panel (devicePlaces): the close-up's own rows (places/render.ts PlacesView: the round mark, the
//   city, «operator · share», the time and the IP, the strip under them, the axis below) drawn without a map, the
//   period on a track for the block's head; a press on the rows, or «Map and replay», opens the close-up
//   (flows/places-closeup.ts) with its map and replay. The rows come with the map's module (shell/maps.ts), asked
//   for once the panel stands: the block holds its place meanwhile, and what lands in it later (the rows, another
//   period) comes in: the block glides to its height and the rows come into focus, as a change inside a sheet
//   does (the owner, 2026-11-12: «исправь моментальное появление»).
// - A row of the map view's list and of a person's panel (placeRow): a face (or the device's icon in its person's
//   panel), who and which, the operator, the strip for the period, when.

import type { Device, GeoPoint, LogEvent, Person, Status } from '../../shared/types';
import { h } from '../../portal/dom';
import { ago } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import { plainOrg } from '../../shared/org';
import type { ConnectionMap } from '../map';
import type { PlacesView, Span } from '../places/render';
import { placeKey, stretches, stripRuns, visits, type Period } from '../places/model';
import { tabs } from '../ui/tabs';
import { ic } from '../ui/icons';
import { face } from '../ui/face';
import { errorText } from '../ui/toast';
import { loadMaps } from '../shell/maps';
import { openCloseUp } from '../flows/places-closeup';
import { EASE_OUT, play } from '../../portal/motion';
import { grown } from '../../portal/ui/grown';
import { putChildren } from '../../portal/ui/put';

/**
 * The rows changed: their box goes to its new height from the one it had (ui/reshape.ts grown), so what stands
 * under it (the way to the map, the blocks below) travels with its edge and never crosses the rows; a dialog follows
 * by itself. `fresh`: the box stood empty until now (the rows have just been loaded), so they blur in; rows that
 * take the place of others on a pick (another period) do not: faded out and in, the block stood empty for a beat
 * between the two (the owner, 2026-11-12: «глитч когда переходишь по 24 7 30»).
 */
function arrive(rows: HTMLElement, change: () => void, fresh = false) {
  // not on screen yet (its panel waits to be shown whole): it is simply there when it is
  if (!rows.isConnected) return change();
  const h0 = rows.offsetHeight;
  change();
  grown(rows, h0);
  if (fresh)
    play(
      rows,
      [
        { opacity: 0, filter: 'blur(4px)' },
        { opacity: 1, filter: 'none' },
      ],
      { duration: 280, delay: 60, easing: EASE_OUT, fill: 'backwards' },
    );
}

const SPAN: Record<Span, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
const SPANS: Span[] = ['24h', '7d', '30d'];
const spanLabel = (s: Span): string => ({ '24h': _('24h'), '7d': _('7 days'), '30d': _('30 days') })[s];

/** No map under these rows: what PlacesView tells its map goes nowhere. */
const noMap = new Proxy({}, { get: () => () => undefined }) as unknown as ConnectionMap;

export interface DevicePlaces {
  el: HTMLElement;
  /** The period's track, for the block's head. */
  range: HTMLElement;
  /** The rows are in (or could not be loaded). */
  ready: Promise<void>;
  update(st: Status, p: Person, d: Device, events: LogEvent[] | null): void;
}

/** A device's places as the close-up's rows, the period picked on a track; a press opens the close-up. */
export function devicePlaces(st0: Status, p0: Person, d0: Device, events0: LogEvent[] | null): DevicePlaces {
  let now = { st: st0, p: p0, d: d0, events: events0 };
  let span: Span = '7d';
  let view: PlacesView | null = null;
  const open = () => openCloseUp(now.d.id, now.st);
  const more = h('button', { type: 'button', class: 'pill-link pp-pl-go' }, _('Map and replay'), ic('chevron'));
  more.addEventListener('click', open);
  // their place held until the rows come
  const rows = h('div', { class: 'dplaces pp-dplaces', title: _('Open the map and the replay') }, h('div', { class: 'pp-pl-wait' }));
  // the rows are the door to the close-up (their strips seek only there, where the map is)
  rows.addEventListener('pointerdown', (e) => e.stopPropagation(), true);
  rows.addEventListener('click', open);
  const data = () => ({ geo: now.st.geo, now: now.st.now, person: now.p, device: now.d, events: now.events });
  // The rows are the map module's (cached once fetched): asked for at once, and `ready` says when they are in (or
  // could not be), so whoever opens the panel may wait for it and show it whole.
  const ready = loadMaps().then(
    (kit) => {
      const v = (view = new kit.PlacesView(noMap, span, data()));
      // the rows take the waiting place's
      arrive(rows, () => putChildren(rows, [v.el]), true);
    },
    (e) => arrive(rows, () => putChildren(rows, [h('p', { class: 'kt-none' }, errorText(e))]), true),
  );
  const range = tabs(
    SPANS.map((s) => ({ id: s, label: spanLabel(s) })),
    span,
    (r) => {
      span = r;
      // another period is another set of rows, drawn in their place: the block goes to their height
      if (view) arrive(rows, () => view!.setRange(r));
    },
    { cls: 'in-row kt-segs', label: _('Period') },
  ).el;
  return {
    el: h('div', { class: 'pp-places' }, rows, h('div', { class: 'pp-pl-foot' }, more)),
    range,
    ready,
    update(st, p, d, events) {
      now = { st, p, d, events };
      // drawn in place: when it is the log's first reading that lands, the panel brings its blocks in together
      // (pages/people/device: one glide of the dialog, not one a block)
      view?.update(data());
    },
  };
}

export interface PlaceRow {
  st: Status;
  pt: GeoPoint;
  p: Person;
  d: Device;
  /** Connection events of the period (null: not read yet, the strip stands empty). */
  events: LogEvent[] | null;
  /** The period the strip spans; 'online': the last 24 hours. */
  range: Period;
  href: string;
  /** In a person's panel: the device leads, the city under it. */
  own?: boolean;
  current?: boolean;
}

/** When device `d` was at `pt`'s place over the last `span` seconds, as [left, width] shares of a strip (none until the log is read). */
export function deviceRuns(st: Status, pt: GeoPoint, d: Device, events: LogEvent[] | null, span: number): [number, number][] {
  return events
    ? stripRuns(
        visits(stretches(events, d.id, st.now, d.online, d.handshake), st.geo.points, d.id, st.now - span),
        placeKey(pt),
        st.now,
        span,
      )
    : [];
}

/** Seconds a period spans ('online': the last 24 hours). */
export const spanOf = (r: Period): number => SPAN[r === 'online' ? '24h' : r];

/**
 * A strip: the track, and the runs over it as one layer (data-flat: a repaint keeps it or crosses it whole, never
 * run by run), in --live when `live`.
 */
export function runsStrip(runs: [number, number][], live: boolean): HTMLElement {
  return h(
    'span',
    { class: 'kt-strip', 'aria-hidden': 'true' },
    h(
      'span',
      { class: `kt-runs${live ? ' live' : ''}`, 'data-flat': true },
      ...runs.map(([l, w]) => {
        const i = h('i');
        i.style.left = `${(l * 100).toFixed(2)}%`;
        i.style.width = `${Math.max(0.6, w * 100).toFixed(2)}%`;
        return i;
      }),
    ),
  );
}

/** A device at a place: who and which, on what network, the strip of when, when last. */
export function placeRow(o: PlaceRow): HTMLElement {
  const { st, pt, p, d } = o;
  const strip = runsStrip(deviceRuns(st, pt, d, o.events, spanOf(o.range)), pt.online);
  const org = pt.org ? plainOrg(pt.org) : '';
  const city = pt.city || pt.cc;
  return h(
    'a',
    {
      class: `prow2 kt-prow${o.current ? ' cur' : ''}`,
      href: o.href,
      'data-device': d.id,
      title: fmt(_('Where %s has been'), `${p.name} · ${d.name}`),
    },
    o.own ? h('span', { class: 'kt-prow-ic' }, ic(d.kind)) : face(p.name, pt.online ? 'ok' : ''),
    h(
      'span',
      { class: 'prow2-t' },
      h('b', {}, o.own ? d.name : p.name),
      h('span', {}, (o.own ? [city, org] : [d.name, org]).filter(Boolean).join(' · ')),
      strip,
    ),
    h('span', { class: `prow2-w${pt.online ? ' now' : ''}` }, pt.online ? _('now') : ago(pt.ts, st.now)),
  );
}
