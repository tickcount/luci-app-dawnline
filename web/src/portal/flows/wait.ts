// Waiting for a new device's first connection: the way from the device to the
// server and what it says in each state (waiting, can't finish, connected, no
// data: way.ts reads them off the router's answer), the polling behind it, and
// the sheet around it keeping pace. Connected, the way fills green and its line
// morphs into "<device> connected", × and the sheet's buttons step away,
// everything under the way folds shut and the sheet closes by itself onto the
// page; any other state undoes that. What sits under the way in each state is
// the view's (setup-view.ts hands it over as `Around`).

import type { Device } from '../../shared/types';
import { fmt } from '../../shared/i18n';
import { gone, call } from '../api';
import { h, ic } from '../dom';
import { EASE_IN, EASE_OUT, calm, play } from '../motion';
import { now, repaint, setState, type State } from '../state';
import { menuOpen } from '../ui/menu';
import { morphText, setText, textOf } from '../ui/morph';
import { closeSheet, onClosed, scrollTop, settle, showing } from '../ui/sheet';
import { wayState, type WayState } from '../way';

export interface Way {
  el: HTMLElement;
  /** Show this state: its look, its line morphing, the line under it gliding in or out or changing in place. */
  set(st: WayState): void;
  /** Ten minutes and nothing: the light goes out, and the way says so. */
  gaveUp(): void;
}

/** The way's line and the one under it (empty: none) in a state. */
function lines(st: WayState, d: Device): [string, string] {
  switch (st) {
    case 'trying':
      return [_('Unable to complete the handshake'), _('Your network may be blocking the connection.')];
    case 'connected':
      return [fmt(_('%s connected'), d.name), ''];
    case 'nodata':
      return [_('Handshake complete, but no data'), _('This device is using an outdated configuration.')];
    case 'waiting':
      return [_('Waiting for the connection'), ''];
  }
}

/** The way's class in a state (setup.css). */
const LOOK: Record<WayState, string> = { waiting: '', trying: 'trying', connected: 'done', nodata: 'nodata' };

