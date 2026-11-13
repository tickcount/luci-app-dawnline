// Content that changes in place, without a jump: the box glides from the height it had to the one it has now (the
// smooth spring, clipped while it glides), so what comes in unfolds and what goes folds away; a glide under way goes
// on from where it stands. refill() also lets the pieces change in place (portal morphInto, deep: what did not
// change stays still and keeps its place, gliding if it moved; a block that holds pieces is gone into and glides to
// its new height, never crossed whole; words morph; only what is new blurs in; what left fades where it stood).
// Nothing moves in calm mode, for a box not on screen, or when the new content is the same as the old. And nothing
// moves at all while the page stands still (portal/motion.ts standStill: the admin), where all of this only puts
// the new content in its place.

import type { Kid } from '../../portal/dom';
import { EASE_IN, SMOOTH, SOFT, calm, play, still } from '../../portal/motion';
import { carryControls } from '../../portal/ui/carry';
import { putChildren } from '../../portal/ui/put';
import { appear, fold, morphInto, morphText, textOf } from '../../portal/ui/morph';

const shown = (el: Element) => el.isConnected && el.getClientRects().length > 0;

/** Boxes still moving from their last refill, and until when. */
const moving = new WeakMap<HTMLElement, number>();
const esc = (t: string) =>
  t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00a0/g, '&nbsp;');
/**
 * Markup as it shows: without what each build makes up (a glass icon's gradient ids) and what runs on it at the
 * moment (inline styles a glide or a pill sets, a morph's and a wait's classes), so a block built again the same
 * is seen as the same.
 */
const shows = (m: string) =>
  m
    .replace(/\b(id="|url\(#|href="#)(gl|ll)\d+/g, '$1$2')
    .replace(/ style="[^"]*"/g, '')
    .replace(
      / class="([^"]*)"/g,
      (_x, c: string) =>
        ` class="${c
          .split(' ')
          .filter((k) => k && k !== 'wait' && k !== 'mt' && !k.startsWith('mt-'))
          .join(' ')}"`,
    );
/** Two markups that show the same (see `shows`). */
export const same = (a: string, b: string) => a === b || shows(a) === shows(b);
/** What `kids` would put in a box, as its innerHTML would read. */
const markup = (kids: Node[]) =>
  kids.map((k) => (k instanceof Element ? k.outerHTML : k.nodeType === Node.TEXT_NODE ? esc(k.textContent ?? '') : '')).join('');

/**
 * What says a value in a block: a number (`.num`), a keyed text (`data-t`, the portal's), a tile's line under its
 * number, a head's state, or what a build marks as one (`data-live`: a state's words, «5 min ago»). Only those that
 * hold words alone (or are morphing them).
 */
const VALUES = '.num, [data-t], [data-live], .stat-sub, .ph-state';
const says = (el: HTMLElement) => !el.firstElementChild || el.classList.contains('mt-run');

/** The values a block says, before a repaint puts another in its place. */
export interface Values {
  keyed: Map<string, string>;
  /** Those without a key, in the block's order. */
  loose: string[];
}

function valuesIn(roots: Iterable<Node>): { keyed: Map<string, HTMLElement>; loose: HTMLElement[] } {
  const keyed = new Map<string, HTMLElement>();
  const loose: HTMLElement[] = [];
  for (const root of roots) {
    if (!(root instanceof Element)) continue;
    const all = [...(root.matches(VALUES) ? [root] : []), ...root.querySelectorAll(VALUES)] as HTMLElement[];
    for (const el of all) {
      if (!says(el)) continue;
      const k = el.dataset.t;
      if (k) keyed.set(k, el);
      else loose.push(el);
    }
  }
  return { keyed, loose };
}

/** What `roots` say now (see `Values`); null where nothing would be watched (less motion asked for, nothing drawn). */
export function valuesOf(...roots: Node[]): Values | null {
  if (calm()) return null;
  const v = valuesIn(roots);
  if (!v.keyed.size && !v.loose.length) return null;
  return { keyed: new Map([...v.keyed].map(([k, el]) => [k, textOf(el)])), loose: v.loose.map(textOf) };
}

/**
 * After a repaint put `roots` where others stood: each value that says something else now morphs from what stood
 * there (portal morphText: the letters both keep stay, the others lift away and rise in). A keyed one from its key's;
 * the others by their order, when the block still has as many (a block built another way has nothing to pair).
 * The one motion a repaint has in the admin: a value changing where it stands (DESIGN.md › Motion › 16).
 */
export function morphValues(was: Values | null, ...roots: Node[]) {
  if (!was) return;
  const now = valuesIn(roots);
  const turn = (el: HTMLElement, from: string | undefined) => {
    // one still morphing (kept across the repaint) says what it is turning into
    const to = textOf(el);
    if (from != null && from !== to && from && to) morphText(el, to, from);
  };
  for (const [k, el] of now.keyed) turn(el, was.keyed.get(k));
  if (now.loose.length === was.loose.length) now.loose.forEach((el, i) => turn(el, was.loose[i]));
}

/** Run `change` on `box`, then let the box glide from its old height to its new one. */
export function reshape(box: HTMLElement, change: () => void) {
  if (still() || !shown(box)) return change();
  // as it stands on screen, a glide under way included
  const h0 = box.getBoundingClientRect().height;
  box.getAnimations().forEach((a) => a.id === 'fold' && a.cancel());
  change();
  if (shown(box)) fold(box, h0, box.getBoundingClientRect().height);
}

