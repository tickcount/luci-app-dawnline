// Bento tiles shared by the server Overview and the person page: speed now
// (live, from the meter) and the last 30 days, plus
// a device card's 30 days. The charts are in the connection map's language
// (widgets/lines.ts, days.ts) and read point by point (shared/scrub.ts): the
// speed in the tile's own head, a day in a tooltip above it (ui/glide.ts).

import type { DayUsage } from '../../shared/types';
import type { LiveSpeed } from '../state/meter';
import { E } from '../e';
import { bits, bytes, parseDay } from '../../shared/format';
import { fill, fmt, locale } from '../../shared/i18n';
import { scrub, type Scrub } from '../../shared/scrub';
import { hideGlide, showGlide } from '../ui/glide';
import { SpeedLines } from './lines';
import { DayStack, DayStrip } from './days';
import { dayTip, deviceDayTip, downUp, secondsAgo, timeOf } from './readouts';

const dayLabel = (day: string) => parseDay(day).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

/** One of the two speeds: its arrow and label, then the value. */
const speedCol = (label: string, ic: string, cls: string, val: HTMLElement) =>
  E('div', { class: 'dl-speed-col' }, [E('span', { class: 'dl-sub' }, [E('span', { class: cls }, ic), ` ${label}`]), val]);

/** Today's traffic under the chart (`today` is [rx, tx]). */
const todayParts = ([rx, tx]: [number, number]) => [
  E('span', {}, fill(_('Today %s'), E('b', {}, bytes(rx + tx)))),
  E('span', {}, downUp(tx, rx)),
];

/**
 * A speed tile's head, numbers and chart, read in place: the picked point's
 * speeds take the numbers' place and the span says when it was ("14:32:07 · 12 s
 * ago"); letting go puts the newest back. Shared by both speed tiles.
 */
class SpeedHead {
  readonly span: HTMLElement;
  private down = E('span', { class: 'dl-speed-val' });
  private up = E('span', { class: 'dl-speed-val' });
  readonly cols = E('div', { class: 'dl-speed-cols' }, [
    speedCol(_('Download', 'speed'), '↓', 'dl-dn', this.down),
    speedCol(_('Upload', 'speed'), '↑', 'dl-up', this.up),
  ]);
  readonly chart: SpeedLines;
  readonly read: Scrub;
  /** What the numbers say when nothing is picked: [rx, tx], or null for dashes. */
  private now: [number, number] | null = null;

  constructor(
    private spanText: string,
    label: string,
  ) {
    this.span = E('span', { class: 'dl-sub' }, spanText);
    this.chart = new SpeedLines(44);
    this.read = scrub(this.chart.el, this.chart, {
      count: () => this.chart.points.length,
      pick: () => this.paint(),
      label,
      say: (i) => {
        const p = this.chart.points[i];
        return `${timeOf(p[0])}: ↓ ${bits(p[2])}, ↑ ${bits(p[1])}`;
      },
    });
  }

  /** The numbers when nothing is picked (null: dashes, the server is off or the meter unreadable). */
  set(now: [number, number] | null): void {
    this.now = now;
    this.paint();
  }

  private paint(): void {
    const pts = this.chart.points;
    const i = this.read.current();
    const p = i >= 0 ? pts[i] : null;
    const newest = pts.length ? pts[pts.length - 1][0] : 0;
    this.span.textContent = p ? `${timeOf(p[0])} · ${secondsAgo(newest - p[0])}` : this.spanText;
    this.span.classList.toggle('dl-picked', !!p);
    this.cols.classList.toggle('dl-picked', !!p);
    const v = p ? ([p[1], p[2]] as [number, number]) : this.now;
    for (const [el, x] of [
      [this.down, v?.[1]],
      [this.up, v?.[0]],
    ] as const) {
      el.className = `dl-speed-val${v ? '' : ' off'}`;
      el.textContent = v ? bits(x!) : '—';
    }
  }
}

/**
 * Speed now, live (the server Overview, a person's page): its chart the last
 * 2 minutes one point a second (state/meter.ts). Built once; update() puts each
 * second's numbers and line in place. A second picked on the chart stays under a
 * still pointer as the line moves on, so its "ago" keeps counting.
 */
