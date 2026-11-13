// Regions and rows that follow signals (shared/live): the admin's way from a changed field to the DOM.
// A region is drawn inside an effect and drawn again only when something it read changed; a list keeps a
// row's node for as long as its item is the same object and nothing else that row read changed
// (shared/live/share.ts keeps unchanged items the same objects). So an answer in which one device came
// online redraws that person's row and the figures that count it, and nothing else on the page is touched:
// no focus, hover, scroll or open tip is lost to a repaint that changed nothing there.
//
// Repaints wait for the next frame, so a burst of changes is one repaint. A region or a row that holds the
// keyboard focus is left as it is until the focus leaves it, unless the repaint follows the user's own
// action (`paintNow(true)`): a background change never takes the focus away.

import { computed, effect, signal, type Computed, type Writable } from '../../shared/live/signal';
import { onNavigate } from '../ui/nav';
import { morphValues, refill, valuesOf, type Values } from '../ui/reshape';
import { focusInside } from './poller';

const due = new Set<() => void>();
let frame = 0;
let loud = false;

function later(run: () => void): void {
  due.add(run);
  frame ||= requestAnimationFrame(() => paintNow());
}

/**
 * Draw what is due now instead of at the next frame (before a page comes in, after the user's
 * own action). `own`: the user's own action, which repaints even what holds the focus.
 */
export function paintNow(own = false): void {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  loud = own;
  try {
    while (due.size) {
      const runs = [...due];
      due.clear();
      for (const run of runs) run();
    }
  } finally {
    loud = false;
  }
}

/** The repaint under way follows the user's own action. */
export const ownPaint = (): boolean => loud;

/**
 * An effect that repaints at the next frame and stops with its page (Outline's navigation). A run that
 * answers false left things as they were: it is still told of what its last run read.
 */
export function live(fn: () => void | boolean): () => void {
  const stop = effect(fn, later);
  const off = onNavigate(() => end());
  const end = () => {
    stop();
    off();
  };
  return end;
}

/** Something changed under a node that holds the focus: `again` is moved once the focus leaves it. */
function hold(el: Node, again: Writable<number>): void {
  el.addEventListener('focusout', () => queueMicrotask(() => again.set(again.peek() + 1)), { once: true });
}

type Kids = Node | null | (Node | null)[];
const listOf = (k: Kids): Node[] => (Array.isArray(k) ? k : [k]).filter((x): x is Node => !!x);

/** Keep `box` filled with what `build` makes of the signals it reads. Returns the stop. */
export function fill(box: HTMLElement, build: () => Kids): () => void {
  const again = signal(0);
  return live(() => {
    again();
    if (!loud && focusInside(box)) {
      hold(box, again);
      return false;
    }
    refill(box, listOf(build()));
  });
}

/**
 * A region that draws itself from the signals it reads. `draw` answers false when it left the region as it
 * was (the focus is in it): it is asked again once the focus leaves `box`.
 */
export function drawn(box: HTMLElement, draw: () => void | boolean): () => void {
  const again = signal(0);
  return live(() => {
    again();
    if (draw() !== false) return;
    hold(box, again);
    return false;
  });
}

/**
 * Keep `box` filled with a row for each item of `list`, in its order. A row is built again when its item
 * is another object or something its build read changed; the others keep their nodes, which only move if
 * the order did. `build` may answer null: no row for that item.
 */
export function rows<T>(box: HTMLElement, list: () => readonly T[], key: (item: T) => string, build: (item: T) => Node | null): () => void {
  const again = signal(0);
  const kept = new Map<string, { item: T; node: Computed<Node | null>; shown: Node | null }>();
  const stop = live(() => {
    again();
    const want: Node[] = [];
    const seen = new Set<string>();
    /** Rows built again: what the old one's values said, for the new one's to morph from. */
    const turned: [Node, Values | null][] = [];
    for (const item of list()) {
      const k = key(item);
      seen.add(k);
      let row = kept.get(k);
      if (!row) kept.set(k, (row = { item, node: computed(() => build(item)), shown: null }));
      else if (row.item !== item) {
        row.node.stop();
        row.item = item;
        row.node = computed(() => build(item));
      }
      const node = row.node();
      if (row.shown && row.shown !== node && !loud && focusInside(row.shown as Element)) hold(row.shown, again);
      else {
        if (row.shown && node && row.shown !== node) turned.push([node, valuesOf(row.shown)]);
        row.shown = node;
      }
      if (row.shown) want.push(row.shown);
    }
    for (const [k, row] of kept) {
      if (seen.has(k)) continue;
      row.node.stop();
      kept.delete(k);
    }
    // the box's children in this order, touching only what differs
    let at = box.firstChild;
    for (const n of want) {
      if (n === at) at = at.nextSibling;
      else box.insertBefore(n, at);
    }
    while (at) {
      const next = at.nextSibling;
      at.remove();
      at = next;
    }
    for (const [node, was] of turned) morphValues(was, node);
  });
  return () => {
    stop();
    for (const row of kept.values()) row.node.stop();
    kept.clear();
  };
}
