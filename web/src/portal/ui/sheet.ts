// The sheet: one drawer floating at the bottom of the screen, on phones and
// desktops alike. It holds a stack of views (go/back), glides to each view's
// height, widens on a desktop for a dense QR code until the code gets its
// pixels, pins a view's own buttons beside ×, and closes by ×, the scrim, a
// pull down on its header, Escape, or the phone's back button (it is a history
// entry). Views are built by the flows; this module only moves them.

import { h, ic } from '../dom';
import { BOUNCY, DRAWER, EASE_IN, EASE_OUT, SMOOTH, SOFT, dismisses, play, rubber } from '../motion';
import { closeMenu } from './menu';

/** A view: its root, and what the sheet reads from it. */
export interface View {
  el: HTMLElement;
  /** The sheet's accessible name while this view shows (its title). */
  label: string;
  /** A question (Remove, Reconnect): an alert dialog. */
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
let ownsHistory = false;
let returnFocus: HTMLElement | null = null;

export const sheetOpen = () => !!root?.classList.contains('open');

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
 * layout (an accordion, the height glide) measures it at the final width; the
 * plan then animates there on the same spring (`startWidth`), so nothing snaps.
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
  sheetEl
    .getAnimations()
    .filter((a) => (a.effect as KeyframeEffect | null)?.getKeyframes().some((k) => 'maxWidth' in k))
    .forEach((a) => a.cancel());
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
  closeBtn = h('button', { type: 'button', class: 'knob x', 'aria-label': 'Close', onclick: () => closeSheet() }, ic('x'));
  actsEl = h('div', { class: 'sheet-acts' });
  vp = h('div', { class: 'vp' });
  scroller = h('div', { class: 'sheet-scroll' }, vp);
  sheetEl = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, closeBtn, actsEl, scroller);
  scrim = h('div', { class: 'scrim', onclick: () => closeSheet() });
  root = h('div', { class: 'sheet-root', 'aria-hidden': 'true' }, scrim, sheetEl);
  document.body.appendChild(root);
  new ResizeObserver(() => startWidth(planWidth())).observe(vp);
  pullToClose();
}

function label(v: View) {
  sheetEl.setAttribute('aria-label', v.label);
  sheetEl.setAttribute('role', v.asks ? 'alertdialog' : 'dialog');
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

/** After this sheet closes (once). */
export function onClosed(fn: () => void) {
  closed = fn;
}

export function openSheet(factory: ViewFactory) {
  if (!root) build();
  closeMenu(true);
  leave();
  if (sheetOpen()) {
    // Already open: the new flow takes the place of the old one, history and all.
    stack = [factory];
    swapView(factory());
    return;
  }
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      ownsHistory = true;
    } catch {
      /* no history */
    }
  }
}

/** `now`: gone at once (Escape: what the keyboard does never animates). */
export function closeSheet(now = false) {
  if (!sheetOpen() || root.dataset.closing) return;
  leave();
  if (ownsHistory) {
    ownsHistory = false;
    history.back();
  }
  document.body.classList.remove('locked');
  const done = () => {
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    delete root.dataset.closing;
    sheetEl.style.transform = '';
    scrim.style.opacity = '';
    sheetEl.getAnimations().forEach((a) => a.cancel());
    scrim.getAnimations().forEach((a) => a.cancel());
    vp.getAnimations().forEach((a) => a.cancel());
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
  };
  if (now) return done();
  root.dataset.closing = '1';
  const from = getComputedStyle(sheetEl).transform;
  sheetEl.getAnimations().forEach((a) => a.cancel());
  play(
    scrim,
    [{ opacity: getComputedStyle(scrim).opacity }, { opacity: 0 }],
    wide() ? { duration: 120, easing: EASE_IN, fill: 'forwards' } : { duration: 320, easing: 'ease-out', fill: 'forwards' },
  );
  const at = from === 'none' ? 'none' : from;
  // A dialog goes the way a ⋯ menu does, quick and soft into its centre; the drawer goes down past the edge.
  play(
    sheetEl,
    wide()
      ? [
          { opacity: 1, transform: at, filter: 'blur(0px)' },
          { opacity: 0, transform: `${at === 'none' ? '' : at} scale(.96)`.trim(), filter: 'blur(3px)' },
        ]
      : [{ transform: at }, { transform: 'translateY(calc(100% + 40px))' }],
    wide() ? { duration: 120, easing: EASE_IN, fill: 'forwards' } : { duration: 420, easing: DRAWER, fill: 'forwards' },
  ).onfinish = done;
}

