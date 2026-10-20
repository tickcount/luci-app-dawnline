// "Your devices": a card per device (the one this page is open on first, then
// by state), the card to add one, and the count. A repaint keeps the grid:
// cards that stay glide to their new places, a new one pops in, one that just
// connected rings green for a moment. What a card's buttons start lives in
// flows/.

import type { Device, Person } from '../../shared/types';
import { addDays, ago, byDeviceState, parseDay } from '../../shared/format';
import { fmt, locale, num, plural } from '../../shared/i18n';
import { h, ic } from '../dom';
import { BOUNCY, EASE_IN, EASE_OUT, SMOOTH, play } from '../motion';
import { now, today, type RepaintOpts, type State } from '../state';
import { bars, sumDays, upDown } from '../ui/bars';
import { copy } from '../ui/feedback';
import { glass } from '../ui/glass';
import { openMenu, type MenuItem } from '../ui/menu';
import { morphChanged, morphText, setText, textsOf } from '../ui/morph';
import { startAdd } from '../flows/add';
import { reconnect, removeDevice, rename } from '../flows/device-actions';
import { openSetup } from '../flows/setup-view';

/** The home network can open connections to it: home access, active, and the device on. */
export const reachableFromHome = (p: Person, d: Device) => p.access !== 'internet' && p.state === 'active' && !d.disabled;

/** The status line: its class and words (short, on one line; the full wording shows on hover). */
function statusOf(d: Device, p: Person): [string, string] {
  if (d.disabled) return ['', _('Disabled')];
  // The Update pill beside it says what to do.
  if (d.config_stale && d.handshake) return ['warn-t', _('Settings changed')];
  // Over the data limit or outside the hours the tunnel stays up but passes nothing: the app says
  // "connected", so say here why nothing works.
  if (d.online && p.state === 'quota') return ['warn-t', _('Connected, no data left')];
  if (d.online && p.state === 'hours') return ['warn-t', _('Connected, outside your hours')];
  if (d.online) return ['ok-t', _('Connected')];
  if (!d.handshake) return ['warn-t', _('Not set up yet')];
  return ['', fmt(_('Last connected %s'), ago(d.handshake, now()))];
}

function menuItems(d: Device, st: State): (MenuItem | null)[] {
  return [
    // How devices at home reach it: only where the router actually lets them through.
    ...(reachableFromHome(st.person, d)
      ? [
          { label: _('Copy IP address'), icon: 'copy', run: () => copy(d.address, _('IP address copied')) },
          ...(d.hostname ? [{ label: _('Copy local address'), icon: 'home', run: () => copy(d.hostname, _('Address copied')) }] : []),
          null,
        ]
      : []),
    // A device the admin turned off can't be renamed, set up again or removed here (the router refuses).
    ...(d.disabled
      ? []
      : [
          { label: _('Rename'), icon: 'edit', run: () => rename(d) },
          { label: _('Reconnect'), icon: 'refresh', tone: 'warn' as const, run: () => reconnect(d) },
          { label: _('Remove'), icon: 'trash', tone: 'bad' as const, run: () => removeDevice(d) },
        ]),
  ];
}

