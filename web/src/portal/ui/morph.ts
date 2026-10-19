// Words that change in place morph letter by letter: the old letters lift away
// with a blur, the new ones rise in one after another, and the width glides
// between them. Every text the page or a sheet changes while it shows goes
// through `morphText`: a card's name and status after a repaint, the counts and
// values, a label that says "Copied", a line that says what happened (the way:
// "iPad connected"), and a menu path for another app or the other phone system
// (`menuLine`: where the app scans, iOS "Create", Android "Scan").

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

/** Where `el`'s words sit (their own box, not the element's). */
function wordsBox(el: HTMLElement): DOMRect {
  const r = document.createRange();
  r.selectNodeContents(el);
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
  const start = kids[0].getBoundingClientRect().left;
  kids.forEach((c, i) => {
    if (!i || at[i] === undefined) return;
    const dx = start + at[i] - c.getBoundingClientRect().left;
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
  el.classList.remove('mt', 'mt-ib');
  el.textContent = r.text;
}

/** Plain, at once: a morph under way on `el` stops where it is going. */
export function setText(el: HTMLElement, text: string) {
  finish(el);
  el.textContent = text;
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
}

/**
 * `el`'s text turns into `next`, letter by letter: the letters both say stay
 * and slide to their new places, the others lift away or rise in. `from`: what
 * it said before a repaint rebuilt it (the new element already says `next`).
 * The old letters keep to the edge
 * that stays put while the width changes (the start of a line, the end of a
 * value on the right, the middle of a centred line). Done, it holds plain text
 * again: a box that ends in an ellipsis keeps it.
 */
export function morphText(el: HTMLElement, next: string, from = textOf(el), o: MorphOpts = {}) {
  const { whole = false, at } = o;
  // Placed by the caller, the width does not glide: what follows is moved by the caller too.
  const glide = (o.glide ?? true) && !at;
  // Interrupted mid-way: the width carries on from where it is on screen, not from where that morph was going.
  const midway = runs.has(el) ? el.getBoundingClientRect().width : null;
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
  let r0: DOMRect | null = null;
  let t0 = at ?? null;
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
  const w0 = midway ?? r0?.width ?? r1.width;
  const glides = glide && !flow && !!r0 && Math.abs(r1.width - w0) > 0.5;
  const edge = !glides || !r0 || Math.abs(r1.left - r0.left) < 0.5 ? 'start' : Math.abs(r1.right - r0.right) < 0.5 ? 'end' : 'middle';

  const neu = h('span', { class: whole ? 'mt-new w' : 'mt-new' }, whole ? next : letters(next));
  const old = h('span', { class: whole ? 'mt-old w' : 'mt-old', 'aria-hidden': 'true' }, whole ? from : letters(from));
  // Whole words wrap as they did: the old ones keep the width they took.
  if (whole) old.style.width = `${t0.width + 1}px`;
  el.replaceChildren(neu, old);
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
  // Then onto the old words exactly: the box's top is not the text's (the line's leading sits above it).
  const t2 = wordsBox(old);
  place(x0 + t0.left - t2.left, t0.top - r2.top + t0.top - t2.top);
  if (whole) {
    play(
      old,
      [
        { opacity: 1, filter: 'blur(0px)' },
        { opacity: 0, filter: 'blur(4px)' },
      ],
      { duration: 180, easing: EASE_IN, fill: 'forwards' },
    );
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
  space(old, at0);

  // The letters both texts keep slide from where they stood to where they go, on the width's spring;
  // the old ones' places in the overlay stay empty.
  const was = [...old.children] as HTMLElement[];
  const now = [...neu.children] as HTMLElement[];
  const pairs = kept([...from], [...next]);
  const stays = new Set(pairs.map(([i]) => i));
  const comes = new Set(pairs.map(([, j]) => j));
  pairs.forEach(([i, j]) => {
    const a = was[i].getBoundingClientRect();
    const b = now[j].getBoundingClientRect();
    was[i].style.visibility = 'hidden';
    if (Math.abs(a.left - b.left) > 0.5 || Math.abs(a.top - b.top) > 0.5)
      play(now[j], [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], {
        duration: SMOOTH.duration,
        easing: SMOOTH.easing,
      });
  });
  const out = was.filter((_, i) => !stays.has(i));
  const inn = now.filter((_, j) => !comes.has(j));
  // A long text keeps the same overall sweep: the steps shorten instead.
  const so = Math.min(12, 160 / Math.max(1, out.length));
  const si = Math.min(22, 260 / Math.max(1, inn.length));
  out.forEach((c, i) =>
    play(
      c,
      [
        { opacity: 1, filter: 'blur(0px)', transform: 'none' },
        { opacity: 0, filter: 'blur(4px)', transform: 'translateY(-0.45em)' },
      ],
      { duration: 220, delay: i * so, easing: EASE_IN, fill: 'forwards' },
    ),
  );
  inn.forEach((c, i) =>
    play(
      c,
      [
        { opacity: 0, filter: 'blur(4px)', transform: 'translateY(0.45em)' },
        { opacity: 1, filter: 'blur(0px)', transform: 'none' },
      ],
      { duration: 380, delay: 120 + i * si, easing: EASE_OUT, fill: 'backwards' },
    ),
  );
  const ends =
    Math.max(220 + out.length * so, inn.length ? 120 + inn.length * si + 380 : 0, glides || pairs.length ? SMOOTH.duration : 0) + 40;
  runs.set(el, { text: next, timer: window.setTimeout(() => finish(el), ends) });
}

/** The keyed texts under `root` (`data-t`), before a repaint rebuilds them. */
export function textsOf(root: ParentNode): Map<string, string> {
  return new Map([...root.querySelectorAll<HTMLElement>('[data-t]')].map((el) => [el.dataset.t!, textOf(el)]));
}

/** After the repaint: each keyed text that changed morphs from what it said. */
export function morphChanged(root: ParentNode, was: Map<string, string>) {
  root.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    const before = was.get(el.dataset.t!);
    const now = el.textContent ?? '';
    if (before !== undefined && before !== now) morphText(el, now, before);
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
}
/** Its tag and classes, less a morph's own (a piece still changing is the same piece). */
const kindOf = (el: Element) => `${el.tagName}.${[...el.classList].filter((c) => c !== 'mt' && c !== 'mt-ib').join(' ')}`;
/** A drawing as markup, less the ids each build makes up (a glass icon's gradients): the same icon twice is the same. */
const drawing = (el: Element) => el.outerHTML.replace(/\bgl\d+/g, 'gl');
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
          out.set(p, { kind: '#text', text: c.textContent, svg: '', at, words: at, node: c });
        }
        return;
      }
      if (!(c instanceof Element)) return;
      const svg = c instanceof SVGElement ? drawing(c) : '';
      const words = c instanceof HTMLElement && !svg ? wordsBox(c.querySelector<HTMLElement>(':scope > .mt-new') ?? c) : null;
      out.set(p, { kind: kindOf(c), text: c instanceof HTMLElement ? textOf(c) : '', svg, at: c.getBoundingClientRect(), words, node: c });
      if (!svg) walk(c, p);
    });
  walk(box, '');
  return out;
}

