// A device's places as a close-up (a block of the page enlarged, read-only,
// so it opens for every login): the period on top, the map pinned under it
// with the replay's plate, the places scrolling under the map
// (places/render.ts PlacesView). 720 px wide on a computer, opened at that
// width (a 400 → 720 glide would resize the map on every frame); the whole
// height on a phone, where the page's own maps step aside meanwhile (one WebGL
// map at a time). Its address is the page's with sheet=places&device= (a
// reload opens it again, Back closes it). `at`: open on that moment (a session
// in the Log), the period the shortest that holds it. MapLibre starts once the
// sheet stands still and its first frame fades in. While open it follows the
// router (the live revision): the device's state and its new connections.
// From a person's page: their places, a track over the period picking «All
// devices» (their places together, no replay) or one of them; the page's own
// address stays, with sheet=places and the device picked as pick=.
// Nothing in it jumps: the map's box has its size from the first frame, every
// change of the rows (the log coming in, another period or device, a poll) is
// refilled in place while the sheet glides to its new height (sheet.ts glide).

import type { LogEvent, Status } from '../../shared/types';
import { api } from '../api';
import { h } from '../../portal/dom';
import { glide, head, onLeave, openSheet, sub, type View } from '../../portal/ui/sheet';
import { fmt } from '../../shared/i18n';
import type { MapCallbacks } from '../map';
import type { Span } from '../places/render';
import { createPoller } from '../state/poller';
import { tabs } from '../ui/tabs';
import { refill } from '../ui/reshape';
import { ic } from '../ui/icons';
import { parkMaps } from '../widgets/map-box';
import { loadMaps, type MapKit } from '../shell/maps';
import { errorText, notify } from '../ui/toast';
import { afterOpen, leaveTo, plain } from '../shell/sheets';
import { deviceUrl, here, personUrl, withCloseUp } from '../shell/routes';

const SPAN: Record<Span, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
const SPANS: Span[] = ['24h', '7d', '30d'];
/** The newest events the close-up reads (30 days of connections and roams of a device, or of a person's devices). */
const LIMIT = 5000;
/** The track's item for all of a person's devices. */
const ALL = '*';

const spanLabel = (s: Span) => ({ '24h': _('24h'), '7d': _('7 days'), '30d': _('30 days') })[s];
const spanWords = (s: Span) => ({ '24h': _('last 24 hours'), '7d': _('last 7 days'), '30d': _('last 30 days') })[s];

/** A device's events, or a person's (`person`), since the longest period began. */
const eventsOf = (st: Status, o: { device?: string; person?: string }) =>
  api.events(LIMIT, o.person, st.now - SPAN['30d'] - 1, o.person ? undefined : o.device).then((r) => r.events);

/**
 * Keep the address saying the close-up is open (on its own history entry), or not once it closes (null). On a
 * person's page (`own`) it stays theirs, the device picked (none: all of them) beside it.
 */
function address(device: string | null, own = false) {
  history.replaceState(history.state, '', withCloseUp(location.href, device, own));
}

/**
 * Open the close-up of device `id` over the page. `st`: the page's status (the close-up keeps its own fresh copy
 * while open). `person`: opened on that person's page, `devices` theirs with places (a track picks one, or all of
 * them: `id` null).
 */
export function openCloseUp(id: string | null, st: Status, o: { at?: number; devices?: string[]; person?: string } = {}) {
  const p = st.people.find((x) => (o.person ? x.id === o.person : x.devices.some((d) => d.id === id)));
  if (!p || (!id && !o.person)) return;
  const range: Span = o.at ? (SPANS.find((s) => st.now - o.at! <= SPAN[s]) ?? '30d') : '30d';
  const own = !!o.person;
  // The map's module first (at once once it is in): the sheet opens with its map.
  loadMaps().then(
    (kit) => {
      // The page's address without the close-up: the sheet's own entry, pushed on top of it, carries it.
      address(null);
      openSheet(() => view(kit, p.id, id, st, range, o.at, own ? (o.devices ?? []) : null));
      address(id, own);
    },
    (e) => notify(errorText(e), 'error', 10000),
  );
}

/**
 * `devices`: opened from a person's page, their devices with places: with several, a track over the period picks
 * whose places show (all of them, or one), in place.
 */
