// A box given its next children without the page losing its place.
//
// `replaceChildren()` empties the box and fills it again. Nothing is painted in between, but the engine may lay the
// page out there, find it shorter than its scroll position and clamp it: on an iPhone a press in Settings, which
// draws its section again, sent the page to its top. Two things in WebKit do it; Chromium does neither.
//
// The node that holds the focus leaving the document is one. So the new nodes are put in first, each where it
// belongs, and what has no place any more is taken out after; a node that stays is not taken out and put back (it
// keeps its focus, its scroll and its running animations; one that only changes place is moved in one step where
// the browser can, `moveBefore`, else re-inserted).
//
// The other needs no emptying at all. A section that is on screen, swapped for a newly built one of the same
// height (the chips of «What it installs» build theirs again on a press), puts the page's scroll position at zero,
// though the page is never shorter. It takes a new node whose styles answer the page's container queries: the
// same node taken out and put back does not do it, nor a bare box of the same height, nor the same swap with
// `container-type` switched off on the page. What WebKit does there is not known; that the position can be read
// before and put back after, in the same task, is. So that is done, for every scrolled box around this one, and
// nothing of the pass in between is ever painted.

/**
 * Where every scrolled box around `box` stands (shadow roots crossed, the document's own scroller last), and the
 * way back there. Reading lays the page out as it is; putting back lays it out as it will be.
 */
function held(box: Element): () => void {
  if (typeof ShadowRoot === 'undefined') return () => undefined;
  const at: [Element, number, number][] = [];
  let n: Node | null = box;
  while (n) {
    if (n instanceof ShadowRoot) n = n.host;
    else {
      if (n instanceof Element && (n.scrollTop || n.scrollLeft)) at.push([n, n.scrollTop, n.scrollLeft]);
      n = n.parentNode;
    }
  }
  return () => {
    for (const [el, top, left] of at) {
      if (el.scrollTop !== top) el.scrollTop = top;
      if (el.scrollLeft !== left) el.scrollLeft = left;
    }
  };
}

/**
 * The page stays where it is scrolled to while `fn` changes what is in `box`. For a redraw that takes nodes out
 * before it comes to `putChildren`: a list that builds its next groups around the cards it keeps has moved them,
 * and with them the button just pressed, out of the page by then (the people's cards: «Extend and resume» at the
 * list's end left the page a few screens up, in WebKit).
 */
export function keepPlace<T>(box: Element, fn: () => T): T {
  const back = held(box);
  try {
    return fn();
  } finally {
    back();
  }
}

/** `box` holds exactly `next`, in this order. */
export function putChildren(box: Element, next: readonly (Node | string)[]) {
  const nodes = next.map((n) => (typeof n === 'string' ? new Text(n) : n));
  const back = held(box);
  const stays = new Set<Node>(nodes);
  const move = typeof Element !== 'undefined' && 'moveBefore' in Element.prototype;
  let at: ChildNode | null = box.firstChild;
  for (const n of nodes) {
    // what leaves is passed over: it is taken out once everything new stands
    while (at && !stays.has(at)) at = at.nextSibling;
    if (n === at) {
      at = at.nextSibling;
      continue;
    }
    if (move && n.parentNode === box) (box as Element & { moveBefore(node: Node, child: Node | null): void }).moveBefore(n, at);
    else box.insertBefore(n, at);
  }
  // (a copy of the list: it changes as nodes leave)
  for (const c of Array.from(box.childNodes)) if (!stays.has(c)) c.remove();
  back();
}
