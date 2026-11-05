// A device's own actions from its ⋯ menu: Reconnect (new keys, what it is and
// LAN Bypass asked again, then the set-up of the new ones), LAN Bypass on or
// off (the same keys, then the set-up of the updated configuration) and Remove
// (Rename edits the name on the card: rename.ts). A question comes before what
// cannot be undone; the action's button stays busy until the router answers.

import type { ClientConfig, Device } from '../../shared/types';
import { pickOf, PICKS, type KindPick } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import { call } from '../api';
import { h, ic } from '../dom';
import { EASE_IN, play } from '../motion';
import { repaint, setState, state, type State } from '../state';
import { once, toast } from '../ui/feedback';
import { glass, type Tone } from '../ui/glass';
import { closeSheet, head, onClosed, openSheet, sub, type View } from '../ui/sheet';
import { kindOf, kindTiles, lanSwitch } from './device-form';
import { secureFirst } from './secure';
import { continueSetup, openSetup } from './setup-view';

/** A question before something that cannot be undone: the action's icon in its colour, what happens (on the left edge), Cancel and the action. */
function ask(o: { icon: string; tone: Tone; title: string; text: string; action: string; cls: string; run: () => Promise<void> }): View {
  const ok = h(
    'button',
    { type: 'button', class: `btn ${o.cls}`, onclick: (ev: Event) => once(ev.currentTarget as HTMLButtonElement, o.run) },
    // In an element: a busy button blurs its content away for the orb (ui/busy.ts).
    h('span', {}, o.action),
  ) as HTMLButtonElement;
  const el = h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'ask' },
      glass(o.icon, o.tone, 'gi xl'),
      h('h3', {}, o.title),
      h('p', {}, o.text),
      h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'btn soft', onclick: () => closeSheet() }, _('Cancel')), ok),
    ),
  );
  return { el, label: o.title, asks: true };
}

/**
 * Set a device up from scratch (a new phone, the app reinstalled, settings the
 * admin changed): new keys, so what it holds stops working; it shows "Not set
 * up yet" until it connects with the new configuration, which the sheet goes on
 * to. The sheet asks again what it is and about LAN Bypass, as Add a device does
 * (device-form.ts), as they stand now; the name stays.
 */
export function reconnect(d: Device) {
  if (secureFirst()) return;
  openSheet(() => vReconnect(d));
}

function vReconnect(d: Device): View {
  const st = state()!;
  const here = st.here === d.id;
  // The kinds this router takes, as the four choices; what it is now ringed.
  const picks = PICKS.filter((k) => st.kinds.some((x) => pickOf(x) === k));
  let pick: KindPick = picks.includes(pickOf(d.kind)) ? pickOf(d.kind) : picks[0];
  let bypass = d.lan_bypass;
  const kinds = kindTiles(picks, (k) => (pick = k));
  kinds.set(pick);
  const lan = lanSwitch(bypass, st.server.home ?? [], (on) => (bypass = on));
  const run = async () => {
    try {
      const r = await call<{ config: ClientConfig; state: State }>(`devices/${d.id}`, {
        action: 'reconnect',
        kind: kindOf(pick, d.kind),
        lan_bypass: bypass,
      });
      setState(r.state);
      repaint();
      await continueSetup(r.state.person.devices.find((x) => x.id === d.id) ?? { ...d, handshake: 0 }, r.config);
    } catch (er) {
      toast((er as Error).message, true);
    }
  };
  const go = h(
    'button',
    { type: 'button', class: 'btn warn block', onclick: (ev: Event) => once(ev.currentTarget as HTMLButtonElement, run) },
    ic('refresh'),
    h('span', {}, _('Reconnect')),
  );
  const title = fmt(_('Reconnect %s'), d.name);
  const el = h(
    'div',
    { class: 'view' },
    head(title),
    sub(
      here
        ? _(
            'It gets new keys. This device is connected through its current settings: it disconnects a few seconds after you confirm. Add the new ones that open next.',
          )
        : _('It gets new keys and its current settings stop working. Set it up again with the new ones that open next.'),
    ),
    kinds.el,
    lan,
    go,
  );
  return { el, label: title };
}

/**
 * LAN Bypass on or off from the ⋯ menu: the keys stay, the device needs its
 * updated configuration (its own local network in or out of the tunnel is in
 * there), so its set-up opens on it.
 */
export async function toggleBypass(d: Device) {
  if (secureFirst()) return;
  const on = !d.lan_bypass;
  try {
    const r = await call<{ state: State }>(`devices/${d.id}`, { action: 'bypass', on });
    setState(r.state);
    repaint();
    toast(on ? _('LAN Bypass is on: add the updated connection') : _('LAN Bypass is off: add the updated connection'));
    const dev = r.state.person.devices.find((x) => x.id === d.id);
    if (dev) await openSetup(dev);
  } catch (er) {
    toast((er as Error).message, true);
  }
}

export function removeDevice(d: Device) {
  openSheet(() =>
    ask({
      icon: 'trash',
      tone: 'red',
      title: fmt(_('Remove %s?'), d.name),
      text: _('Its connection stops working at once. You can add it again later.'),
      action: _('Remove'),
      cls: 'red',
      run: async () => {
        try {
          const r = await call<{ state: State }>(`devices/${d.id}`, { action: 'delete' });
          setState(r.state);
          // The card goes first; the rest then glide into its place.
          onClosed(() => {
            const card = document.querySelector(`.dev[data-id="${CSS.escape(d.id)}"]`);
            const done = () => {
              repaint();
              toast(_('Device removed'));
            };
            if (!card) return done();
            play(
              card,
              [
                { opacity: 1, transform: 'none', filter: 'none' },
                { opacity: 0, transform: 'scale(.9)', filter: 'blur(6px)' },
              ],
              {
                duration: 220,
                easing: EASE_IN,
                fill: 'forwards',
              },
            ).onfinish = done;
          });
          closeSheet();
        } catch (er) {
          toast((er as Error).message, true);
        }
      },
    }),
  );
}