export function waitWay(d: Device): Way {
  const line = h('b', {}, _('Waiting for the connection'));
  const more = h('span', { class: 'ws', hidden: true });
  const t = h('span', { class: 't' }, line, more);
  const text = h('div', { class: 'way-text' }, t);
  // The light's two loops (running, knocking) and the break at the router run all along, each showing in its own
  // state (setup.css): a change of state cross-fades them where they stand instead of starting one over.
  const track = h(
    'span',
    { class: 'way-track' },
    h('span', { class: 'way-glow' }, h('span', { class: 'run' }, h('i')), h('span', { class: 'knock' }, h('i'))),
    h('span', { class: 'way-fill' }),
    h('span', { class: 'way-break' }, h('i')),
  );
  const el = h(
    'div',
    { class: 'way', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'way-row' }, h('span', { class: 'way-end' }, ic(d.kind)), track, h('span', { class: 'way-end home' }, ic('server'))),
    text,
  );

  // The lines sit centred in their block: when the second comes or goes, the block's height and the lines' place
  // glide together (a FLIP of the lines), so the first never jumps to its new centre. `from` and `top`: the block's
  // height and the lines' top on screen before the change.
  const glide = (from: number, top: number) => {
    text.getAnimations().forEach((a) => a.cancel());
    t.getAnimations().forEach((a) => a.cancel());
    const to = text.offsetHeight;
    text.style.overflow = '';
    if (from !== to) {
      text.style.overflow = 'hidden';
      play(text, [{ height: `${from}px` }, { height: `${to}px` }], { duration: 340, easing: EASE_OUT }).onfinish = () => {
        text.style.overflow = '';
      };
    }
    // Measured with the block held at its old height (its glide has just started), the sheet around it at its old
    // size too: the lines start exactly where they stood, however the sheet is anchored and however they centre.
    const dy = top - t.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5) play(t, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 340, easing: EASE_OUT });
  };
  /** Where the line under it shows its words on screen (mid-morph, the words it is turning into). */
  const words = () => {
    const r = document.createRange();
    r.selectNodeContents(more.querySelector(':scope > .mt-new') ?? more);
    return r.getBoundingClientRect();
  };
  // The line under it comes, goes and changes without the block snapping: in, it blurs in as the block opens; out,
  // it blurs away first, then the block closes; another in its place, the words blur from the old into the new
  // where they stand as the block glides to the new one's height. A fade under way turns round from where it is.
  let says = '';
  let hiding = 0;
  const second = (why: string) => {
    if (why === says) return;
    says = why;
    clearTimeout(hiding);
    const shown = !more.hidden;
    const cs = getComputedStyle(more);
    const cur = { opacity: cs.opacity, filter: cs.filter };
    if (!why) {
      if (!shown) return;
      more.getAnimations().forEach((a) => a.cancel());
      play(more, [cur, { opacity: 0, filter: 'blur(4px)' }], { duration: 180, easing: EASE_OUT, fill: 'forwards' });
      hiding = window.setTimeout(() => {
        const from = text.offsetHeight;
        const top = t.getBoundingClientRect().top;
        more.hidden = true;
        more.getAnimations().forEach((a) => a.cancel());
        glide(from, top);
      }, 170);
      return;
    }
    const from = text.offsetHeight;
    const top = t.getBoundingClientRect().top;
    if (!shown) {
      setText(more, why);
      more.hidden = false;
      glide(from, top);
      play(
        more,
        [
          { opacity: 0, filter: 'blur(4px)' },
          { opacity: 1, filter: 'none' },
        ],
        { duration: 300, easing: EASE_OUT, delay: 60, fill: 'backwards' },
      );
      return;
    }
    // The old words go from where they stand now, placed against the block as the glide holds it on its first frame.
    const was = textOf(more);
    const at = words();
    setText(more, why);
    glide(from, top);
    morphText(more, why, was, { whole: true, at });
    more.getAnimations().forEach((a) => a.cancel());
    if (+cur.opacity < 1) play(more, [cur, { opacity: 1, filter: 'none' }], { duration: 300, easing: EASE_OUT });
  };
  const packets = (on: boolean) => {
    // Those on their way out are not counted: back to no data while they fade, a fresh pair sets off.
    const pk = track.querySelectorAll<HTMLElement>('.way-pkt:not(.out)');
    if (on) {
      // Two, half a loop apart: one is always on its way.
      if (!pk.length) track.append(h('span', { class: 'way-pkt' }), h('span', { class: 'way-pkt b' }));
      return;
    }
    // Each fades where it is, falling on (a fade from script wins over its loop's own opacity), then goes.
    pk.forEach((p) => {
      p.classList.add('out');
      const o = getComputedStyle(p).opacity;
      play(p, [{ opacity: o }, { opacity: 0 }], { duration: 200, easing: EASE_IN, fill: 'forwards' }).onfinish = () => p.remove();
    });
  };
  return {
    el,
    set(st) {
      el.classList.remove('trying', 'nodata', 'done', 'stopped');
      if (LOOK[st]) el.classList.add(LOOK[st]);
      const [a, b] = lines(st, d);
      morphText(line, a);
      second(b);
      packets(st === 'nodata');
    },
    gaveUp() {
      el.classList.remove('trying', 'nodata', 'done');
      el.classList.add('stopped');
      packets(false);
      morphText(line, _('No connection yet'));
      second(_('Close this and open it again to keep checking.'));
    },
  };
}

/**
 * The first connection was seen before the agent's watcher marked the device
 * online, a second at most: ask again shortly, a few times, and repaint the
 * page with the answer, so the card goes on to "Connected" instead of staying
 * on "Last connected just now".
 */
