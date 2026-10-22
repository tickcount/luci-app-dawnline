// Words that change in place morph letter by letter: the old letters lift away
// with a blur, the new ones rise in one after another, and the width glides
// between them. Every text the page or a sheet changes while it shows goes
// through `morphText`: a card's name and status after a repaint, the counts and
// values, a label that says "Copied", a line that says what happened (the way:
// "iPad connected"), and a menu path for another app or the other phone system
// (`menuLine`: where the app scans, iOS "Create", Android "Scan"). Turned again
// half-way, a morph or a refill goes on from what shows: words still coming in
// leave from as far as they came, what was leaving keeps leaving.

import { fmt } from '../../shared/i18n';
import { h, ic, markup, put, type Kid } from '../dom';
import { EASE_IN, EASE_OUT, POP, SMOOTH, calm, play } from '../motion';

/** Each character as its own inline box, so each can move. */
const letters = (w: string): HTMLElement[] => [...w].map((ch) => h('i', {}, ch));

interface Run {
  /** What it is turning into. */
  text: string;
  timer: number;
}
const runs = new WeakMap<HTMLElement, Run>();

/** What `el` says: while it morphs, what it is turning into. */
export const textOf = (el: HTMLElement): string => runs.get(el)?.text ?? el.textContent ?? '';

/** How something shows: its opacity and blur, part of the way while a fade or a morph runs. */
export interface Look {
  opacity: number;
  filter: string;
}
const SHOWN: Look = { opacity: 1, filter: 'blur(0px)' };
const settled = (s: Look) => s.opacity > 0.99 && (s.filter === 'none' || s.filter === 'blur(0px)');

/** How `el` shows now (on the page: a detached element has no style), with the words a whole-word morph brings in. */
export function look(el: Element): Look {
  const cs = getComputedStyle(el);
  const words = el.querySelector(':scope > .mt-new');
  const ws = words && getComputedStyle(words);
  return { opacity: +cs.opacity * (ws ? +ws.opacity : 1), filter: cs.filter === 'none' && ws ? ws.filter : cs.filter };
}

/** Where `el`'s words sit (their own box, not the element's). */
function wordsBox(el: HTMLElement): DOMRect {
  const r = document.createRange();
  r.selectNodeContents(el);
  return r.getBoundingClientRect();
}

/** Where a text's glyphs stand (only as high as the font, not the line). */
function glyphs(n: Node): DOMRect {
  const r = document.createRange();
  r.selectNodeContents(n);
  return r.getBoundingClientRect();
}

/** Where each character of `el`'s plain text starts, from the first (kerning and all). */
function spacing(el: HTMLElement): number[] {
  const node = el.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [];
  const r = document.createRange();
  const out: number[] = [];
  let o = 0;
  for (const ch of node.textContent ?? '') {
    r.setStart(node, o);
    r.setEnd(node, o + ch.length);
    out.push(r.getBoundingClientRect().left);
    o += ch.length;
  }
  return out.map((x) => x - out[0]);
}

/**
 * The letters stood where the plain text's characters stand. One by one they
 * lose the font's kerning, so the word turning back into text would shift on
 * its last frame; a nudge each and they land exactly on it.
 */
function space(box: Element, at: number[]) {
  const kids = [...box.children] as HTMLElement[];
  if (!kids.length) return;
  kids.forEach((c, i) => {
    if (!i || at[i] === undefined) return;
    // Against the first letter as it stands now: in a centred line every nudge moves the whole run
    // by half of it, the first letter too, and a start read once would let the nudges add up.
    const dx = kids[0].getBoundingClientRect().left + at[i] - c.getBoundingClientRect().left;
    if (Math.abs(dx) > 0.01) c.style.marginLeft = `${dx}px`;
  });
}

/**
 * The letters both texts keep, in order: pairs of [old index, new index]. What
 * they share at the start and at the end stays together; in between, the
 * longest run of letters in common (a longest common subsequence).
 */
export function kept(a: string[], b: string[]): [number, number][] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const A = a.slice(p, a.length - q);
  const B = b.slice(p, b.length - q);
  const L = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: [number, number][] = [];
  for (let i = 0; i < p; i++) out.push([i, i]);
  for (let i = 0, j = 0; i < A.length && j < B.length; ) {
    if (A[i] === B[j]) out.push([p + i++, p + j++]);
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  for (let k = q; k > 0; k--) out.push([a.length - k, b.length - k]);
  return out;
}