function view(kit: MapKit, pid: string, id0: string | null, first: Status, range0: Span, at?: number, devices?: string[] | null): View {
  let st = first;
  let p = st.people.find((x) => x.id === pid)!;
  let id = id0;
  const own = !!devices;
  const many = !!devices && devices.length > 1;
  const dev = () => (id ? (p.devices.find((x) => x.id === id) ?? null) : null);
  const narrow = !matchMedia('(min-width: 760px)').matches;
  const cb: MapCallbacks = {
    openPerson: (x) => leaveTo(personUrl(x)),
    openDevice: (_pid, did) => leaveTo(deviceUrl(did)),
  };
  let range = range0;
  const map = new kit.ConnectionMap(cb, range, narrow ? 240 : 380);
  const places = new kit.PlacesView(map, range, { geo: st.geo, now: st.now, person: p, device: dev(), events: null });
  const subEl = sub('');
  // the title names the person when it is theirs: the line under it says only the period
  const say = () => (subEl.textContent = many || !id ? spanWords(range) : `${p.name} · ${spanWords(range)}`);
  say();
  // Rows edge: they scroll under the map, their edge fades only where more is hidden under it.
  const rows = h('div', { class: 'lp-rows' }, places.el);
  const edge = () => rows.classList.toggle('more-down', rows.scrollTop + rows.clientHeight < rows.scrollHeight - 1);
  rows.addEventListener('scroll', edge, { passive: true });
  /** A change of what the sheet shows: the rows refill in place, the sheet glides to its new height (SMOOTH). */
  const change = (fn: () => void) => {
    glide(fn);
    requestAnimationFrame(edge);
  };
  const track = tabs(
    SPANS.map((s) => ({ id: s, label: spanLabel(s) })),
    range,
    (r) => {
      range = r;
      change(() => places.setRange(r));
      say();
    },
    { cls: 'range', label: _('Period') },
  );
  // The way to the device's own page: not on it (it is under the sheet), nor for all of a person's devices.
  const foot = h('div', { class: 'lp-foot' });
  const paintFoot = () => {
    const onItsPage = here().view === 'people' && new URLSearchParams(location.search).get('device') === id;
    const to = id && !onItsPage ? deviceUrl(id) : null;
    refill(
      foot,
      to
        ? [
            h(
              'a',
              {
                class: 'pill-link lp-open',
                href: to,
                onclick: (e: Event) => {
                  if (!plain(e)) return;
                  e.preventDefault();
                  leaveTo(to);
                },
              },
              _('Open the device'),
              ic('chevron'),
            ),
          ]
        : [],
    );
  };
  paintFoot();
  const title = many || !id ? fmt(_('Where they have been · %s'), p.name) : fmt(_('Where it has been · %s'), dev()?.name ?? '');
  const which =
    devices && devices.length > 1
      ? tabs(
          [
            { id: ALL, label: _('All devices') },
            ...devices.map((x) => ({
              id: x,
              label: p.devices.find((y) => y.id === x)?.name ?? x,
              icon: p.devices.find((y) => y.id === x)?.kind,
            })),
          ],
          id ?? ALL,
          (next) => {
            id = next === ALL ? null : next;
            address(id, true);
            change(() => {
              places.setDevice(dev());
              paintFoot();
            });
          },
          { cls: 'range lp-devs', label: _('Device') },
        ).el
      : null;
  const mapEl = h('div', { class: 'map-box dl-dmap' }, map.el, places.controls);
  const el = h(
    'div',
    { class: 'view look-places' },
    head(title),
    subEl,
    h('div', { class: 'dplaces lp' }, which, track.el, mapEl, rows, foot),
  );
  const unpark = narrow ? parkMaps() : null;
  let dead = false;
  // a person's page reads all their devices' events, so another pick needs none
  const scope = () => (own ? { person: pid } : { device: id! });

  // The log for its strips, and live: its state and new connections as they come.
  const poller = createPoller({
    fetch: () => Promise.all([api.status(1), eventsOf(st, scope())]),
    every: 30,
    live: true,
    active: () => !dead,
    apply: ([s, ev]: [Status, LogEvent[]]) => {
      st = s;
      const p2 = s.people.find((x) => x.id === pid);
      if (!p2 || (id && !p2.devices.some((x) => x.id === id))) return;
      p = p2;
      change(() => places.update({ geo: s.geo, now: s.now, person: p2, device: dev(), events: ev }));
    },
  });
  void (async () => {
    const ev = await eventsOf(st, scope()).catch(() => [] as LogEvent[]);
    if (dead) return;
    change(() => places.update({ events: ev }));
    await afterOpen();
    if (dead || !el.isConnected) return;
    edge();
    places.el.addEventListener('click', () => requestAnimationFrame(edge));
    // The map's box stands from the first frame; the map itself fades in once it has drawn (map.ts mount).
    await map.mount(places.mapData());
    if (at && !dead) places.seek(at);
  })();
  onLeave(() => {
    dead = true;
    poller.stop();
    unpark?.();
    // Gone with the sheet, once it has left the screen.
    setTimeout(() => {
      places.destroy();
      map.destroy();
    }, 460);
  });
  return { el, label: title };
}
