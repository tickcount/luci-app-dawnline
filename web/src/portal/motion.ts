// Portal motion: the moves between two states the DOM alone would snap
// between — a sheet's height following its content, cards that changed place
// after a repaint, a pane swapped for another, a sheet pulled down, a copy
// button saying it worked. This module measures and starts them; the curves,
// durations and every one-shot keyframe live in portal.css ("Motion").
//
// Everything checks `calm()` (prefers-reduced-motion) and then only fades.
// The pure decisions (rubber band, when a pull dismisses) are exported for tests.

/** The visitor asked for less motion: fades only, nothing travels. */
export const calm = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The curves of portal.css, for animations started from script. */
const EASE = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  in: 'cubic-bezier(0.55, 0, 1, 0.45)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
};

/**
 * A block inside a sheet animating its own height: the sheet's edge follows it
 * frame by frame on its own, so followHeight holds off meanwhile (a count:
 * several such blocks may move at once).
 */
function hold(el: Element): () => void {
  const panel = el.closest<HTMLElement>('.sheet-panel');
  if (!panel) return () => undefined;
  panel.dataset.hold = String(+(panel.dataset.hold ?? 0) + 1);
  return () => {
    const n = +(panel.dataset.hold ?? 1) - 1;
    if (n > 0) panel.dataset.hold = String(n);
    else delete panel.dataset.hold;
  };
}

/** Distance past an edge → how far it actually goes: resistance grows with the pull. */
export function rubber(dist: number, dim: number): number {
  return dist <= 0 || dim <= 0 ? 0 : (1 - 1 / ((dist * 0.55) / dim + 1)) * dim;
}

/**
 * Does a pulled sheet go away? A flick down (px/ms, as Vaul) or a pull past a
 * third of its height does; a flick back up keeps it, however far it went.
 */
export function dismisses(dy: number, velocity: number, height: number): boolean {
  if (dy <= 0 || velocity < -0.1) return false;
  return velocity > 0.4 || dy > height / 3;
}

/** A height change takes longer the further it goes, inside the house range. */
export const morphMs = (dist: number): number => Math.round(Math.min(380, Math.max(220, 200 + dist * 0.35)));

/** Restart a one-shot CSS animation class on an element that already had it. */
export function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/**
 * Keep `panel`'s size following `content`: whatever changes inside (a tab, a
 * fold, a whole new sheet), the panel eases from the height it shows to the new
 * one instead of jumping. Interruptible: a change mid-way starts from where it
 * is. A width change (a window resize) only records, unless the panel asked for
 * it (`data-morph="width"`: a question turning into a sheet), and then width
 * and height morph together. Returns the stop.
 */
export function followHeight(panel: HTMLElement, content: HTMLElement): () => void {
  let lastH = 0,
    lastW = 0,
    widthToo = false;
  let anim: Animation | null = null;
  const ro = new ResizeObserver(() => {
    // Something inside moves its own height (hold): only keep up with the size.
    if (panel.dataset.hold) {
      anim?.cancel();
      panel.classList.remove('morphing', 'morphing-w');
      lastH = panel.offsetHeight;
      lastW = panel.offsetWidth;
      return;
    }
    const cs = getComputedStyle(panel);
    const shownH = anim ? parseFloat(cs.height) : lastH;
    const shownW = anim ? parseFloat(cs.width) : lastW;
    anim?.cancel();
    // Measure the natural size: without the uncapped width of a morph still under way.
    panel.classList.remove('morphing', 'morphing-w');
    const h = panel.offsetHeight,
      w = panel.offsetWidth;
    // Asked now, or still on its way from an earlier ask.
    const asked = panel.dataset.morph === 'width' || widthToo;
    delete panel.dataset.morph;
    const resized = lastW !== 0 && w !== lastW;
    lastH = h;
    lastW = w;
    if (!shownH || calm() || (resized && !asked)) return;
    const dh = Math.abs(h - shownH),
      dw = asked ? Math.abs(w - shownW) : 0;
    if (dh < 2 && dw < 2) return;
    widthToo = dw >= 2;
    panel.classList.add('morphing');
    panel.classList.toggle('morphing-w', widthToo);
    const a = panel.animate(
      widthToo
        ? [
            { height: `${shownH}px`, width: `${shownW}px` },
            { height: `${h}px`, width: `${w}px` },
          ]
        : [{ height: `${shownH}px` }, { height: `${h}px` }],
      { duration: morphMs(Math.max(dh, dw)), easing: EASE.out },
    );
    anim = a;
    const done = () => {
      if (anim !== a) return;
      anim = null;
      widthToo = false;
      panel.classList.remove('morphing', 'morphing-w');
    };
    a.onfinish = done;
    a.oncancel = done;
  });
  ro.observe(content);
  return () => ro.disconnect();
}

