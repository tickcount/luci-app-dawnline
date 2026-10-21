// Bento tiles shared by the server Overview and the person page: speed now
// (from the minute samples, or live on the Overview) and the last 30 days.

import type { DayUsage } from '../../shared/types';
import type { LiveSpeed, Rate } from '../state/meter';
import { E } from '../e';
import { bits, bytes, parseDay } from '../../shared/format';
import { fill, fmt, locale } from '../../shared/i18n';
import { attachTip } from '../ui/tooltip';
import { svg } from '../ui/layout';

const dayLabel = (day: string) => parseDay(day).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

/** The speed chart's box (its viewBox; CSS stretches it to the tile). */
const W = 200,
  H = 40;

/** The speed chart's lines through `pts` at `xs` (0–1 across): download filled, upload over it. */
function chartPaths(pts: Rate[], xs: number[]): { area: string; down: string; up: string } {
  const max = Math.max(1, ...pts.map((p) => Math.max(p[1], p[2])));
  const line = (k: 1 | 2) => pts.map((p, i) => `${xs[i] * W},${H - 2 - (p[k] / max) * (H - 6)}`);
  const dl = line(2),
    ul = line(1);
  return {
    area: `M${dl.join(' L')} L${xs[xs.length - 1] * W},${H} L${xs[0] * W},${H}Z`,
    down: `M${dl.join(' L')}`,
    up: `M${ul.join(' L')}`,
  };
}

/** One of the two speeds: its arrow and label, then the value. */
const speedCol = (label: string, ic: string, cls: string, val: HTMLElement) =>
  E('div', { class: 'dl-speed-col' }, [E('span', { class: 'dl-sub' }, [E('span', { class: cls }, ic), ` ${label}`]), val]);

/** Today's traffic under the chart (`today` is [rx, tx]). */
const todayParts = ([rx, tx]: [number, number]) => [
  E('span', {}, fill(_('Today %s'), E('b', {}, bytes(rx + tx)))),
  E('span', {}, [E('span', { class: 'dl-dn' }, '↓'), ` ${bytes(tx)}  `, E('span', { class: 'dl-up' }, '↑'), ` ${bytes(rx)}`]),
];

/**
 * Throughput over the last 15 minutes plus today's total. `off`: the server is
 * turned off, so there is no speed to show (dashes, not zeros) and no chart.
 */
