// What stops the person's devices, said once at the top of the page: paused,
// ended, out of data, outside the hours, the server off or missing, or access
// ending soon. A notice wears its tone (orange or red) in its tint.

import type { Person } from '../../shared/types';
import { daysLeft, date, endsIn, endsSoon } from '../../shared/format';
import { h } from '../dom';
import { clockOf, hoursFor } from '../days';
import { state, today } from '../state';
import { glass } from '../ui/glass';

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
  if (!hw) return `${hours.replace('-', '–')} (router time)`;
  return `${clockOf(hw.from)}–${clockOf(hw.to)} ${hw.yours ? 'your time' : '(router time)'}`;
}

/** Why the person's devices can't connect: icon, a short title, and a line that adds to it (never says it again). */
export function stateNotice(p: Person): [string, string, string] {
  switch (p.state) {
    case 'server_off':
      return ['server', 'Server is disabled', 'Your devices can’t connect until it’s enabled again.'];
    case 'no_server':
      return ['server', 'No server yet', 'You haven’t been added to one.'];
    case 'quota':
      return ['chart', 'Out of data', 'Nothing gets through until it resets.'];
    case 'expired':
      return ['calendar', 'Access ended', 'Your devices can’t connect until it’s extended.'];
    case 'hours':
      return ['clock', 'Outside your hours', `Open ${hoursText(p.hours)}.`];
    default:
      return ['pause', 'Access paused', 'Your devices can’t connect until it’s resumed.'];
  }
}

/** The page's notice, or null when nothing stands in the way. */
export function pageNotice(p: Person): HTMLElement | null {
  if (p.state !== 'active') return notice(p.state === 'quota' || p.state === 'expired' ? 'bad' : 'warn', ...stateNotice(p));
  const left = daysLeft(p.expires, today());
  return endsSoon(p, left) ? notice('warn', 'calendar', `Access ${endsIn(left as number)}`, `On ${date(p.expires)}.`) : null;
}
