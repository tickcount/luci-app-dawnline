// Bento tiles shared by the server Overview and the person page: speed now
// and the last 30 days.

import type { DayUsage } from '../../shared/types';
import { E } from '../e';
import { bits, bytes, parseDay } from '../../shared/format';
import { attachTip } from '../ui/tooltip';
import { svg } from '../ui/layout';

const dayLabel = (day: string) => parseDay(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * Throughput over the last 15 minutes plus today's total. `off`: the server is
 * turned off, so there is no speed to show (dashes, not zeros) and no chart.
 */
export function speedTile(rate: [number, number, number][], now: number, today: [number, number], off = false): HTMLElement {
  const pts = rate.slice(-15);
  const last = pts[pts.length - 1];
  const fresh = last && now - last[0] < 180;
  const down = fresh ? last[2] : 0,
    up = fresh ? last[1] : 0;
  const [rx, tx] = today;
  const W = 200,
    H = 40;
  const max = Math.max(1, ...pts.map((p) => Math.max(p[1], p[2])));
  const line = (k: 1 | 2) => pts.map((p, i) => `${pts.length > 1 ? (i / (pts.length - 1)) * W : W},${H - 2 - (p[k] / max) * (H - 6)}`);
  const dl = line(2),
    ul = line(1);
  const chart =
    pts.length > 1 && !off
      ? svg(
          `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="dl-speed-chart" aria-hidden="true">` +
            `<path d="M${dl.join(' L')} L${W},${H} L0,${H}Z" class="area"/><path d="M${dl.join(' L')}" class="line"/>` +
            `<path d="M${ul.join(' L')}" class="line up"/></svg>`,
        )
      : E('div', { class: 'dl-speed-wait' }, [E('i'), off ? '' : E('span', {}, 'Collecting… 1 point a minute')]);
  const col = (label: string, ic: string, cls: string, v: number) =>
    E('div', { class: 'dl-speed-col' }, [
      E('span', { class: 'dl-sub' }, [E('span', { class: cls }, ic), ` ${label}`]),
      off ? E('span', { class: 'dl-speed-val off' }, '—') : E('span', { class: 'dl-speed-val' }, bits(v)),
    ]);
  if (pts.length > 1 && !off)
    attachTip(chart, () => {
      const p = pts[pts.length - 1];
      return [
        E('div', { class: 'dl-tip-title' }, new Date(p[0] * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })),
        E('div', {}, `↓ ${bits(p[2])} · ↑ ${bits(p[1])}`),
      ];
    });
  return E('div', { class: 'dl-bento-tile' }, [
    E('div', { class: 'dl-bento-head' }, [
      E('span', { class: 'dl-metric-label' }, 'Speed now'),
      off ? '' : E('span', { class: 'dl-sub' }, 'last 15 min'),
    ]),
    E('div', { class: 'dl-speed-cols' }, [col('Download', '↓', 'dl-dn', down), col('Upload', '↑', 'dl-up', up)]),
    chart,
    E('div', { class: 'dl-speed-today' }, [
      E('span', {}, ['Today ', E('b', {}, bytes(rx + tx))]),
      E('span', {}, [E('span', { class: 'dl-dn' }, '↓'), ` ${bytes(tx)}  `, E('span', { class: 'dl-up' }, '↑'), ` ${bytes(rx)}`]),
    ]),
  ]);
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
      attachTip(bar, () => [
        E('div', { class: 'dl-tip-title' }, i === days.length - 1 ? `Today · ${dayLabel(d.day)}` : dayLabel(d.day)),
        E('div', {}, bytes(v)),
        E('div', { class: 'dl-muted dl-mono' }, `↓ ${bytes(d.tx)} ↑ ${bytes(d.rx)}`),
      ]);
      return bar;
    }),
  );
  return E('div', { class: 'dl-bento-tile month' }, [
    E('div', { class: 'dl-bento-head' }, [
      E('span', {}, [E('span', { class: 'dl-metric-label' }, 'Last 30 days'), E('b', { class: 'dl-bento-total' }, bytes(total))]),
      vals[peakI] > 0 ? E('span', { class: 'dl-sub' }, `peak ${bytes(vals[peakI])} · ${dayLabel(days[peakI].day)}`) : '',
    ]),
    days.length ? bars : E('p', { class: 'dl-muted' }, 'No traffic yet.'),
    E('div', { class: 'dl-bento-head' }, [
      E('span', { class: 'dl-sub' }, days.length ? dayLabel(days[0].day) : ''),
      E('span', { class: 'dl-sub' }, note),
      E('span', { class: 'dl-sub' }, 'today'),
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
      attachTip(bar, () => [
        E('div', { class: 'dl-tip-title' }, i === days.length - 1 ? `Today · ${dayLabel(x.day)}` : dayLabel(x.day)),
        E('div', {}, bytes(vals[i])),
      ]);
      return bar;
    }),
  );
}