/**
 * Swap `box`'s content for `next`: the old content fades out where it was
 * (lifted out of the flow, so the box already takes the new height) while the
 * new one comes in. `dir` -1 / 1: the new content comes from the left / right.
 */
export function swap(box: HTMLElement, next: Node[], dir = 0) {
  const old = [...box.childNodes];
  if (!old.length || !box.isConnected) {
    box.replaceChildren(...next);
    return;
  }
  // The ghost lays the old content out as the box did, over the box's padding edge.
  const cs = getComputedStyle(box);
  const ghost = document.createElement('div');
  ghost.className = 'ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, {
    display: cs.display === 'flex' ? 'flex' : 'block',
    flexDirection: cs.flexDirection,
    alignItems: cs.alignItems,
    gap: cs.gap,
    top: cs.paddingTop,
    left: cs.paddingLeft,
    right: cs.paddingRight,
  });
  ghost.append(...old);
  box.replaceChildren(ghost, ...next);
  // The old content drops away fast (it sits under the new one, see .ghost) so the two never read together.
  const still = calm();
  const out = ghost.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: still ? 'none' : `translateX(${-dir * 8}px)` },
    ],
    { duration: 120, easing: EASE.out, fill: 'forwards' },
  );
  const drop = () => ghost.remove();
  out.onfinish = drop;
  out.oncancel = drop;
  for (const n of next)
    if (n instanceof HTMLElement)
      n.animate(
        still
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: `translate(${dir * 12}px, ${dir ? 0 : 6}px)`, filter: 'blur(4px)' },
              { opacity: 1, transform: 'none', filter: 'blur(0)' },
            ],
        { duration: still ? 160 : 280, delay: 50, easing: EASE.out, fill: 'backwards' },
      );
}

/** Play an element's way out before it is removed (it keeps its place until then). */
export function leave(el: Element | null | undefined): Promise<void> {
  if (!el || !el.isConnected) return Promise.resolve();
  const a = el.animate(
    calm()
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
          { opacity: 0, transform: 'scale(0.96)', filter: 'blur(4px)' },
        ],
    { duration: 200, easing: EASE.in, fill: 'forwards' },
  );
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** A beat between the steps of a sequence; none when the visitor asked for less motion. */
export const beat = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, calm() ? 0 : ms));

/**
 * The accordion's look: the height closes on the drawer curve over `ms`; the
 * content dissolves faster, from the start, as blocks leave elsewhere (blur, a
 * small rise and shrink, on the strong ease-out over `contentMs`).
 */
const FOLD = { ms: 520, contentMs: 300, blur: 4, drift: 6, scale: 0.98 };

/**
 * Fold a block shut like an accordion and take it out: its height closes from
 * the bottom edge (the sheet's edge comes with it) while its content dissolves
 * into a blur. Less motion: it fades.
 */
export async function fold(el: HTMLElement): Promise<void> {
  if (!el.isConnected) return;
  const release = hold(el);
  const gap = parseFloat(getComputedStyle(el.parentElement as HTMLElement).rowGap) || 0;
  const h = el.offsetHeight;
  el.style.overflow = 'hidden';
  el.style.transformOrigin = '50% 0';
  el.inert = true;
  const done = () => undefined;
  if (calm())
    await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: EASE.out, fill: 'forwards' }).finished.then(done, done);
  else {
    el.animate(
      [
        { opacity: 1, filter: 'blur(0px)', transform: 'none' },
        { opacity: 0, filter: `blur(${FOLD.blur}px)`, transform: `translateY(${-FOLD.drift}px) scale(${FOLD.scale})` },
      ],
      { duration: FOLD.contentMs, easing: EASE.out, fill: 'forwards' },
    );
    await el
      .animate(
        [
          { height: `${h}px`, marginTop: '0px' },
          { height: '0px', marginTop: `${-gap}px` },
        ],
        { duration: FOLD.ms, easing: EASE.drawer, fill: 'forwards' },
      )
      .finished.then(done, done);
  }
  el.remove();
  release();
}

/**
 * The opposite, for a line that just got something to say: it opens from no
 * height to its own (the sheet's edge comes with it) and comes into focus.
 */
