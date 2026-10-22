// The sheet: a drawer at the bottom of a phone's screen, a dialog in the
// middle of a computer's. It holds a stack of views (go/back), glides to each
// view's height, widens on a desktop for a dense QR code until the code gets
// its pixels, pins a view's own buttons beside ×, and closes by ×, the scrim, a
// pull down on its header, Escape, or the phone's back button (it is a history
// entry). A flow that comes while it is on its way out opens once it is gone.
// Views are built by the flows; this module only moves them.

import { h, ic } from '../dom';
import { BOUNCY, DRAWER, EASE_IN, EASE_OUT, SMOOTH, SOFT, dismisses, play, rubber, unrubber } from '../motion';
import { closeDrop } from './drop';

/** A view: its root, and what the sheet reads from it. */
export interface View {
  el: HTMLElement;
  /** The sheet's accessible name while this view shows (its title). */
  label: string;
  /** A question (Remove, Reconnect): an alert dialog, closed by its Cancel (no ×). */
  asks?: boolean;
  /** Its own buttons, pinned beside × while it shows. */
  acts?: HTMLElement | null;
}
export type ViewFactory = () => View;

let root: HTMLElement;
let scrim: HTMLElement;
let sheetEl: HTMLElement;
let closeBtn: HTMLElement;
let actsEl: HTMLElement;
let scroller: HTMLElement;
let vp: HTMLElement;

let stack: ViewFactory[] = [];
let closed: (() => void) | null = null;
let left: (() => void) | null = null;
/** A flow that came while the sheet was on its way out (an answer after Cancel): it opens once the sheet is gone. */
let next: ViewFactory | null = null;
let ownsHistory = false;
let returnFocus: HTMLElement | null = null;
/** Until then clicks in a sheet just opened are the second half of the double click that opened it. */
let quietUntil = 0;

export const sheetOpen = () => !!root?.classList.contains('open');

/** What runs on `el` and moves one of `props`: stopped or waited for without touching the rest. */
const running = (el: Element, ...props: string[]) =>
  el.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.getKeyframes().some((k) => props.some((p) => p in k)));

/* ---------- width: a dense code scans from a screen at about 3 px a module ---------- */

const SHEET_W = 400;
const QR_PAD = 80;
// 3.2 px a module: 6–7 device pixels on a retina screen, still a sure read for a phone camera.
const PX_PER_MODULE = 3.2;
/** A computer, or a tablet held wide: the sheet is a dialog in the middle (sheet.css), and may widen for a dense code. */
const wide = () => matchMedia('(min-width: 760px)').matches;
let sheetW = SHEET_W;
let shownQr: HTMLElement | null = null;

export interface WidthPlan {
  from: number;
  want: number;
  reveal: HTMLElement | null;
}

/**
 * The width the sheet needs now, set at once so whatever measures the new
 * layout (an accordion) measures it at the final width; the plan then animates
 * there on the same spring (`startWidth`), so nothing snaps. The sheet's own
 * height follows its view through the glide (`glideHeight`).
 */
export function planWidth(): WidthPlan | null {
  if (!root || !sheetOpen()) return null;
  if (!wide()) {
    if (sheetEl.style.maxWidth) sheetEl.style.maxWidth = '';
    sheetW = SHEET_W;
    return null;
  }
  const qr = [...vp.querySelectorAll<HTMLElement>('.qrbox.dense')].find((b) => {
    const row = b.closest('.acc-row');
    return b.offsetWidth && (!row || row.classList.contains('open')) && !b.closest('.leaving');
  });
  let want = SHEET_W;
  if (qr) {
    // The code itself fits the screen; the rest of the sheet may scroll around it.
    const room = Math.min(innerWidth - 32 - QR_PAD, innerHeight - 120);
    want = Math.max(SHEET_W, Math.round(Math.min(+(qr.dataset.mods ?? 0) * PX_PER_MODULE, room) + QR_PAD));
  }
  const reveal = qr && qr !== shownQr ? qr : null;
  shownQr = qr ?? null;
  if (Math.abs(want - sheetW) < 8) return reveal ? { from: want, want, reveal } : null;
  const from = parseFloat(getComputedStyle(sheetEl).maxWidth) || sheetW;
  sheetW = want;
  running(sheetEl, 'maxWidth').forEach((a) => a.cancel());
  sheetEl.style.maxWidth = `${want}px`;
  return { from, want, reveal };
}

