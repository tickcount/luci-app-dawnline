// A control that a repaint builds anew goes on from where the one it replaces stood. The admin draws a part again
// from data when a choice is made (a staged change, a pick on a track), so the control pressed is another node a
// moment later, and a new node stands in its end state: its pill, its knob, its mark never moved (the owner,
// 2026-11-12: «нужно добавить анимации на компоненты»). Here a control names itself (`key`: one per control on
// screen) and is handed the node it replaces, while that one is still in the page; it starts as that one stood and
// moves to its own state, by its own means (a track stretches its pill, the stylesheet glides a knob or a mark).
//
// Only a control somebody pressed moves this way: a part drawn again in the background has the same state as the
// one it replaces, so there is nothing to go on from.

const last = new Map<string, HTMLElement>();
/** The controls a turn was begun on (one named to carryOn is not turned again as one of its region's). */
const turned = new WeakSet<Element>();

/** `el` is the control `key` now; answers the one it replaces, if that one is still in the page. */
export function replaces<T extends HTMLElement>(key: string, el: T): T | null {
  const was = last.get(key) as T | undefined;
  // a long list names many (a log's rows): those long gone are let go
  if (last.size > 400) for (const [k, e] of last) if (!e.isConnected) last.delete(k);
  last.set(key, el);
  return was && was !== el && was.isConnected ? was : null;
}

/**
 * `el` shows `from` first (set by `put`), and its own state once it is in the page: what the stylesheet glides
 * between the two then runs. It is in the page by the end of the task that builds it, as a rule, and turns there,
 * before anything is painted (a frame of `from` would show a knob that was half way back at its start); built
 * for a later frame, it turns at the next one.
 */
export function turn(el: HTMLElement, from: () => void, to: () => void) {
  turned.add(el);
  from();
  const go = () => {
    // laid out as it began before it turns (a node put in the page this very task has no style to go from yet)
    void el.offsetWidth;
    to();
  };
  queueMicrotask(() => (el.isConnected ? go() : requestAnimationFrame(go)));
}

/**
 * A control that is on or off (the class `on`, `aria-pressed` when it has one): built again by a repaint, it shows
 * what the one it replaces showed, then its own, so the stylesheet's change between the two runs.
 */
export function carryOn<T extends HTMLElement>(key: string, el: T, on: boolean): T {
  const was = replaces(key, el);
  const show = (v: boolean) => {
    el.classList.toggle('on', v);
    if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', String(v));
  };
  if (was && was.classList.contains('on') !== on)
    turn(
      el,
      () => show(!on),
      () => show(on),
    );
  return el;
}

// The same for a whole region, without a name given to each control. On a page that stands still (the admin) a
// press stages a change and the region is drawn again at once, in the same task as the press: the switch pressed
// is another node before its knob has moved at all, and stood at its end from the first frame (the owner,
// 2026-11-12: «у чекбоксов/свитчей нет больше анимаций как на портале»). So each on/off control of the new
// region is paired with the one of the old region that has its name, and goes on from it.

const CONTROLS = '[role="switch"], [role="radio"], [role="checkbox"], [aria-pressed]';
const ARIA = ['aria-checked', 'aria-pressed'] as const;
/** What a control shows of its state: the class `on`, and the ARIA state it has. */
type Shown = [on: boolean, ...aria: (string | null)[]];
const shown = (el: Element): Shown => [el.classList.contains('on'), ...ARIA.map((a) => el.getAttribute(a))];
function show(el: Element, [on, ...aria]: Shown) {
  el.classList.toggle('on', on);
  // (only the states it has: a switch is never given `aria-pressed`)
  ARIA.forEach((a, i) => el.hasAttribute(a) && aria[i] != null && el.setAttribute(a, aria[i]));
}
/** The other state of `s`. */
const other = ([on, ...aria]: Shown): Shown => [!on, ...aria.map((v) => (v === 'true' ? 'false' : v === 'false' ? 'true' : v))];
/** A control's name among its region's: its kind and its title's words (not the line under, which may say its state). */
const nameOf = (el: Element): string =>
  `${el.getAttribute('role') ?? el.tagName}:${(el.getAttribute('aria-label') ?? el.querySelector('b')?.textContent ?? el.textContent ?? '').trim()}`;

/** When a control showed its new state by itself, at the press. */
const flipped = new WeakMap<Element, number>();
/**
 * `el` shows its new state now, by itself, before the change is asked for (a switch moves its knob at the press):
 * a region drawn again while the knob is on its way lets the new switch go on with the move.
 */
export const flippedNow = (el: Element): void => void flipped.set(el, performance.now());
/** A move begun this long ago is over (the longest a control's own state takes, with room). */
const OVER = 700;

/**
 * The on/off controls of `next` (a region about to take the place of `was`, which is still in the page) go on from
 * those they replace. One that shows another state than the old one did starts as the old one stood and turns to
 * its own (a press that only asked for the change). One that shows the same, while the old one was still on its
 * way there (a switch moves its knob at the press, then asks), starts from the other state and is put as far into
 * the move as the old one was, so the move goes on, not again.
 */
export function carryControls(was: ParentNode, next: readonly Node[]) {
  const old = new Map<string, Element[]>();
  for (const o of was.querySelectorAll(CONTROLS)) old.set(nameOf(o), [...(old.get(nameOf(o)) ?? []), o]);
  if (!old.size) return;
  for (const root of next) {
    if (!(root instanceof HTMLElement)) continue;
    for (const n of [...(root.matches(CONTROLS) ? [root] : []), ...root.querySelectorAll<HTMLElement>(CONTROLS)]) {
      const o = old.get(nameOf(n))?.shift();
      if (!o || turned.has(n)) continue;
      const own = shown(n);
      const stood = shown(o);
      if (own.some((v, i) => v != null && stood[i] != null && v !== stood[i])) {
        turn(
          n,
          () => show(n, stood),
          () => show(n, own),
        );
        continue;
      }
      const since = flipped.get(o);
      if (since == null || performance.now() - since > OVER) continue;
      turn(
        n,
        () => show(n, other(own)),
        () => {
          show(n, own);
          // (reading them brings the styles up to date: the moves just begun are among them)
          for (const a of n.getAnimations({ subtree: true })) if (a instanceof CSSTransition) a.currentTime = performance.now() - since;
        },
      );
    }
  }
}
