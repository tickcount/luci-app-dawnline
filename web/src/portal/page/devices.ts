// "Your devices": a card per device (the one this page is open on first, then
// by state), the card to add one, and the count. A repaint keeps the grid:
// cards that stay glide to their new places and heights (Connect turned into
// the week crosses where it stands), a new one pops in, one that just
// connected rings green for a moment. What a card's buttons start lives in
// flows/.

import type { Device, LinkState, Person } from '../../shared/types';
import { addDays, ago, byDeviceState, parseDay } from '../../shared/format';
import { fmt, locale, num, plural } from '../../shared/i18n';
import { h, ic } from '../dom';
import { BOUNCY, EASE_IN, EASE_OUT, SMOOTH, calm, play } from '../motion';
import { now, today, type RepaintOpts, type State } from '../state';
import { bars, sumDays, upDown } from '../ui/bars';
import { copy } from '../ui/feedback';
import { glass } from '../ui/glass';
import { openMenu, type MenuItem } from '../ui/menu';
import { appear, fadeAway, look, morphChanged, morphText, setText, textsOf, type Look } from '../ui/morph';
import { startAdd } from '../flows/add';
import { reconnect, removeDevice } from '../flows/device-actions';
import { renameOnCard } from '../flows/rename';
import { openSetup } from '../flows/setup-view';

/** The home network can open connections to it: home access, active, and the device on. */
export const reachableFromHome = (p: Person, d: Device) => p.access !== 'internet' && p.state === 'active' && !d.disabled;

/** A link failing in a named way (the router's watcher held it 3 minutes): the card's line, and why. */
function linkWords(s: LinkState): [string, string] {
  switch (s) {
    case 'trying':
      return [
        _('Can’t finish connecting'),
        _('It reaches the router, but the connection never completes. The network may be blocking it.'),
      ];
    case 'dropped':
      return [_('Connected, but no data'), _('The router can’t use what it sends: reconnect it.')];
    case 'shared':
      return [
        _('On two devices at once'),
        _('This connection is on two devices and they push each other out. Add the other one as its own device.'),
      ];
    case 'unstable':
      return [_('Connection keeps dropping'), _('It connects, but the connection breaks every few minutes. Another network may help.')];
  }
}

/**
 * The status line: its class and words (short, on one line; the full wording shows on hover), and for a link
 * failing in a named way, why (its hover).
 */
function statusOf(d: Device, p: Person): [string, string, string?] {
  if (d.disabled) return ['', _('Disabled')];
  // The Reconnect button under it says what to do.
  if (d.config_stale && d.handshake) return ['warn-t', _('Settings changed')];
  // Over the data limit or outside the hours the tunnel stays up but passes nothing: the app says
  // "connected", so say here why nothing works.
  if (d.online && p.state === 'quota') return ['warn-t', _('Connected, no data left')];
  if (d.online && p.state === 'hours') return ['warn-t', _('Connected, outside your hours')];
  if (d.link) return ['warn-t', ...linkWords(d.link.state)];
  if (d.online) return ['ok-t', _('Connected')];
  if (!d.handshake) return ['warn-t', _('Not set up yet')];
  return ['', fmt(_('Last connected %s'), ago(d.handshake, now()))];
}

/**
 * The card's name. One the person may change is a button too: a click, Return or Space edits it in place
 * (flows/rename.ts), as Rename in the ⋯ menu does.
 */
function nameOf(d: Device, editable: boolean): HTMLElement {
  const el = h('span', { class: 'dev-name', 'data-t': `${d.id}:name` }, d.name);
  if (!editable) return el;
  el.classList.add('can-edit');
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.setAttribute('aria-label', fmt(_('Rename %s'), d.name));
  el.addEventListener('click', () => renameHere(d));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    renameHere(d);
  });
  return el;
}