/** A morph under way on `el` ends where it was going: its words as plain text. */
function finish(el: HTMLElement) {
  const r = runs.get(el);
  if (!r) return;
  clearTimeout(r.timer);
  runs.delete(el);
  el.getAnimations().forEach((a) => a.cancel());
  el.classList.remove('mt', 'mt-ib', 'mt-run');
  el.textContent = r.text;
}

/** Plain, at once: a morph under way on `el` stops where it is going. */
export function setText(el: HTMLElement, text: string) {
  finish(el);
  el.textContent = text;
}

/**
 * A morph under way on `el`, taken out as it shows: the words it brings in (and where they stand), and all still
 * leaving (one turned again before has more than one).
 */
function lift(el: HTMLElement): { words: HTMLElement; at: DOMRect; going: HTMLElement[] } | null {
  const words = el.querySelector<HTMLElement>(':scope > .mt-new');
  if (!words) return null;
  const going = [...el.querySelectorAll<HTMLElement>(':scope > .mt-old')];
  const at = wordsBox(words);
  words.remove();
  going.forEach((g) => g.remove());
  return { words, at, going };
}

export interface MorphOpts {
  /** The words change as a whole instead: the old blur away where they stood as the new come in. */
  whole?: boolean;
  /** false where something else moves what follows (a width gliding inside a wrapping list would reflow it mid-way). */
  glide?: boolean;
  /**
   * Where the old words stand on screen now, when `el` no longer holds them in
   * the same layout (morphInto: put back, they could wrap another way): whole
   * words go from there, and the width does not glide.
   */
  at?: DOMRect;
  /** How the old words show, against `el` (they were still coming in when the caller rebuilt them): they leave from there. */
  shows?: Look;
  /** The old words' colour, where `el` took another with the new ones (a status turned green): they keep it, the new turn from it. */
  color?: string;
}

/**
 * A letter of a morph leaving: it lifts away as it blurs out (`delay`: its place in the sweep; `from`: how it
 * shows). Also what goes with the words as one more letter (a pick pill's flag), so both move as one.
 */
export function letterOut(el: Element, delay = 0, from: Look = SHOWN): Animation {
  return play(
    el,
    [
      { opacity: from.opacity, filter: from.filter, transform: 'none' },
      { opacity: 0, filter: 'blur(4px)', transform: 'translateY(-0.45em)' },
    ],
    { duration: 220, delay, easing: EASE_IN, fill: 'forwards' },
  );
}

/** A letter of a morph coming in: it rises in as it sharpens, after the old ones start to go. */
export function letterIn(el: Element, delay = 0): Animation {
  return play(
    el,
    [
      { opacity: 0, filter: 'blur(4px)', transform: 'translateY(0.45em)' },
      { opacity: 1, filter: 'blur(0px)', transform: 'none' },
    ],
    { duration: 380, delay: 120 + delay, easing: EASE_OUT, fill: 'backwards' },
  );
}

/**
 * `el`'s text turns into `next`, letter by letter: the letters both say stay
 * and slide to their new places, the others lift away or rise in. `from`: what
 * it said before a repaint rebuilt it (the new element already says `next`).
 * The old letters keep to the edge
 * that stays put while the width changes (the start of a line, the end of a
 * value on the right, the middle of a centred line). Done, it holds plain text
 * again: a box that ends in an ellipsis keeps it. Turned again half-way, the
 * words that were coming in leave from as far as they came (a letter both
 * texts keep slides on from where it is), and those leaving go on leaving.
 */
