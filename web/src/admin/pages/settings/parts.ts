// The parts of a Settings view kept in order: each a section (or the server's
// bar, the rollout's strip) with a key of what it shows. A part is built again
// only when its key moved (a stage's address is probed when it is built, a
// path check's result stands in its section: neither on every poll), and on a
// quiet repaint never while a value is typed in it.

import { still } from '../../../portal/motion';
import { morphInto } from '../../../portal/ui/morph';
import { carryControls } from '../../../portal/ui/carry';
import { putChildren } from '../../../portal/ui/put';
import { morphValues, valuesOf } from '../../ui/reshape';

/** A part of a view: its id, how to build it (null: it is gone), the key of what it shows. */
export type Part = [id: string, make: (() => HTMLElement | null) | null, key: string];

/** A value is being typed inside `el`: a repaint leaves that part alone. */
function typing(el: HTMLElement): boolean {
  const a = (el.getRootNode() as Document | ShadowRoot).activeElement;
  return !!a && el.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName);
}

const FOCUSABLE = 'button, a[href], input, [tabindex]:not([tabindex="-1"])';

/** Which of a part's controls holds the focus, by its place among them; -1: none. */
function focusedAt(el: HTMLElement): number {
  const a = (el.getRootNode() as Document | ShadowRoot).activeElement;
  return a && el.contains(a) ? [...el.querySelectorAll(FOCUSABLE)].indexOf(a) : -1;
}

export class Parts {
  private map = new Map<string, { el: HTMLElement; key: string }>();
  /** Boxes drawn once already: their next change moves. */
  private drawn = new WeakSet<HTMLElement>();

  /** A part's element, if it is drawn. */
  el(id: string): HTMLElement | undefined {
    return this.map.get(id)?.el;
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  /** The parts drawn in `box`, as laid out. */
  within(box: HTMLElement): HTMLElement[] {
    return [...this.map.values()].map((x) => x.el).filter((el) => box.contains(el));
  }

  /**
   * The parts of a box, in order (a part not listed, or listed as null, goes). A part is built again only when its
   * key moved, and on a quiet repaint not while a value is typed in it.
   */
  put(box: HTMLElement, list: Part[], quiet: boolean) {
    // drawn before: the box changes in place (portal morphInto, deep): a part kept stays (gliding if it moved), one
    // rebuilt changes only what it shows anew (words morph, a switch's options unfold, its knob slides), one that comes
    // blurs in, one that goes fades out where it stood, and the box glides to its new height
    const moving = this.drawn.has(box) && !still() && box.getClientRects().length > 0;
    // the page stands still (the admin): a part built again is put in, and only its values that changed morph
    const was = this.drawn.has(box) && !moving && box.getClientRects().length > 0 ? valuesOf(box) : null;
    this.drawn.add(box);
    const ids = new Set(list.filter(([, make]) => make).map(([id]) => id));
    for (const [id, part] of this.map) if (part.el.parentElement === box && !ids.has(id)) this.map.delete(id);
    const next: HTMLElement[] = [];
    const focus: [HTMLElement, number][] = [];
    for (const [id, make, key] of list) {
      const old = this.map.get(id);
      const there = !!old && old.el.parentElement === box;
      if (there && (old.key === key || (quiet && typing(old.el)))) {
        next.push(old.el);
        continue;
      }
      const el = make?.();
      if (!el) {
        this.map.delete(id);
        continue;
      }
      // the page stands still, but what was pressed moves: a switch, a chip, a tile goes on from the one it replaces
      if (there && !moving && was) carryControls(old.el, [el]);
      // paired with what it was by its id, whatever came or went around it
      el.dataset.key = id;
      // the focus was in the part: it stays on the same control of the new one (a keyboard goes on from there)
      const at = there ? focusedAt(old.el) : -1;
      if (at >= 0) focus.push([el, at]);
      this.map.set(id, { el, key });
      next.push(el);
    }
    if (moving) morphInto(box, next, { deep: true });
    else {
      // (never emptied on the way: WebKit would lose the page's scroll position, ui/put.ts)
      putChildren(box, next);
      morphValues(was, box);
    }
    for (const [el, at] of focus) el.querySelectorAll<HTMLElement>(FOCUSABLE)[at]?.focus({ preventScroll: true });
  }
}