/** Edit `d`'s name on its card, wherever the card is now (ui: flows/rename.ts). */
function renameHere(d: Device) {
  const card = document.querySelector<HTMLElement>(`.dev[data-id="${CSS.escape(d.id)}"]`);
  if (card) renameOnCard(d, card);
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
          { label: _('Rename'), icon: 'edit', run: () => renameHere(d) },
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
function usage(d: Device): HTMLElement {
  const week = sumDays(d.spark);
  const lbl = h('span', { class: 'use-lbl' }, _('Last 7 days'));
  const val = upDown(d.id);
  val.set(week);
  const chart = bars(d.spark, 'bars-week', 34);
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
  return h('div', { class: 'dev-use' }, h('div', { class: 'use-txt' }, lbl, h('span', { class: 'use-val' }, val.el)), chart.el);
}

function card(d: Device, st: State): HTMLElement {
  const p = st.person;
  const locked = !!st.locked;
  // The device this page was opened from (through the tunnel): it is connected, so say which one it is instead.
  const here = st.here === d.id;
  const [cls, words, why] = here ? ['here-t', _('This device')] : statusOf(d, p);
  const setUp = !d.handshake && !d.disabled;
  const stale = d.config_stale && !setUp && !locked && !d.disabled;
  // Connected, but nothing it sends gets through (an old configuration): new keys fix it, as changed settings.
  const renew = (d.config_stale || d.link?.state === 'dropped') && !setUp && !locked && !d.disabled;
  // On one line; why, the exact time, or the whole wording, on hover.
  const title =
    why ??
    (!here && d.handshake && !d.online && !d.disabled && !d.config_stale
      ? new Date(d.handshake * 1000).toLocaleString(locale())
      : stale
        ? _('Settings changed, update needed')
        : words);
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
        nameOf(d, !d.disabled && !locked),
        h('span', { class: `dev-stat ${cls}`, title, 'data-t': `${d.id}:stat` }, words),
        // Why a link fails: a pointer reads it on hover, a screen reader right after the status (a touch screen
        // has neither; the card keeps its one line).
        why ? h('span', { class: 'offscreen' }, why) : null,
      ),
      more,
    ),
    // Stopped by the admin: a device never set up has nothing to show. Its settings changed, or no data gets
    // through: Reconnect in place of its week (new keys, then set it up again), as a device not set up yet shows
    // Connect.
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
        : renew
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn tint block setup-btn',
                'aria-label': fmt(_('Reconnect %s'), d.name),
                onclick: () => reconnect(d),
              },
              ic('refresh'),
              h('span', {}, _('Reconnect')),
            )
          : usage(d),
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
  const grid = h('div', { class: 'dgrid' });
  snapOnJump(grid);
  return h(
    'section',
    { class: 'devices', id: 'devices', 'aria-label': _('Your devices') },
    h('div', { class: 'sec-head' }, h('h2', {}, _('Your devices')), h('span', { class: 'aside num' })),
    grid,
    h('p', { class: 'note-s limit', hidden: true }),
  );
}

/**
 * A card whose width jumps (the grid changed its columns: a window across 560 or 960 px, a phone turned)
 * takes its new shape with the layout, at once: gliding there from the old one, its numbers would not fit
 * for a moment and wrap. A threshold crossed while the window is resized a little at a time still glides
 * (devices.css). The class goes on before the frame is painted, so the glide that began never shows.
 */
function snapOnJump(grid: HTMLElement) {
  let was = 0;
  new ResizeObserver(() => {
    const w = grid.querySelector('.dev')?.getBoundingClientRect().width ?? 0;
    if (Math.abs(w - was) > 16) {
      grid.classList.add('snap');
      requestAnimationFrame(() => requestAnimationFrame(() => grid.classList.remove('snap')));
    }
    was = w;
  }).observe(grid);
}

/** The green ring of a device that just connected (its animation's id, to find it again on a repaint). */
const RING = 'ring';

/** What a card ends in (Connect, Reconnect or its week), and which of them (a button by its words). */
const footOf = (c: Element) => c.querySelector<HTMLElement>(':scope > .dev-use, :scope > .setup-btn');
const footKind = (f: HTMLElement | null) => (!f ? '' : f.classList.contains('dev-use') ? 'use' : (f.textContent ?? ''));