/** Something with nothing to change from comes in through a blur. */
const appear = (el: Element) =>
  play(
    el,
    [
      { opacity: 0, filter: 'blur(4px)' },
      { opacity: 1, filter: 'blur(0px)' },
    ],
    { duration: 280, delay: 60, easing: EASE_OUT, fill: 'backwards' },
  );

/**
 * `box` refilled with `kids` and nothing blinks: what is the same stays still;
 * a piece in the same place with other words blurs from the old words into the
 * new where it stands; a drawing that changed comes in through a blur; a piece
 * that changed its kind or its height (another block, a list that wraps over
 * more lines) crosses whole, the old one blurring out exactly where it stood as
 * the new one blurs in, and so does what is gone. A piece that kept its kind
 * and size but moved glides from where it stood. Places are taken against the
 * box, which its sheet moves as a whole; an old piece fades inside its own
 * parent's new self (the same kind, in the same place), so it keeps its look.
 */
export function morphInto(box: HTMLElement, kids: Kid) {
  const was = pieces(box);
  const box0 = box.getBoundingClientRect();
  put(box, kids);
  if (!was.size || calm()) return;
  const box1 = box.getBoundingClientRect();
  /** Where something that stood at `r` in the box's old place stands now, the pieces having glided back there. */
  const here = (r: DOMRect | null) => r && new DOMRect(r.left - box0.left + box1.left, r.top - box0.top + box1.top, r.width, r.height);
  const morphs: (() => void)[] = [];
  /** An old piece, where it stood, the new parent it fades in and where that parent stood. */
  const ghosts: [Element, DOMRect, Element, DOMRect][] = [];
  const seen = new Set<string>();
  const cross = (el: Element, w: Piece | undefined, path: string) => {
    const host = el.parentElement;
    const from = path ? was.get(path)?.at : box0;
    if (w?.at && w.node instanceof Element) ghosts.push(host && from ? [w.node, w.at, host, from] : [w.node, w.at, box, box0]);
    morphs.push(() => appear(el));
  };
  /** Moves `el` from where it stood (`at`, in the box's old place) to where it is, less what its parent already carries. */
  const glideFrom = (el: Element, at: DOMRect, carried: [number, number]): [number, number] => {
    const r = el.getBoundingClientRect();
    const dx = at.left - box0.left - (r.left - box1.left);
    const dy = at.top - box0.top - (r.top - box1.top);
    const ox = dx - carried[0];
    const oy = dy - carried[1];
    if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5)
      play(el, [{ transform: `translate(${ox}px, ${oy}px)` }, { transform: 'none' }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
    return [dx, dy];
  };
  const walk = (n: Node, path: string, carried: [number, number]) =>
    [...n.childNodes].forEach((c, i) => {
      const p = `${path}/${i}`;
      seen.add(p);
      const w = was.get(p);
      if (c.nodeType === Node.TEXT_NODE) {
        const t = c.textContent ?? '';
        if (!t.trim() || (w?.kind === '#text' && w.text === t)) return;
        // A bare word among elements goes into a span of its own, so it can change (and glide from where its words were).
        const s = h('span', {}, t);
        c.replaceWith(s);
        if (w?.at) glideFrom(s, w.at, carried);
        morphs.push(() =>
          w?.kind === '#text' && t.length <= 40 && w.text.length <= 40
            ? morphText(s, t, w.text, { whole: true, at: here(w.words) ?? undefined })
            : appear(s),
        );
        return;
      }
      if (!(c instanceof Element)) return;
      const r = c.getBoundingClientRect();
      if (!w || w.kind !== kindOf(c) || (w.at && Math.abs(w.at.height - r.height) > 1 && !(c instanceof SVGElement)))
        return cross(c, w, path);
      // The same piece somewhere else in the box: it glides there (what it holds rides along, plus its own move).
      const own = w.at ? glideFrom(c, w.at, carried) : carried;
      if (c instanceof SVGElement) {
        if (w.svg !== drawing(c)) morphs.push(() => appear(c));
        return;
      }
      if (!c.children.length && c instanceof HTMLElement) {
        const t = c.textContent ?? '';
        if (t !== w.text)
          morphs.push(() =>
            t.length <= 40 && w.text.length <= 40
              ? morphText(c, t, w.text, { whole: true, at: here(w.words) ?? undefined })
              : cross(c, w, path),
          );
        return;
      }
      walk(c, p, own);
    });
  walk(box, '', [0, 0]);
  // What the new box no longer has goes the same way.
  for (const [p, w] of was)
    if (!seen.has(p) && p.lastIndexOf('/') === 0 && w.at && w.node instanceof Element) ghosts.push([w.node, w.at, box, box0]);
  morphs.forEach((m) => m());
  // The old pieces that cross go from exactly where they stood in their parent (which glides from where it stood).
  const hosts = new Map<Element, number>();
  for (const [, , host] of ghosts) {
    if (!hosts.has(host) && getComputedStyle(host).position === 'static') host.classList.add('mt');
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }
  for (const [g, at, host, from] of ghosts) {
    const e = g as HTMLElement;
    e.style.position = 'absolute';
    e.style.margin = '0';
    e.style.left = `${at.left - from.left - host.clientLeft}px`;
    e.style.top = `${at.top - from.top - host.clientTop}px`;
    e.style.width = `${at.width}px`;
    e.style.pointerEvents = 'none';
    e.setAttribute('aria-hidden', 'true');
    host.appendChild(e);
    play(
      e,
      [
        { opacity: 1, filter: 'blur(0px)' },
        { opacity: 0, filter: 'blur(4px)' },
      ],
      { duration: 180, easing: EASE_IN, fill: 'forwards' },
    ).onfinish = () => {
      e.remove();
      const n = hosts.get(host)! - 1;
      hosts.set(host, n);
      if (!n) host.classList.remove('mt');
    };
  }
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
  const markOut = (m: HTMLElement) =>
    (play(
      m,
      [
        { opacity: 1, filter: 'blur(0px)', ...MARK },
        { opacity: 0, filter: 'blur(3px)', width: '0px', marginRight: '0px' },
      ],
      { duration: 220, easing: EASE_IN, fill: 'forwards' },
    ).onfinish = () => m.remove());
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
    el.setAttribute('aria-label', (i === a ? i : `${i} (Android: ${a.split(' → ').pop()})`).replace(/ → /g, ' › '));
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
