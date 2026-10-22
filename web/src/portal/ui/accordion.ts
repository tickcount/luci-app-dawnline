// The accordion (skiper103's motion, on a softer spring): rows touch while
// closed and share their rounded ends; an open row lifts out with 10 px gaps
// and its own corners. One row open at a time. A row with nothing to open is a
// plain head: no chevron, no click. Inside the sheet it tells the sheet first,
// so a code that comes into view gets its width. A row the person opens is
// `.opened` until it has shut: what enters inside it (the calendar's days) keys
// on that, so a repaint that rebuilds the row open doesn't play it again, and a
// row opened again before it has shut carries on. A click mid-way (a double
// click) turns every row and body back from where it stands, and a row around
// them glides on with them (`regrow`, which the set-up sheet also uses when a
// pick changes a row still opening); the sheet follows its view by itself.

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
  /**
   * Actions on what the row holds, beside the chevron while it is open (gone while it is shut). Beside the head,
   * not in it: the head is a button itself.
   */
  aside?: Node | null;
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

/** A body not showing (display: none) stands where an opening one starts. */
const HIDDEN: Keyframe = { opacity: 0, filter: 'blur(2px)' };

/** A body's new fade takes over from the one under way, which stops once the new one is in place. */
function fade(body: HTMLElement, frames: Keyframe[], o: KeyframeAnimationOptions) {
  const old = body.getAnimations();
  play(body, frames, o);
  old.forEach((a) => a.cancel());
}