/** A card as it stood before a repaint. */
interface CardWas {
  el: HTMLElement;
  at: DOMRect;
  shows: Look;
  /** What it ended in, which kind, where it stood and how it showed: one of another kind crosses. */
  foot: { el: HTMLElement; kind: string; at: DOMRect; shows: Look } | null;
  /** How far its green ring had faded (ms), while it still shows. */
  ring: number | null;
}

/** "Your devices" as it stands: each card, and where the note under them stood (if it showed). */
export interface DevicesWas {
  cards: Map<string, CardWas>;
  note: DOMRect | null;
}

/** "Your devices" as it stands: read before anything above it changes (the notice; on a phone, "Your access"). */
export function devicesNow(section: HTMLElement): DevicesWas {
  const note = section.querySelector('.limit') as HTMLElement;
  // Not a card still fading out where it stood (laid over the grid, hidden from screen readers).
  const cards = [...section.querySelectorAll<HTMLElement>('.dgrid > [data-id]:not([aria-hidden])')].map((c): [string, CardWas] => {
    const f = footOf(c);
    const ring = c.getAnimations().find((a) => a.id === RING);
    return [
      c.dataset.id!,
      {
        el: c,
        at: c.getBoundingClientRect(),
        shows: look(c),
        foot: f && { el: f, kind: footKind(f), at: f.getBoundingClientRect(), shows: look(f) },
        ring: ring ? Number(ring.currentTime) : null,
      },
    ];
  });
  return { cards: new Map(cards), note: note.hidden ? null : note.getBoundingClientRect() };
}

/**
 * The green ring of a device that just connected fades into the card's own (this device's blue one, or none);
 * `from`: a ring already fading on the card a repaint rebuilt goes on from there.
 */
function ring(c: HTMLElement, from: number) {
  const own = getComputedStyle(c).boxShadow;
  c.animate([{ boxShadow: 'inset 0 0 0 1.5px var(--ok)' }, { boxShadow: own === 'none' ? 'inset 0 0 0 1.5px transparent' : own }], {
    duration: 1800,
    easing: 'ease-out',
    id: RING,
  }).currentTime = from;
}

/**
 * The cards for this state, moving from where they were (`was`: read before
 * what stands above them changed). A card that changes height (another foot, a
 * row that no longer stretches it) glides to it; a foot of another kind
 * crosses, the old one fading where it stood as the new one blurs in; a card
 * no longer there (Add device once the last slot is taken) fades where it
 * stood.
 */
export function fillDevices(section: HTMLElement, st: State, o: RepaintOpts = {}, was = devicesNow(section)) {
  const p = st.person;
  const grid = section.querySelector('.dgrid') as HTMLElement;
  // A repaint (not the first paint, which brings everything in): what newly shows comes in too.
  const repainting = grid.childElementCount > 0;
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
  const heights = cards.map((c) => c.getBoundingClientRect().height);
  cards.forEach((c, i) => {
    const w = was.cards.get(c.dataset.id!);
    if (!w || c.dataset.id === o.pop) return;
    const foot = footOf(c);
    if ((w.foot?.kind ?? '') !== footKind(foot)) {
      if (w.foot) fadeAway(w.foot.el, w.foot.at, c, w.at, w.foot.shows);
      if (foot) appear(foot);
    }
    // What it holds is clipped to it on the way (a taller foot would hang out of it).
    if (Math.abs(w.at.height - heights[i]) > 0.5) {
      c.style.overflow = 'clip';
      play(c, [{ height: `${w.at.height}px` }, { height: `${heights[i]}px` }], {
        duration: SMOOTH.duration,
        easing: SMOOTH.easing,
      }).onfinish = () => (c.style.overflow = '');
    }
  });
  // Places once the heights set off: a card under one that grows rides along with it.
  for (const c of cards) {
    const f = was.cards.get(c.dataset.id!)?.at;
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
    const r = c.dataset.id === o.flash ? 0 : was.cards.get(c.dataset.id!)?.ring;
    if (r != null) ring(c, r);
  }
  const ids = new Set(cards.map((c) => c.dataset.id));
  const g = grid.getBoundingClientRect();
  for (const [id, w] of was.cards)
    if (!ids.has(id)) {
      w.el.style.height = `${w.at.height}px`;
      fadeAway(w.el, w.at, grid, g, w.shows);
    }
  if (repainting) morphChanged(grid, said);
  const count = section.querySelector('.sec-head .aside') as HTMLElement;
  const n = fmt(_('%s of %s'), num(p.devices.length), num(p.device_limit));
  if (repainting) morphText(count, n);
  else count.textContent = n;
  // The admin may add devices past the limit.
  count.classList.toggle('warn-t', p.devices.length > p.device_limit);
  const limit = section.querySelector('.limit') as HTMLElement;
  limit.textContent = plural(
    p.device_limit,
    'You have reached your limit of %s device. Remove one to add another.',
    'You have reached your limit of %s devices. Remove one to add another.',
  );
  limitNote(limit, st.can_add || !!st.locked, repainting, was.note);
}

