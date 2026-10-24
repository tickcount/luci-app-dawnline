// The page's own text selection, as the name fields draw theirs (ui/caret.ts), with a mouse or trackpad. Little
// of the page can be selected (base.css: what is typed or copied by hand, the mono text and the configuration);
// there the native selection is see-through and this draws an accent wash over each line it covers, a little
// taller than the line, with a handle at each end, as iOS does. Each line's ends glide on the fields' pull
// (glideStep): the wash grows out of where the selection started, follows the pointer, and fades where it stands
// as it collapses; when the text moves or goes (a scroll, a fold, a sheet), it goes along at once. Fields keep their own: a range cannot measure
// an input's text. On a touch screen the system's selection stays, with its own handles.
//
// The wash lies over the text, not under it (it cannot go under every block's), so it blends (controls.css): the
// text keeps its colour and the ground under it takes the accent. It stands on the layer of what holds the
// selection (the page, under its edge fades; a sheet; a dropdown) and is clipped to what clips or scrolls it there.

import { h } from '../dom';
import { calm } from '../motion';
import { FRAME, glideStep, type Glide } from './caret';

/** One run of a line the selection covers, on screen. */
interface Box {
  top: number;
  height: number;
  left: number;
  right: number;
}

interface Band {
  el: HTMLElement;
  top: number;
  height: number;
  l: Glide;
  r: Glide;
}

/** The layer a selection stands on, by what holds it: just over its dropdown or sheet, else under the edge fades. */
const layer = (el: Element): number => (el.closest('.toasts') ? 71 : el.closest('.drop') ? 61 : el.closest('.sheet-root') ? 51 : 29);

/** What shows `el`: the screen, cut by every box around it that clips or scrolls. */
function clipOf(el: Element, seen: Map<Element, Box>): Box {
  const had = seen.get(el);
  if (had) return had;
  const up = el.parentElement;
  const c = up ? { ...clipOf(up, seen) } : { top: 0, height: innerHeight, left: 0, right: innerWidth };
  const cs = getComputedStyle(el);
  if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
    const r = el.getBoundingClientRect();
    const bottom = Math.min(c.top + c.height, r.bottom);
    c.top = Math.max(c.top, r.top);
    c.height = Math.max(0, bottom - c.top);
    c.left = Math.max(c.left, r.left);
    c.right = Math.min(c.right, r.right);
  }
  seen.set(el, c);
  return c;
}

/** The lines `range` covers in what can be selected, one box per run of a line, and the layer they stand on. */
function lines(range: Range): { boxes: Box[]; z: number } {
  const root = range.commonAncestorContainer;
  const texts: Text[] = [];
  if (root instanceof Text) texts.push(root);
  else {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (range.intersectsNode(n)) texts.push(n as Text);
  }
  const seen = new Map<Element, Box>();
  const runs: Box[] = [];
  let z = 0;
  for (const t of texts) {
    const el = t.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if ((cs.userSelect || cs.webkitUserSelect) === 'none') continue;
    const part = document.createRange();
    part.setStart(t, t === range.startContainer ? range.startOffset : 0);
    part.setEnd(t, t === range.endContainer ? range.endOffset : t.length);
    if (part.collapsed) continue;
    z ||= layer(el);
    const c = clipOf(el, seen);
    for (const q of part.getClientRects()) {
      if (q.width < 0.5) continue;
      // A little taller than the line, as the fields' wash.
      const top = Math.max(c.top, q.top - 1);
      const bottom = Math.min(c.top + c.height, q.bottom + 1);
      const left = Math.max(c.left, q.left);
      const right = Math.min(c.right, q.right);
      if (bottom - top >= 0.5 && right - left >= 0.5) runs.push({ top, height: bottom - top, left, right });
    }
  }
  runs.sort((a, b) => a.top - b.top || a.left - b.left);
  const boxes: Box[] = [];
  for (const q of runs) {
    const b = boxes.find((x) => Math.abs(x.top - q.top) < 2 && q.left - x.right < 6 && x.left - q.right < 6);
    if (!b) boxes.push({ ...q });
    else {
      b.left = Math.min(b.left, q.left);
      b.right = Math.max(b.right, q.right);
      b.height = Math.max(b.height, q.height);
    }
  }
  return { boxes, z };
}

/** The focus before the anchor: the selection was dragged up or to the left. */
function backward(s: Selection): boolean {
  if (!s.anchorNode || !s.focusNode) return false;
  if (s.anchorNode === s.focusNode) return s.focusOffset < s.anchorOffset;
  return !!(s.anchorNode.compareDocumentPosition(s.focusNode) & Node.DOCUMENT_POSITION_PRECEDING);
}

/** Where the selection started, on screen, or null where that has no place (a node with no box). */
function anchorX(s: Selection): number | null {
  if (!s.anchorNode) return null;
  const r = document.createRange();
  r.setStart(s.anchorNode, s.anchorOffset);
  const q = r.getBoundingClientRect();
  return q.height ? q.left : null;
}