export function grow(el: HTMLElement) {
  if (!el.isConnected || calm()) return replay(el, 'swap');
  const release = hold(el);
  const gap = parseFloat(getComputedStyle(el.parentElement as HTMLElement).rowGap) || 0;
  const h = el.offsetHeight;
  el.style.overflow = 'hidden';
  const a = el.animate(
    [
      { height: '0px', marginTop: `${-gap}px`, opacity: 0, filter: 'blur(4px)' },
      { height: `${h}px`, marginTop: '0px', opacity: 1, filter: 'blur(0px)' },
    ],
    { duration: 380, easing: EASE.drawer },
  );
  const end = () => {
    el.style.overflow = '';
    release();
  };
  a.onfinish = end;
  a.oncancel = end;
}

/**
 * The page's first paint: the blocks matching `selector` rise in, in reading
 * order (top to bottom, then left to right, whatever the layout), at most
 * eight steps apart. portal.css draws `.intro`; `--i` is the step.
 */
export function intro(root: ParentNode, selector: string) {
  const els = [...root.querySelectorAll<HTMLElement>(selector)].map((el) => ({ el, r: el.getBoundingClientRect() }));
  els.sort((a, b) => Math.round(a.r.top - b.r.top) || a.r.left - b.r.left);
  els.forEach(({ el }, i) => {
    el.style.setProperty('--i', String(Math.min(i, 8)));
    el.classList.add('intro');
  });
}

/** Where the keyed blocks of a page are and what its keyed values say, before a repaint. */
export interface Snap {
  at: Map<string, { x: number; y: number }>;
  text: Map<string, string>;
}

export function snap(root: ParentNode): Snap {
  const at = new Map<string, { x: number; y: number }>();
  const text = new Map<string, string>();
  root.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
    const r = el.getBoundingClientRect();
    at.set(el.dataset.key as string, { x: r.left + scrollX, y: r.top + scrollY });
  });
  root.querySelectorAll<HTMLElement>('[data-v]').forEach((el) => text.set(el.dataset.v as string, el.textContent ?? ''));
  return { at, text };
}

/**
 * After a repaint: a keyed block that moved glides from where it was (FLIP),
 * one that is new rises in, a keyed value that changed comes into focus.
 * Keyed blocks are never nested, so no move is counted twice.
 */
export function settle(root: ParentNode, before: Snap) {
  const still = calm();
  root.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
    const was = before.at.get(el.dataset.key as string);
    if (!was) {
      el.classList.add('enter');
      return;
    }
    if (still) return;
    const r = el.getBoundingClientRect();
    const dx = was.x - (r.left + scrollX),
      dy = was.y - (r.top + scrollY);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: morphMs(Math.hypot(dx, dy)),
      easing: EASE.out,
    });
  });
  root.querySelectorAll<HTMLElement>('[data-v]').forEach((el) => {
    const was = before.text.get(el.dataset.v as string);
    if (was != null && was !== el.textContent) el.classList.add('swap');
  });
}

/**
 * A repaint of a sheet's content that keeps its motion: keyed controls
 * (`data-m`) that flipped on or off get `to-on` / `to-off`, whose keyframes
 * start from the other look; one whose text changed comes into focus (`swap`);
 * one marked `data-glide` that moved within its parent (a chip beside a chevron
 * that went) glides there.
 */
export function restyle(root: ParentNode, paint: () => void) {
  const state = (el: Element) => el.classList.contains('on') || el.classList.contains('open');
  // What it says: its text, or `data-sig` where the text says nothing (a QR code).
  const says = (el: HTMLElement) => el.dataset.sig ?? el.textContent ?? '';
  const inParent = (el: HTMLElement) => {
    const r = el.getBoundingClientRect(),
      p = (el.parentElement as HTMLElement).getBoundingClientRect();
    return { x: r.left - p.left, y: r.top - p.top };
  };
  const before = new Map<string, { on: boolean; says: string }>();
  root.querySelectorAll<HTMLElement>('[data-m]').forEach((el) => before.set(el.dataset.m as string, { on: state(el), says: says(el) }));
  const placed = new Map<string, { x: number; y: number }>();
  root.querySelectorAll<HTMLElement>('[data-glide]').forEach((el) => placed.set(el.dataset.glide as string, inParent(el)));
  paint();
  if (!calm())
    root.querySelectorAll<HTMLElement>('[data-glide]').forEach((el) => {
      const was = placed.get(el.dataset.glide as string);
      if (!was) return;
      const now = inParent(el);
      const dx = was.x - now.x,
        dy = was.y - now.y;
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1)
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 280, easing: EASE.out });
    });
  root.querySelectorAll<HTMLElement>('[data-m]').forEach((el) => {
    const was = before.get(el.dataset.m as string);
    if (!was) return;
    if (was.on !== state(el)) el.classList.add(state(el) ? 'to-on' : 'to-off');
    else if (was.says !== says(el)) el.classList.add('swap');
  });
}

