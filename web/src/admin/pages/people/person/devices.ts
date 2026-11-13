// A person's devices as the portal's cards (portal/page/devices.ts, in the
// admin's words): each a link to its own panel (its name a real <a>, its hit
// area stretched over the card; ⋯ and the button stay their own), its glass,
// name and one line in its state's colour (people/diagnosis.ts deviceLine);
// under it the last 7 days as bars, or Show set-up where the device needs it
// (never set up, an outdated configuration, nothing it sends usable). Then
// the card that adds one, over the limit too (an admin may). ⋯ on a card:
// open, show its set-up, turn off or on, reset its traffic, new keys, remove.

import type { Device } from '../../../../shared/types';
import { h } from '../../../../portal/dom';
import { openMenu, type MenuItem } from '../../../../portal/ui/menu';
import { fmt } from '../../../../shared/i18n';
import { glass } from '../../../ui/glass';
import { weekUse } from '../../../widgets/week-use';
import { ic } from '../../../ui/icons';
import { deviceLine } from '../../../people/diagnosis';
import { deviceUrl } from '../../../shell/routes';
import { visit } from '../../../shell/visit';
import { showSetup } from '../../../flows/setup';
import { addDevice } from '../../../flows/add-device';
import { newKeys } from '../../../flows/new-keys';
import { removeDevice, resetDeviceTraffic, toggleDevice, type DeviceActCtx } from '../../../flows/device-acts';
import type { PersonCtx } from '../../../people/ctx';
import { EASE_IN, SMOOTH, play } from '../../../../portal/motion';
import { asksNow, routerDeclined } from '../../../servers/behind';
import { replaces } from '../../../../portal/ui/carry';
import { glide } from '../../../../portal/ui/chips-motion';

/** It needs its set-up shown: never set up, an outdated configuration, or nothing it sends is usable. */
const needsSetup = (d: Device) => !d.disabled && (!d.handshake || d.config_stale || d.link?.state === 'dropped');

/** The last 7 days down and up over their bars; a day under the pointer puts its own numbers in their place. */
const week = (d: Device): HTMLElement => weekUse(d.id, d.name, d.spark).el;

function menu(c: PersonCtx, d: Device, anchor: HTMLElement, reload: () => void) {
  const dc: DeviceActCtx = { device: d, reload };
  // calm to grave: what only shows it; what resets something of it; what stops it: off in warn, then Remove, last
  const items: (MenuItem | null)[] = [
    { label: _('Open'), icon: 'open', run: () => visit(deviceUrl(d.id)) },
    { label: _('Show set-up'), icon: 'qr', run: () => void showSetup({ person: c.p, device: d, now: c.now, done: reload }).then(reload) },
    null,
    { label: _('Reset traffic'), icon: 'reset', run: () => resetDeviceTraffic(dc) },
    {
      label: _('New keys'),
      icon: 'key',
      run: () => newKeys({ person: c.p, device: d, server: c.srv, now: c.now, made: reload, setup: { done: reload } }),
    },
    null,
    d.disabled
      ? { label: _('Turn on'), icon: 'play', run: () => void toggleDevice(dc, false) }
      : { label: _('Turn off'), icon: 'pause', tone: 'warn', run: () => void toggleDevice(dc, true) },
    { label: _('Remove'), icon: 'trash', tone: 'bad', run: () => removeDevice(dc) },
  ];
  // a router that waits for an answer: it is opened (where it is answered), or removed
  openMenu(anchor, d.waiting ? [items[0], null, items[items.length - 1]] : items, d.name);
}

