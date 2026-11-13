// Where a device went, under its map (the places close-up, flows/places-closeup.ts):
// a row per place with a strip of when it was there, and a replay of the period:
// the place it leaves goes gray, a blue shimmer runs along the dotted arc to the
// next place, which lights up. The rows are the portal's inset rows (a round
// mark, the city as the title, "operator · share" as the meta line, the time and
// the IP at the end, the strip under them, the axis below the stack). A strip is
// the replay's timeline: a click, a drag or the keys (← → a step, Home / End)
// go to that moment. The model is ./model; the map draws (ConnectionMap.replay,
// band, bandAt).
// All of a person's devices at once (no device): a row per place any of them was
// at, the devices there under the city, the strip when any of them was there; no
// replay (their stays overlap, and the map's person scope has no light to move).
// Every repaint changes the rows in place (ui/reshape.ts refill): the strips
// hold their place while the log is still coming, so it only fills them in.

import type { Device, Geo, LogEvent, Person } from '../../shared/types';
import { h } from '../../portal/dom';
import { icon } from '../../shared/icons';
import { ago } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import { plainOrg } from '../../shared/org';
import { devicePlaces, type ConnectionMap, type MapData, type Range } from '../map';
import { refill } from '../ui/reshape';
import { appear } from '../../portal/ui/morph';
import { EASE_IN, play } from '../../portal/motion';
import {
  MOVE_MS,
  arrived,
  bandMiddle,
  cities,
  clock,
  dayName,
  moment,
  msAt,
  placeKey,
  shares,
  replayStays,
  ticks,
  timeline,
  union,
  visitsOf,
  type Stay,
  type Step,
} from './model';

export interface PlacesData {
  geo: Geo;
  /** The router's clock (seconds). */
  now: number;
  person: Person;
  /** One of their devices; null: all of them. */
  device: Device | null;
  /** The activity log (the device's or the person's connects and roams); null until loaded. */
  events: LogEvent[] | null;
}

export type Span = Exclude<Range, 'online'>;
const SPAN: Record<Span, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
/** A keyboard step along a strip: an hour, six hours, a day. */
const STEP: Record<Span, number> = { '24h': 3600, '7d': 6 * 3600, '30d': 86400 };
const pct = (part: number, whole: number) => `${((part / whole) * 100).toFixed(3)}%`;

export class PlacesView {
  /** The rows under the map. */
  readonly el = h('div', { class: 'dl-dplaces' });
  /** The replay's controls, for the map's top corner. */
  readonly controls = h('div', { class: 'dl-map-replay' });
  private data: PlacesData;
  /** What came while the replay ran: shown once it ends (the replay plays what it started with). */
  private pending: PlacesData | null = null;
  private rows = new Map<string, HTMLElement>();
  private st: Stay[] = [];
  private steps: Step[] = [];
  private total = 0;
  /** Where the replay is (ms into it) and the step it showed last. */
  private ms = 0;
  private stepI = -1;
  /** In the replay (playing or paused), and playing. */
  private on = false;
  private playing = false;
  /** The moment the keys step from (the last seek), while the replay is paused on it. */
  private at: number | null = null;
  private raf = 0;
  private last = 0;
  private endTimer = 0;
  private play = h('button', { type: 'button', class: 'dl-map-btn' });
  private chip = h('span', { class: 'dl-map-chip' });
  /** The replay's plate fading away (nothing to replay any more). */
  private going: Animation | null = null;
  private stop = h('button', { type: 'button', class: 'dl-map-btn', title: _('Back to now'), 'aria-label': _('Back to now') }, icon('x'));
  private reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(
    private map: ConnectionMap,
    private range: Span,
    data: PlacesData,
  ) {
    this.data = data;
    this.play.addEventListener('click', () => this.toggle());
    this.stop.addEventListener('click', () => this.end());
    this.paint();
  }

  mapData(): MapData {
    const d = this.data;
    return { geo: d.geo, people: [d.person], now: d.now, person: d.person.id, device: d.device?.id };
  }

