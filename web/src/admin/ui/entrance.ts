// How a page of the admin comes in, and a view it swaps in: as the portal's page does (portal/ui/rise.ts), its blocks
// rising one after the other in the order they stand on screen (DESIGN.md › Motion › 16). This is the one motion a
// page of the admin has of its own: a repaint after it stands still.
//
// The admin's pages are many and built of nested parts, so their blocks are found, not listed: from the root down,
// a block is what is seen as one thing (a surface: a card, a tile, a field; a line low enough to be one row: a head,
// a caption, a row of chips; a heading; a leaf), and a box that only lays others out is gone through. The section
// row (`.dl-nav`) is the frame every page shares: it stands from the first frame and never rises.
//
// A page is often drawn again while it comes in (Health, a section's own question, the stream's next answer): what
// takes the place of a block still rising goes on rising from where that block was, on the wave's clock, and what is
// put in beside them comes in with the wave's last. Nothing new stands there at a stroke in the middle of the wave.

import { RISING, rise, riseIn, type Wave } from '../../portal/ui/rise';

/** A box this low is one line (a head, a caption, a row of chips): it rises whole. */
const ROW = 64;
/** How deep a box is gone through looking for blocks. */
const DEPTH = 8;
/** Blocks this far down (in windows) rise; those under them stand there already when they are scrolled to. */
const REACH = 1.25;
/** The wave's steps at most: a dense page still stands whole in well under a second. */
const MOST = 14;

/** Seen as one thing: a painted surface, a heading, a line. */
function isBlock(el: Element, r: DOMRect): boolean {
  if (!el.firstElementChild || r.height <= ROW) return true;
  if (/^(H[1-6]|HEADER|P|TABLE|svg|canvas|IMG)$/.test(el.tagName)) return true;
  const cs = getComputedStyle(el);
  if (cs.display.startsWith('inline') || cs.display === 'table') return true;
  return (
    !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) ||
    cs.backgroundImage !== 'none' ||
    cs.boxShadow !== 'none' ||
    parseFloat(cs.borderTopWidth) > 0
  );
}

function blocksOf(root: Element): Element[] {
  const out: Element[] = [];
  const bottom = innerHeight * REACH;
  const walk = (el: Element, depth: number) => {
    for (const c of el.children) {
      if (c.matches(`.dl-nav, style, script, template, [${RISING}]`)) continue;
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height || r.top > bottom) continue;
      // what is laid over the flow (a rail's highlight, a pill, a mark in a corner) is no block of the page: it
      // belongs to what it stands on, and comes with it or by its own means. Taken for a block, a highlight still
      // unseen rose to its own opacity, nothing, and then stood there at a stroke when the rise let go of it (the
      // owner, 2026-11-12: «в сайдбаре хайлайт появляется инстантно а не плавно»).
      if (/absolute|fixed/.test(getComputedStyle(c).position)) continue;
      // a box with something rising in it already: only what is still to come in rises, around that
      const busy = !!c.querySelector(`[${RISING}]`);
      if (!busy && (depth >= DEPTH || isBlock(c, r))) out.push(c);
      else if (c.firstElementChild) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** The blocks of what was put in (`el` itself when it reads as one). */
function blocksIn(el: Element): Element[] {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || r.top > innerHeight * REACH) return [];
  return isBlock(el, r) ? [el] : blocksOf(el);
}

/** For as long as `wave` rises in `root`: what a repaint puts in place of its blocks rises on with it. */
function carry(root: HTMLElement, wave: Wave) {
  const look = new MutationObserver((records) => {
    // What went from each box in this turn, by the earliest wait among it. A repaint may take the old out and put
    // the new in as two changes (a rail drops its links, then adds them): they are one replacement all the same,
    // so the waits are gathered over the whole turn before anything put in is given one. (Read apart, the new
    // links were taken for something that had never stood there and sent to the wave's end: the rail of Settings
    // went away and came back with every answer that landed while the page came in.)
    const went = new Map<Node, number>();
    for (const rec of records)
      for (const n of rec.removedNodes) {
        if (!(n instanceof Element)) continue;
        for (const x of [n, ...n.querySelectorAll('*')]) {
          const d = wave.delays.get(x);
          if (d != null) went.set(rec.target, Math.min(went.get(rec.target) ?? Infinity, d));
        }
      }
    for (const rec of records)
      for (const n of rec.addedNodes) {
        // inside a block still rising: it comes in with it
        if (!(n instanceof Element) || !n.isConnected || n.parentElement?.closest(`[${RISING}]`)) continue;
        for (const b of blocksIn(n)) riseIn(wave, b, went.get(rec.target) ?? wave.last);
      }
  });
  look.observe(root, { childList: true, subtree: true });
  setTimeout(() => look.disconnect(), Math.max(0, wave.end - Number(document.timeline.currentTime ?? performance.now())));
}

/** The blocks rise, and what takes their places meanwhile rises on with them. */
function come(root: HTMLElement) {
  carry(root, rise(blocksOf(root), MOST));
}

/**
 * `root`'s blocks rise. A root not yet in the page (LuCI puts a view in a moment after it is drawn) waits for it
 * unseen, so it is never shown standing before it comes in.
 */
export function enter(root: HTMLElement) {
  // inside a block still rising: it comes in with it
  if (root.closest(`[${RISING}]`)) return;
  if (root.isConnected) return come(root);
  root.style.opacity = '0';
  let frames = 60;
  const wait = () => {
    if (!root.isConnected && --frames > 0) return void requestAnimationFrame(wait);
    root.style.opacity = '';
    if (root.isConnected) come(root);
  };
  requestAnimationFrame(wait);
}
