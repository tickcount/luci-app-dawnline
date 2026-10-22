// The name fields' own caret and, with a mouse or trackpad, their own selection
// (`smoothCaret` on a `.field`). The caret glides to where the next letter goes
// and blinks as macOS draws it; a selection is an accent wash with a handle at
// each end, as iOS draws it, growing out of the caret and fading back into it.
// The input stays the browser's own (typing, IME, its native selection, made
// see-through): this only draws over it. With a mouse or trackpad only: on a
// touch screen the system's caret stays (in the accent), with its own selection
// and handles. iOS doesn't tell a page reliably where its caret went (a tap in
// the words, a press-and-drag): a drawn one would wait for the first key. The
// look is in styles/controls.css; like the rest of the page this writes styles
// through `el.style` only (the CSP drops style attributes).
//
// Places come from a hidden mirror with the input's own font: the width of the
// text up to a position, less how far the input has scrolled. The pure parts
// (`glideStep`, `places`) are what the tests run.

import { h } from '../dom';
import { calm } from '../motion';

/** One edge that glides: where it is, how fast it moves, where it goes. */
export interface Glide {
  x: number;
  v: number;
  t: number;
}

/** The frame the glide is tuned to, in ms. */
const FRAME = 16.67;

/**
 * Move a glide on by `frames` frames (after bencho.dev's one-time code, a softer pull: per frame
 * v += (t − x)·0.12, v ·= 0.62, x += v; 90% of the way in ~134 ms, about 2% over, no stretch).
 * At most 2.5 frames at once; after a long gap (a hidden tab) it is simply there. False once it
 * rests, then exactly on its target.
 */
export function glideStep(g: Glide, frames: number): boolean {
  if (frames > 15) {
    g.x = g.t;
    g.v = 0;
    return false;
  }
  const dt = Math.min(2.5, Math.max(0, frames));
  g.v += (g.t - g.x) * 0.12 * dt;
  g.v *= Math.pow(0.62, dt);
  g.x += g.v * dt;
  if (Math.abs(g.t - g.x) < 0.05 && Math.abs(g.v) < 0.05) {
    g.x = g.t;
    g.v = 0;
    return false;
  }
  return true;
}

/** What an input shows now, as `places` reads it. */
export interface FieldText {
  value: string;
  /** The selection (equal: a caret), and which end the caret is at. */
  start: number;
  end: number;
  backward: boolean;
  /** The input's box in the field: its left edge and width, and how far its text has scrolled. */
  left: number;
  width: number;
  scroll: number;
}

/** Where the caret and a selection's ends go, in px from the field's left edge. */
export interface Places {
  caret: number;
  start: number;
  end: number;
  /** A selection, not just a caret. */
  range: boolean;
}

/**
 * The places for `f`, with `measure` the width of a text in the input's font. A selection that
 * runs past the input's edges (a long name, scrolled) stops at them: the wash never covers the
 * go button.
 */
export function places(f: FieldText, measure: (text: string) => number): Places {
  const x = (i: number) => Math.min(f.left + f.width, Math.max(f.left, f.left + measure(f.value.slice(0, i)) - f.scroll));
  const start = x(f.start);
  const end = f.end === f.start ? start : x(f.end);
  return { caret: f.backward ? start : end, start, end, range: f.start !== f.end };
}

/** The input's font, as the mirror needs it to measure the same widths. */
const FONT = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'fontFeatureSettings', 'fontVariationSettings'] as const;

/**
 * Give the input of `field` (a `.field`) the glide caret and the selection, with a mouse or trackpad.
 * Call it once, as the field is built (it measures only once the field is on the page).
 */