  /** New status or log: shown at once, or after the replay. */
  update(data: Partial<PlacesData>) {
    const next = { ...(this.pending ?? this.data), ...data };
    if (this.on) {
      this.pending = next;
      return;
    }
    this.data = next;
    this.map.update(this.mapData());
    this.paint();
  }

  /**
   * Another of the person's devices, or all of them (null): the replay ends, the rows change in place and the map
   * crosses to its new places (ConnectionMap.rescope), framed with the replay's plate as it now stands.
   */
  setDevice(d: Device | null) {
    this.end();
    this.data = { ...(this.pending ?? this.data), device: d };
    this.pending = null;
    this.paint();
    this.map.rescope(this.mapData());
  }

  setRange(r: Span) {
    this.end();
    this.range = r;
    this.map.setRange(r);
    this.paint();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.endTimer);
  }

  private get from() {
    return this.data.now - SPAN[this.range];
  }

  private paint() {
    const d = this.data;
    const span = SPAN[this.range];
    const from = this.from;
    const dev = d.device;
    const v = d.events ? visitsOf(d.events, dev ? [dev] : d.person.devices, d.geo.points, d.now, from) : [];
    const share = shares(v);
    this.st = dev ? replayStays(v) : [];
    // A row a place: the device's, numbered by recency; all of theirs, with the devices that were there.
    const pts = devicePlaces(this.mapData(), this.range);
    const kinds = new Map(d.person.devices.map((x) => [x.id, x]));
    const list = dev
      ? pts.map((p) => ({ p, n: p.n, devs: [dev] }))
      : cities(pts)
          .sort((a, b) => Number(b.live > 0) - Number(a.live > 0) || b.last - a.last)
          .map((c) => ({
            p: { ...c.points[0], online: c.live > 0, ts: c.last },
            n: 0,
            devs: c.points.map((x) => kinds.get(x.device)).filter((x): x is Device => !!x),
          }));
    // The strips hold their place while the log is coming; without its connections (the category off) there are none.
    const strips = !d.events || v.length > 0;
    const replay = this.st.length > 1;
    this.el.classList.toggle('strips', strips);
    this.el.classList.toggle('can-replay', replay);
    this.el.classList.toggle('all', !dev);
    this.rows.clear();
    if (!list.length) {
      refill(this.el, [h('div', { class: 'dl-sub' }, _('No locations in this period.'))]);
      this.paintControls();
      return;
    }
    const rows = list.map(({ p: x, n, devs }) => {
      const key = placeKey(x);
      const sh = share.get(key);
      const city = x.city || x.cc || _('Unknown city');
      // A place it was at only before the period (no share of it) says so, quieter; not while the log is coming.
      const pre = !!d.events && sh == null && !x.online;
      const meta = [
        x.org ? plainOrg(x.org) : '',
        sh != null ? fmt(_('%s%% of the time'), sh > 0 && sh < 0.005 ? '<1' : Math.round(sh * 100)) : pre ? _('before this period') : '',
      ].filter(Boolean);
      const strip = strips
        ? h(
            'div',
            { class: `dl-dplace-strip${x.online ? ' live' : ''}` },
            // the stays as one layer over the track (data-flat): a repaint keeps it or crosses it whole
            h(
              'span',
              { class: `dl-runs${x.online ? ' live' : ''}`, 'data-flat': true },
              ...union(v.filter((y) => y.key === key).map((y) => [y.from, y.to])).map(([a, b]) => {
                const i = h('i');
                i.style.left = pct(a - from, span);
                i.style.width = pct(b - a, span);
                return i;
              }),
            ),
          )
        : null;
      const row = h(
        'div',
        { class: `dl-dplace-row${pre ? ' pre' : ''}`, 'data-key': key },
        h(
          'span',
          { class: `dl-dplace-n${x.online ? ' live' : ''}`, 'aria-hidden': 'true' },
          x.online || !dev ? icon(devs[0]?.kind ?? 'other') : String(n),
        ),
        h(
          'span',
          { class: 'pr-main' },
          h('span', { class: 'pr-t', title: city }, city),
          dev ? null : h('span', { class: 'pr-devs pr-m' }, ...devs.map((y) => h('span', { class: 'pr-dev' }, icon(y.kind), y.name))),
          meta.length ? h('span', { class: 'pr-m' }, meta.join(' · ')) : null,
        ),
        h(
          'span',
          { class: 'pr-end' },
          h('span', { class: `pr-when${x.online ? ' now' : ''}` }, x.online ? _('now') : ago(x.ts, d.now)),
          x.ip ? h('span', { class: 'pr-ip' }, x.ip) : null,
        ),
        strip,
      );
      row.addEventListener('mouseenter', () => this.map.hoverPlace(key));
      row.addEventListener('mouseleave', () => this.map.hoverPlace(null));
      if (strip && replay) this.wireStrip(strip, city);
      this.rows.set(key, row);
      return row;
    });
    const axis = strips
      ? h(
          'div',
          { class: 'dl-dplace-axis', 'aria-hidden': 'true' },
          ...ticks(this.range, d.now).map(([f, label]) => {
            const s = h('span', { class: f > 0.94 ? 'last' : '' }, label);
            s.style.left = `${(f * 100).toFixed(2)}%`;
            return s;
          }),
        )
      : null;
    refill(this.el, [h('div', { class: 'pl-stack' }, ...rows), ...(axis ? [axis] : [])]);
    this.paintControls();
  }

  /** A strip as the replay's timeline: the pointer (a ghost under it, a press or a drag seeks) and the keys. */
  private wireStrip(strip: HTMLElement, city: string) {
    strip.tabIndex = 0;
    strip.setAttribute('role', 'slider');
    strip.setAttribute('aria-label', fmt(_('%s: replay this period'), city));
    const seekAt = (ev: PointerEvent) => {
      const r = strip.getBoundingClientRect();
      this.seek(this.from + SPAN[this.range] * Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)));
    };
    strip.addEventListener('pointermove', (ev) => {
      const r = strip.getBoundingClientRect();
      strip.style.setProperty('--hx', `${Math.min(r.width, Math.max(0, ev.clientX - r.left))}px`);
      strip.classList.add('aim');
      if (ev.buttons) seekAt(ev);
    });
    strip.addEventListener('pointerleave', () => strip.classList.remove('aim'));
    strip.addEventListener('pointerdown', (ev) => {
      strip.setPointerCapture(ev.pointerId);
      seekAt(ev);
    });
    // A moment between two stays shows the next stay, so a step goes on until what is shown moves, or the period ends.
    strip.addEventListener('keydown', (ev) => {
      const from = this.from;
      const end = this.data.now;
      const dir = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
      if (!dir && ev.key !== 'Home' && ev.key !== 'End') return;
      ev.preventDefault();
      if (!dir) return this.seek(ev.key === 'Home' ? from : end);
      const was = this.on ? this.ms : -1;
      let x = this.on && this.at != null ? this.at : end;
      do {
        x = Math.min(end, Math.max(from, x + dir * STEP[this.range]));
        this.seek(x);
      } while (this.ms === was && x > from && x < end);
    });
  }

  private paintControls() {
    this.play.replaceChildren(icon(this.playing ? 'pause' : 'play'));
    this.play.title = this.playing ? _('Pause', 'replay') : _('Replay this period');
    this.play.setAttribute('aria-label', this.play.title);
    const kids = this.on ? [this.play, this.chip, this.stop] : this.st.length > 1 ? [this.play] : [];
    const going = this.going;
    this.going = null;
    const was = going ? 0 : this.controls.childElementCount;
    // Nothing more to replay (all of a person's devices): the plate fades where it stands, then empties.
    if (!kids.length && was && this.controls.isConnected) {
      const cs = getComputedStyle(this.controls);
      const o = +cs.opacity;
      const a = play(
        this.controls,
        [
          { opacity: o, filter: cs.filter === 'none' ? 'blur(0px)' : cs.filter },
          { opacity: 0, filter: 'blur(4px)' },
        ],
        { duration: 180 * o, easing: EASE_IN, fill: 'forwards' },
      );
      this.controls.getAnimations().forEach((x) => x !== a && x.cancel());
      this.going = a;
      a.onfinish = () => {
        if (this.going !== a) return;
        this.going = null;
        this.controls.replaceChildren();
        a.cancel();
      };
      return;
    }
    // coming back while it fades: from where the fade has it
    const cs = going ? getComputedStyle(this.controls) : null;
    const shows = cs ? { opacity: +cs.opacity, filter: cs.filter === 'none' ? 'blur(0px)' : cs.filter } : undefined;
    going?.cancel();
    this.controls.replaceChildren(...kids);
    // the replay's knob comes once there is something to replay (the log is in, a device picked): it blurs in
    if ((!was || shows) && kids.length && this.controls.isConnected) appear(this.controls, shows);
  }

  /* ---------- the replay ---------- */

  private begin() {
    this.on = true;
    ({ steps: this.steps, total: this.total } = timeline(this.st, this.reduced ? 400 : MOVE_MS));
    this.ms = 0;
    this.stepI = -1;
    // The live place lets go; the first stay lights up on the first frame.
    this.map.replay({ active: null, when: '' }, true);
  }

  private toggle() {
    if (this.playing) {
      this.playing = false;
      cancelAnimationFrame(this.raf);
      this.paintControls();
      return;
    }
    clearTimeout(this.endTimer);
    if (!this.on || this.ms >= this.total) this.begin();
    this.playing = true;
    this.at = null;
    this.last = performance.now();
    this.paintControls();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    if (!this.playing) return;
    this.ms = Math.min(this.total, this.ms + (now - this.last));
    this.last = now;
    this.show(true);
    if (this.ms < this.total) {
      this.raf = requestAnimationFrame((t) => this.frame(t));
      return;
    }
    // At the end: a moment on the last place, then back to now.
    this.playing = false;
    this.paintControls();
    this.endTimer = window.setTimeout(() => this.end(), 1500);
  }

  /** Moment `t` (a strip, the Log's session): its place at once, paused there. */
  seek(t: number) {
    if (this.st.length < 2) return;
    clearTimeout(this.endTimer);
    if (this.playing) {
      this.playing = false;
      cancelAnimationFrame(this.raf);
    }
    if (!this.on) this.begin();
    this.at = t;
    this.ms = msAt(this.st, this.steps, t);
    this.stepI = -1;
    this.show(false);
    this.paintControls();
  }

  /** The replay at `this.ms`: the map's light and shimmer, the strips' tick, the chip. */
  private show(animate: boolean) {
    const m = moment(this.st, this.steps, this.ms);
    const s = this.st[m.step.k];
    if (m.step.kind === 'move') {
      const prev = this.st[m.step.k - 1];
      if (m.i !== this.stepI) {
        // The place it leaves goes gray; the shimmer sets off from it.
        this.map.replay({ active: null, when: '' }, animate);
        this.map.band([prev.point.lon, prev.point.lat], [s.point.lon, s.point.lat]);
      }
      const c = bandMiddle(m.q);
      if (!this.reduced) this.map.bandAt(c);
      if (this.reduced ? m.q >= 0.5 : arrived(c)) this.map.replay({ active: s.key, when: clock(m.t) }, animate);
    } else {
      if (m.i !== this.stepI) this.map.band();
      this.map.replay({ active: s.key, when: clock(m.t) }, animate);
    }
    this.stepI = m.i;
    const d = this.data;
    const from = this.from;
    this.el.classList.add('replay');
    this.el.style.setProperty('--at', pct(m.t - from, d.now - from));
    for (const [k, r] of this.rows) r.classList.toggle('cur', k === s.key);
    this.chip.textContent = `${dayName(m.t, d.now)}, ${clock(m.t)} · ${s.point.city || s.point.cc || '?'}`;
  }

  /** Back to now: the map as it is, and whatever came while the replay ran. */
  private end() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.endTimer);
    if (!this.on) return;
    this.on = false;
    this.playing = false;
    this.at = null;
    this.ms = 0;
    this.stepI = -1;
    this.map.band();
    this.map.replay(null, false);
    this.el.classList.remove('replay');
    for (const r of this.rows.values()) r.classList.remove('cur');
    if (this.pending) {
      this.data = this.pending;
      this.pending = null;
      this.map.update(this.mapData());
      this.paint();
    } else this.paintControls();
  }
}