export function startWidth(p: WidthPlan | null) {
  if (!p) return;
  if (Math.abs(p.from - p.want) > 1)
    play(sheetEl, [{ maxWidth: `${p.from}px` }, { maxWidth: `${p.want}px` }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
  // The code has to be on screen whole: scroll it into view once the sheet has its size.
  const q = p.reveal;
  if (q)
    setTimeout(() => {
      if (!q.isConnected) return;
      const a = scroller.getBoundingClientRect();
      const b = q.getBoundingClientRect();
      const d = b.bottom > a.bottom - 16 ? b.bottom - a.bottom + 16 : b.top < a.top + 16 ? b.top - a.top - 16 : 0;
      if (d) scroller.scrollBy({ top: d, behavior: 'smooth' });
    }, BOUNCY.duration);
}

/* ---------- the drawer ---------- */

function build() {
  closeBtn = h('button', { type: 'button', class: 'knob x', onclick: () => closeSheet() }, ic('x'));
  actsEl = h('div', { class: 'sheet-acts' });
  vp = h('div', { class: 'vp' });
  scroller = h('div', { class: 'sheet-scroll' }, vp);
  sheetEl = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, closeBtn, actsEl, scroller);
  scrim = h('div', { class: 'scrim', onclick: () => closeSheet() });
  root = h('div', { class: 'sheet-root', 'aria-hidden': 'true' }, scrim, sheetEl);
  // The second click of a double click lands on what the first one opened: the scrim would close the sheet again,
  // a question's button would answer it.
  root.addEventListener(
    'click',
    (e) => {
      if (performance.now() >= quietUntil) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  document.body.appendChild(root);
  // What changes the sheet's width says so itself (a view, a row opening, a code swapped: planWidth); left is the
  // window, a phone turned or a desktop window crossing the dialog's width. Once a frame at most.
  let resizing = 0;
  addEventListener('resize', () => {
    if (!resizing) resizing = requestAnimationFrame(() => ((resizing = 0), startWidth(planWidth())));
  });
  pullToClose();
}

function label(v: View) {
  sheetEl.setAttribute('aria-label', v.label);
  // Built once, named each time: the language may have changed since.
  closeBtn.setAttribute('aria-label', _('Close'));
  sheetEl.setAttribute('role', v.asks ? 'alertdialog' : 'dialog');
  sheetEl.classList.toggle('asks', !!v.asks);
}

/** The view being left (a new one, or the sheet closing) lets go of what it holds. */
function leave() {
  const f = left;
  left = null;
  f?.();
}

/** What the current view holds and must stop (a poll): called when it is left. */
export function onLeave(fn: () => void) {
  left = fn;
}

/** Who is told the sheet changed: a view shown in it, its work done (or not), the sheet gone. */
const watchers: (() => void)[] = [];
/** Told whenever the sheet changes (the demo's state switch: demo/way-pick.ts). */
export const onSheetChange = (fn: () => void) => void watchers.push(fn);
const changed = () => watchers.forEach((f) => f());

/** After this sheet closes (once). */
export function onClosed(fn: () => void) {
  closed = fn;
}

export function openSheet(factory: ViewFactory) {
  if (!root) build();
  closeDrop(true);
  if (root.dataset.closing) {
    // Still on its way out: the new flow opens once it is gone, as it would have a moment later.
    next = factory;
    return;
  }
  leave();
  if (sheetOpen()) {
    // Already open: the new flow takes the place of the old one, history and all.
    stack = [factory];
    swapView(factory());
    return;
  }
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  quietUntil = performance.now() + 320;
  stack = [factory];
  closed = null;
  sheetW = SHEET_W;
  shownQr = null;
  sheetEl.style.maxWidth = '';
  sheetEl.classList.remove('arrived');
  const v = factory();
  vp.replaceChildren(v.el);
  setActs(v, false);
  label(v);
  root.classList.add('open');
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('locked');
  const p0 = planWidth();
  if (p0) startWidth({ ...p0, from: p0.want });
  sheetEl.getAnimations().forEach((a) => a.cancel());
  scrim.getAnimations().forEach((a) => a.cancel());
  sheetEl.style.transform = '';
  // A dialog comes up from its centre the way a ⋯ menu pops (menu.ts), on a softer spring; the drawer rises from the bottom edge.
  if (wide())
    play(
      sheetEl,
      [
        { opacity: 0, transform: 'scale(.9)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'none', filter: 'none' },
      ],
      { duration: SOFT.duration, easing: SOFT.easing },
    );
  else play(sheetEl, [{ transform: 'translateY(calc(100% + 40px))' }, { transform: 'none' }], { duration: 500, easing: DRAWER });
  // The dim behind keeps time with the sheet: with the dialog's pop on a computer, with the drawer's rise on a phone.
  play(
    scrim,
    [{ opacity: 0 }, { opacity: 1 }],
    wide() ? { duration: SOFT.duration, easing: SOFT.easing } : { duration: 420, easing: 'ease-out' },
  );
  if (!ownsHistory) {
    try {
      history.pushState({ sheet: true }, '');
      // The sheet's own entry never moves the page: left behind once the sheet closes, a step forward onto it (Safari's
      // swipe in from the right edge) would put the page back where it stood when the sheet opened.
      history.scrollRestoration = 'manual';
      ownsHistory = true;
    } catch {
      /* no history */
    }
  }
  changed();
}

/** `now`: gone at once (Escape: what the keyboard does never animates). */
export function closeSheet(now = false) {
  if (!sheetOpen()) return;
  if (root.dataset.closing) {
    // Escape while it goes, or the link stopped working: gone at once, and nothing opens after it.
    if (now) {
      next = null;
      gone();
    }
    return;
  }
  leave();
  if (ownsHistory) {
    ownsHistory = false;
    history.back();
  }
  document.body.classList.remove('locked');
  if (now) return gone();
  root.dataset.closing = '1';
  // From where it stands: a dialog still coming up leaves from its present fade, blur and scale.
  const cs = getComputedStyle(sheetEl);
  const at = cs.transform;
  const op = cs.opacity;
  const blur = cs.filter === 'none' ? 'blur(0px)' : cs.filter;
  const dim = getComputedStyle(scrim).opacity;
  running(sheetEl, 'transform', 'opacity').forEach((a) => a.cancel());
  scrim.getAnimations().forEach((a) => a.cancel());
  play(
    scrim,
    [{ opacity: dim }, { opacity: 0 }],
    wide() ? { duration: 120, easing: EASE_IN, fill: 'forwards' } : { duration: 320, easing: 'ease-out', fill: 'forwards' },
  );
  // A dialog goes the way a ⋯ menu does, quick and soft into its centre; the drawer goes down past the edge.
  play(
    sheetEl,
    wide()
      ? [
          { opacity: op, transform: at, filter: blur },
          { opacity: 0, transform: `${at === 'none' ? '' : at} scale(.96)`.trim(), filter: 'blur(3px)' },
        ]
      : [{ transform: at }, { transform: 'translateY(calc(100% + 40px))' }],
    wide() ? { duration: 120, easing: EASE_IN, fill: 'forwards' } : { duration: 420, easing: DRAWER, fill: 'forwards' },
  ).onfinish = gone;
}

/** The sheet is out of the page: emptied, focus back on what opened it, then whatever waited for it. */
function gone() {
  // Nothing a view holds (a poll) outlives the sheet.
  leave();
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
  delete root.dataset.closing;
  sheetEl.style.transform = '';
  scrim.style.opacity = '';
  sheetEl.getAnimations().forEach((a) => a.cancel());
  scrim.getAnimations().forEach((a) => a.cancel());
  vp.replaceChildren();
  actsEl.replaceChildren();
  sheetEl.classList.remove('arrived');
  sheetEl.style.maxWidth = '';
  sheetW = SHEET_W;
  stack = [];
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
  const f = closed;
  closed = null;
  f?.();
  changed();
  const n = next;
  next = null;
  if (n) openSheet(n);
}

/** On the history entry a sheet pushed (openSheet): closing it steps back to the page's own. */
export const onSheetEntry = () => !!(history.state as { sheet?: boolean } | null)?.sheet;

// The phone's back button closes the sheet instead of leaving the page. A sheet's entry is current only while its
// sheet is open: one left behind (a reload with a sheet open, a step forward onto it) is stepped back off at once, so
// Back from there leaves the page instead of putting it back where it stood when that sheet opened.
addEventListener('popstate', () => {
  if (!sheetOpen()) {
    if (onSheetEntry()) history.back();
    return;
  }
  ownsHistory = false;
  closeSheet();
});
if (onSheetEntry()) history.back();

/** A view's own buttons beside ×: pinned with it while the sheet scrolls, they come and go with the view. */
function setActs(v: View, anim = true) {
  const neu = v.acts ?? null;
  const old = actsEl.firstElementChild as HTMLElement | null;
  if (neu === old) return;
  // No motion asked, or the same buttons for a rebuilt view: swapped in place.
  if (!anim || (old && neu && old.dataset.key === neu.dataset.key)) return actsEl.replaceChildren(...(neu ? [neu] : []));
  if (old) {
    Object.assign(old.style, { position: 'absolute', right: '0', top: '0', pointerEvents: 'none' });
    play(
      old,
      [
        { opacity: 1, transform: 'none', filter: 'none' },
        { opacity: 0, transform: 'scale(.9)', filter: 'blur(3px)' },
      ],
      {
        duration: 180,
        easing: 'cubic-bezier(.2,0,0,1)',
        fill: 'forwards',
      },
    ).onfinish = () => old.remove();
  }
  if (neu) {
    actsEl.appendChild(neu);
    play(
      neu,
      [
        { opacity: 0, transform: 'scale(.9)', filter: 'blur(3px)' },
        { opacity: 1, transform: 'none', filter: 'none' },
      ],
      {
        duration: 260,
        delay: 110,
        easing: 'cubic-bezier(.2,0,0,1)',
        fill: 'backwards',
      },
    );
  }
}

/**
 * The viewport glides from `h0`, its height on screen, to its view's: as a gap under the view that closes, or an
 * overhang the viewport clips, so what changes inside meanwhile (a row opening, a fold, a poll) carries the sheet's
 * edge along instead of landing when the glide ends.
 */
function glideHeight(view: Element | null, h0: number, o: KeyframeAnimationOptions) {
  if (!view) return;
  running(view, 'marginBottom').forEach((a) => a.cancel());
  const d = h0 - vp.getBoundingClientRect().height;
  if (Math.abs(d) > 1) play(view, [{ marginBottom: `${d}px` }, { marginBottom: '0px' }], o);
}

/** Another view in the open sheet: the old one fades out over the new one, the sheet glides to its height. */
function swapView(v: View) {
  label(v);
  setActs(v);
  sheetEl.classList.remove('arrived');
  const h0 = vp.getBoundingClientRect().height;
  // What goes stays where it stands on screen while the scroll goes back to the top under it (the viewport clips it);
  // a view already on its way out keeps its own fade.
  const st = scroller.scrollTop;
  const views = [...vp.children] as HTMLElement[];
  const tops = views.map((o) => (o.classList.contains('leaving') ? parseFloat(o.style.top) || 0 : 0) - st);
  const old = views.filter((o) => !o.classList.contains('leaving'));
  // It fades from how it shows: one still coming in (Back right after a step) goes from as far as it came.
  const shown = old.map((o) => {
    const cs = getComputedStyle(o);
    return { opacity: cs.opacity, transform: cs.transform, filter: cs.filter };
  });
  views.forEach((o, i) => {
    o.classList.add('leaving');
    Object.assign(o.style, { position: 'absolute', left: '0', right: '0', top: `${tops[i]}px`, pointerEvents: 'none' });
    o.inert = true;
  });
  vp.appendChild(v.el);
  // A tap that lands where the new view's button appears must not press it.
  v.el.style.pointerEvents = 'none';
  setTimeout(() => (v.el.style.pointerEvents = ''), 320);
  scroller.scrollTop = 0;
  startWidth(planWidth());
  glideHeight(v.el, h0, { duration: 360, easing: 'cubic-bezier(.25,1,.5,1)' });
  old.forEach((o, i) => {
    const prior = o.getAnimations();
    play(o, [shown[i], { opacity: 0, transform: 'scale(.96)', filter: 'blur(2px)' }], {
      duration: 200 * +shown[i].opacity,
      easing: 'cubic-bezier(.2,0,0,1)',
      fill: 'forwards',
    }).onfinish = () => o.remove();
    prior.forEach((a) => a.cancel());
  });
  play(
    v.el,
    [
      { opacity: 0, transform: 'scale(.96)', filter: 'blur(4px)' },
      { opacity: 1, transform: 'none', filter: 'none' },
    ],
    {
      duration: 280,
      delay: 110,
      easing: 'cubic-bezier(.2,0,0,1)',
      fill: 'backwards',
    },
  );
  changed();
}

/** Further into a flow (Add → Open on the device). */
export function go(factory: ViewFactory) {
  if (!sheetOpen() || root.dataset.closing) return openSheet(factory);
  leave();
  stack.push(factory);
  swapView(factory());
}

export function back() {
  if (stack.length < 2 || root.dataset.closing) return;
  leave();
  stack.pop();
  swapView(stack[stack.length - 1]());
}

/**
 * Content inside the open sheet changed: it glides to its new height, what
 * stayed but moved (a block above it grew or shrank) glides to its new place,
 * the changed blocks come into focus.
 */
export function glide(change: () => void, focus: (Element | null | undefined)[] = []) {
  if (!sheetOpen()) return change();
  const view = vp.lastElementChild;
  // As it all stands on screen, the sheet's own glides under way included.
  const was = new Map<Element, DOMRect>();
  view?.querySelectorAll('*').forEach((e) => {
    if (!(e instanceof SVGElement) || e instanceof SVGSVGElement) was.set(e, e.getBoundingClientRect());
  });
  const h0 = vp.getBoundingClientRect().height;
  change();
  startWidth(planWidth());
  glideHeight(view, h0, { duration: SMOOTH.duration, easing: SMOOTH.easing });
  // Measured with the sheet back at its size on screen (its glides have just started): only what moved inside it moves.
  const moved = new Set<Element>();
  for (const [e, r] of was) {
    if (!e.isConnected || !r.width || !r.height) continue;
    const n = e.getBoundingClientRect();
    if (!n.width || !n.height) continue;
    const dx = r.left - n.left;
    const dy = r.top - n.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    moved.add(e);
    // Once, on the outermost that moved: what it holds moves with it.
    let p = e.parentElement;
    while (p && p !== view && !moved.has(p)) p = p.parentElement;
    if (p && p !== view) continue;
    // Added to a glide still under way (a quick second pick), which runs on to its end underneath: both rects held
    // its offset, so this is only the new move, and nothing it had left to go is dropped.
    play(e, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: SMOOTH.duration,
      easing: SMOOTH.easing,
      composite: 'add',
    });
  }
  for (const el of focus)
    if (el)
      play(
        el,
        [
          { opacity: 0, filter: 'blur(4px)' },
          { opacity: 1, filter: 'none' },
        ],
        { duration: 280, easing: EASE_OUT },
      );
}

/**
 * The view's job is done (a device connected): ×, and the view's own buttons, step away. `false`: it turned out
 * not to be (the device left that state): they come back.
 */
export function settle(done = true) {
  sheetEl?.classList.toggle('arrived', done);
  changed();
}

/** The sheet scrolls back to the top (a device connected under a scrolled sheet). */
export const scrollTop = () => scroller?.scrollTo({ top: 0, behavior: 'smooth' });

/** Is this element in the sheet that shows now (not one being swapped out)? */
export const showing = (el: Element) => sheetOpen() && vp.contains(el) && !el.closest('.leaving');

/* ---------- pull down by the header to close ---------- */

/** The dim a pull alone leaves: it fades as the sheet goes down. */
const dimAt = (dy: number) => Math.max(0, 1 - Math.max(0, dy) / 420);

function pullToClose() {
  // `y`: where the finger would stand with the sheet at rest; `y0`: where the sheet was taken; `off`: how far the dim
  // was then from what the pull alone gives (a sheet taken while it still opens).
  let drag: { y: number; t: number; dy: number; v: number; y0: number; off: number } | null = null;
  sheetEl.addEventListener('pointerdown', (e) => {
    const t = e.target as Element;
    if (!t.closest('.vhead') || t.closest('button, a, input')) return;
    // Not while it leaves, nor while a dialog pops up: its fade and blur ride the same animation as its scale.
    if (root.dataset.closing || running(sheetEl, 'opacity').length) return;
    // Taken where it stands (still rising, or settling back from the last pull), and the dim with it.
    const y0 = new DOMMatrixReadOnly(getComputedStyle(sheetEl).transform).m42;
    const o = +getComputedStyle(scrim).opacity;
    running(sheetEl, 'transform').forEach((a) => a.cancel());
    scrim.getAnimations().forEach((a) => a.cancel());
    if (y0) sheetEl.style.transform = `translateY(${y0}px)`;
    if (o !== 1) scrim.style.opacity = String(o);
    const raw = y0 < 0 ? -unrubber(-y0, sheetEl.offsetHeight) : y0;
    drag = { y: e.clientY - raw, t: performance.now(), dy: y0, v: 0, y0, off: o - dimAt(y0) };
    sheetEl.setPointerCapture(e.pointerId);
  });
  sheetEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const raw = e.clientY - drag.y;
    const t = performance.now();
    // Down follows the finger; up resists, more the further it goes.
    const dy = raw > 0 ? raw : -rubber(-raw, sheetEl.offsetHeight);
    drag.v = (dy - drag.dy) / Math.max(1, t - drag.t);
    drag.dy = dy;
    drag.t = t;
    sheetEl.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.min(1, Math.max(0, dimAt(dy) + drag.off)));
  });
  const end = () => {
    if (!drag) return;
    const { dy, v, y0 } = drag;
    drag = null;
    // A touch that never moved (on a sheet still rising) only lets it settle.
    if (dy !== y0 && dismisses(dy, v, sheetEl.offsetHeight)) return closeSheet();
    // Back to rest from where the pull left it, the dim with it on the same spring.
    const from = sheetEl.style.transform;
    const dim = getComputedStyle(scrim).opacity;
    sheetEl.style.transform = '';
    scrim.style.opacity = '';
    const o = { duration: SMOOTH.duration, easing: SMOOTH.easing };
    if (dy !== 0) play(sheetEl, [{ transform: from }, { transform: 'none' }], o);
    if (+dim !== 1) play(scrim, [{ opacity: dim }, { opacity: 1 }], o);
  };
  sheetEl.addEventListener('pointerup', end);
  sheetEl.addEventListener('pointercancel', end);
}

/* ---------- the parts every view is made of ---------- */

/** A view's head: its title (and Back, inside a flow). */
export function head(title: string, o: { back?: boolean; acts?: boolean } = {}): HTMLElement {
  return h(
    'div',
    { class: `vhead${o.back ? ' center' : ''}${o.acts ? ' with-acts' : ''}` },
    o.back ? h('button', { type: 'button', class: 'knob back', 'aria-label': _('Back'), onclick: back }, ic('chevron')) : null,
    h('h2', {}, title),
  );
}

/** The line under a view's title. */
export const sub = (text: string) => h('p', { class: 'vsub' }, text);
/** A small line of help. */
export const hint = (...kids: (Node | string | null)[]) => h('p', { class: 'hint' }, ...kids);