/** Draw the page's selection from now on (a mouse or trackpad only). Call it once. */
export function pageSelection() {
  if (!matchMedia('(pointer: fine)').matches) return;
  document.documentElement.classList.add('own-tsel');
  const h0 = h('span', { class: 'tsel-hd s', 'aria-hidden': 'true' });
  const h1 = h('span', { class: 'tsel-hd e', 'aria-hidden': 'true' });
  let bands: Band[] = [];
  let shown = false;
  let gone = 0;
  let watch = 0;
  let queued = 0;

  const jump = (g: Glide) => {
    g.x = g.t;
    g.v = 0;
  };
  const draw = () => {
    for (const b of bands) {
      b.el.style.transform = `translate(${b.l.x.toFixed(2)}px, ${b.top.toFixed(2)}px)`;
      b.el.style.width = `${Math.max(0, b.r.x - b.l.x).toFixed(2)}px`;
      b.el.style.height = `${b.height.toFixed(2)}px`;
    }
    const a = bands[0];
    const z = bands[bands.length - 1];
    if (!a || !z) return;
    h0.style.transform = `translate(${(a.l.x - 1).toFixed(2)}px, ${a.top.toFixed(2)}px)`;
    h0.style.height = `${a.height.toFixed(2)}px`;
    h1.style.transform = `translate(${(z.r.x - 1).toFixed(2)}px, ${z.top.toFixed(2)}px)`;
    h1.style.height = `${z.height.toFixed(2)}px`;
  };

  // One loop for every edge; it stops when all of them rest.
  let raf = 0;
  let last = 0;
  const step = (t: number) => {
    const frames = last ? (t - last) / FRAME : 1;
    last = t;
    let busy = false;
    for (const b of bands) for (const g of [b.l, b.r]) if (glideStep(g, frames)) busy = true;
    draw();
    raf = busy ? requestAnimationFrame(step) : 0;
    if (!raf) last = 0;
  };
  const follow = () => {
    if (calm()) {
      for (const b of bands) [b.l, b.r].forEach(jump);
      return draw();
    }
    if (!raf) raf = requestAnimationFrame(step);
  };

  const all = () => [...bands.map((b) => b.el), h0, h1];
  // Collapsed: the wash fades where it stands, and is gone once it has.
  const fade = () => {
    if (!shown) return;
    shown = false;
    all().forEach((el) => el.classList.remove('on'));
    clearTimeout(gone);
    gone = window.setTimeout(() => {
      if (shown) return;
      bands.forEach((b) => b.el.remove());
      bands = [];
      h0.remove();
      h1.remove();
    }, 160);
  };

  /** The selection's lines as they stand; none while a field has the focus (it draws its own). */
  const now = (sel: Selection | null) => {
    const focus = document.activeElement;
    const typing = focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement;
    return sel && sel.rangeCount && !sel.isCollapsed && !typing ? lines(sel.getRangeAt(0)) : { boxes: [], z: 0 };
  };
  const place = (still: boolean) => {
    const sel = getSelection();
    const { boxes, z } = now(sel);
    if (!sel || !boxes.length) return fade();
    // A new selection grows out of where it started (a wash still fading turns back from where it stands); a line
    // it reaches grows from the side it is reached from.
    const from = bands.length ? null : anchorX(sel);
    const back = backward(sel);
    const kept: Band[] = [];
    for (const box of boxes) {
      let b = bands.find((x) => !kept.includes(x) && Math.abs(x.top - box.top) < 2);
      if (!b) {
        const x = from ?? (back ? box.right : box.left);
        b = {
          el: h('span', { class: 'tsel-band', 'aria-hidden': 'true' }),
          top: box.top,
          height: box.height,
          l: { x, v: 0, t: x },
          r: { x, v: 0, t: x },
        };
        document.body.append(b.el);
      }
      b.top = box.top;
      b.height = box.height;
      b.l.t = box.left;
      b.r.t = box.right;
      if (still) [b.l, b.r].forEach(jump);
      b.el.style.zIndex = String(z);
      kept.push(b);
    }
    bands.filter((b) => !kept.includes(b)).forEach((b) => b.el.remove());
    bands = kept;
    h0.style.zIndex = h1.style.zIndex = String(z + 1);
    if (!h0.isConnected) document.body.append(h0, h1);
    clearTimeout(gone);
    draw();
    // Drawn where they start before they fade in (a style read in between, so the fade runs).
    if (!shown) h0.getBoundingClientRect();
    shown = true;
    all().forEach((el) => el.classList.add('on'));
    follow();
    if (!watch) watch = requestAnimationFrame(look);
  };

  // While it shows, every frame: the text may move or go with no event to say so (a fold closing over it, a
  // sheet's view swapped or the sheet shut, a scroll): the wash moves with it at once, or fades where nothing of
  // it shows any more. The selection itself stays, as the browser keeps it.
  const look = () => {
    watch = 0;
    if (!shown) return;
    if (!queued) {
      const { boxes } = now(getSelection());
      const same =
        boxes.length === bands.length &&
        boxes.every((x, i) => {
          const b = bands[i];
          return (
            Math.abs(x.top - b.top) < 0.5 &&
            Math.abs(x.height - b.height) < 0.5 &&
            Math.abs(x.left - b.l.t) < 0.5 &&
            Math.abs(x.right - b.r.t) < 0.5
          );
        });
      if (!same) place(true);
    }
    if (shown) watch = requestAnimationFrame(look);
  };

  // After the event: by then the browser has moved its selection.
  const soon = () => {
    if (!queued)
      queued = requestAnimationFrame(() => {
        queued = 0;
        place(false);
      });
  };
  document.addEventListener('selectionchange', () => soon());
  // A press where nothing can be selected lets go of the selection, as a click anywhere does in a document: the
  // browser keeps it over text that cannot be selected, and here that is most of the page.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || !(e.target instanceof Element)) return;
      const cs = getComputedStyle(e.target);
      if ((cs.userSelect || cs.webkitUserSelect) === 'none') getSelection()?.removeAllRanges();
    },
    true,
  );
}
