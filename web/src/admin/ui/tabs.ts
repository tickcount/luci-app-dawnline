// A segmented track with words (and a caption or an icon beside each): the
// portal's track and pill (DESIGN.md Segmented control), labelled. Tabs are as
// wide as their words; the pill takes the picked one's place as laid out (and
// again when the track's width changes, Outline's sidebar folding included),
// and a pick stretches it there as the portal's app picker does (ui/seg.ts,
// DESIGN.md Motion 10): its leading edge on LEAD, the trailing one on SMOOTH,
// from wherever it stands; with reduced motion it jumps.

import { h } from '../../portal/dom';
import { LEAD, SMOOTH, calm } from '../../portal/motion';
import { replaces } from '../../portal/ui/carry';
import { ic } from './icons';

export interface Tab<T extends string> {
  id: T;
  label: string;
  /** A caption beside the words (a count). */
  sub?: string;
  icon?: string;
}

export interface Tabs<T extends string> {
  el: HTMLElement;
  /** New captions, the tabs kept (counts that moved). */
  subs(sub: (id: T) => string | undefined): void;
}

/**
 * The two lengths a track's fading ends are drawn from (tabs.css), registered so they animate: a custom property
 * that is not registered jumps, and `@property` is not read from a stylesheet inside a shadow root, where the
 * admin's pages live. Once a document.
 */
function registerFades() {
  for (const name of ['--tabs-fade-start', '--tabs-fade-end']) {
    try {
      CSS.registerProperty({ name, syntax: '<length>', inherits: false, initialValue: '0px' });
    } catch {
      // registered already (another page of the admin drew a track before), or the browser has no such registry
    }
  }
}
let fades = false;

/** `b` brought into the track's view: only the track scrolls, never the page; past the fading end, not into it. */
function reveal(track: HTMLElement, b: HTMLElement, smooth: boolean) {
  if (track.scrollWidth <= track.clientWidth + 1) return;
  const pad = 28;
  const l = b.offsetLeft - pad;
  const r = b.offsetLeft + b.offsetWidth + pad;
  const left = l < track.scrollLeft ? l : r > track.scrollLeft + track.clientWidth ? r - track.clientWidth : null;
  if (left != null) track.scrollTo({ left: Math.max(0, left), behavior: smooth && !calm() ? 'smooth' : 'auto' });
}

/** Where scroll-driven animations are missing: the ends of a track that have more beyond them are marked. */
function watchEnds(track: HTMLElement, btns: HTMLElement[]) {
  if (CSS.supports('animation-timeline', 'scroll()') || btns.length < 2) return;
  const [first, last] = [btns[0], btns[btns.length - 1]];
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) track.classList.toggle(e.target === first ? 'more-start' : 'more-end', e.intersectionRatio < 1);
    },
    // (a width of a fraction of a pixel must not leave an end tab short of fully seen)
    { root: track, threshold: 1, rootMargin: '1px' },
  );
  seen.observe(first);
  seen.observe(last);
}

/** The pill's per-frame drive under way, by pill. */
const drives = new WeakMap<HTMLElement, number>();

function placePill(track: HTMLElement) {
  const pill = track.querySelector<HTMLElement>(':scope > .tabs-pill');
  const t = track.querySelector<HTMLElement>(':scope > .tab.on');
  if (pill && t) pillOn(pill, t);
}

/** `pill` on `t` at once (a pill of any track: the section row's too, shell/nav.ts). */
export function pillOn(pill: HTMLElement, t: HTMLElement) {
  if (!t.offsetWidth) return;
  cancelAnimationFrame(drives.get(pill) ?? 0);
  drives.set(pill, 0);
  pill.style.left = `${t.offsetLeft}px`;
  pill.style.width = `${t.offsetWidth}px`;
}

function stretchPill(track: HTMLElement, b: HTMLElement) {
  const pill = track.querySelector<HTMLElement>(':scope > .tabs-pill');
  if (pill) pillTo(pill, b);
}

