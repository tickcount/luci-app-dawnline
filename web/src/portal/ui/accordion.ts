// The accordion (skiper103's motion, on a softer spring): rows touch while
// closed and share their rounded ends; an open row lifts out with 10 px gaps
// and its own corners. One row open at a time. A row with nothing to open is a
// plain head: no chevron, no click. Inside the sheet it tells the sheet first,
// so a code that comes into view gets its width. A row the person opens is
// `.opened` until it closes: what enters inside it (the calendar's days) keys on
// that, so a repaint that rebuilds the row open doesn't play it again.

import { h, ic } from '../dom';
import { EASE_IN, SOFT, play } from '../motion';
import { planWidth, startWidth } from './sheet';

export interface AccItem {
  icon: Element;
  title: string;
  /** Beside the title (a chip). */
  tag?: Node | null;
  /** At the head's end (numbers). */
  val?: Node | null;
  /** The body shows the same numbers: the head drops them while open. */
  valHide?: boolean;
  body: (Node | null | false | undefined)[];
}

export interface Accordion {
  el: HTMLElement;
  /** The open row, or -1. */
  openIndex(): number;
  /** Open this row (or none), without motion: a repaint keeps what was open. */
  setOpen(i: number): void;
}

/** The properties the rows animate between their closed and open shapes. */
const PROPS = [
  'height',
  'marginTop',
  'marginBottom',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
] as const;

export function accordion(
  items: AccItem[],
  o: { inset?: boolean; open?: number; onToggle?: (i: number, open: boolean, instant: boolean) => void } = {},
): Accordion {
  const acc = h('div', { class: `acc${o.inset ? ' inset' : ''}` });
  const rows = items.map((it, i) => {
    const kids = it.body.filter((k): k is Node => !!k);
    const still = !kids.length;
    const inner = [
      it.icon,
      h('span', { class: 'acc-title' }, h('span', { class: 't' }, it.title), it.tag ?? null),
      it.val ? h('span', { class: `acc-val${it.valHide ? ' hide-open' : ''}` }, it.val) : null,
    ];
    const open = i === o.open && !still;
    const headEl = still
      ? h('div', { class: 'acc-head' }, ...inner)
      : h(
          'button',
          { type: 'button', class: 'acc-head', 'aria-expanded': String(open), onclick: () => toggle(r) },
          ...inner,
          ic('chevron', 'i acc-chev'),
        );
    const r = h(
      'div',
      { class: `acc-row${still ? ' still' : ''}${open ? ' open' : ''}` },
      headEl,
      h('div', { class: 'acc-body' }, ...kids),
    );
    acc.appendChild(r);
    return r;
  });
  const bodyOf = (r: HTMLElement) => r.querySelector('.acc-body') as HTMLElement;
  const corners = () =>
    rows.forEach((r, i) => {
      const op = r.classList.contains('open');
      r.classList.toggle('rt', i === 0 || op || rows[i - 1].classList.contains('open'));
      r.classList.toggle('rb', i === rows.length - 1 || op || rows[i + 1].classList.contains('open'));
    });
  const read = (x: HTMLElement) => {
    const cs = getComputedStyle(x);
    const out: Record<string, string> = {};
    for (const p of PROPS) out[p] = p === 'height' ? `${x.getBoundingClientRect().height}px` : cs[p];
    return out;
  };
  const aria = () =>
    rows.forEach((x) => x.querySelector('button.acc-head')?.setAttribute('aria-expanded', String(x.classList.contains('open'))));

  function toggle(r: HTMLElement) {
    const before = rows.map(read);
    rows.forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
    rows.forEach((x) =>
      bodyOf(x)
        .getAnimations()
        .forEach((a) => a.cancel()),
    );
    const willOpen = !r.classList.contains('open');
    const closing = rows.filter((x) => x.classList.contains('open') && (x === r || willOpen));
    rows.forEach((x) => {
      x.classList.remove('closing');
      if (x !== r) x.classList.remove('open', 'opened');
    });
    r.classList.toggle('open', willOpen);
    r.classList.toggle('opened', willOpen);
    corners();
    const plan = planWidth();
    rows.forEach((x, i) => {
      const after = read(x);
      if (!PROPS.some((p) => before[i][p] !== after[p])) return;
      if (closing.includes(x)) x.classList.add('closing');
      play(x, [before[i], after], { duration: SOFT.duration, easing: SOFT.easing }).onfinish = () => x.classList.remove('closing');
    });
    closing.forEach((x) =>
      play(bodyOf(x), [{ opacity: 1 }, { opacity: 0, filter: 'blur(2px)' }], { duration: 160, easing: EASE_IN, fill: 'forwards' }),
    );
    if (willOpen)
      play(
        bodyOf(r),
        [
          { opacity: 0, filter: 'blur(2px)' },
          { opacity: 1, filter: 'blur(0px)' },
        ],
        { duration: 300, easing: 'cubic-bezier(0,0,.58,1)' },
      );
    startWidth(plan);
    aria();
    o.onToggle?.(rows.indexOf(r), willOpen, false);
  }

  corners();
  return {
    el: acc,
    openIndex: () => rows.findIndex((x) => x.classList.contains('open')),
    setOpen(i) {
      rows.forEach((x, k) => x.classList.toggle('open', k === i && !x.classList.contains('still')));
      corners();
      aria();
      rows.forEach((x, k) => o.onToggle?.(k, x.classList.contains('open'), true));
    },
  };
}
