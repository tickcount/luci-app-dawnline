// A line chart by days in the connection map's language (map.ts,
// styles/shadow/map.css; the concept's kit/chart.ts): the period in --live, a
// soft zone under it, the period before it dashed in --past, both ends fading
// out, the admin's monotone curve (ui/plot.ts smooth). Drawn at the box's own width in real pixels, again when the box
// changes width (Outline's sidebar folds without a resize).
//
// Motion: the first drawing shows the line once, a fade as it rises 5 px (360
// ms EASE_OUT); a redraw never shows it again. At rest there is no marker: it
// shows on the day being read (the pointer, a tap, ← → Home End; Escape lets
// go), fading in and out where it stands, gliding from day to day under a
// moving pointer (the menu highlight's QUICK spring, in CSS), jumping under the
// keyboard. The page says the day read (`onPick`).

import { h } from '../../portal/dom';
import { EASE_OUT, play, still } from '../../portal/motion';
import { smooth } from '../ui/plot';
import { putChildren } from '../../portal/ui/put';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag: string, a: Record<string, string | number>) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v));
  return e;
};

let ids = 0;

const draws = new WeakMap<Element, () => void>();

/**
 * Draw a chart now, if it stands in the page with a width: whoever puts it in calls this, so its line is there in
 * the very frame its box is. Left to its ResizeObserver alone, the box stood empty for a frame or more and the
 * line then struck in (the owner's screenshot of Overview, 2026-11-12: every tile in, the chart's plot bare).
 */
export const drawChart = (el: Element): void => draws.get(el)?.();

/**
 * `values`: one a day, oldest first; `labels`: the two ends of the axis; `onPick(i)`: a day read (-1: let go);
 * `label`: what it shows, for a screen reader; `past`: the period before, as long, drawn under it dashed.
 */
export function lineChart(
  values: number[],
  hgt: number,
  labels: [string, string],
  label: string,
  onPick: (i: number) => void,
  past?: number[] | null,
): HTMLElement {
  const id = `lc${++ids}`;
  const n = values.length;
  const max = Math.max(1, ...values, ...(past ?? [])) * 1.12;
  const last = n - 1;
  // the reading marker's halo (r 10) stays inside the plot at either end
  const pad = 12;
  const plot = h('div', { class: 'lc-plot', tabindex: '0', role: 'img', 'aria-label': label });
  plot.style.height = `${hgt}px`;
  const box = h('div', { class: 'lc-box' }, plot, h('div', { class: 'lc-axis' }, h('span', {}, labels[0]), h('span', {}, labels[1])));
  let w = 0;
  let picked = -1;
  let drawn = false;
  let x = (i: number) => i;
  const y = (v: number) => hgt - 6 - (v / max) * (hgt - 18);

  function draw() {
    const W = Math.round(plot.getBoundingClientRect().width);
    if (!W || W === w) return;
    w = W;
    x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, n - 1);
    const line = (vs: number[]) => smooth(vs.map((v, i) => [x(i), y(v)] as [number, number]));
    const path = line(values);
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, class: 'lc', 'aria-hidden': 'true' });
    const defs = svgEl('defs', {});
    const zoneG = svgEl('linearGradient', { id: `${id}z`, x1: 0, y1: 0, x2: 0, y2: 1 });
    zoneG.append(svgEl('stop', { offset: 0, class: 'lc-z0' }), svgEl('stop', { offset: 1, class: 'lc-z1' }));
    // both ends of the line fade out (a mask on the line only: the reading marker stays whole at an end)
    const fadeG = svgEl('linearGradient', { id: `${id}f`, x1: 0, y1: 0, x2: 1, y2: 0 });
    for (const [o, op] of [
      [0, 0],
      [0.07, 1],
      [0.93, 1],
      [1, 0],
    ])
      fadeG.append(svgEl('stop', { offset: o, 'stop-color': '#fff', 'stop-opacity': op }));
    const fade = svgEl('mask', { id: `${id}m`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: w, height: hgt });
    fade.append(svgEl('rect', { x: 0, y: 0, width: w, height: hgt, fill: `url(#${id}f)` }));
    defs.append(zoneG, fadeG, fade);
    const lines = svgEl('g', { mask: `url(#${id}m)` });
    if (past?.length) lines.append(svgEl('path', { d: line(past), class: 'lc-past' }));
    lines.append(
      svgEl('path', { d: `${path} L${x(last)} ${hgt} L${x(0)} ${hgt} Z`, fill: `url(#${id}z)` }),
      svgEl('path', { d: path, class: 'lc-live' }),
    );
    const mark = svgEl('g', { class: 'lc-mark' });
    mark.append(
      svgEl('line', { class: 'lc-rule', x1: 0, x2: 0, y1: -hgt, y2: hgt }),
      svgEl('circle', { class: 'lc-halo', r: 10 }),
      svgEl('circle', { class: 'lc-dot', r: 3.5 }),
    );
    svg.append(defs, lines, mark);
    putChildren(plot, [svg]);
    place(true);
    // where pages stand still it is drawn with its page and comes in with it (admin/ui/entrance.ts)
    if (!drawn && !still())
      play(
        svg,
        [
          { opacity: 0, transform: 'translateY(5px)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0px)' },
        ],
        { duration: 280, delay: 60, easing: EASE_OUT, fill: 'backwards' },
      );
    drawn = true;
  }

  /** The marker stands on the picked day; `jump`: there without its glide, only fading. Let go, it fades where it is. */
  function place(jump = false) {
    const mark = plot.querySelector<SVGGElement>('.lc-mark');
    if (!mark) return;
    mark.classList.toggle('jump', jump);
    if (picked >= 0 || !mark.style.transform) {
      const k = picked < 0 ? last : picked;
      mark.style.transform = `translate(${x(k).toFixed(1)}px, ${y(values[k] ?? 0).toFixed(1)}px)`;
    }
    mark.classList.toggle('picked', picked >= 0);
    if (!jump) return;
    void getComputedStyle(mark).transform;
    mark.classList.remove('jump');
  }

  const choose = (i: number, kbd = false) => {
    if (i === picked) return;
    const from = picked;
    picked = i;
    place(kbd || from < 0 || i < 0);
    onPick(i);
  };
  const at = (px: number) => Math.max(0, Math.min(last, Math.round(((px - pad) / Math.max(1, w - pad * 2)) * (n - 1))));
  plot.addEventListener('pointermove', (e) => choose(at(e.clientX - plot.getBoundingClientRect().left)));
  plot.addEventListener('pointerdown', (e) => choose(at(e.clientX - plot.getBoundingClientRect().left)));
  plot.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && choose(-1));
  plot.addEventListener('blur', () => choose(-1));
  plot.addEventListener('keydown', (e) => {
    const k = picked < 0 ? last : picked;
    if (e.key === 'ArrowLeft') choose(Math.max(0, k - 1), true);
    else if (e.key === 'ArrowRight') choose(Math.min(last, k + 1), true);
    else if (e.key === 'Home') choose(0, true);
    else if (e.key === 'End') choose(last, true);
    else if (e.key === 'Escape') choose(-1, true);
    else return;
    e.preventDefault();
  });
  const ro = new ResizeObserver(() => {
    if (!plot.isConnected && w) return ro.disconnect();
    draw();
  });
  ro.observe(plot);
  draws.set(box, draw);
  return box;
}