function card(c: PersonCtx, d: Device, reload: () => void): HTMLElement {
  const line = deviceLine(d, c.p, { now: c.now(), today: c.today, tz: c.st.tz });
  const stat = h(
    'span',
    { class: `dev-stat ${line.tone ? `${line.tone}-t` : ''}`, id: `dev-st-${d.id}`, title: line.why ?? line.text },
    line.text,
  );
  const more = c.write
    ? (h(
        'button',
        {
          type: 'button',
          class: 'knob more',
          'aria-label': fmt(_('%s: set-up, turn off, new keys, remove'), d.name),
          'aria-haspopup': 'menu',
        },
        ic('more'),
      ) as HTMLButtonElement)
    : null;
  more?.addEventListener('click', () => menu(c, d, more, reload));
  // It asks for something: where «Show set-up» would stand, one button that opens its dialog, where the question
  // is answered (a question with its answers does not fit a card). A router that waits has no set-up to show.
  const foot = asksNow(d)
    ? c.write
      ? h(
          'button',
          { type: 'button', class: 'btn tint block setup-btn', onclick: () => visit(deviceUrl(d.id)) },
          ic('clock'),
          h('span', {}, _('Answer the request')),
        )
      : null
    : c.write && needsSetup(d)
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn tint block setup-btn',
            onclick: () => void showSetup({ person: c.p, device: d, now: c.now, done: reload }).then(reload),
          },
          ic('qr'),
          h('span', {}, _('Show set-up')),
        )
      : week(d);
  return h(
    'article',
    { class: `dev as-link${d.disabled ? ' off' : ''}`, 'data-id': d.id },
    h(
      'div',
      { class: 'dev-top' },
      glass(d.kind, 'grey'),
      h(
        'div',
        { class: 'dev-id' },
        h('a', { class: 'dev-name dev-a', href: deviceUrl(d.id), title: d.name, 'aria-describedby': `dev-st-${d.id}` }, d.name),
        stat,
      ),
      more,
    ),
    foot,
  );
}

/**
 * The grid a press here drew again (ui/carry.ts) moves as the portal's does (portal/page/devices.ts): a card that is
 * no more fades where it stood (180 ms EASE_IN, through a 4 px blur), the cards that stay glide to their places
 * (FLIP on SMOOTH), one that is new comes in a beat after (from nine tenths, blurred, on SMOOTH), and the grid goes
 * to its new height so the blocks under it travel with it. Each from where it stands on screen.
 */
function carryGrid(key: string, grid: HTMLElement) {
  const old = replaces(key, grid);
  if (!old) return;
  const o = old.getBoundingClientRect();
  const was = new Map<string, { el: HTMLElement; x: number; y: number; w: number; h: number }>();
  for (const c of old.children as Iterable<HTMLElement>) {
    const r = c.getBoundingClientRect();
    was.set(c.dataset.id ?? '#add', { el: c, x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height });
  }
  const h0 = o.height;
  requestAnimationFrame(() => {
    if (!grid.isConnected) return;
    const g = grid.getBoundingClientRect();
    const now = new Set<string>();
    for (const c of grid.children as Iterable<HTMLElement>) {
      const id = c.dataset.id ?? '#add';
      now.add(id);
      const f = was.get(id);
      const r = c.getBoundingClientRect();
      const dx = f ? f.x - (r.left - g.left) : 0;
      const dy = f ? f.y - (r.top - g.top) : 0;
      if (!f)
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
      else if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
        play(c, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          duration: SMOOTH.duration,
          easing: SMOOTH.easing,
        });
    }
    for (const [id, f] of was) {
      if (now.has(id)) continue;
      const ghost = f.el.cloneNode(true) as HTMLElement;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      Object.assign(ghost.style, {
        position: 'absolute',
        left: `${f.x}px`,
        top: `${f.y}px`,
        width: `${f.w}px`,
        height: `${f.h}px`,
        margin: '0',
        pointerEvents: 'none',
      });
      grid.append(ghost);
      play(
        ghost,
        [
          { opacity: 1, filter: 'blur(0px)' },
          { opacity: 0, filter: 'blur(4px)' },
        ],
        { duration: 180, easing: EASE_IN, fill: 'forwards' },
      ).finished.then(
        () => ghost.remove(),
        () => ghost.remove(),
      );
    }
    glide(grid, h0);
  });
}

/** The cards and the add card. */
export function deviceGrid(c: PersonCtx, reload: () => void): HTMLElement {
  const over = c.p.devices.length >= c.p.device_limit;
  const grid = h(
    'div',
    { class: 'dgrid' },
    // a router asked for and turned down is not the admin's to see: it stays on its owner's page until they remove it
    ...c.p.devices.filter((d) => !routerDeclined(d)).map((d) => card(c, d, reload)),
    c.write
      ? h(
          'button',
          {
            type: 'button',
            class: 'dev add',
            title: over ? _('Over the limit: admins can still add') : null,
            onclick: () => addDevice({ person: c.p, server: c.srv, now: c.now, added: reload, people: c.st.people, servers: c.st.servers }),
          },
          glass('plus'),
          h('span', {}, over ? _('Add over the limit') : _('Add device')),
        )
      : null,
  );
  carryGrid(`dgrid:${c.p.id}`, grid);
  return grid;
}
