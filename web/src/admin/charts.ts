// DOM bar charts with a hover tooltip (traffic per day, sparklines).

import type { DayUsage } from '../shared/types';
import { E } from './e';
import { bytes } from '../shared/format';

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Daily traffic bars (download stacked over upload, from the person's point
 * of view: router tx = download). `top(day)` may name the busiest device.
 */
export function trafficBars(series: DayUsage[], height = 180, top?: (day: string) => string | null): HTMLElement {
  const max = Math.max(1, ...series.map((d) => d.rx + d.tx));
  const tip = E('div', { class: 'dl-tip' });
  tip.style.display = 'none';
  const bars = E('div', { class: 'dl-bars' });
  bars.style.height = `${height}px`;
  series.forEach((d) => {
    const total = d.rx + d.tx;
    const col = E('div', { class: 'dl-bar' }, [E('i', { class: 'down' }), E('i', { class: 'up' })]);
    (col.children[0] as HTMLElement).style.height = `${(d.tx / max) * 100}%`;
    (col.children[1] as HTMLElement).style.height = `${(d.rx / max) * 100}%`;
    if (!total) col.classList.add('empty');
    col.addEventListener('mouseenter', () => {
      const t = top?.(d.day);
      tip.replaceChildren(
        E('div', { class: 'dl-tip-title' }, dayLabel(d.day)),
        E('div', { class: 'dl-muted' }, `↓ ${bytes(d.tx)} · ↑ ${bytes(d.rx)}`),
        t ? E('div', { class: 'dl-faint' }, `Top: ${t}`) : '',
      );
      tip.style.display = '';
      const r = col.getBoundingClientRect();
      const host = bars.getBoundingClientRect();
      const x = r.left - host.left + r.width / 2;
      tip.style.left = `${Math.min(Math.max(x, 70), host.width - 70)}px`;
    });
    bars.appendChild(col);
  });
  bars.addEventListener('mouseleave', () => (tip.style.display = 'none'));
  const first = series[0]?.day;
  return E('div', { class: 'dl-chartbox' }, [
    bars,
    tip,
    E('div', { class: 'dl-axis' }, [E('span', {}, first ? dayLabel(first) : ''), E('span', {}, 'Today')]),
  ]);
}

let floating: HTMLElement | null = null;

/** Floating tooltip that follows the pointer (for small charts and meters). */
export function attachTip(el: HTMLElement, content: () => (Node | string)[]) {
  const show = (ev: MouseEvent) => {
    floating ??= document.body.appendChild(E('div', { class: 'dl-tip dl-tip-float dl-root' }));
    floating.replaceChildren(...content().map((c) => (typeof c === 'string' ? document.createTextNode(c) : c)));
    floating.style.display = '';
    floating.style.left = `${ev.clientX}px`;
    floating.style.top = `${ev.clientY - 10}px`;
  };
  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', show);
  el.addEventListener('mouseleave', () => floating && (floating.style.display = 'none'));
}

/** Tiny daily sparkline (oldest first, the last bar is today) with per-day tooltips. */
export function spark(values: number[], width = 120, height = 26): HTMLElement {
  const max = Math.max(1, ...values);
  const el = E('div', { class: 'dl-spark' });
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  const now = Date.now();
  values.forEach((v, i) => {
    const b = E('i');
    b.style.height = `${Math.max(6, (v / max) * 100)}%`;
    if (!v) b.classList.add('zero');
    const back = values.length - 1 - i;
    const d = new Date(now - back * 86400000);
    attachTip(b, () => [
      E(
        'div',
        { class: 'dl-tip-title' },
        back === 0
          ? 'Today'
          : back === 1
            ? 'Yesterday'
            : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      ),
      E('div', { class: 'dl-muted' }, bytes(v)),
    ]);
    el.appendChild(b);
  });
  return el;
}