export class LiveSpeedTile {
  private head = new SpeedHead(_('last 2 min'), _('Speed over the last 2 minutes'));
  private wait = E('div', { class: 'dl-speed-wait' });
  /** The chart or the waiting line, whichever is in the tile. */
  private shown = this.wait;
  private today = E('div', { class: 'dl-speed-today' });
  readonly el = E('div', { class: 'dl-bento-tile' }, [
    E('div', { class: 'dl-bento-head' }, [E('span', { class: 'dl-metric-label' }, _('Speed now')), this.head.span]),
    this.head.cols,
    this.wait,
    this.today,
  ]);

  /**
   * This second's speed and today's traffic ([rx, tx]). `off`: the server is
   * turned off (dashes, no chart); a meter that cannot be read says why in
   * the chart's place, with dashes for the speeds. While collecting, a shimmer
   * runs along the dashed track.
   */
  update(s: LiveSpeed, today: [number, number], off: boolean): void {
    const none = off || !!s.error;
    this.head.span.style.display = off ? 'none' : '';
    const lines = !none && s.pts.length > 1;
    if (lines) this.head.chart.set(s.pts, s.xs);
    else {
      const words =
        off || (s.early && !s.error)
          ? ''
          : s.error
            ? fmt(_("Couldn't read the live speed: %s"), s.error)
            : _('Collecting… 1 point a second');
      dom.content(this.wait, [E('i', { class: !none && !s.early ? 'run' : '' }), words ? E('span', {}, words) : '']);
    }
    const want = lines ? this.head.chart.el : this.wait;
    if (want !== this.shown) {
      this.shown.replaceWith(want);
      this.shown = want;
    }
    this.head.set(none ? null : [s.rx, s.tx]);
    if (lines) this.head.read.refresh();
    dom.content(this.today, todayParts(today));
  }
}

/**
 * A chart of days read with the tooltip above the picked day: the pointer, a tap
 * or the arrow keys pick one; the tooltip glides from day to day.
 */
function readDays(chart: DayStack | DayStrip, days: DayUsage[], label: string, tip: (i: number) => (Node | string)[]): void {
  scrub(chart.el, chart, {
    count: () => days.length,
    pick: (i) => {
      if (i < 0) return hideGlide(chart.el);
      const [x, y] = chart.anchor(i);
      showGlide(chart.el, x, y, tip(i));
    },
    label,
    say: (i) => `${dayLabel(days[i].day)}: ${bytes(days[i].rx + days[i].tx)}`,
  });
}

/**
 * Daily traffic for the last 30 days, today on the right: a stacked bar a day,
 * download at the base and upload on top; the head's legend is the 30 days'
 * down and up in the same colours.
 */
export function daysTile(series: DayUsage[], note: string): HTMLElement {
  const days = series.slice(-30);
  const total = days.reduce((a, d) => a + d.rx + d.tx, 0);
  const down = days.reduce((a, d) => a + d.tx, 0),
    up = days.reduce((a, d) => a + d.rx, 0);
  const today = days.length ? days[days.length - 1].day : '';
  let chart: HTMLElement;
  if (days.length) {
    const bars = new DayStack(
      days.map((d) => [d.rx, d.tx]),
      64,
    );
    readDays(bars, days, _('Traffic, last 30 days'), (i) => dayTip(days, i, today));
    chart = bars.el;
  } else chart = E('p', { class: 'dl-muted' }, _('No traffic yet.'));
  return E('div', { class: 'dl-bento-tile month' }, [
    E('div', { class: 'dl-bento-head' }, [
      E('span', {}, [E('span', { class: 'dl-metric-label' }, _('Last 30 days')), E('b', { class: 'dl-bento-total' }, bytes(total))]),
      total > 0
        ? E('span', { class: 'dl-sub dl-days-key' }, [
            E('span', {}, [E('i', { class: 'dn' }), `↓ ${bytes(down)}`]),
            E('span', {}, [E('i', { class: 'up' }), `↑ ${bytes(up)}`]),
          ])
        : '',
    ]),
    chart,
    E('div', { class: 'dl-bento-head' }, [
      E('span', { class: 'dl-sub' }, days.length ? dayLabel(days[0].day) : ''),
      E('span', { class: 'dl-sub' }, note),
      E('span', { class: 'dl-sub' }, _('today')),
    ]),
  ]);
}

/** Which of the last 30 days one device was used, today on the right (person page device cards). */
export function dayBars(series: DayUsage[]): HTMLElement {
  const days = series.slice(-30);
  const strip = new DayStrip(
    days.map((d) => [d.rx, d.tx]),
    18,
  );
  const today = days.length ? days[days.length - 1].day : '';
  readDays(strip, days, _('Days this device was used'), (i) => deviceDayTip(days, i, today));
  return strip.el;
}