export function morphText(el: HTMLElement, next: string, from = textOf(el), o: MorphOpts = {}) {
  const { whole = false, at } = o;
  const run = runs.get(el);
  // Asked again for what it is already turning into: the morph under way goes on.
  if (run && from === run.text && next === run.text) return;
  // Placed by the caller, the width does not glide: what follows is moved by the caller too.
  const glide = (o.glide ?? true) && !at;
  // Interrupted mid-way: the width carries on from where it is on screen, not from where that morph was going,
  // and what shows of it is taken out as it stands.
  const midway = run ? el.getBoundingClientRect() : null;
  const live = run && from === run.text && !calm() && el.getClientRects().length ? lift(el) : null;
  finish(el);
  // Nothing to watch move: no motion asked for, or not on screen (a folded row, a closed sheet).
  if (from === next || calm() || !el.getClientRects().length) {
    el.textContent = next;
    return;
  }
  const cs = getComputedStyle(el);
  // Letters need a box whose width can glide; words that change whole keep the text's own flow (they
  // may wrap), and what follows them is moved by the caller (morphInto) instead.
  const flow = whole && cs.display === 'inline';
  if (cs.display === 'inline' && !whole) el.classList.add('mt-ib');
  if (cs.position === 'static') el.classList.add('mt');
  // A box that clips its text (one line ending in an ellipsis) lets it show whole while it changes: the letters
  // rise from under the line and blur, and the width glides past the new ones. Clipped again once done.
  el.classList.add('mt-run');
  let r0: DOMRect | null = live ? midway : null;
  let t0 = live?.at ?? at ?? null;
  let at0: number[] = [];
  if (!t0) {
    el.textContent = from;
    r0 = el.getBoundingClientRect();
    t0 = wordsBox(el);
    at0 = spacing(el);
  }
  el.textContent = next;
  const r1 = el.getBoundingClientRect();
  const at1 = spacing(el);
  const w0 = midway?.width ?? r0?.width ?? r1.width;
  const glides = glide && !flow && !!r0 && Math.abs(r1.width - w0) > 0.5;
  const edge = !glides || !r0 || Math.abs(r1.left - r0.left) < 0.5 ? 'start' : Math.abs(r1.right - r0.right) < 0.5 ? 'end' : 'middle';

  const neu = h('span', { class: whole ? 'mt-new w' : 'mt-new' }, whole ? next : letters(next));
  // The old words: those that were coming in, as they show, or the old text built afresh.
  const old = live?.words ?? h('span', { class: whole ? 'mt-old w' : 'mt-old' }, whole ? from : letters(from));
  old.classList.replace('mt-new', 'mt-old');
  old.setAttribute('aria-hidden', 'true');
  // Whole words wrap as they did: the old ones keep the width they took.
  if (old.classList.contains('w')) old.style.width = `${t0.width + 1}px`;
  el.replaceChildren(neu, old);
  // What was still leaving goes on leaving where it is.
  if (live) el.append(...live.going);
  if (o.color) {
    old.style.color = o.color;
    const c1 = getComputedStyle(el).color;
    if (c1 !== o.color) play(neu, [{ color: o.color }, { color: c1 }], { duration: 280, easing: EASE_OUT });
  }
  // Held at the plain text's width until the letters turn back into it, so what follows never steps.
  if (glides)
    play(el, [{ width: `${w0}px` }, { width: `${r1.width}px` }], {
      duration: SMOOTH.duration,
      easing: SMOOTH.easing,
      fill: 'forwards',
    });
  // The old letters go from exactly where they stood on screen, against the box as it is now: a box
  // its text left empty sits lower (on the baseline), and would carry them down with it.
  const r2 = el.getBoundingClientRect();
  const place = (dx: number, dy: number) => {
    old.style.top = `${dy}px`;
    if (edge === 'end') old.style.right = `${-dx}px`;
    else if (edge === 'middle') {
      old.style.left = '50%';
      old.style.translate = `calc(-50% + ${dx}px) 0`;
    } else old.style.left = `${dx}px`;
  };
  const x0 = edge === 'end' ? t0.right - r2.right : edge === 'middle' ? (t0.left + t0.right - r2.left - r2.right) / 2 : t0.left - r2.left;
  place(x0, t0.top - r2.top);
  // Then onto the old words exactly: the box's top is not the text's (the line's leading sits above it), nor is a
  // letter's (a box of its own, a line high): built afresh, the first letter's glyphs go where the text's stood.
  const first = !live && old.querySelector('i')?.firstChild;
  const t2 = first ? glyphs(first) : wordsBox(old);
  place(x0 + t0.left - t2.left, t0.top - r2.top + t0.top - t2.top);
  // How the old words show: those that were coming in as far as they came.
  const s0 = live ? look(old) : (o.shows ?? SHOWN);
  /** The old words go as one, from how they show. */
  const leave = () => {
    const prior = old.getAnimations();
    play(
      old,
      [
        { opacity: s0.opacity, filter: s0.filter },
        { opacity: 0, filter: 'blur(4px)' },
      ],
      { duration: 180 * s0.opacity, easing: EASE_IN, fill: 'forwards' },
    );
    prior.forEach((a) => a.cancel());
  };
  if (whole) {
    leave();
    play(
      neu,
      [
        { opacity: 0, filter: 'blur(4px)' },
        { opacity: 1, filter: 'blur(0px)' },
      ],
      { duration: 280, delay: 60, easing: EASE_OUT, fill: 'backwards' },
    );
    const ends = Math.max(340, glides ? SMOOTH.duration : 0) + 40;
    runs.set(el, { text: next, timer: window.setTimeout(() => finish(el), ends) });
    return;
  }
  space(neu, at1);
  if (!live) space(old, at0);

  // The letters both texts keep slide from where they stood to where they go, on the width's spring;
  // the old ones' places in the overlay stay empty. Old words that came whole have no letters to keep.
  const was = old.classList.contains('w') ? [] : ([...old.children] as HTMLElement[]);
  const now = [...neu.children] as HTMLElement[];
  const pairs = was.length ? kept([...from], [...next]) : [];
  const stays = new Set(pairs.map(([i]) => i));
  const comes = new Set(pairs.map(([, j]) => j));
  pairs.forEach(([i, j]) => {
    const a = was[i].getBoundingClientRect();
    const b = now[j].getBoundingClientRect();
    // A letter still rising when the morph turned comes along from as far as it rose.
    const s = live ? look(was[i]) : s0;
    was[i].style.visibility = 'hidden';
    const moves = Math.abs(a.left - b.left) > 0.5 || Math.abs(a.top - b.top) > 0.5;
    const shows = settled(s) ? null : s;
    if (moves || shows)
      play(
        now[j],
        [
          { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, ...shows },
          { transform: 'none', ...(shows && SHOWN) },
        ],
        { duration: SMOOTH.duration, easing: SMOOTH.easing },
      );
  });
  // Turned half-way, the old words leave as one: each of their letters is somewhere on its own way.
  const out = live ? [] : was.filter((_x, i) => !stays.has(i));
  if (live) leave();
  const inn = now.filter((_x, j) => !comes.has(j));
  // A long text keeps the same overall sweep: the steps shorten instead.
  const so = Math.min(12, 160 / Math.max(1, out.length));
  const si = Math.min(22, 260 / Math.max(1, inn.length));
  out.forEach((c, i) => letterOut(c, i * so, s0));
  inn.forEach((c, i) => letterIn(c, i * si));
  const ends =
    Math.max(220 + out.length * so, inn.length ? 120 + inn.length * si + 380 : 0, glides || pairs.length ? SMOOTH.duration : 0) + 40;
  runs.set(el, { text: next, timer: window.setTimeout(() => finish(el), ends) });
}

