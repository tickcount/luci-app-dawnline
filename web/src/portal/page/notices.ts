// What stops the person's devices, said once at the top of the page: paused,
// ended, out of data, outside the hours, the server off or missing, or access
// ending soon. A notice wears its tone (orange or red) in its tint. On a
// repaint it comes, goes or changes in place while its slot glides to its new
// height, so the page under it moves instead of jumping.

import type { Person } from '../../shared/types';
import { daysLeft, date, endsIn, endsSoon } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import { h, put } from '../dom';
import { SMOOTH, play } from '../motion';
import { clockOf, hoursFor } from '../days';
import { state, today } from '../state';
import { glass } from '../ui/glass';
import { appear, morphInto } from '../ui/morph';

export type Tone = 'warn' | 'bad';

export function notice(tone: Tone, icon: string, title: string | null, sub: string): HTMLElement {
  return h(
    'div',
    { class: `notice ${tone}` },
    glass(icon, tone === 'bad' ? 'red' : 'orange'),
    h('div', { class: 't' }, title ? h('b', {}, title) : null, h('span', {}, sub)),
  );
}

/** The admin's hours as the visitor reads them: "08:00–22:00 your time" (or the router's, said so). */
export function hoursText(hours: string): string {
  const hw = hoursFor(hours, state()?.tz_offset, -new Date().getTimezoneOffset());
  if (!hw) return fmt(_('%s (router time)'), hours.replace('-', '–'));
  const span = `${clockOf(hw.from)}–${clockOf(hw.to)}`;
  return fmt(hw.yours ? _('%s your time') : _('%s (router time)'), span);
}

/** Why the person's devices can't connect: icon, a short title, and a line that adds to it (never says it again). */
export function stateNotice(p: Person): [string, string, string] {
  switch (p.state) {
    case 'server_off':
      return ['server', _('Server is disabled'), _('Your devices can’t connect until it’s enabled again.')];
    case 'no_server':
      return ['server', _('No server yet'), _('You haven’t been added to one.')];
    case 'quota':
      return ['chart', _('Out of data'), _('Nothing gets through until it resets.')];
    case 'expired':
      return ['calendar', _('Access ended'), _('Your devices can’t connect until it’s extended.')];
    case 'hours':
      return ['clock', _('Outside your hours'), fmt(_('Open %s.'), hoursText(p.hours))];
    default:
      return ['pause', _('Access paused'), _('Your devices can’t connect until it’s resumed.')];
  }
}

/** The page's notice, or null when nothing stands in the way. */
export function pageNotice(p: Person): HTMLElement | null {
  if (p.state !== 'active') return notice(p.state === 'quota' || p.state === 'expired' ? 'bad' : 'warn', ...stateNotice(p));
  const left = daysLeft(p.expires, today());
  return endsSoon(p, left)
    ? notice('warn', 'calendar', fmt(_('Access %s'), endsIn(left as number)), fmt(_('On %s.'), date(p.expires)))
    : null;
}

/**
 * The page's notice in its slot. On a repaint one that comes blurs in, one that
 * goes fades where it stood, one that changes morphs in place (ui/morph.ts),
 * and the slot glides from its height on screen to the new one (the slot holds
 * the notice's margin and clips it on the way: page.css).
 */
export function fillNotice(slot: HTMLElement, p: Person, repainting: boolean) {
  const n = pageNotice(p);
  if (!repainting) return put(slot, n);
  const h0 = slot.getBoundingClientRect().height;
  // A notice that was there (one fading out lies over the slot, hidden from screen readers).
  const had = !!slot.querySelector(':scope > .notice:not([aria-hidden])');
  slot.getAnimations().forEach((a) => a.cancel());
  morphInto(slot, n);
  if (n && !had) appear(n);
  const h1 = slot.getBoundingClientRect().height;
  if (Math.abs(h1 - h0) > 0.5)
    play(slot, [{ height: `${h0}px` }, { height: `${h1}px` }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
}