/** A copy button in its "Copied" moment: what to put back, and when. */
const COPIED = new WeakMap<HTMLElement, { timer: number; icon: string | null; label: string | null }>();

/**
 * A copy button says it worked where the finger is: its icon turns into a
 * check and a "Copy" label into "Copied", for a moment. Other labels (a host
 * name on a chip) stay. `check` is the check icon's markup.
 */
export function copied(btn: HTMLElement | null | undefined, check: string) {
  if (!btn) return;
  const icon = btn.querySelector<HTMLElement>('.ic');
  const label =
    btn.querySelector<HTMLElement>('.badge-main') ??
    btn.querySelector<HTMLElement>(':scope > span:not(.ic)') ??
    (btn.children.length ? null : btn);
  const was = COPIED.get(btn) ?? { timer: 0, icon: icon?.innerHTML ?? null, label: label?.textContent ?? null };
  clearTimeout(was.timer);
  const says = !!label && (label.classList.contains('badge-main') || /^copy$/i.test(was.label ?? ''));
  const show = (svg: string | null, text: string | null) => {
    if (icon && svg != null && icon.innerHTML !== svg) {
      icon.innerHTML = svg;
      replay(icon, 'swap-ic');
    }
    if (label && says && text != null && label.textContent !== text) {
      label.textContent = text;
      replay(label, 'swap');
    }
  };
  show(check, 'Copied');
  btn.classList.add('copied');
  was.timer = window.setTimeout(() => {
    COPIED.delete(btn);
    btn.classList.remove('copied');
    show(was.icon, was.label);
  }, 1600);
  COPIED.set(btn, was);
}

/** A button waiting for the router: after a beat (no flash on a quick answer) a spinner takes the label's place. */
export function busy(btn: HTMLElement): () => void {
  const t = window.setTimeout(() => btn.classList.add('busy'), 250);
  return () => {
    clearTimeout(t);
    btn.classList.remove('busy');
  };
}

/**
 * Let a bottom sheet be pulled down by its grab bar and head (a question: all of it): the panel
 * follows the finger (with resistance upwards), the scrim fades with it, and
 * on release it either goes (`close`) or springs back. Only while `bottom()`
 * (the sheet sits at the bottom: phones). The release transitions start from
 * the dragged spot because the inline transform and `.dragging` go together.
 */
export function pullToClose(panel: HTMLElement, scrim: HTMLElement, close: () => void, bottom: () => boolean) {
  panel.addEventListener('pointerdown', (e) => {
    const t = e.target as Element;
    if (!bottom() || e.button !== 0 || !t.closest('.grab, .sheet-head, .ask') || t.closest('button, a, input')) return;
    const y0 = e.clientY,
      h = panel.offsetHeight;
    let dy = 0;
    const trail: { t: number; y: number }[] = [{ t: e.timeStamp, y: e.clientY }];
    try {
      panel.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer the browser no longer tracks: the pull still follows while it is over the panel */
    }
    panel.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      const raw = ev.clientY - y0;
      dy = raw < 0 ? -rubber(-raw, h) : raw;
      panel.style.transform = `translateY(${dy}px)`;
      scrim.style.opacity = String(1 - Math.max(0, dy) / h);
      trail.push({ t: ev.timeStamp, y: ev.clientY });
      while (trail.length > 2 && ev.timeStamp - trail[0].t > 100) trail.shift();
    };
    const up = (ev: PointerEvent) => {
      panel.removeEventListener('pointermove', move);
      panel.removeEventListener('pointerup', up);
      panel.removeEventListener('pointercancel', up);
      const first = trail[0],
        last = trail[trail.length - 1];
      const v = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      panel.classList.remove('dragging');
      panel.style.transform = '';
      scrim.style.opacity = '';
      if (ev.type === 'pointerup' && dismisses(dy, v, h)) close();
    };
    panel.addEventListener('pointermove', move);
    panel.addEventListener('pointerup', up);
    panel.addEventListener('pointercancel', up);
  });
}