/** What a keyed text said, and in which colour. */
export interface Said {
  text: string;
  color: string;
  /** Its words change as a whole (`data-whole`: a hint standing in for a card's status): they blur across. */
  whole: boolean;
}

/** The keyed texts under `root` (`data-t`), before a repaint rebuilds them. */
export function textsOf(root: ParentNode): Map<string, Said> {
  return new Map(
    [...root.querySelectorAll<HTMLElement>('[data-t]')].map((el) => [
      el.dataset.t!,
      { text: textOf(el), color: getComputedStyle(el).color, whole: el.hasAttribute('data-whole') },
    ]),
  );
}

/**
 * After the repaint: each keyed text that changed morphs from what it said (one already turning into it goes on).
 * `fresh`: what a refill brought in whole (morphInto), its words with it: the old words fade where they stood.
 */
export function morphChanged(root: ParentNode, was: Map<string, Said>, fresh: Element[] = []) {
  root.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    const before = was.get(el.dataset.t!);
    const now = textOf(el);
    if (!before || before.text === now || runs.has(el) || fresh.some((f) => f.contains(el))) return;
    morphText(el, now, before.text, { color: before.color, whole: before.whole });
  });
}

/** What a box shows, piece by piece, keyed by where each sits (child indexes): its kind, its words, its drawing, its place. */
interface Piece {
  kind: string;
  text: string;
  svg: string;
  at: DOMRect | null;
  /** Where its words stand (a morph under way: the words it is turning into). */
  words: DOMRect | null;
  node: Node;
  /** How it shows: part of the way while it still comes in. */
  shows: Look;
}
/** What can fade out where it stood. */
type Drawn = HTMLElement | SVGElement;
const isDrawn = (n: Node): n is Drawn => n instanceof HTMLElement || n instanceof SVGElement;
/** A piece as something that can fade where it stood: bare words go into a span of their own. */
const drawn = (n: Node): Drawn => (isDrawn(n) ? n : h('span', {}, n));
/** Its tag and classes, less a morph's own (a piece still changing is the same piece). */
const kindOf = (el: Element) => `${el.tagName}.${[...el.classList].filter((c) => c !== 'mt' && c !== 'mt-ib').join(' ')}`;
/** A drawing as markup, less the ids each build makes up (a glass icon's gradients): the same icon twice is the same. */
const drawing = (el: Element) => el.outerHTML.replace(/\bgl\d+/g, 'gl');