/** "Today", "Yesterday", "Tue 13 Oct": a spark bar's day, on the router's calendar. */
function dayName(back: number): string {
  if (back === 0) return _('Today');
  if (back === 1) return _('Yesterday');
  return parseDay(addDays(today(), -back)).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Last 7 days down and up over their bars; a day under the pointer puts its own numbers in their place. */
function usage(d: Device, stale: boolean): HTMLElement {
  const week = sumDays(d.spark);
  const lbl = h('span', { class: 'use-lbl' }, _('Last 7 days'));
  const val = upDown(d.id);
  val.set(week);
  let side: HTMLElement;
  if (stale)
    side = h(
      'button',
      {
        type: 'button',
        class: 'upd-pill',
        'aria-label': _('Update the connection'),
        title: _('Its settings changed: update the connection'),
        onclick: () => reconnect(d),
      },
      ic('refresh'),
      h('span', {}, _('Update')),
    );
  else {
    const chart = bars(d.spark, 'bars-week', 34);
    side = chart.el;
    chart.cols.forEach((col, i) => {
      const back = d.spark.length - 1 - i;
      // What the pointer reads off the bars changes at once: no morph while it moves.
      col.addEventListener('pointerenter', () => {
        setText(lbl, dayName(back));
        val.set(d.spark[i]);
      });
      col.addEventListener('pointerleave', () => {
        setText(lbl, _('Last 7 days'));
        val.set(week);
      });
    });
  }
  return h('div', { class: 'dev-use' }, h('div', { class: 'use-txt' }, lbl, h('span', { class: 'use-val' }, val.el)), side);
}

function card(d: Device, st: State): HTMLElement {
  const p = st.person;
  const locked = !!st.locked;
  // The device this page was opened from (through the tunnel): it is connected, so say which one it is instead.
  const here = st.here === d.id;
  const [cls, words] = here ? ['here-t', _('This device')] : statusOf(d, p);
  const setUp = !d.handshake && !d.disabled;
  const stale = d.config_stale && !setUp && !locked && !d.disabled;
  // On one line; the exact time, or the whole wording, on hover.
  const title =
    !here && d.handshake && !d.online && !d.disabled && !d.config_stale
      ? new Date(d.handshake * 1000).toLocaleString(locale())
      : stale
        ? _('Settings changed, update needed')
        : words;
  const items = menuItems(d, st);
  const more =
    locked || !items.length
      ? null
      : h(
          'button',
          {
            type: 'button',
            class: 'knob more',
            'aria-label': fmt(_('%s options'), d.name),
            'aria-haspopup': 'menu',
            'aria-expanded': 'false',
          },
          ic('more'),
        );
  more?.addEventListener('click', () => openMenu(more, items));
  return h(
    'article',
    { class: `dev${here ? ' is-here' : ''}${d.disabled ? ' off' : ''}`, 'data-id': d.id },
    h(
      'div',
      { class: 'dev-top' },
      glass(d.kind, here ? 'blue' : 'grey'),
      h(
        'div',
        { class: 'dev-id' },
        h('span', { class: 'dev-name', 'data-t': `${d.id}:name` }, d.name),
        h('span', { class: `dev-stat ${cls}`, title, 'data-t': `${d.id}:stat` }, words),
      ),
      more,
    ),
    // Stopped by the admin: a device never set up has nothing to show.
    setUp && locked
      ? null
      : setUp
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn tint block setup-btn',
              'aria-label': fmt(_('Set up %s'), d.name),
              onclick: (ev: Event) => openSetup(d, ev.currentTarget),
            },
            ic('qr'),
            h('span', {}, _('Connect')),
          )
        : usage(d, stale),
  );
}

/** Nothing yet: one card that says what comes, with the button. */
const firstCard = (mobile: boolean) =>
  h(
    'div',
    { class: 'dev first', 'data-id': 'first' },
    glass('plus', 'blue'),
    h('b', {}, _('Add your first device')),
    h('p', {}, _('Two steps, about a minute: get the app, then add the connection.')),
    h(
      'button',
      { type: 'button', class: 'btn accent block', onclick: startAdd },
      ic('plus'),
      h('span', {}, mobile ? _('Add this phone') : _('Add this device')),
    ),
  );

const addCard = () =>
  h('button', { type: 'button', class: 'dev add', 'data-id': 'add', onclick: startAdd }, glass('plus'), h('span', {}, _('Add device')));

/** The section, built once; `fill` puts the cards in. */
export function devicesSection(): HTMLElement {
  return h(
    'section',
    { class: 'devices', id: 'devices', 'aria-label': _('Your devices') },
    h('div', { class: 'sec-head' }, h('h2', {}, _('Your devices')), h('span', { class: 'aside num' })),
    h('div', { class: 'dgrid' }),
    h('p', { class: 'note-s limit', hidden: true }),
  );
}