/**
 * Refill `box` with `kids`: the pieces change in place, the box glides to its new height; into an empty box drawn
 * on screen they blur in. The same markup, at rest: put in, still. Not on screen (its first paint): put in.
 */
export function refill(box: HTMLElement, list: (Node | string)[]) {
  const kids = list.filter((k) => k !== '').map((k) => (typeof k === 'string' ? new Text(k) : k));
  const before = box.innerHTML;
  const up = box.parentElement;
  if (still() || !(shown(box) || (!before && up && shown(up)))) {
    // the page stands still (the admin): the new pieces are put in, and only a value that changed morphs
    const was = before && shown(box) ? valuesOf(box) : null;
    // (and what was pressed: a control goes on from the one it replaces, portal/ui/carry.ts)
    if (was) carryControls(box, kids);
    putChildren(box, kids);
    return morphValues(was, box);
  }
  if (!before)
    return reshape(box, () => {
      putChildren(box, kids);
      kids.forEach((k) => k instanceof Element && appear(k));
    });
  // the same markup (most repaints, most blocks): nothing to move. Read cheaply (no clone, no walk over the
  // subtree's animations); while the box still moves from its last change it is left as it is
  if (same(markup(kids), before)) {
    if ((moving.get(box) ?? 0) > performance.now()) return;
    return putChildren(box, kids);
  }
  moving.set(box, performance.now() + SMOOTH.duration + 120);
  morphInto(box, kids as Kid, { deep: true });
}

/** How a fold's body is shown and hidden, when not by its `hidden` (a class the stylesheet reads). */
export interface Shown {
  is(): boolean;
  set(shown: boolean): void;
}

/**
 * Open or shut a fold's `body` (a row's options, the interfaces not offered, an event's details) as the portal's
 * accordion does (DESIGN.md › Motion › 4): its height from where it stands on SOFT (shutting: SMOOTH), clipped, its
 * margins, paddings and its parent's gap over it with it; its opacity and a 2 px
 * blur with it, in over what is left of 300 ms, out over what is left of 160. Turned back half-way, it goes back
 * from there. With less motion it only fades. Shut, it is hidden. A fold is opened by a press: it moves in the
 * admin too, where a repaint does not.
 */
export function unfold(body: HTMLElement, open: boolean, shown: Shown = { is: () => !body.hidden, set: (v) => (body.hidden = !v) }) {
  const was = shown.is();
  const fade0 = was ? getComputedStyle(body) : null;
  const o0 = fade0 ? +fade0.opacity : 0;
  const b0 = !fade0 ? 'blur(2px)' : fade0.filter === 'none' ? 'blur(0px)' : fade0.filter;
  const from = was ? boxOf(body) : null;
  const old = body.getAnimations();
  shown.set(true);
  // its box at rest, read with nothing of the last fold holding it
  old.forEach((x) => x.cancel());
  const rest = boxOf(body);
  // Shut, it takes no room at all: its own margins and paddings go with its height, and the gap its parent keeps
  // between its children is taken back, or the block would lose those pixels at a stroke when it is hidden (the
  // owner, 2026-11-12: «в конце анимирования снап происходит»: 10 px of a column's gap).
  const shut: Box = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: `${-gapOver(body)}px`, marginBottom: '0px' };
  const size = play(
    body,
    [
      { ...(from ?? shut), overflow: 'clip' },
      { ...(open ? rest : shut), overflow: 'clip' },
    ],
    {
      // shutting has no give: a height cannot go under nothing, so a spring that overshoots would stop dead at the
      // floor while still moving (the portal's rows shut onto their heads, not onto nothing)
      duration: open ? SOFT.duration : SMOOTH.duration,
      easing: open ? SOFT.easing : SMOOTH.easing,
    },
  );
  // what is left of the way: a body half in fades the rest of it
  const left = open ? 1 - o0 : o0;
  play(
    body,
    [
      { opacity: o0, filter: b0 },
      { opacity: +open, filter: `blur(${open ? 0 : 2}px)` },
    ],
    {
      duration: Math.max(1, (open ? 300 : 160) * left),
      easing: open ? 'cubic-bezier(0, 0, 0.58, 1)' : EASE_IN,
      fill: 'forwards',
    },
  );
  size.onfinish = () => {
    body.getAnimations().forEach((x) => x.cancel());
    shown.set(open);
  };
}

/** What a fold's body takes of the column it stands in. */
interface Box {
  height: string;
  paddingTop: string;
  paddingBottom: string;
  marginTop: string;
  marginBottom: string;
}

/** `el`'s box as it stands now (mid-fold included), `height` as its own box-sizing counts it. */
function boxOf(el: HTMLElement): Box {
  const cs = getComputedStyle(el);
  const n = (v: string) => parseFloat(v) || 0;
  const inner = cs.boxSizing === 'border-box' ? 0 : n(cs.paddingTop) + n(cs.paddingBottom) + n(cs.borderTopWidth) + n(cs.borderBottomWidth);
  return {
    // as the layout has it, not as it shows (a fold inside a dialog that is still opening at nine tenths)
    height: `${Math.max(0, el.offsetHeight - inner)}px`,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    marginTop: cs.marginTop,
    marginBottom: cs.marginBottom,
  };
}

/** The gap `el`'s parent keeps over it (a column of flex or grid children with something before it), in px. */
function gapOver(el: HTMLElement): number {
  const p = el.parentElement;
  if (!p || !el.previousElementSibling) return 0;
  const cs = getComputedStyle(p);
  const column = (cs.display.includes('flex') && cs.flexDirection.startsWith('column')) || cs.display.includes('grid');
  return column ? parseFloat(cs.rowGap) || 0 : 0;
}