/** What fades out where it stood (`fadeAway`), each with the element it is laid over. */
const fading = new Map<Element, Element>();
/** How many fade over each element, and those made a positioned box for them. */
const holding = new WeakMap<Element, number>();
const boxed = new WeakSet<Element>();
/** Inside something already fading out (under `box`): it goes with it. */
function within(el: Element, box: Element): boolean {
  for (let p = el.parentElement; p && p !== box; p = p.parentElement) if (fading.has(p)) return true;
  return false;
}
function hold(host: Element) {
  const n = holding.get(host) ?? 0;
  if (!n && getComputedStyle(host).position === 'static') {
    host.classList.add('mt');
    boxed.add(host);
  }
  holding.set(host, n + 1);
}
/** The last to fade over `host` is gone: a box made positioned for them is static again. */
function release(host: Element) {
  const n = (holding.get(host) ?? 1) - 1;
  holding.set(host, n);
  if (!n && boxed.delete(host)) host.classList.remove('mt');
}

/**
 * `e`, which stood at `at` on screen, fades out there, laid over `host` (which
 * stood at `from`): a piece a refill crossed or left out (morphInto), a card's
 * old foot (page/devices.ts). One already fading only moves over its new host
 * and goes on; another starts from how it showed (`shows`: it may still have
 * been coming in), over what is left of its way.
 */
export function fadeAway(e: Drawn, at: DOMRect, host: Element, from: DOMRect, shows: Look = SHOWN) {
  const over = fading.get(e);
  if (over) release(over);
  hold(host);
  fading.set(e, host);
  e.style.position = 'absolute';
  e.style.margin = '0';
  e.style.left = `${at.left - from.left - host.clientLeft}px`;
  e.style.top = `${at.top - from.top - host.clientTop}px`;
  e.style.right = '';
  e.style.translate = '';
  e.style.width = `${at.width}px`;
  e.style.pointerEvents = 'none';
  e.setAttribute('aria-hidden', 'true');
  host.appendChild(e);
  if (over) return;
  const prior = e.getAnimations();
  const a = play(
    e,
    [
      { opacity: shows.opacity, filter: shows.filter },
      { opacity: 0, filter: 'blur(4px)' },
    ],
    { duration: 180 * shows.opacity, easing: EASE_IN, fill: 'forwards' },
  );
  prior.forEach((x) => x.cancel());
  // Gone, or stopped by whatever stops what moves around it: it was leaving either way.
  a.onfinish = a.oncancel = () => {
    const last = fading.get(e);
    if (!last) return;
    fading.delete(e);
    release(last);
    e.remove();
  };
}

function pieces(box: Element): Map<string, Piece> {
  const out = new Map<string, Piece>();
  const walk = (n: Node, path: string) =>
    n.childNodes.forEach((c, i) => {
      const p = `${path}/${i}`;
      if (c.nodeType === Node.TEXT_NODE) {
        if (c.textContent?.trim()) {
          const r = document.createRange();
          r.selectNodeContents(c);
          const at = r.getBoundingClientRect();
          out.set(p, { kind: '#text', text: c.textContent, svg: '', at, words: at, node: c, shows: SHOWN });
        }
        return;
      }
      // What is on its way out already (crossed by a refill before, words a morph lifts away) goes on by itself.
      if (!(c instanceof Element) || fading.has(c) || c.classList.contains('mt-old')) return;
      const svg = c instanceof SVGElement ? drawing(c) : '';
      const words = c instanceof HTMLElement && !svg ? wordsBox(c.querySelector<HTMLElement>(':scope > .mt-new') ?? c) : null;
      out.set(p, {
        kind: kindOf(c),
        text: c instanceof HTMLElement ? textOf(c) : '',
        svg,
        at: c.getBoundingClientRect(),
        words,
        node: c,
        shows: look(c),
      });
      if (!svg) walk(c, p);
    });
  walk(box, '');
  return out;
}

/**
 * `el` glides back to its place from `(dx, dy)` away, on SMOOTH. A transform
 * does nothing to words in a line (an inline box): those move by a relative
 * offset instead, theirs only for the glide.
 */
function shift(el: Element, dx: number, dy: number) {
  const o = { duration: SMOOTH.duration, easing: SMOOTH.easing };
  if (!(el instanceof HTMLElement) || getComputedStyle(el).display !== 'inline')
    return play(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], o);
  const own = el.style.position;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  const a = play(
    el,
    [
      { left: `${dx}px`, top: `${dy}px` },
      { left: '0px', top: '0px' },
    ],
    o,
  );
  a.onfinish = a.oncancel = () => (el.style.position = own);
  return a;
}

/**
 * Something with nothing to change from comes in through a blur, to its own
 * opacity (a part the stylesheet dims stays dimmed); `shows`: it was on its way
 * in already, and goes on from as far as it came.
 */