/** What a keyframe holds besides the properties it animates. */
const META = new Set(['offset', 'computedOffset', 'easing', 'composite']);
const kebab = (p: string) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * Content changed under a glide still heading for a height it measured before
 * (a row opening, a fold coming back): each element from `from` up whose
 * height glides to what its content gives it carries on from where it stands
 * to what its content gives it now, on its own curve, so it neither clips what
 * grew nor jumps when the glide ends. A row closing (its height is its head's,
 * not its content's) or a fold shutting keeps its end. Called with what changed
 * in its end shape, before that moves. The heights are taken at the sheet's end
 * width (a dense code widening it).
 */
export function regrow(...from: (Element | null | undefined)[]) {
  const runs: { el: HTMLElement; a: Animation; t: CSSNumberish | null; cur: Keyframe; to: Keyframe }[] = [];
  const widths: { a: Animation; t: CSSNumberish | null }[] = [];
  const seen = new Set<Element>();
  for (const start of from)
    for (let el: Element | null | undefined = start; el && !seen.has(el); el = el.parentElement) {
      seen.add(el);
      if (!(el instanceof HTMLElement) || el.classList.contains('closing')) continue;
      for (const a of el.getAnimations()) {
        const ks = a.playState === 'running' && a.effect instanceof KeyframeEffect ? a.effect.getKeyframes() : [];
        const end = ks[ks.length - 1];
        if (end && ('width' in end || 'maxWidth' in end)) widths.push({ a, t: a.currentTime });
        if (!end?.height || end.height === '0px') continue;
        const cs = getComputedStyle(el);
        const cur: Keyframe = {};
        const to: Keyframe = {};
        for (const p of Object.keys(end))
          if (!META.has(p)) {
            cur[p] = cs.getPropertyValue(kebab(p));
            to[p] = end[p];
          }
        runs.push({ el, a, t: a.currentTime, cur, to });
      }
    }
  if (!runs.length) return;
  // Measured with every glide lifted, the widths too; those not aimed anew go on from where they were.
  [...runs, ...widths].forEach((r) => r.a.cancel());
  const ends = runs.map((r) => getComputedStyle(r.el).height);
  for (const w of widths) {
    w.a.play();
    w.a.currentTime = w.t;
  }
  runs.forEach((r, i) => {
    r.a.play();
    // Its content gives it the height it was heading for: it carries on as it was.
    if (Math.abs(parseFloat(ends[i]) - parseFloat(String(r.to.height))) < 0.5) r.a.currentTime = r.t;
    else (r.a.effect as KeyframeEffect).setKeyframes([r.cur, { ...r.to, height: ends[i] }]);
  });
}

export function accordion(
  items: AccItem[],
  o: {
    inset?: boolean;
    open?: number;
    onToggle?: (i: number, open: boolean, instant: boolean) => void;
    /** On the page: holds its height as a click reshapes the rows; what it returns lets go once their new shape is measured. */
    hold?: () => () => void;
  } = {},
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
      { class: `acc-row${still ? ' still' : ''}${open ? ' open' : ''}${it.aside ? ' has-aside' : ''}` },
      headEl,
      it.aside ? h('div', { class: 'acc-aside' }, it.aside) : null,
      h('div', { class: 'acc-body' }, ...kids),
    );
    acc.appendChild(r);
    return r;
  });
  const bodyOf = (r: HTMLElement) => r.querySelector('.acc-body') as HTMLElement;
  /** Corners and edges over the rows that show: a row stepped out (only()) leaves no gap or corner behind. */
  const corners = () => {
    const shown = rows.filter((r) => !r.hidden);
    shown.forEach((r, i) => {
      const op = r.classList.contains('open');
      r.classList.toggle('rt', i === 0 || op || shown[i - 1].classList.contains('open'));
      r.classList.toggle('rb', i === shown.length - 1 || op || shown[i + 1].classList.contains('open'));
    });
    rows.forEach((r) => {
      r.classList.toggle('first', r === shown[0]);
      r.classList.toggle('last', r === shown[shown.length - 1]);
    });
  };
  const read = (x: HTMLElement) => {
    const cs = getComputedStyle(x);
    const out: Record<string, string> = {};
    for (const p of PROPS) out[p] = p === 'height' ? `${x.getBoundingClientRect().height}px` : cs[p];
    return out;
  };
  const aria = () =>
    rows.forEach((x) => x.querySelector('button.acc-head')?.setAttribute('aria-expanded', String(x.classList.contains('open'))));
  /** A row shows its body while open and while it closes (`.closing`). */
  const shows = (x: HTMLElement) => x.classList.contains('open') || x.classList.contains('closing');
  /** Where a body's fade stands now, mid-fade included. */
  const faded = (x: HTMLElement): Keyframe => {
    if (!shows(x)) return HIDDEN;
    const cs = getComputedStyle(bodyOf(x));
    return { opacity: cs.opacity, filter: cs.filter === 'none' ? 'blur(0px)' : cs.filter };
  };

  function toggle(r: HTMLElement) {
    const before = rows.map(read);
    const fades = rows.map(faded);
    const release = o.hold?.();
    rows.forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
    const willOpen = !r.classList.contains('open');
    // Every row showing its body shuts, still closing from a click before included, but the one that opens.
    const closing = rows.filter((x) => shows(x) && !(x === r && willOpen));
    rows.forEach((x) => {
      x.classList.remove('closing');
      if (x !== r) x.classList.remove('open');
    });
    r.classList.toggle('open', willOpen);
    if (willOpen) r.classList.add('opened');
    corners();
    const plan = planWidth();
    const after = rows.map(read);
    release?.();
    // The row this accordion sits in glides on to its new height with them (the sheet follows its view by itself).
    regrow(acc.parentElement);
    rows.forEach((x, i) => {
      // Shut: what enters inside it plays again the next time it opens.
      const shut = () => {
        x.classList.remove('closing');
        if (!x.classList.contains('open')) x.classList.remove('opened');
      };
      if (!PROPS.some((p) => before[i][p] !== after[i][p])) return shut();
      if (closing.includes(x)) x.classList.add('closing');
      play(x, [before[i], after[i]], { duration: SOFT.duration, easing: SOFT.easing }).onfinish = shut;
    });
    // Each body fades on from where it stands (a double click turns it back), over what is left of its way.
    closing.forEach((x) => {
      const f = fades[rows.indexOf(x)];
      fade(bodyOf(x), [f, { opacity: 0, filter: 'blur(2px)' }], { duration: 160 * Number(f.opacity), easing: EASE_IN, fill: 'forwards' });
    });
    if (willOpen) {
      const f = fades[rows.indexOf(r)];
      fade(bodyOf(r), [f, { opacity: 1, filter: 'blur(0px)' }], {
        duration: 300 * (1 - Number(f.opacity)),
        easing: 'cubic-bezier(0,0,.58,1)',
      });
    }
    startWidth(plan);
    aria();
    o.onToggle?.(rows.indexOf(r), willOpen, false);
  }

  corners();
  return {
    el: acc,
    openIndex: () => rows.findIndex((x) => x.classList.contains('open')),
    setOpen(i) {
      rows.forEach((x, k) => {
        // Without motion: whatever was under way stops where it was going.
        [x, bodyOf(x)].forEach((e) => e.getAnimations().forEach((a) => a.cancel()));
        const open = k === i && !x.classList.contains('still');
        x.classList.toggle('open', open);
        x.classList.remove('closing');
        if (!open) x.classList.remove('opened');
      });
      corners();
      aria();
      rows.forEach((x, k) => o.onToggle?.(k, x.classList.contains('open'), true));
    },
  };
}