export function smoothCaret(field: HTMLElement) {
  const input = field.querySelector('input');
  if (!input) return;
  // A touch screen: the system's caret (controls.css gives it the accent).
  if (!matchMedia('(pointer: fine)').matches) return;
  field.classList.add('own-caret', 'own-sel');
  const wash = h('span', { class: 'caret-sel' });
  const h0 = h('span', { class: 'caret-hd s' });
  const h1 = h('span', { class: 'caret-hd e' });
  const caret = h('span', { class: 'caret' });
  const mirror = h('span', { class: 'caret-mirror', 'aria-hidden': 'true' });
  field.append(wash, h0, h1, caret, mirror);
  // In the field's own px: while the sheet scales in (the rename field selects its text then), the
  // box on screen is smaller than the one the caret is drawn in.
  const measure = (text: string) => {
    mirror.textContent = text;
    const shown = field.getBoundingClientRect().width;
    return mirror.getBoundingClientRect().width * (shown ? field.offsetWidth / shown : 1);
  };
  const now = (): Places =>
    places(
      {
        value: input.value,
        start: input.selectionStart ?? 0,
        end: input.selectionEnd ?? 0,
        backward: input.selectionDirection === 'backward',
        left: input.offsetLeft,
        width: input.clientWidth,
        scroll: input.scrollLeft,
      },
      measure,
    );

  const glide = (): Glide => ({ x: 0, v: 0, t: 0 });
  const cur = glide();
  const s0 = glide();
  const s1 = glide();
  const all = [cur, s0, s1];
  const jump = (g: Glide, x: number) => {
    g.x = g.t = x;
    g.v = 0;
  };
  let selecting = false;
  const focused = () => document.activeElement === input;

  const draw = () => {
    caret.style.transform = `translateX(${(cur.x - 1).toFixed(2)}px)`;
    wash.style.transform = `translateX(${Math.min(s0.x, s1.x).toFixed(2)}px)`;
    wash.style.width = `${Math.abs(s1.x - s0.x).toFixed(2)}px`;
    h0.style.transform = `translateX(${(s0.x - 1).toFixed(2)}px)`;
    h1.style.transform = `translateX(${(s1.x - 1).toFixed(2)}px)`;
  };

  // One loop for the three edges; it stops when all of them rest.
  let raf = 0;
  let last = 0;
  const step = (t: number) => {
    const frames = last ? (t - last) / FRAME : 1;
    last = t;
    let busy = false;
    for (const g of all) if (glideStep(g, frames)) busy = true;
    draw();
    raf = busy ? requestAnimationFrame(step) : 0;
    if (!raf) last = 0;
  };
  const follow = () => {
    // Less motion: everything is where it goes at once.
    if (calm()) {
      all.forEach((g) => jump(g, g.t));
      return draw();
    }
    if (!raf) raf = requestAnimationFrame(step);
  };

  let first = true;
  let rest = 0;
  let faded = 0;
  let fading = false;
  let pressedAt = 0;
  const place = () => {
    if (!focused()) {
      clearTimeout(rest);
      caret.classList.remove('on', 'blink');
      field.classList.remove('selecting');
      selecting = false;
      return draw();
    }
    if (first) {
      // Measured here, not when built: a field not on the page yet has no font to copy.
      const cs = getComputedStyle(input);
      for (const k of FONT) mirror.style[k] = cs[k];
    }
    const p = now();
    if (first) {
      all.forEach((g) => jump(g, p.start));
      first = false;
    }
    if (p.range) {
      // Selecting: the wash grows out of where the caret is, and the caret steps aside. A wash still fading from
      // the last selection turns back instead and glides from its old ends to the new ones.
      if (!selecting) {
        clearTimeout(faded);
        if (!fading) {
          s0.x = s1.x = cur.x;
          s0.v = s1.v = 0;
        }
        fading = false;
      }
      selecting = true;
      s0.t = p.start;
      s1.t = p.end;
      cur.t = p.caret;
      field.classList.add('selecting');
      caret.classList.remove('on', 'blink');
    } else {
      // Collapsed: the wash fades where it stands, and its ends join the caret once it is gone.
      // A click puts the caret where it was clicked at once, as macOS does; typing and the arrows glide.
      if (selecting) {
        field.classList.remove('selecting');
        clearTimeout(faded);
        fading = true;
        faded = window.setTimeout(() => {
          fading = false;
          if (selecting) return;
          jump(s0, cur.t);
          jump(s1, cur.t);
          draw();
        }, 160);
      } else if (!fading) {
        jump(s0, p.start);
        jump(s1, p.start);
      }
      selecting = false;
      if (performance.now() - pressedAt < 400) jump(cur, p.caret);
      else cur.t = p.caret;
      // Solid while it moves or they type, blinking again half a second after.
      caret.classList.add('on');
      caret.classList.remove('blink');
      clearTimeout(rest);
      rest = window.setTimeout(() => {
        if (focused()) caret.classList.add('blink');
      }, 500);
    }
    follow();
  };
  // After the event: by then the browser has moved its own caret.
  let queued = 0;
  const soon = () => {
    if (!queued)
      queued = requestAnimationFrame(() => {
        queued = 0;
        place();
      });
  };

  for (const ev of ['pointerdown', 'pointerup']) input.addEventListener(ev, () => (pressedAt = performance.now()));
  for (const ev of ['input', 'keydown', 'keyup', 'pointerup', 'select', 'scroll']) input.addEventListener(ev, soon);
  input.addEventListener('pointermove', (e) => {
    if (e.buttons) soon();
  });
  // A selection made any other way (the keyboard's, a double click, the page's own select()).
  const onSelect = () => {
    if (focused()) soon();
  };
  input.addEventListener('focus', () => {
    first = true;
    document.addEventListener('selectionchange', onSelect);
    soon();
  });
  input.addEventListener('blur', () => {
    document.removeEventListener('selectionchange', onSelect);
    soon();
  });
}