export function appear(el: Element, shows?: Look) {
  const own = +getComputedStyle(el).opacity;
  const o0 = shows?.opacity ?? 0;
  play(
    el,
    [
      { opacity: o0, filter: shows?.filter ?? 'blur(4px)' },
      { opacity: own, filter: 'blur(0px)' },
    ],
    { duration: 280 * Math.min(1, Math.max(0, own - o0) / (own || 1)), delay: shows ? 0 : 60, easing: EASE_OUT, fill: 'backwards' },
  );
}

/**
 * `box` refilled with `kids` and nothing blinks: what is the same stays still;
 * a piece in the same place with other words blurs from the old words into the
 * new where it stands (a keyed text, `data-t`, is left to morphChanged, which
 * letter-morphs it from what it said); a piece that changed its kind, its
 * height (another block, a list that wraps over more lines) or its drawing
 * crosses whole, the old one blurring out exactly where it stood as the new one
 * blurs in, and so does what is gone. A piece that kept its kind and size but
 * moved glides from where it stood. Places are taken against the box, which its
 * sheet moves as a whole; an old piece fades inside its own parent's new self
 * (the same kind, in the same place), so it keeps its look. Refilled again
 * half-way, what was fading goes on fading where it is, and what was still
 * coming in goes on from as far as it came. Returns what came in whole.
 */
export function morphInto(box: HTMLElement, kids: Kid): Element[] {
  const was = pieces(box);
  const box0 = box.getBoundingClientRect();
  // What is on its way out already, with what it sat in: it goes on over that one's new self.
  const going = [...fading.keys(), ...box.querySelectorAll('.mt-old')]
    .filter((g): g is Drawn => box.contains(g) && !within(g, box) && isDrawn(g))
    .map((g) => ({ g, at: g.getBoundingClientRect(), over: g.parentElement, shows: fading.has(g) ? undefined : look(g) }));
  const pathOf = new Map([...was].map(([p, w]) => [w.node, p]));
  put(box, kids);
  /** The new element at each place. */
  const placed = new Map<string, Element>();
  const carry = () =>
    going.forEach(({ g, at, over, shows }) => {
      const p = over && pathOf.get(over);
      const host = p && placed.get(p);
      const w = p && was.get(p);
      if (host && w && w.at && w.kind === kindOf(host)) fadeAway(g, at, host, w.at, shows);
      else fadeAway(g, at, box, box0, shows);
    });
  if (!was.size || calm()) {
    carry();
    return [];
  }
  const box1 = box.getBoundingClientRect();
  /** Where something that stood at `r` in the box's old place stands now, the pieces having glided back there. */
  const here = (r: DOMRect | null) => r && new DOMRect(r.left - box0.left + box1.left, r.top - box0.top + box1.top, r.width, r.height);
  const morphs: (() => void)[] = [];
  /** An old piece, where it stood, the new parent it fades in, where that parent stood, and how the piece showed. */
  const ghosts: [Drawn, DOMRect, Element, DOMRect, Look][] = [];
  const seen = new Set<string>();
  /** What comes in whole. */
  const came: Element[] = [];
  const cross = (el: Element, w: Piece | undefined, path: string) => {
    const host = el.parentElement;
    const from = path ? was.get(path)?.at : box0;
    if (w?.at) ghosts.push(host && from ? [drawn(w.node), w.at, host, from, w.shows] : [drawn(w.node), w.at, box, box0, w.shows]);
    came.push(el);
    morphs.push(() => appear(el));
  };
  /** Moves `el` from where it stood (`at`, in the box's old place) to where it is, less what its parent already carries. */
  const glideFrom = (el: Element, at: DOMRect, carried: [number, number]): [number, number] => {
    const r = el.getBoundingClientRect();
    const dx = at.left - box0.left - (r.left - box1.left);
    const dy = at.top - box0.top - (r.top - box1.top);
    const ox = dx - carried[0];
    const oy = dy - carried[1];
    if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) shift(el, ox, oy);
    return [dx, dy];
  };
  const walk = (n: Node, path: string, carried: [number, number]) =>
    [...n.childNodes].forEach((c, i) => {
      const p = `${path}/${i}`;
      seen.add(p);
      const w = was.get(p);
      if (c.nodeType === Node.TEXT_NODE) {
        const t = c.textContent ?? '';
        if (!t.trim()) return;
        // Words: a bare word before, or one the last refill put in a span of its own (it is still that word).
        const said = w && (w.kind === '#text' || (w.node instanceof HTMLElement && !w.node.children.length)) ? w.text : null;
        const coming = w && w.shows.opacity < 0.99 ? w.shows : null;
        if (said === t && !coming) return;
        // A bare word among elements goes into a span of its own, so it can change (and glide from where its words were).
        const s = h('span', {}, t);
        c.replaceWith(s);
        if (said === null || Math.max(t.length, said.length) > 40) return cross(s, w, path);
        if (w?.at) glideFrom(s, w.at, carried);
        morphs.push(() =>
          said === t ? appear(s, coming!) : morphText(s, t, said, { whole: true, at: here(w!.words) ?? undefined, shows: w!.shows }),
        );
        return;
      }
      if (!(c instanceof Element)) return;
      placed.set(p, c);
      const r = c.getBoundingClientRect();
      const svg = c instanceof SVGElement;
      if (!w || w.kind !== kindOf(c) || (svg ? w.svg !== drawing(c) : !!w.at && Math.abs(w.at.height - r.height) > 1))
        return cross(c, w, path);
      // The same piece somewhere else in the box: it glides there (what it holds rides along, plus its own move).
      const own = w.at ? glideFrom(c, w.at, carried) : carried;
      // Still coming in when the box was refilled: it goes on from as far as it came.
      const rest = +getComputedStyle(c).opacity;
      const coming = Math.abs(w.shows.opacity - rest) > 0.01 ? w.shows : null;
      if (svg) {
        if (coming) morphs.push(() => appear(c, coming));
        return;
      }
      if (!c.children.length && c instanceof HTMLElement) {
        const t = c.textContent ?? '';
        if (t === w.text || c.dataset.t) {
          if (coming) morphs.push(() => appear(c, coming));
        } else if (t.length <= 40 && w.text.length <= 40) {
          // The old words leave from how they showed, against the element that holds them now.
          const shows = { opacity: Math.min(1, w.shows.opacity / (rest || 1)), filter: w.shows.filter };
          morphs.push(() => morphText(c, t, w.text, { whole: true, at: here(w.words) ?? undefined, shows }));
        } else cross(c, w, path);
        return;
      }
      if (coming) morphs.push(() => appear(c, coming));
      walk(c, p, own);
    });
  walk(box, '', [0, 0]);
  // What the new box no longer has goes the same way.
  for (const [p, w] of was) if (!seen.has(p) && p.lastIndexOf('/') === 0 && w.at) ghosts.push([drawn(w.node), w.at, box, box0, w.shows]);
  morphs.forEach((m) => m());
  // The old pieces that cross go from exactly where they stood in their parent (which glides from where it stood).
  for (const [g, at, host, from, shows] of ghosts) fadeAway(g, at, host, from, shows);
  carry();
  return came;
}