function catchUp(id: string, tries = 4) {
  window.setTimeout(async () => {
    try {
      const st = await call<State>('state');
      setState(st);
      if (!menuOpen()) repaint();
      if (!st.person.devices.find((x) => x.id === id)?.online && tries > 1) catchUp(id, tries - 1);
    } catch {
      /* a hiccup: the page keeps the last answer, as on load */
    }
  }, 1500);
}

/** The open set-up sheets' polls, for pollNow(). */
const pokes = new Set<() => void>();

/** Run the open set-up sheet's poll now instead of at its next turn (the demo, once its state switch moved). */
export function pollNow() {
  pokes.forEach((p) => p());
}

/**
 * Poll the device being set up while its sheet is open: 5 s at first, then
 * slower, for ten minutes at most (then `gaveUp`, unless it is connected: the
 * sheet is closing by itself), not while the tab is hidden (every poll is a
 * process on the router), and never again once the link stopped working.
 * `seen` gets each new state of the way. Returns the stop function.
 */
export function watchFirstConnection(d: Device, seen: (st: WayState) => void, gaveUp: () => void): () => void {
  // The states count from this sheet (router clock): way.ts.
  const opened = now();
  let timer = 0;
  let polls = 0;
  let done = false;
  let last: WayState = 'waiting';
  const started = Date.now();
  const poll = async () => {
    timer = 0;
    if (done) return;
    if (last !== 'connected' && Date.now() - started > 600_000) {
      done = true;
      gaveUp();
      return;
    }
    if (document.hidden) return schedule();
    try {
      const st = await call<State>('state');
      setState(st);
      // Left while it asked: the answer is the page's, not this sheet's any more.
      if (done) return;
      const dev = st.person.devices.find((x) => x.id === d.id);
      const next = wayState(dev, opened);
      if (next !== last) {
        if (next === 'connected' && dev && !dev.online) catchUp(d.id);
        last = next;
        seen(next);
      }
    } catch (e) {
      if (gone(e)) {
        done = true;
        return;
      }
    }
    polls++;
    schedule();
  };
  const schedule = () => {
    if (!done && !timer) timer = window.setTimeout(poll, polls < 6 ? 5000 : polls < 12 ? 15000 : 30000);
  };
  const onVisible = () => {
    if (!document.hidden && !done && !timer) void poll();
  };
  const poke = () => {
    if (done) return;
    if (timer) clearTimeout(timer);
    void poll();
  };
  document.addEventListener('visibilitychange', onVisible);
  pokes.add(poke);
  schedule();
  return () => {
    done = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    pokes.delete(poke);
  };
}

/** What the sheet around the way is made of (setup-view.ts). */
export interface Around {
  /** The line under the sheet's title. */
  sub: HTMLElement;
  /** Everything under the way. */
  rest: HTMLElement;
  /** Give what is under the way its shape for this state, at once (the glide is here); false: nothing changed. */
  shape(st: WayState): boolean;
}

/** Blocks folded away, held at nothing until they come back. */
const folded = new WeakSet<Element>();

/**
 * Fold a block away (its height and margins to nothing, blurring out) or bring
 * it back, from wherever it stands now: a fold turned round half-way never jumps.
 * With less motion it fades out and then is gone, its space with it (or comes
 * back at once and fades in): nothing travels, and nothing keeps a blank band.
 */
function fold(el: HTMLElement, away: boolean, duration: number) {
  if (folded.has(el) === away) return;
  if (away) folded.add(el);
  else folded.delete(el);
  if (calm()) {
    el.getAnimations().forEach((a) => a.cancel());
    if (!away) {
      el.hidden = false;
      play(el, [{ opacity: 0 }, { opacity: 1 }], { duration });
      return;
    }
    play(el, [{ opacity: 1 }, { opacity: 0 }], { duration, fill: 'forwards' }).onfinish = () => {
      if (folded.has(el)) el.hidden = true;
    };
    return;
  }
  el.hidden = false;
  const cs = getComputedStyle(el);
  const cur = {
    height: `${el.getBoundingClientRect().height}px`,
    marginTop: cs.marginTop,
    marginBottom: cs.marginBottom,
    opacity: cs.opacity,
    filter: cs.filter,
  };
  el.getAnimations().forEach((a) => a.cancel());
  const own = getComputedStyle(el);
  const to = away
    ? { height: '0px', marginTop: '0px', marginBottom: '0px', opacity: 0, filter: 'blur(4px)' }
    : {
        height: `${el.getBoundingClientRect().height}px`,
        marginTop: own.marginTop,
        marginBottom: own.marginBottom,
        opacity: 1,
        filter: 'none',
      };
  el.style.overflow = 'hidden';
  play(el, [cur, to], { duration, easing: EASE_OUT, fill: away ? 'forwards' : 'none' }).onfinish = () => {
    if (!away) el.style.overflow = '';
  };
}

