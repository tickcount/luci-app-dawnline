// Where a device went, under its map (the device window): a row per place with a strip of
// when it was there, and a replay of the period: the place it leaves goes gray, a blue
// shimmer runs along the dotted arc to the next place, which lights up. The model is
// ./model; the map draws (ConnectionMap.replay, band, bandAt).

import type { Device, Geo, LogEvent, Person } from '../../shared/types';
import { E } from '../e';
import { icon } from '../../shared/icons';
import { ago } from '../../shared/format';
import { devicePlaces, type ConnectionMap, type MapData, type Range } from '../map';
import {
  MOVE_MS,
  arrived,
  bandMiddle,
  clock,
  dayName,
  moment,
  msAt,
  placeKey,
  shares,
  replayStays,
  stretches,
  ticks,
  timeline,
  visits,
  type Stay,
  type Step,
} from './model';

export interface PlacesData {
  geo: Geo;
  /** The router's clock (seconds). */
  now: number;
  person: Person;
  device: Device;
  /** The person's activity log (the device's connects and roams in it); null until loaded. */
  events: LogEvent[] | null;
}

const SPAN: Record<Exclude<Range, 'online'>, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
const pct = (part: number, whole: number) => `${((part / whole) * 100).toFixed(3)}%`;

export class PlacesView {
  /** The rows under the map. */
  readonly el = E('div', { class: 'dl-dplaces' });
  /** The replay's controls, for the map's top corner. */
  readonly controls = E('div', { class: 'dl-map-replay' });
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
  private raf = 0;
  private last = 0;
  private endTimer = 0;
  private play = E('button', { type: 'button', class: 'dl-map-btn' });
  private chip = E('span', { class: 'dl-map-chip' });
  private stop = E('button', { type: 'button', class: 'dl-map-btn', title: 'Back to now', 'aria-label': 'Back to now' }, icon('x'));
  private reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(
    private map: ConnectionMap,
    private range: Range,
    data: PlacesData,
  ) {
    this.data = data;
    this.play.addEventListener('click', () => this.toggle());
    this.stop.addEventListener('click', () => this.end());
    this.paint();
  }

  mapData(): MapData {
    const d = this.data;
    return { geo: d.geo, people: [d.person], now: d.now, person: d.person.id, device: d.device.id };
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

  setRange(r: Range) {
    this.end();
    this.range = r;
    this.map.setRange(r);
    this.paint();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.endTimer);
  }

  private paint() {
    const d = this.data;
    const span = SPAN[this.range as keyof typeof SPAN];
    const from = d.now - span;
    const v = visits(stretches(d.events ?? [], d.device.id, d.now, d.device.online, d.device.handshake), d.geo.points, d.device.id, from);
    const share = shares(v);
    this.st = replayStays(v);
    const list = devicePlaces(this.mapData(), this.range);
    const strips = v.length > 0;
    this.el.classList.toggle('strips', strips);
    this.el.classList.toggle('can-replay', this.st.length > 1);
    this.rows.clear();
    dom.content(
      this.el,
      list.length
        ? [
            ...list.map((x) => {
              const key = placeKey(x);
              const sh = share.get(key);
              const strip = strips
                ? E(
                    'div',
                    { class: `dl-dplace-strip${x.online ? ' live' : ''}` },
                    v
                      .filter((y) => y.key === key)
                      .map((y) => E('i', { style: `left:${pct(y.from - from, span)};width:${pct(y.to - y.from, span)}` })),
                  )
                : '';
              const row = E('div', { class: 'dl-dplace-row' }, [
                E('span', { class: `dl-dplace-n${x.online ? ' live' : ''}` }, x.online ? icon(d.device.kind) : String(x.n)),
                E('span', { class: 'dl-row-main dl-stack' }, [
                  E('span', {}, [x.city || x.cc || 'Unknown city', x.org ? E('span', { class: 'dl-muted' }, ` · ${x.org}`) : '']),
                  E('span', { class: 'dl-faint' }, [
                    E('span', { class: 'dl-mono' }, x.ip),
                    sh != null ? ` · ${sh > 0 && sh < 0.005 ? '<1' : Math.round(sh * 100)}% of the time` : '',
                  ]),
                ]),
                E('span', { class: x.online ? 'dl-dplace-now' : 'dl-faint dl-nowrap' }, x.online ? 'now' : ago(x.ts, d.now)),
                strip,
              ]);
              row.addEventListener('mouseenter', () => this.map.hoverPlace(key));
              row.addEventListener('mouseleave', () => this.map.hoverPlace(null));
              // The strips are the replay's timeline: a click or a drag on one goes to that moment.
              if (strip) {
                const seek = (ev: PointerEvent) => {
                  const r = strip.getBoundingClientRect();
                  this.seek(from + span * Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)));
                };
                strip.addEventListener('pointerdown', (ev) => {
                  strip.setPointerCapture(ev.pointerId);
                  seek(ev);
                });
                strip.addEventListener('pointermove', (ev) => ev.buttons && seek(ev));
              }
              this.rows.set(key, row);
              return row;
            }),
            strips
              ? E(
                  'div',
                  { class: 'dl-dplace-axis' },
                  ticks(this.range as keyof typeof SPAN, d.now).map(([f, label]) =>
                    E('span', { style: `left:${(f * 100).toFixed(2)}%` }, label),
                  ),
                )
              : '',
          ]
        : E('div', { class: 'dl-sub' }, 'No locations in this period.'),
    );
    this.paintControls();
  }

  private paintControls() {
    dom.content(this.play, icon(this.playing ? 'pause' : 'play'));
    this.play.title = this.playing ? 'Pause' : 'Replay this period';
    this.play.setAttribute('aria-label', this.play.title);
    // LuCI's dom.content takes one level of children: no nested arrays.
    dom.content(this.controls, this.on ? [this.play, this.chip, this.stop] : this.st.length > 1 ? [this.play] : []);
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

  /** Moment `t` (a click on a strip): its place at once, paused there. */
  private seek(t: number) {
    if (this.st.length < 2) return;
    clearTimeout(this.endTimer);
    if (!this.on) this.begin();
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
    const from = d.now - SPAN[this.range as keyof typeof SPAN];
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
