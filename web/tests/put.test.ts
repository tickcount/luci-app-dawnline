import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepPlace, putChildren } from '../src/portal/ui/put';

/** A node and a box of nodes, as far as putChildren reads the DOM: who stands where, and what was taken out. */
class N {
  parentNode: Box | null = null;
  /** How many times it left a box (a move within the box counts: its focus and scroll would go with it). */
  left = 0;
  constructor(public name: string) {}
  get nextSibling(): N | null {
    const list = this.parentNode?.kids ?? [];
    return list[list.indexOf(this) + 1] ?? null;
  }
  remove() {
    const p = this.parentNode;
    if (!p) return;
    p.kids.splice(p.kids.indexOf(this), 1);
    this.parentNode = null;
    this.left++;
    p.seen();
  }
}
class Box {
  kids: N[] = [];
  /** The fewest children it ever held between two calls: an emptied box loses the page's scroll in WebKit. */
  fewest = Infinity;
  constructor(...kids: N[]) {
    for (const k of kids) {
      k.parentNode = this;
      this.kids.push(k);
    }
  }
  seen() {
    this.fewest = Math.min(this.fewest, this.kids.length);
  }
  get firstChild(): N | null {
    return this.kids[0] ?? null;
  }
  get childNodes(): N[] {
    return this.kids;
  }
  insertBefore(n: N, at: N | null) {
    n.remove();
    n.parentNode = this;
    this.kids.splice(at ? this.kids.indexOf(at) : this.kids.length, 0, n);
    this.seen();
  }
  names() {
    return this.kids.map((k) => k.name).join(' ');
  }
}
const put = (box: Box, next: N[]) => putChildren(box as unknown as Element, next as unknown as Node[]);

describe('a box given its next children', () => {
  it('holds exactly them, in order', () => {
    const [a, b, c, x] = ['a', 'b', 'c', 'x'].map((n) => new N(n));
    const box = new Box(a, b, c);
    put(box, [c, x, a]);
    expect(box.names()).toBe('c x a');
    expect(b.parentNode).toBeNull();
  });
  it('leaves alone what stays where it stood', () => {
    const [a, b, c, x, y] = ['a', 'b', 'c', 'x', 'y'].map((n) => new N(n));
    const box = new Box(a, b, c);
    // b is built anew (y takes its place), x comes at the end: a and c are never taken out
    put(box, [a, y, c, x]);
    expect(box.names()).toBe('a y c x');
    expect([a.left, c.left]).toEqual([0, 0]);
  });
  it('is never emptied on the way, even when every child is new', () => {
    const old = ['a', 'b', 'c'].map((n) => new N(n));
    const next = ['x', 'y'].map((n) => new N(n));
    const box = new Box(...old);
    box.fewest = Infinity;
    put(box, next);
    expect(box.names()).toBe('x y');
    // the new ones stood before the old ones left: never fewer than it ends with
    expect(box.fewest).toBeGreaterThanOrEqual(2);
  });
  it('empties a box that is to be empty, and fills an empty one', () => {
    const [a, b] = ['a', 'b'].map((n) => new N(n));
    const box = new Box(a);
    put(box, []);
    expect(box.names()).toBe('');
    put(box, [b, a]);
    expect(box.names()).toBe('b a');
  });
});

/** A page as far as the hold reads it: boxes one in another, a shadow root between, each with where it is scrolled to. */
class El {
  scrollTop = 0;
  scrollLeft = 0;
  constructor(public parentNode: El | Root | null = null) {}
}
class Root {
  parentNode = null;
  constructor(public host: El) {}
}

describe('the page keeps its place over a redraw', () => {
  afterEach(() => vi.unstubAllGlobals());
  const page = () => {
    vi.stubGlobal('Element', El);
    vi.stubGlobal('ShadowRoot', Root);
    // the main area scrolls; the admin's host stands in it, its page under a shadow root, a track of tabs in the page
    const main = new El();
    const host = new El(main);
    const track = new El(new El(new Root(host)));
    const box = new El(track);
    main.scrollTop = 841;
    track.scrollLeft = 120;
    return { main, track, box: box as unknown as Element };
  };
  it('puts back every scrolled box around the one that changes, across the shadow root', () => {
    const { main, track, box } = page();
    // (what WebKit does when a section on screen is swapped for a newly built one)
    const said = keepPlace(box, () => {
      main.scrollTop = 0;
      track.scrollLeft = 0;
      return 'drawn';
    });
    expect([main.scrollTop, track.scrollLeft, said]).toEqual([841, 120, 'drawn']);
  });
  it('puts it back when the redraw throws, and the throw goes on', () => {
    const { main, box } = page();
    expect(() =>
      keepPlace(box, () => {
        main.scrollTop = 0;
        throw new Error('no');
      }),
    ).toThrow('no');
    expect(main.scrollTop).toBe(841);
  });
});