/** The cards for this state, moving from where they were. */
export function fillDevices(section: HTMLElement, st: State, o: RepaintOpts = {}) {
  const p = st.person;
  const grid = section.querySelector('.dgrid') as HTMLElement;
  // A repaint (not the first paint, which brings everything in): what newly shows comes in too.
  const repainting = grid.childElementCount > 0;
  const first = new Map([...grid.querySelectorAll<HTMLElement>('[data-id]')].map((c) => [c.dataset.id, c.getBoundingClientRect()]));
  // What each card said (a name, its status, its week): what changed morphs from it once the cards are in place.
  const said = textsOf(grid);
  // The device this page was opened from comes first.
  const order = byDeviceState(p.devices).sort((a, b) => Number(b.id === st.here) - Number(a.id === st.here));
  const cards = order.map((d) => card(d, st));
  const free = st.locked ? 0 : Math.max(0, p.device_limit - p.devices.length);
  const mobile = matchMedia('(max-width: 959px)').matches || /Android|iPhone|iPad/.test(navigator.userAgent);
  if (!p.devices.length && free) cards.push(firstCard(mobile));
  // Paused or ended: the router refuses a new device, so there is no card to offer one (the notice says why).
  else if (st.can_add && !st.locked) cards.push(addCard());
  grid.classList.toggle('empty', !p.devices.length);
  grid.replaceChildren(...cards);
  for (const c of cards) {
    const f = first.get(c.dataset.id);
    const l = c.getBoundingClientRect();
    if (c.dataset.id === o.pop)
      play(
        c,
        [
          { opacity: 0, transform: 'scale(.9)', filter: 'blur(6px)' },
          { opacity: 1, transform: 'none', filter: 'none' },
        ],
        {
          duration: BOUNCY.duration,
          easing: BOUNCY.easing,
        },
      );
    else if (f && (f.left !== l.left || f.top !== l.top))
      play(c, [{ transform: `translate(${f.left - l.left}px, ${f.top - l.top}px)` }, { transform: 'none' }], {
        duration: SMOOTH.duration,
        easing: SMOOTH.easing,
      });
    // New on a repaint (Add device once a slot frees up): it comes in the way a removed card leaves, a beat after.
    else if (!f && repainting)
      play(
        c,
        [
          { opacity: 0, transform: 'scale(.9)', filter: 'blur(6px)' },
          { opacity: getComputedStyle(c).opacity, transform: 'none', filter: 'none' },
        ],
        {
          duration: SMOOTH.duration,
          delay: 60,
          easing: SMOOTH.easing,
          fill: 'backwards',
        },
      );
    if (c.dataset.id === o.flash)
      c.animate([{ boxShadow: 'inset 0 0 0 1.5px var(--ok)' }, { boxShadow: 'inset 0 0 0 1.5px transparent' }], {
        duration: 1800,
        easing: 'ease-out',
      });
  }
  if (repainting) morphChanged(grid, said);
  const count = section.querySelector('.sec-head .aside') as HTMLElement;
  const n = fmt(_('%s of %s'), num(p.devices.length), num(p.device_limit));
  if (repainting) morphText(count, n);
  else count.textContent = n;
  // The admin may add devices past the limit.
  count.classList.toggle('warn-t', p.devices.length > p.device_limit);
  const limit = section.querySelector('.limit') as HTMLElement;
  const was = limit.hidden;
  const hide = st.can_add || !!st.locked;
  limit.textContent = plural(
    p.device_limit,
    'You have reached your limit of %s device. Remove one to add another.',
    'You have reached your limit of %s devices. Remove one to add another.',
  );
  limit.getAnimations().forEach((a) => a.cancel());
  // A slot freed: the note fades the way it came, then leaves the layout.
  if (repainting && !was && hide) {
    const a = play(
      limit,
      [
        { opacity: 1, filter: 'none' },
        { opacity: 0, filter: 'blur(4px)' },
      ],
      { duration: 200, easing: EASE_IN, fill: 'forwards' },
    );
    a.onfinish = () => {
      limit.hidden = true;
      a.cancel();
    };
  } else {
    limit.hidden = hide;
    if (repainting && was && !hide)
      play(
        limit,
        [
          { opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'none', filter: 'none' },
        ],
        { duration: 420, easing: EASE_OUT },
      );
  }
}