export function speedTile(rate: Rate[], now: number, today: [number, number], off = false): HTMLElement {
  const pts = rate.slice(-15);
  const last = pts[pts.length - 1];
  const fresh = last && now - last[0] < 180;
  const down = fresh ? last[2] : 0,
    up = fresh ? last[1] : 0;
  let chart: HTMLElement;
  if (pts.length > 1 && !off) {
    const d = chartPaths(
      pts,
      pts.map((_x, i) => i / (pts.length - 1)),
    );
    chart = svg(
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="dl-speed-chart" aria-hidden="true">` +
        `<path d="${d.area}" class="area"/><path d="${d.down}" class="line"/><path d="${d.up}" class="line up"/></svg>`,
    );
    attachTip(chart, () => {
      const p = pts[pts.length - 1];
      return [
        E('div', { class: 'dl-tip-title' }, new Date(p[0] * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })),
        E('div', {}, `↓ ${bits(p[2])} · ↑ ${bits(p[1])}`),
      ];
    });
  } else chart = E('div', { class: 'dl-speed-wait' }, [E('i'), off ? '' : E('span', {}, _('Collecting… 1 point a minute'))]);
  const val = (v: number) => (off ? E('span', { class: 'dl-speed-val off' }, '—') : E('span', { class: 'dl-speed-val' }, bits(v)));
  return E('div', { class: 'dl-bento-tile' }, [
    E('div', { class: 'dl-bento-head' }, [
      E('span', { class: 'dl-metric-label' }, _('Speed now')),
      off ? '' : E('span', { class: 'dl-sub' }, _('last 15 min')),
    ]),
    E('div', { class: 'dl-speed-cols' }, [
      speedCol(_('Download', 'speed'), '↓', 'dl-dn', val(down)),
      speedCol(_('Upload', 'speed'), '↑', 'dl-up', val(up)),
    ]),
    chart,
    E('div', { class: 'dl-speed-today' }, todayParts(today)),
  ]);
}

/**
 * Speed now, live (the server Overview): speedTile's tile, its chart the last
 * 2 minutes one point a second (state/meter.ts). Built once; update() puts each
 * second's numbers and lines in place. No tooltip: the numbers above the chart
 * are its newest point already.
 */
export class LiveSpeedTile {
  private span = E('span', { class: 'dl-sub' }, _('last 2 min'));
  private down = E('span', { class: 'dl-speed-val' });
  private up = E('span', { class: 'dl-speed-val' });
  private chart = svg(
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="dl-speed-chart" aria-hidden="true">` +
      `<path class="area"/><path class="line"/><path class="line up"/></svg>`,
  );
  private wait = E('div', { class: 'dl-speed-wait' });
  /** The chart or the waiting line, whichever is in the tile. */
  private shown = this.wait;
  private today = E('div', { class: 'dl-speed-today' });
  readonly el = E('div', { class: 'dl-bento-tile' }, [
    E('div', { class: 'dl-bento-head' }, [E('span', { class: 'dl-metric-label' }, _('Speed now')), this.span]),
    E('div', { class: 'dl-speed-cols' }, [
      speedCol(_('Download', 'speed'), '↓', 'dl-dn', this.down),
      speedCol(_('Upload', 'speed'), '↑', 'dl-up', this.up),
    ]),
    this.wait,
    this.today,
  ]);

  /**
   * This second's speed and today's traffic ([rx, tx]). `off`: the server is
   * turned off (dashes, no chart); a meter that cannot be read says why in
   * the chart's place, with dashes for the speeds.
   */
  update(s: LiveSpeed, today: [number, number], off: boolean): void {
    const none = off || !!s.error;
    this.span.style.display = off ? 'none' : '';
    for (const [el, v] of [
      [this.down, s.tx],
      [this.up, s.rx],
    ] as const) {
      el.className = `dl-speed-val${none ? ' off' : ''}`;
      el.textContent = none ? '—' : bits(v);
    }
    const lines = !none && s.pts.length > 1;
    if (lines) {
      const p = chartPaths(s.pts, s.xs);
      const [area, down, up] = this.chart.querySelectorAll('path');
      area.setAttribute('d', p.area);
      down.setAttribute('d', p.down);
      up.setAttribute('d', p.up);
    } else
      dom.content(this.wait, [
        E('i'),
        off || (s.early && !s.error)
          ? ''
          : E('span', {}, s.error ? fmt(_("Couldn't read the live speed: %s"), s.error) : _('Collecting… 1 point a second')),
      ]);
    const want = lines ? this.chart : this.wait;
    if (want !== this.shown) {
      this.shown.replaceWith(want);
      this.shown = want;
    }
    dom.content(this.today, todayParts(today));
  }
}

/** Daily traffic for the last 30 days, today on the right. */
export function daysTile(series: DayUsage[], note: string): HTMLElement {
  const days = series.slice(-30);
  const vals = days.map((d) => d.rx + d.tx);
  const max = Math.max(1, ...vals);
  const total = vals.reduce((a, v) => a + v, 0);
  const peakI = vals.reduce((a, v, i) => (v > vals[a] ? i : a), 0);
  const bars = E(
    'div',
    { class: 'dl-bento-bars' },
    days.map((d, i) => {
      const v = vals[i];
      const bar = E('i', { class: i === days.length - 1 ? 'hi' : '', style: `height:${Math.max(4, (v / max) * 100)}%` });
      // The day's column carries the tooltip: it answers above a short bar and between two bars.
      const col = E('span', {}, [bar]);
      attachTip(col, () => [
        E('div', { class: 'dl-tip-title' }, i === days.length - 1 ? `${_('Today')} · ${dayLabel(d.day)}` : dayLabel(d.day)),
        E('div', {}, bytes(v)),
        E('div', { class: 'dl-muted dl-mono' }, `↓ ${bytes(d.tx)} ↑ ${bytes(d.rx)}`),
      ]);
      return col;
    }),
  );
  return E('div', { class: 'dl-bento-tile month' }, [
    E('div', { class: 'dl-bento-head' }, [
      E('span', {}, [E('span', { class: 'dl-metric-label' }, _('Last 30 days')), E('b', { class: 'dl-bento-total' }, bytes(total))]),
      vals[peakI] > 0 ? E('span', { class: 'dl-sub' }, `${fmt(_('peak %s'), bytes(vals[peakI]))} · ${dayLabel(days[peakI].day)}`) : '',
    ]),
    days.length ? bars : E('p', { class: 'dl-muted' }, _('No traffic yet.')),
    E('div', { class: 'dl-bento-head' }, [
      E('span', { class: 'dl-sub' }, days.length ? dayLabel(days[0].day) : ''),
      E('span', { class: 'dl-sub' }, note),
      E('span', { class: 'dl-sub' }, _('today')),
    ]),
  ]);
}

/** Daily traffic of one device over the last 30 days, today on the right (person page device cards). */
export function dayBars(series: DayUsage[]): HTMLElement {
  const days = series.slice(-30);
  const vals = days.map((x) => x.rx + x.tx);
  const max = Math.max(1, ...vals);
  return E(
    'div',
    { class: 'dl-dbars' },
    days.map((x, i) => {
      const bar = E('i', { class: `${vals[i] ? '' : 'zero'}${i === days.length - 1 ? ' hi' : ''}` });
      bar.style.height = `${Math.max(8, (vals[i] / max) * 100)}%`;
      const col = E('span', {}, [bar]);
      attachTip(col, () => [
        E('div', { class: 'dl-tip-title' }, i === days.length - 1 ? `${_('Today')} · ${dayLabel(x.day)}` : dayLabel(x.day)),
        E('div', {}, bytes(vals[i])),
      ]);
      return col;
    }),
  );
}