// The phone's back button closes the sheet instead of leaving the page.
addEventListener('popstate', () => {
  if (!sheetOpen()) return;
  ownsHistory = false;
  closeSheet();
});

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

/** Another view in the open sheet: the old one fades out over the new one, the sheet glides to its height. */
function swapView(v: View) {
  label(v);
  setActs(v);
  sheetEl.classList.remove('arrived');
  const old = [...vp.children] as HTMLElement[];
  const h0 = vp.getBoundingClientRect().height;
  vp.getAnimations().forEach((a) => a.cancel());
  old.forEach((o) => {
    o.classList.add('leaving');
    Object.assign(o.style, { position: 'absolute', left: '0', right: '0', top: '0', pointerEvents: 'none' });
    o.inert = true;
  });
  vp.appendChild(v.el);
  // A tap that lands where the new view's button appears must not press it.
  v.el.style.pointerEvents = 'none';
  setTimeout(() => (v.el.style.pointerEvents = ''), 320);
  scroller.scrollTop = 0;
  const plan = planWidth();
  const h1 = v.el.getBoundingClientRect().height;
  play(vp, [{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 360, easing: 'cubic-bezier(.25,1,.5,1)' });
  startWidth(plan);
  old.forEach(
    (o) =>
      (play(
        o,
        [
          { opacity: 1, transform: 'none', filter: 'none' },
          { opacity: 0, transform: 'scale(.96)', filter: 'blur(2px)' },
        ],
        {
          duration: 200,
          easing: 'cubic-bezier(.2,0,0,1)',
          fill: 'forwards',
        },
      ).onfinish = () => o.remove()),
  );
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
}

/** Further into a flow (Add → Open on the device). */
export function go(factory: ViewFactory) {
  if (!sheetOpen()) return openSheet(factory);
  leave();
  stack.push(factory);
  swapView(factory());
}

export function back() {
  if (stack.length < 2) return;
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
  const h0 = vp.getBoundingClientRect().height;
  vp.getAnimations().forEach((a) => a.cancel());
  const view = vp.lastElementChild;
  const was = new Map<Element, DOMRect>();
  view?.querySelectorAll('*').forEach((e) => {
    if (!(e instanceof SVGElement) || e instanceof SVGSVGElement) was.set(e, e.getBoundingClientRect());
  });
  change();
  const plan = planWidth();
  const h1 = vp.getBoundingClientRect().height;
  if (Math.abs(h1 - h0) > 1) play(vp, [{ height: `${h0}px` }, { height: `${h1}px` }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
  startWidth(plan);
  // Measured with the sheet back at its old size (its glides have just started): only what moved inside it moves.
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
    play(e, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
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

/** The view's job is done (a device connected): ×, and the view's own buttons, step away. */
export function settle() {
  sheetEl?.classList.add('arrived');
}

/** The sheet scrolls back to the top (a device connected under a scrolled sheet). */
export const scrollTop = () => scroller?.scrollTo({ top: 0, behavior: 'smooth' });

/** Is this element in the sheet that shows now (not one being swapped out)? */
export const showing = (el: Element) => sheetOpen() && vp.contains(el) && !el.closest('.leaving');

/* ---------- pull down by the header to close ---------- */

function pullToClose() {
  let drag: { y: number; t: number; dy: number; v: number } | null = null;
  sheetEl.addEventListener('pointerdown', (e) => {
    const t = e.target as Element;
    if (!t.closest('.vhead') || t.closest('button, a, input')) return;
    drag = { y: e.clientY, t: performance.now(), dy: 0, v: 0 };
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
    scrim.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / 420));
  });
  const end = () => {
    if (!drag) return;
    const { dy, v } = drag;
    drag = null;
    if (dismisses(dy, v, sheetEl.offsetHeight)) return closeSheet();
    const from = sheetEl.style.transform;
    sheetEl.style.transform = '';
    scrim.style.opacity = '';
    if (dy !== 0) play(sheetEl, [{ transform: from }, { transform: 'none' }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
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
    o.back ? h('button', { type: 'button', class: 'knob back', 'aria-label': 'Back', onclick: back }, ic('chevron')) : null,
    h('h2', {}, title),
  );
}

/** The line under a view's title. */
export const sub = (text: string) => h('p', { class: 'vsub' }, text);
/** A small line of help. */
export const hint = (...kids: (Node | string | null)[]) => h('p', { class: 'hint' }, ...kids);
