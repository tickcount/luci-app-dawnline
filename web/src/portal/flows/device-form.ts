// What a device is and how it connects, as Add a device and Reconnect ask it:
// the kinds as four tiles (phones and tablets are one choice, the same apps and
// the same smaller packets) and LAN Bypass, the whole row a switch.

import type { Kind } from '../../shared/types';
import { netsLabel, pickLabel, pickOf, type KindPick } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import { h } from '../dom';
import { SMOOTH, play } from '../motion';
import { glass } from '../ui/glass';

export const UA = navigator.userAgent;
export const IPAD = /iPad/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);

/** Best guess at the kind of device this page is open on (the browser never tells). */
export function guessKind(): Kind {
  if (IPAD || /Tablet/i.test(UA) || (/Android/.test(UA) && !/Mobile/.test(UA))) return 'tablet';
  if (/Android|iPhone|Mobile/i.test(UA)) return 'phone';
  return 'computer';
}

/** The kind a pick keeps: Mobile is a tablet when this page is open on one, or when the device was one already (`was`). */
export function kindOf(p: KindPick, was?: Kind): Kind {
  if (was && pickOf(was) === p) return was;
  return p !== 'mobile' ? p : guessKind() === 'tablet' ? 'tablet' : 'phone';
}

/**
 * A line in a block opens or folds away: height, opacity and blur on SMOOTH, as the set-up steps fold, from
 * where it is on screen (flicking the switch never snaps). The block's 1 px gap goes with it.
 */
function foldLine(el: HTMLElement, open: boolean) {
  const cs = getComputedStyle(el);
  const from = el.hidden
    ? { h: 0, o: 0, b: 4, m: -1 }
    : {
        h: el.getBoundingClientRect().height,
        o: +cs.opacity,
        b: +(cs.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0),
        m: parseFloat(cs.marginTop) || 0,
      };
  el.getAnimations().forEach((a) => a.cancel());
  el.hidden = false;
  el.style.overflow = 'hidden';
  const to = open ? { h: el.scrollHeight, o: 1, b: 0, m: 0 } : { h: 0, o: 0, b: 4, m: -1 };
  const frame = (v: typeof from) => ({ height: `${v.h}px`, opacity: v.o, filter: v.b ? `blur(${v.b}px)` : 'none', marginTop: `${v.m}px` });
  const a = play(el, [frame(from), frame(to)], { duration: SMOOTH.duration, easing: SMOOTH.easing, fill: 'forwards' });
  a.onfinish = () => {
    el.hidden = !open;
    el.style.overflow = '';
    a.cancel();
  };
}

export interface KindTiles {
  el: HTMLElement;
  /** Ring this one (the ring does not travel between tiles: the picked tile rings itself where it stands). */
  set(k: KindPick): void;
}

/** The kinds a router takes, as tiles; `onPick` on a tap, after the ring moved. */
export function kindTiles(picks: KindPick[], onPick: (k: KindPick) => void): KindTiles {
  const el = h('div', { class: 'kinds', role: 'radiogroup', 'aria-label': _('What is it?') });
  el.style.setProperty('--n', String(picks.length));
  const set = (k: KindPick) =>
    tiles.forEach((t, i) => {
      const on = picks[i] === k;
      t.classList.toggle('on', on);
      t.setAttribute('aria-checked', String(on));
    });
  const tiles = picks.map((k) => {
    const t = h(
      'button',
      {
        type: 'button',
        class: 'kind',
        role: 'radio',
        'aria-label': pickLabel(k),
        onclick: () => {
          set(k);
          onPick(k);
        },
      },
      h('span', { class: 'kind-tile' }, glass(k, 'blue')),
      h('span', { class: 'kind-lbl' }, pickLabel(k)),
    );
    el.appendChild(t);
    return t;
  });
  return { el, set };
}

/**
 * LAN Bypass, the whole row the switch, built as it is (`on`) before it is on
 * the page: nothing slides. With home access the home networks still go into
 * the tunnel: a local network on the same addresses is out of reach, and the
 * row says so while it is on.
 */
export function lanSwitch(on: boolean, home: string[], onChange: (on: boolean) => void): HTMLElement {
  const except = home.length
    ? h('span', { class: 'sw-sub sw-note', hidden: !on }, fmt(_('Except %s: those addresses lead to the home network.'), netsLabel(home)))
    : null;
  const row = h(
    'button',
    {
      type: 'button',
      class: on ? 'swrow on' : 'swrow',
      role: 'switch',
      'aria-checked': String(on),
      onclick: () => {
        on = !on;
        row.classList.toggle('on', on);
        row.setAttribute('aria-checked', String(on));
        if (except) foldLine(except, on);
        onChange(on);
      },
    },
    glass('lan', 'blue'),
    h(
      'span',
      { class: 'sw-t' },
      h('b', {}, _('LAN Bypass')),
      h('span', { class: 'sw-sub' }, _('Your local network stays reachable while connected.')),
      except,
    ),
    h('span', { class: 'sw', 'aria-hidden': 'true' }),
  );
  return row;
}
