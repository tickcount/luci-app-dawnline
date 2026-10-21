// The icon picker (the apps): icons only, the picked one widens and shows its
// name. The pill stretches like skiper21's tabs: its leading edge reaches the
// new item first and the trailing edge follows, so the name fading in is always
// inside it. Items grow by flex-grow (a share of the track, not pixels), so
// they stay right while the sheet around them changes width.

import { h, ic } from '../dom';
import { EASE_OUT, LEAD, SMOOTH, calm, play } from '../motion';

export interface SegItem<T extends string> {
  value: T;
  label: string;
  icon: string;
}

export interface IconSeg<T extends string> {
  el: HTMLElement;
  /** Show this value without telling anyone (another copy of the picker changed it). */
  sync(v: T): void;
}

/** Where a name stands on screen: its width of `full` (its words' whole width), and its opacity. */
export interface LabelAt {
  width: number;
  full: number;
  opacity: number;
}

/**
 * How a name fades on a pick, from where it stands (ms): the picked one blurs
 * in (280, a beat after the pill sets off), the others fold (220); a fade
 * turned back half-way runs only the share of its way it has left, and a name
 * already folded has nothing to do (0).
 */
export function labelFade(at: LabelAt, picked: boolean): { duration: number; delay: number } {
  const opacity = Math.min(1, Math.max(0, at.opacity));
  if (picked) return { duration: 280 * (1 - opacity), delay: 70 * (1 - opacity) };
  const left = Math.max(opacity, at.full > 0 ? Math.min(1, at.width / at.full) : 0);
  return { duration: left > 0.01 ? 220 * left : 0, delay: 0 };
}

export function iconSeg<T extends string>(items: SegItem<T>[], value: T, onPick: (v: T) => void): IconSeg<T> {
  const pill = h('span', { class: 'seg-pill' });
  const el = h('div', { class: 'seg appseg', role: 'tablist' }, pill);
  const btns = items.map((it) => {
    const b = h(
      'button',
      { type: 'button', class: 'seg-b', role: 'tab', 'aria-label': it.label, title: it.label, onclick: () => pick(it.value) },
      ic(it.icon),
      h('span', { class: 'seg-l' }, it.label),
    );
    b.dataset.v = it.value;
    el.appendChild(b);
    return b;
  });
  const labelOf = (b: HTMLElement) => b.querySelector('.seg-l') as HTMLElement;
  const mark = () =>
    btns.forEach((b) => {
      const on = b.dataset.v === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
  const edges = (): [number, number] | null => {
    const b = btns.find((x) => x.dataset.v === value);
    return b && b.offsetWidth ? [b.offsetLeft, el.clientWidth - b.offsetLeft - b.offsetWidth] : null;
  };
  const placePill = () => {
    const e = edges();
    if (!e) return;
    pill.style.left = `${e[0]}px`;
    pill.style.right = `${e[1]}px`;
  };

  let raf = 0;
  function pick(v: T) {
    if (v === value) return;
    const from = btns.findIndex((b) => b.dataset.v === value);
    const to = btns.findIndex((b) => b.dataset.v === v);
    const cs = getComputedStyle(pill);
    const l0 = parseFloat(cs.left) || 0;
    const r0 = parseFloat(cs.right) || 0;
    // Each item's share as it stands, and its basis (a narrow picker gives a picked item more: controls.css).
    const g0 = btns.map((b) => parseFloat(getComputedStyle(b).flexGrow) || 0);
    const f0 = btns.map((b) => getComputedStyle(b).flexBasis);
    // Every name from where it stands too: a pick turned back half-way (or an item still folding from the one
    // before) goes on from there, so neither a name nor the icon beside it jumps.
    const labels = btns.map(labelOf);
    const now = labels.map((l) => {
      const s = getComputedStyle(l);
      return { width: l.getBoundingClientRect().width, opacity: +s.opacity, filter: s.filter, marginLeft: s.marginLeft };
    });
    [...btns, ...labels].forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
    value = v;
    mark();
    // The picked name's whole width, as it will stand once its item has its share.
    const w1 = labels[to].getBoundingClientRect().width;
    btns.forEach((b, i) => {
      const g1 = i === to ? 1 : 0;
      const f1 = getComputedStyle(b).flexBasis;
      if (g0[i] !== g1 || f0[i] !== f1)
        play(
          b,
          [
            { flexGrow: g0[i], flexBasis: f0[i] },
            { flexGrow: g1, flexBasis: f1 },
          ],
          { duration: SMOOTH.duration, easing: SMOOTH.easing },
        );
    });
    labels.forEach((l, i) => {
      const n = now[i];
      const fade = labelFade({ ...n, full: l.scrollWidth }, i === to);
      if (i !== to) {
        // It folds (its blur, if it was still coming in, stays while it fades).
        if (fade.duration)
          play(
            l,
            [
              { opacity: n.opacity, maxWidth: `${n.width}px`, marginLeft: n.marginLeft, filter: n.filter },
              { opacity: 0, maxWidth: '0px', marginLeft: '-8px', filter: n.filter },
            ],
            { duration: fade.duration, easing: 'ease-out' },
          );
        return;
      }
      // The picked name opens with its item's share, inside the pill, and blurs in.
      play(
        l,
        [
          { maxWidth: `${n.width}px`, marginLeft: n.marginLeft },
          { maxWidth: `${w1}px`, marginLeft: '0px' },
        ],
        { duration: SMOOTH.duration, easing: SMOOTH.easing },
      );
      play(
        l,
        [
          { opacity: n.opacity, filter: n.opacity ? n.filter : 'blur(4px)' },
          { opacity: 1, filter: 'none' },
        ],
        { ...fade, easing: EASE_OUT, fill: 'backwards' },
      );
    });
    // The stretch: the leading edge follows the quick spring, the trailing edge the smooth one.
    const right = to > from;
    const lead = calm() ? SMOOTH : LEAD;
    const t0 = performance.now();
    const end = Math.max(SMOOTH.duration, lead.duration);
    const eL = right ? SMOOTH : lead;
    const eR = right ? lead : SMOOTH;
    cancelAnimationFrame(raf);
    const step = () => {
      const t = calm() ? end : performance.now() - t0;
      const e = edges();
      if (!e) {
        raf = 0;
        return;
      }
      pill.style.left = `${l0 + (e[0] - l0) * eL.at(t)}px`;
      pill.style.right = `${r0 + (e[1] - r0) * eR.at(t)}px`;
      raf = t < end ? requestAnimationFrame(step) : 0;
      if (!raf) placePill();
    };
    raf = requestAnimationFrame(step);
    onPick(v);
  }

  mark();
  new ResizeObserver(() => {
    if (!raf) placePill();
  }).observe(el);
  return {
    el,
    sync(v) {
      if (v === value) return;
      value = v;
      mark();
      placePill();
    },
  };
}