/** The Android robot's head; its eyes take the colour of what it sits on. */
const ANDROID =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 19a9.5 9.5 0 0 1 19 0z" fill="currentColor"/>' +
  '<path d="M6.9 11.2 4.6 7.4M17.1 11.2l2.3-3.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>' +
  '<circle class="eye" cx="8.3" cy="15" r="1.25"/><circle class="eye" cx="15.7" cy="15" r="1.25"/></svg>';
const marks = (): Element[] => [ic('apple'), markup(ANDROID)];

/** One step of a path, cut where iOS and Android word it differently: [what comes before, iOS word, Android word, what comes after]. */
type Step = [string, string, string, string];
function cut(ios: string, android: string): Step {
  if (ios === android) return ['', ios, ios, ''];
  const A = ios.split(' ');
  const B = android.split(' ');
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let q = 0;
  while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++;
  const pre = A.slice(0, p).join(' ');
  const suf = A.slice(A.length - q).join(' ');
  return [pre ? `${pre} ` : '', A.slice(p, A.length - q).join(' '), B.slice(p, B.length - q).join(' '), suf ? ` ${suf}` : ''];
}

export interface MenuLine {
  el: HTMLElement;
  /** Another app's path in its place: each part morphs, the arrows stay, the system's mark comes or goes. */
  set(ios: string, android: string): void;
}

/**
 * A menu path ("+ → Create from QR code") for both phone systems in one line,
 * its steps in bold with grey arrows between them. Where iOS and Android word a
 * step differently, that word turns between the two every few seconds, the
 * system's mark beside it.
 */
