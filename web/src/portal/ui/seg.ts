// The icon picker (the apps): icons only, the picked one widens and shows its
// name. The pill stretches like skiper21's tabs: its leading edge reaches the
// new item first and the trailing edge follows, so the name fading in is always
// inside it. Items grow by flex-grow (a share of the track, not pixels), so
// they stay right while the sheet around them changes width. At rest the pill
// stands where CSS puts it (its item's place among the others: controls.css), so
// a sheet changing width, a phone turned, carry it along with nothing to watch;
// only a pick moves it from here. A name wider than its place fades out at
// the edge it runs past and glides to its end on hover (marquee()).

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

/** How fast a name too long for its place glides to its end (px/s): slow enough to read along. */
const GLIDE_SPEED = 40;
/** In and out of the glide, gently at both ends. */
const GLIDE_EASE = 'cubic-bezier(.45, 0, .55, 1)';

interface Marquee {
  /** Glide to the name's end, or back to its start (`now`: at once). */
  go(end: boolean, now?: boolean): void;
  /** At the start, at once (another item picked). */
  reset(): void;
  /** At the end: back; at the start: to the end (a tap on the picked item, where there is no hover). */
  toggle(): void;
}

/**
 * A name in its place (`l`, its words the inline block inside): wider than
 * the place, it is `.clip` and fades to nothing at the edge it runs past
 * (controls.css); at its end (`.end`) the fade moves to the other edge. It
 * glides from where it stands, at GLIDE_SPEED, a beat after the pointer comes.
 */
function marquee(l: HTMLElement): Marquee {
  const t = l.firstElementChild as HTMLElement;
  let atEnd = false;
  /** The glide under way, if any. */
  let glide: Animation | null = null;
  const over = () => Math.max(0, t.offsetWidth - l.clientWidth);
  /** To the end or the start, from where it stands; `delay` before it sets off (a beat on hover, none to follow a moved end). */
  function go(end: boolean, now = false, delay = end ? 240 : 0) {
    const o = end ? over() : 0;
    atEnd = end && o > 0;
    l.classList.toggle('end', atEnd);
    const from = new DOMMatrix(getComputedStyle(t).transform).m41;
    t.getAnimations().forEach((a) => a.cancel());
    glide = null;
    t.style.transform = o ? `translateX(${-o}px)` : '';
    const dist = Math.abs(-o - from);
    if (now || dist < 0.5) return;
    const a = play(t, [{ transform: `translateX(${from}px)` }, { transform: `translateX(${-o}px)` }], {
      duration: Math.max(420, (dist / GLIDE_SPEED) * 1000),
      delay,
      easing: GLIDE_EASE,
      fill: 'backwards',
    });
    glide = a;
    // The place changed while it glided (a pick still opening it, the sheet still gliding to its width): on to
    // the end it has now, from where it landed, without a jump.
    a.onfinish = () => {
      if (glide !== a) return;
      glide = null;
      if (atEnd && Math.abs(over() - o) > 0.5) go(true, false, 0);
    };
  }
  // Its place changes (a pick opens or folds it, the sheet changes width): clipped or not. At its end and still,
  // it glides to where the end is now (back to the start if it fits); a glide under way corrects when it lands.
  new ResizeObserver(() => {
    l.classList.toggle('clip', over() > 0.5);
    if (atEnd && !glide) go(true, false, 0);
  }).observe(l);
  return { go, reset: () => go(false, true), toggle: () => go(!atEnd) };
}

export function iconSeg<T extends string>(items: SegItem<T>[], value: T, onPick: (v: T) => void): IconSeg<T> {
  const pill = h('span', { class: 'seg-pill' });
  const el = h('div', { class: 'seg appseg', role: 'tablist' }, pill);
  // A touch has no hover: a tap on the picked item glides its name instead.
  let touch = false;
  const btns = items.map((it) => {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'seg-b',
        role: 'tab',
        'aria-label': it.label,
        title: it.label,
        onclick: () => (it.value === value ? touch && marquees[btns.indexOf(b)].toggle() : pick(it.value)),
      },
      ic(it.icon),
      h('span', { class: 'seg-l' }, h('span', { class: 'seg-t' }, it.label)),
    );
    b.dataset.v = it.value;
    b.addEventListener('pointerdown', (e) => (touch = e.pointerType !== 'mouse'));
    // The picked item's name glides to its end while the pointer (or the keyboard's focus) is on it.
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && b.classList.contains('on')) marquees[btns.indexOf(b)].go(true);
    });
    b.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') marquees[btns.indexOf(b)].go(false);
    });
    b.addEventListener('focus', () => {
      if (b.matches(':focus-visible') && b.classList.contains('on')) marquees[btns.indexOf(b)].go(true);
    });
    b.addEventListener('blur', () => marquees[btns.indexOf(b)].go(false));
    el.appendChild(b);
    return b;
  });
  const labelOf = (b: HTMLElement) => b.querySelector('.seg-l') as HTMLElement;
  const marquees = btns.map((b) => marquee(labelOf(b)));
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
  /** At rest: its item's place, for CSS to keep (`--i` of `--n`), nothing inline. */
  const placePill = () => {
    pill.style.setProperty(
      '--i',
      String(
        Math.max(
          0,
          btns.findIndex((b) => b.dataset.v === value),
        ),
      ),
    );
    pill.style.setProperty('--n', String(btns.length));
    pill.style.left = '';
    pill.style.right = '';
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
    // Every name back at its start; the picked one glides once it has its place, if the pointer is still on it.
    marquees.forEach((m) => m.reset());
    window.setTimeout(() => {
      if (value === v && btns[to].matches(':hover') && !touch) marquees[to].go(true);
    }, SMOOTH.duration);
    value = v;
    mark();
    // The picked name's own width (its words, up to the 180 px CSS gives a picked name), not the room it has
    // now: the room changes while it opens (AmneziaVPN's dense code widens the sheet), and a width measured
    // before that would jump to the new room when the animation hands back to CSS. Where there is less room,
    // the item squeezes the name (it shrinks to its place: controls.css), so the end is where CSS puts it.
    const w1 = Math.min(180, (labels[to].firstElementChild as HTMLElement).offsetWidth);
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
  placePill();
  return {
    el,
    sync(v) {
      if (v === value) return;
      value = v;
      marquees.forEach((m) => m.reset());
      mark();
      placePill();
    },
  };
}
