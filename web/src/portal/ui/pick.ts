// A pill that picks one of a few options (the language in the breadcrumb; the demo's set-up state): what is
// picked and a chevron. Its popup, a dropdown as every other (ui/drop.ts: its glass, its gap, its way in and out,
// what shuts it), is a row of segments in one pill frame beside it, its tail one shape with it, pointing at the pill. A click opens it and another picks; or press the pill, slide onto an option and let go
// there (a quick pick: let go anywhere else after sliding and nothing changes). The chevron turns up as it opens
// and on round to down as it shuts; what the pill says morphs into the one picked. Fixed to the screen (it may open
// on a sheet), it also shuts on a wheel or a swipe, and on Tab.

import { h, ic } from '../dom';
import { EASE_IN, play } from '../motion';
import { appear, EDGE, GAP, opened, vanish } from './drop';
import { glide } from './glide';
import { letterIn, letterOut, morphText, setText } from './morph';

interface PickOption<T> {
  value: T;
  label: () => string;
  /** Before the label, in the popup and on the pill (a dot, a flag): made anew each time it shows. */
  lead?: () => Element;
}

export interface PickPill<T> {
  el: HTMLButtonElement;
  /** Show this value, without motion (it changed elsewhere). */
  show(v: T): void;
  close(): void;
}

interface PickOpts<T> {
  /** The pill's own class (its look). */
  cls: string;
  label: () => string;
  options: PickOption<T>[];
  value: T;
  /** What the pill says for a value: the option's label unless given (the language's code). */
  short?: (v: T) => string;
  pick: (v: T) => void;
  /** Where the popup goes first: above the pill (default) or under it; the other side where it does not fit. */
  prefer?: 'above' | 'below';
}

/** The tail: its height and half its width at the base. */
const TAIL = 6;
const HALF = 10;

/**
 * The popup's outline, `w` × `h`: a pill of radius `r` with its tail at `x` on the top edge (`up`) or the bottom
 * one, its shoulders leaving the edge level (so it flows out of the frame) and its tip rounded.
 */
function outline(w: number, ht: number, r: number, x: number, up: boolean): string {
  const y0 = up ? TAIL : 0;
  const y1 = up ? ht : ht - TAIL;
  const tip = up ? 0 : ht;
  const n = (v: number) => Math.round(v * 100) / 100;
  const tail = (a: number, b: number, base: number) =>
    `L ${n(a)} ${base} C ${n(a + (b - a) / 4)} ${base} ${n(x - (b - a) / 8)} ${tip} ${n(x)} ${tip} ` +
    `C ${n(x + (b - a) / 8)} ${tip} ${n(b - (b - a) / 4)} ${base} ${n(b)} ${base} `;
  return (
    `M ${r} ${y0} ${up ? tail(x - HALF, x + HALF, y0) : ''}L ${w - r} ${y0} A ${r} ${r} 0 0 1 ${w - r} ${y1} ` +
    `${up ? '' : tail(x + HALF, x - HALF, y1)}L ${r} ${y1} A ${r} ${r} 0 0 1 ${r} ${y0} Z`
  );
}

interface Open {
  el: HTMLElement;
  pop: HTMLElement;
  close(): void;
  choose(b: HTMLElement): void;
  /** The dropdowns' highlight on this segment (ui/glide.ts). */
  light(b: HTMLElement | null): void;
  /** A press on the pill under way: was the popup open before it, and has it slid since. */
  press: { wasOpen: boolean; x: number; y: number; moved: boolean } | null;
}
let open: Open | null = null;

/** Gone from where it stands, so one leaving while it still comes in turns back from there. */
function leave(el: Element, frames: Keyframe, ms: number) {
  const s = getComputedStyle(el);
  el.getAnimations().forEach((a) => a.cancel());
  play(
    el,
    [
      { opacity: s.opacity, transform: s.transform, filter: s.filter },
      { opacity: 0, ...frames },
    ],
    {
      duration: ms,
      easing: EASE_IN,
      fill: 'forwards',
    },
  ).onfinish = () => el.remove();
}

