// Waiting for a new device's first connection: the way from the device to the
// server (a light runs along it while the page waits), the polling behind it,
// and what happens when it comes: the way fills green and its line morphs into
// "<device> connected", the sheet's buttons step away, the steps fold shut,
// and the sheet closes by itself onto the page.

import type { Device } from '../../shared/types';
import { fmt } from '../../shared/i18n';
import { gone, call } from '../api';
import { h, ic } from '../dom';
import { EASE_OUT, play } from '../motion';
import { now, repaint, setState, type State } from '../state';
import { menuOpen } from '../ui/menu';
import { morphText } from '../ui/morph';
import { closeSheet, onClosed, scrollTop, settle, showing } from '../ui/sheet';

export interface Way {
  el: HTMLElement;
  connected(): void;
  gaveUp(): void;
}

export function waitWay(d: Device): Way {
  const line = h('b', {}, _('Waiting for the connection'));
  const more = h('span', { class: 'ws', hidden: true });
  const el = h(
    'div',
    { class: 'way', role: 'status', 'aria-live': 'polite' },
    h(
      'div',
      { class: 'way-row' },
      h('span', { class: 'way-end' }, ic(d.kind)),
      h('span', { class: 'way-track' }, h('span', { class: 'way-glow' }, h('i')), h('span', { class: 'way-fill' })),
      h('span', { class: 'way-end home' }, ic('server')),
    ),
    h('div', { class: 'way-text' }, h('span', { class: 't' }, line, more)),
  );
  return {
    el,
    connected() {
      el.classList.add('done');
      morphText(line, fmt(_('%s connected'), d.name));
    },
    gaveUp() {
      el.classList.add('stopped');
      morphText(line, _('No connection yet'));
      more.textContent = _('Close this and open it again to keep checking.');
      more.hidden = false;
      play(
        line.parentElement!,
        [
          { opacity: 0, filter: 'blur(4px)' },
          { opacity: 1, filter: 'none' },
        ],
        { duration: 280, easing: EASE_OUT },
      );
    },
  };
}

/**
 * The first connection was seen (a fresh handshake) before the agent's watcher
 * marked the device online, a second at most: ask again shortly, a few times,
 * and repaint the page with the answer, so the card goes on to "Connected"
 * instead of staying on "Last connected just now".
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

/**
 * Poll for the first connection of a device that never connected: 5 s at
 * first, then slower, for ten minutes at most (then `gaveUp`), not while the
 * tab is hidden (every poll is a process on the router), and never again once
 * the link stopped working. `arrived` runs once. Returns the stop function.
 */
export function watchFirstConnection(d: Device, arrived: () => void, gaveUp: () => void): () => void {
  // The first connection is a handshake newer than this sheet (router clock), not `online`:
  // that follows the agent's watcher, which can lag the handshake by a poll, and a device
  // set up again with new keys still reports the last handshake of its old ones.
  const opened = now();
  let timer = 0;
  let polls = 0;
  let done = false;
  const started = Date.now();
  const poll = async () => {
    timer = 0;
    if (done) return;
    if (Date.now() - started > 600_000) {
      done = true;
      gaveUp();
      return;
    }
    if (document.hidden) return schedule();
    try {
      const st = await call<State>('state');
      setState(st);
      const dev = st.person.devices.find((x) => x.id === d.id);
      if (dev && dev.handshake > opened) {
        done = true;
        arrived();
        if (!dev.online) catchUp(d.id);
        return;
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
  document.addEventListener('visibilitychange', onVisible);
  schedule();
  return () => {
    done = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

const beat = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The first connection arrived. The way fills green and says so (the sheet
 * goes back up to it if it was scrolled), the buttons beside × step away; then
 * everything under the way, which did its job, folds shut. Two seconds to read
 * it, and the sheet closes by itself onto the page, the card ringing green.
 */
export async function arrive(way: Way, rest: HTMLElement, d: Device) {
  way.connected();
  settle();
  scrollTop();
  await beat(400);
  if (!showing(way.el)) return;
  rest.style.overflow = 'hidden';
  play(
    rest,
    [
      { height: `${rest.offsetHeight}px`, opacity: 1, filter: 'none' },
      { height: '0px', opacity: 0, filter: 'blur(4px)' },
    ],
    {
      duration: 520,
      easing: EASE_OUT,
      fill: 'forwards',
    },
  );
  play(way.el, [{ marginBottom: '18px' }, { marginBottom: '0px' }], { duration: 520, easing: EASE_OUT, fill: 'forwards' });
  // Reading time, not motion: the same with less motion.
  await beat(2400);
  // Only this sheet: not one the visitor went on to.
  if (!showing(way.el)) return;
  onClosed(() => repaint({ flash: d.id }));
  closeSheet();
}