export function menuLine(ios: string, android: string): MenuLine {
  const body = h('span', { 'aria-hidden': 'true' });
  const el = h('b', { class: 'osm', role: 'text' }, body);
  let steps: Step[] = [];
  let parts: { pre: HTMLElement; word: HTMLElement; suf: HTMLElement }[] = [];
  /** The step that differs (its mark stands before its word), or -1. */
  let at = -1;
  let icEl: HTMLElement | null = null;
  /** Which system's wording shows: 0 iOS, 1 Android. */
  let k = 0;
  const wordOf = (s: Step) => (k ? s[2] : s[1]);
  const part = (t: string) => h('span', { class: 'osm-p' }, t);

  /** Drawn afresh, no motion (the first time, or a path with another number of steps). */
  const draw = () => {
    at = steps.findIndex((s) => s[1] !== s[2]);
    if (at < 0) k = 0;
    parts = steps.map((s) => ({ pre: part(s[0]), word: part(wordOf(s)), suf: part(s[3]) }));
    icEl = at >= 0 ? h('span', { class: 'osm-ic' }, marks()[k]) : null;
    body.replaceChildren(
      ...parts
        .flatMap((p, i) => [i ? h('span', { class: 'arr' }, '›') : null, p.pre, i === at ? icEl : null, p.word, p.suf])
        .filter((n): n is HTMLElement => !!n),
    );
  };

  const MARK = { width: '1.05em', marginRight: '0.25em' };
  /** The mark shrinks away from where it stands (one still growing in turns back), over what is left of its width. */
  const markOut = (m: HTMLElement) => {
    const cs = getComputedStyle(m);
    const left = Math.min(1, parseFloat(cs.width) / (1.05 * parseFloat(cs.fontSize)) || 0);
    const prior = m.getAnimations();
    play(
      m,
      [
        { opacity: cs.opacity, filter: cs.filter, width: cs.width, marginRight: cs.marginRight },
        { opacity: 0, filter: 'blur(3px)', width: '0px', marginRight: '0px' },
      ],
      { duration: 220 * left, easing: EASE_IN, fill: 'forwards' },
    ).onfinish = () => m.remove();
    prior.forEach((a) => a.cancel());
  };
  const markIn = (m: HTMLElement) =>
    play(
      m,
      [
        { opacity: 0, filter: 'blur(3px)', width: '0px', marginRight: '0px' },
        { opacity: 1, filter: 'blur(0px)', ...MARK },
      ],
      { duration: SMOOTH.duration, easing: SMOOTH.easing },
    );

  const set = (i: string, a: string) => {
    el.setAttribute('aria-label', (i === a ? i : fmt(_('%s (Android: %s)'), i, a.split(' → ').pop())).replace(/ → /g, ' › '));
    const I = i.split(' → ');
    const A = a.split(' → ');
    const next = I.map((s, n) => cut(s, A[n] ?? s));
    if (!parts.length || next.length !== steps.length) {
      steps = next;
      return draw();
    }
    const was = at;
    steps = next;
    at = steps.findIndex((s) => s[1] !== s[2]);
    if (at < 0) k = 0;
    // Another app's path: each part blurs from the old words into the new (the system's turn morphs, below).
    steps.forEach((s, n) => {
      morphText(parts[n].pre, s[0], undefined, { whole: true });
      morphText(parts[n].word, wordOf(s), undefined, { whole: true });
      morphText(parts[n].suf, s[3], undefined, { whole: true });
    });
    if (at === was) return;
    if (icEl) markOut(icEl);
    icEl = at >= 0 ? h('span', { class: 'osm-ic' }, marks()[k]) : null;
    if (icEl) {
      parts[at].word.before(icEl);
      markIn(icEl);
    }
  };
  set(ios, android);

  // The other system's wording, every few seconds: its word morphs, its mark turns in.
  const turn = () => {
    if (!el.isConnected) return clearInterval(timer);
    // Not on screen (a folded row): wait for the next turn.
    if (at < 0 || !icEl || !el.offsetParent) return;
    k = 1 - k;
    morphText(parts[at].word, wordOf(steps[at]));
    const oi = icEl.firstElementChild as Element;
    const ni = marks()[k];
    if (calm()) {
      oi.replaceWith(ni);
      return;
    }
    icEl.appendChild(ni);
    play(
      oi,
      [
        { opacity: 1, filter: 'blur(0px)', transform: 'none' },
        { opacity: 0, filter: 'blur(3px)', transform: 'scale(.5) rotate(-40deg)' },
      ],
      { duration: 200, easing: EASE_IN, fill: 'forwards' },
    ).onfinish = () => oi.remove();
    play(
      ni,
      [
        { opacity: 0, filter: 'blur(3px)', transform: 'scale(.5) rotate(40deg)' },
        { opacity: 1, filter: 'blur(0px)', transform: 'none' },
      ],
      { duration: POP.duration, delay: 80, easing: POP.easing, fill: 'backwards' },
    );
  };
  const timer = window.setInterval(turn, 3000);
  return { el, set };
}