const optionAt = (x: number, y: number) =>
  open ? (document.elementFromPoint(x, y)?.closest<HTMLElement>('.pp-pop button') ?? null) : null;

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener(
    'pointermove',
    (e) => {
      const p = open?.press;
      if (!open || !p) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) p.moved = true;
      open.light(optionAt(e.clientX, e.clientY));
    },
    true,
  );
  document.addEventListener(
    'pointerup',
    (e) => {
      const o = open;
      const p = o?.press;
      if (!o || !p) return;
      o.press = null;
      const at = optionAt(e.clientX, e.clientY);
      if (at && o.pop.contains(at)) return o.choose(at);
      const onPill = o.el.contains(document.elementFromPoint(e.clientX, e.clientY));
      // A click on the pill: it opened and stays; open already, it shuts. Slid off and let go elsewhere: nothing.
      if (onPill ? p.wasOpen && !p.moved : p.moved) o.close();
    },
    true,
  );
  document.addEventListener('pointercancel', () => open && (open.press = null), true);
  document.addEventListener(
    'keydown',
    (e) => {
      if (!open) return;
      if (e.key === 'Tab') open.close();
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && open.pop.contains(document.activeElement)) {
        e.preventDefault();
        const bs = [...open.pop.querySelectorAll<HTMLElement>('button')];
        const i = bs.indexOf(document.activeElement as HTMLElement) + (e.key === 'ArrowRight' ? 1 : -1);
        bs[Math.max(0, Math.min(bs.length - 1, i))].focus({ preventScroll: true });
      }
    },
    true,
  );
  for (const ev of ['wheel', 'touchmove'])
    addEventListener(ev, (e) => open && !open.pop.contains(e.target as Node) && !open.el.contains(e.target as Node) && open.close(), {
      passive: true,
      capture: true,
    });
}

