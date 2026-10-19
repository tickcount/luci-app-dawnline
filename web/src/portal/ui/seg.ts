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
    const g0 = btns.map((b) => parseFloat(getComputedStyle(b).flexGrow) || 0);
    const oldL = labelOf(btns[from]);
    const oldW = oldL.getBoundingClientRect().width;
    [...btns, ...btns.map(labelOf)].forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
    value = v;
    mark();
    btns.forEach((b, i) => {
      const g1 = i === to ? 1 : 0;
      if (g0[i] !== g1) play(b, [{ flexGrow: g0[i] }, { flexGrow: g1 }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
    });
    play(
      oldL,
      [
        { opacity: 1, maxWidth: `${oldW}px`, marginLeft: '0px' },
        { opacity: 0, maxWidth: '0px', marginLeft: '-8px' },
      ],
      { duration: 220, easing: 'ease-out' },
    );
    play(
      labelOf(btns[to]),
      [
        { opacity: 0, filter: 'blur(4px)' },
        { opacity: 1, filter: 'none' },
      ],
      { duration: 280, delay: 70, easing: EASE_OUT, fill: 'backwards' },
    );
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