/** `pill` stretches to `b` from where it stands: its leading edge on LEAD, the trailing one on SMOOTH. */
export function pillTo(pill: HTMLElement, b: HTMLElement) {
  const cs = getComputedStyle(pill);
  const l0 = parseFloat(cs.left);
  const r0 = l0 + parseFloat(cs.width);
  cancelAnimationFrame(drives.get(pill) ?? 0);
  const to = (): [number, number] => [b.offsetLeft, b.offsetLeft + b.offsetWidth];
  const put = (l: number, r: number) => {
    pill.style.left = `${l}px`;
    pill.style.width = `${Math.max(0, r - l)}px`;
  };
  const [l1, r1] = to();
  if (calm() || !Number.isFinite(l0) || !Number.isFinite(r0)) return put(l1, r1);
  const right = l1 + r1 > l0 + r0;
  const eL = right ? SMOOTH : LEAD;
  const eR = right ? LEAD : SMOOTH;
  const end = Math.max(SMOOTH.duration, LEAD.duration);
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.max(0, now - t0);
    // The target as laid out now: a track that changes width on the way keeps it right.
    const [l, r] = to();
    put(l0 + (l - l0) * eL.at(t), r0 + (r - r0) * eR.at(t));
    drives.set(pill, t < end ? requestAnimationFrame(step) : 0);
  };
  drives.set(pill, requestAnimationFrame(step));
}

/** A track of `items`, `on` picked; `onPick` when another is picked (not when the same one is pressed again). */
/**
 * `keep`: the track's name among the controls on screen (ui/carry.ts): built again by a repaint after a pick, its
 * pill goes on from where the last one's stood and stretches to the picked tab.
 */
export function tabs<T extends string>(
  items: Tab<T>[],
  on: T,
  onPick: (id: T) => void,
  o: { cls?: string; label: string; keep?: string },
): Tabs<T> {
  const pill = h('span', { class: 'seg-pill tabs-pill', 'aria-hidden': 'true' });
  const subEls = new Map<T, HTMLElement>();
  const btns = items.map((it) => {
    const sub = h('span', { class: 'tab-s num' }, it.sub ?? '');
    subEls.set(it.id, sub);
    const b = h(
      'button',
      {
        type: 'button',
        class: `seg-b tab${it.id === on ? ' on' : ''}`,
        role: 'tab',
        'aria-selected': String(it.id === on),
        title: it.label,
        'data-id': it.id,
      },
      it.icon ? ic(it.icon) : null,
      h('span', { class: 'tab-l' }, it.label),
      sub,
    );
    b.addEventListener('click', () => {
      if (b.classList.contains('on')) return;
      mark(it.id);
      onPick(it.id);
    });
    return b;
  });
  const el = h('div', { class: `seg tabs ${o.cls ?? ''}`, role: 'tablist', 'aria-label': o.label }, pill, ...btns);
  const mark = (id: T) => {
    btns.forEach((b, i) => {
      const yes = items[i].id === id;
      b.classList.toggle('on', yes);
      b.setAttribute('aria-selected', String(yes));
    });
    const picked = btns[items.findIndex((it) => it.id === id)];
    if (picked) stretchPill(el, picked);
    // a tab pressed while half in view comes whole into it, with part of the next one
    if (picked) reveal(el, picked, true);
  };
  if (!fades) registerFades();
  fades = true;
  watchEnds(el, btns);
  // Where the pill of the track this one replaces stands (its drive stopped: this one's takes over).
  const was = o.keep ? replaces(`tabs:${o.keep}`, el)?.querySelector<HTMLElement>(':scope > .tabs-pill') : null;
  const from = was ? ([was.offsetLeft, was.offsetWidth] as const) : null;
  if (was && from) {
    cancelAnimationFrame(drives.get(was) ?? 0);
    pill.style.left = `${from[0]}px`;
    pill.style.width = `${from[1]}px`;
  }
  // until it has set off from there, nothing else places it
  let arriving = !!from;
  // Placed once laid out (stretched there from the last one's place), and again whenever the track's width changes.
  requestAnimationFrame(() => {
    arriving = false;
    const picked = el.querySelector<HTMLElement>(':scope > .tab.on');
    if (from && picked?.offsetWidth && (Math.abs(picked.offsetLeft - from[0]) > 0.5 || Math.abs(picked.offsetWidth - from[1]) > 0.5))
      stretchPill(el, picked);
    else placePill(el);
    // the picked tab is in view from the start, wherever in the track it is
    if (picked) reveal(el, picked, false);
  });
  // (a pill on its way to a pick follows the layout by itself)
  new ResizeObserver(() => !arriving && !drives.get(pill) && placePill(el)).observe(el);
  return {
    el,
    subs: (sub) => {
      subEls.forEach((s, id) => {
        s.textContent = sub(id) ?? '';
      });
      // New counts move the tabs: the pill follows, unless it is on its way to a pick.
      if (!drives.get(pill)) placePill(el);
    },
  };
}