export function pickPill<T>(o: PickOpts<T>): PickPill<T> {
  wire();
  let value = o.value;
  const opt = (v: T) => o.options.find((x) => x.value === v) ?? o.options[0];
  const words = (v: T) => (o.short ? o.short(v) : opt(v).label());
  const lead = h('span', { class: 'pp-lead' });
  const lbl = h('span', { class: 'pp-t' });
  const chev = ic('chevron', 'i pp-chev') as SVGElement;
  const el = h(
    'button',
    { type: 'button', class: `pp ${o.cls}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    lead,
    lbl,
    chev,
  ) as HTMLButtonElement;
  /** What it leads with follows the value; `swap`: the old one blurs away over the new one as that pops in. */
  const paint = (swap = false) => {
    const n = opt(value).lead?.();
    const old = swap ? [...lead.children].filter((c) => !c.classList.contains('pp-gone')) : [];
    lead.replaceChildren(...old, ...(n ? [n] : []));
    lead.hidden = !n && !old.length;
    el.setAttribute('aria-label', o.label());
    if (!swap) return;
    // As the first letter of the words beside it: it goes and comes with them (ui/morph.ts).
    for (const c of old) {
      c.classList.add('pp-gone');
      letterOut(c).onfinish = () => c.remove();
    }
    if (n) letterIn(n);
  };
  setText(lbl, words(value));
  paint();

  // The chevron turns by its own angle, so shutting goes on round (up, left, down) rather than back; once down it
  // is 90° again, unseen.
  chev.addEventListener('transitionend', () => {
    if (chev.style.rotate !== '-270deg') return;
    chev.style.transition = 'none';
    chev.style.rotate = '';
    chev.getBoundingClientRect();
    chev.style.transition = '';
  });

  let me: Open | null = null;
  let shade: HTMLElement | null = null;
  /** Lets go of what every dropdown listens for (ui/drop.ts). */
  let release: () => boolean = () => false;
  const close = (now = false) => {
    if (!me || !release()) return;
    if (now) {
      me.pop.remove();
      shade?.remove();
    } else {
      vanish(me.pop);
      if (shade) leave(shade, {}, 110);
    }
    shade = null;
    if (open === me) open = null;
    me = null;
    chev.style.rotate = '-270deg';
  };
  const choose = (b: HTMLElement) => {
    const v = o.options[Number(b.dataset.i)].value;
    close();
    if (v === value) return;
    const was = words(value);
    value = v;
    // Picking may draw the page again (a language): the pill is the same one, put back; its words morph after.
    o.pick(v);
    paint(true);
    morphText(lbl, words(v), was);
  };

  const show = (focus: boolean) => {
    const pop = h(
      'div',
      { class: 'pp-pop drop', role: 'menu', 'aria-label': o.label() },
      ...o.options.map((x, i) =>
        h(
          'button',
          {
            type: 'button',
            role: 'menuitemradio',
            tabindex: '-1',
            'data-i': String(i),
            'aria-checked': String(x.value === value),
            onclick: (e: Event) => choose(e.currentTarget as HTMLElement),
          },
          x.lead?.() ?? null,
          h('span', {}, x.label()),
        ),
      ),
    );
    document.body.append(pop);
    // Centred on the pill, inside its sheet where it fits (else the screen), the tail on the pill's middle and its
    // tip the dropdowns' gap from it.
    const r = el.getBoundingClientRect();
    const box = el.closest('.sheet')?.getBoundingClientRect() ?? { left: 0, right: innerWidth };
    const w = pop.offsetWidth;
    const ht = pop.offsetHeight;
    const mid = r.left + r.width / 2;
    const lo = Math.max(EDGE, box.left + 10);
    const hi = Math.min(innerWidth - EDGE, box.right - 10);
    const left = Math.max(lo, Math.min(mid - w / 2, hi - w));
    // The tail is part of the glass (one shape with the frame, a clip path): the popup grows by it towards the pill.
    const all = ht + TAIL;
    const above = r.top - GAP - all >= EDGE;
    const under = r.bottom + GAP + all <= innerHeight - EDGE;
    const below = o.prefer === 'below' ? under || !above : !above;
    const top = below ? r.bottom + GAP : r.top - GAP - all;
    pop.classList.add(below ? 'below' : 'above');
    const x = Math.max(ht / 2 + HALF, Math.min(mid - left, w - ht / 2 - HALF));
    const shape = outline(w, all, ht / 2, x, below);
    Object.assign(pop.style, {
      left: `${left}px`,
      top: `${top}px`,
      height: `${all}px`,
      clipPath: `path('${shape}')`,
      transformOrigin: `${x}px ${below ? 0 : all}px`,
    });
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('class', 'pp-ring');
    ring.setAttribute('aria-hidden', 'true');
    ring.setAttribute('viewBox', `0 0 ${w} ${all}`);
    const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    edge.setAttribute('d', shape);
    ring.append(edge);
    pop.append(ring);
    // The glass's shadow (light only, tokens.css): the clip path would cut one off the popup, so a clear pill under
    // its frame casts it (an outer shadow shows only outside its box).
    shade = h('div', { class: 'pp-shade', 'aria-hidden': 'true' });
    Object.assign(shade.style, {
      left: `${left}px`,
      top: `${top + (below ? TAIL : 0)}px`,
      width: `${w}px`,
      height: `${ht}px`,
    });
    pop.before(shade);
    play(shade, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    appear(pop);
    release = opened(pop, el, close);
    // The highlight rests on the picked segment: it is what says which one is picked.
    const { light } = glide(pop, [...pop.querySelectorAll<HTMLElement>('button')], pop.querySelector<HTMLElement>('[aria-checked="true"]'));
    me = { el, pop, close, choose, light, press: null };
    open = me;
    chev.style.rotate = '-90deg';
    if (focus) pop.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  };

  let pressedAt = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pressedAt = performance.now();
    const wasOpen = !!me;
    if (!me) show(false);
    me!.press = { wasOpen, x: e.clientX, y: e.clientY, moved: false };
    // A touch keeps to what it pressed: let it go, so what is under the finger can be found as it slides.
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  });
  // The keyboard's click (Return, Space): a press already did what it does.
  el.addEventListener('click', () => {
    if (performance.now() - pressedAt < 800) return;
    if (me) close();
    else show(true);
  });

  return {
    el,
    show(v) {
      if (v === value) return;
      value = v;
      setText(lbl, words(v));
      paint();
    },
    close,
  };
}