/**
 * The note that the limit is reached. It rises in under the cards when the
 * last slot is taken; when one frees up it fades the way it came while its
 * space folds away (on a phone it ends the page: a page scrolled to its foot
 * then moves down with it instead of dropping), then leaves the layout. Each
 * from where it stands, one turned back half-way included.
 */
function limitNote(limit: HTMLElement, hide: boolean, repainting: boolean, at: DOMRect | null) {
  const cs = getComputedStyle(limit);
  const stood = {
    opacity: cs.opacity,
    filter: cs.filter,
    transform: cs.transform,
    height: `${limit.offsetHeight}px`,
    marginTop: cs.marginTop,
  };
  const prior = limit.getAnimations();
  const shown = !limit.hidden;
  if (repainting && hide && shown) {
    const fade = play(
      limit,
      [
        { opacity: stood.opacity, filter: stood.filter, transform: stood.transform },
        { opacity: 0, filter: 'blur(4px)', transform: stood.transform },
      ],
      { duration: 200 * +stood.opacity, easing: EASE_IN, fill: 'forwards' },
    );
    // With less motion nothing folds: it fades, then is gone with its space.
    const fold = calm()
      ? null
      : play(
          limit,
          [
            { height: stood.height, marginTop: stood.marginTop },
            { height: '0px', marginTop: '0px' },
          ],
          { duration: SMOOTH.duration, easing: SMOOTH.easing, fill: 'forwards' },
        );
    prior.forEach((a) => a.cancel());
    (fold ?? fade).onfinish = () => {
      limit.hidden = true;
      fade.cancel();
      fold?.cancel();
    };
  } else {
    prior.forEach((a) => a.cancel());
    limit.hidden = hide;
  }
  if (!repainting || hide) return glideFrom(limit, at);
  if (!shown)
    play(
      limit,
      [
        { opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'none', filter: 'none' },
      ],
      { duration: 420, easing: EASE_OUT },
    );
  // Folding away when it was needed again: it opens back from where it stood.
  else if (prior.length)
    play(
      limit,
      [
        stood,
        { opacity: 1, filter: 'none', transform: 'none', height: `${limit.offsetHeight}px`, marginTop: getComputedStyle(limit).marginTop },
      ],
      { duration: SMOOTH.duration, easing: SMOOTH.easing },
    );
  glideFrom(limit, at);
}

/** The note, shown before and still in the page, glides from where it stood as the cards do (one came in above it). */
function glideFrom(limit: HTMLElement, at: DOMRect | null) {
  if (!at || limit.hidden) return;
  const dy = at.top - limit.getBoundingClientRect().top;
  if (Math.abs(dy) > 0.5)
    play(limit, [{ translate: `0 ${dy}px` }, { translate: '0 0' }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
}