/** The way's own gap to what is under it (18 px, setup.css) goes with it, and comes back with it. */
function gap(way: HTMLElement, away: boolean) {
  const from = getComputedStyle(way).marginBottom;
  way.getAnimations().forEach((a) => a.cancel());
  const to = away ? '0px' : getComputedStyle(way).marginBottom;
  play(way, [{ marginBottom: from }, { marginBottom: to }], { duration: 520, easing: EASE_OUT, fill: away ? 'forwards' : 'none' });
}

/** What is under the way takes another shape: it glides to its new height, and what came in blurs in. */
function reshape(a: Around, st: WayState) {
  const rest = a.rest;
  // From where it stands on screen (a glide under way included) to its new height.
  const h0 = rest.getBoundingClientRect().height;
  if (!a.shape(st)) return;
  rest.getAnimations().forEach((x) => x.cancel());
  const h1 = rest.getBoundingClientRect().height;
  rest.style.overflow = 'hidden';
  play(rest, [{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 420, easing: EASE_OUT }).onfinish = () => {
    rest.style.overflow = '';
  };
  play(
    rest,
    [
      { opacity: 0.4, filter: 'blur(2px)' },
      { opacity: 1, filter: 'none' },
    ],
    { duration: 320, easing: EASE_OUT },
  );
}

/** What the sheet does as the wait goes on (follow). */
export interface Following {
  /** A new state of the way. */
  seen(st: WayState): void;
  /** Ten minutes and nothing (watchFirstConnection). */
  gaveUp(): void;
}

/**
 * The sheet keeps pace with the way. Connected: × and the buttons beside it
 * step away, the sheet goes back up to the way if it was scrolled, everything
 * under the way folds shut with the way's gap to it, and after two seconds to
 * read it the sheet closes by itself onto the page, the card ringing green. Any
 * other state undoes that (× comes back, what folded unfolds) and gives what is
 * under the way its shape. The subtitle says what setting up takes, so it shows
 * only while waiting: once the device is heard from, or the wait gives up, it
 * folds away, the way then right under the head.
 */
export function follow(d: Device, way: Way, a: Around): Following {
  let shut = false;
  let timers: number[] = [];
  const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
  const seen = (st: WayState) => {
    timers.forEach(clearTimeout);
    timers = [];
    way.set(st);
    fold(a.sub, st !== 'waiting', 380);
    settle(st === 'connected');
    if (st === 'connected') {
      scrollTop();
      later(400, () => {
        if (!showing(way.el)) return;
        shut = true;
        fold(a.rest, true, 520);
        gap(way.el, true);
        // Reading time, not motion: the same with less motion.
        later(2400, () => {
          // Only this sheet: not one the visitor went on to.
          if (!showing(way.el)) return;
          onClosed(() => repaint({ flash: d.id }));
          closeSheet();
        });
      });
      return;
    }
    if (!shut) return reshape(a, st);
    // Folded while it was connected: it unfolds straight into its new shape.
    shut = false;
    a.shape(st);
    fold(a.rest, false, 520);
    gap(way.el, false);
  };
  return {
    seen,
    gaveUp() {
      fold(a.sub, true, 380);
      way.gaveUp();
    },
  };
}
