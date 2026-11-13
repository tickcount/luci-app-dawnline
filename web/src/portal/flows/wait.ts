// Waiting for a new device's first connection, the portal's way: polling its
// own API (one CGI process on the router per ask, so slowly and only while the
// tab is visible) while the set-up sheet is open, reading each answer into the
// way's state (way.ts) for ui/wait-way.ts, which draws the way and moves the
// sheet around it. The admin draws the same way with its own watcher.

import { gone, call } from '../api';
import { now, repaint, setState, type State } from '../state';
import { dropOpen } from '../ui/drop';
import type { Watcher } from '../ui/wait-way';
import { wayState, type WayState } from '../way';

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
      if (!dropOpen()) repaint();
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
export const watchFirstConnection: Watcher = (d, seen, gaveUp) => {
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
};
