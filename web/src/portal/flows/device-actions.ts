// A device's own actions from its ⋯ menu: Reconnect (new keys, then the set-up
// of the new ones) and Remove (Rename edits the name on the card: rename.ts). A
// question comes before what cannot be undone; the action's button stays busy
// until the router answers.

import type { ClientConfig, Device } from '../../shared/types';
import { fmt } from '../../shared/i18n';
import { call } from '../api';
import { h } from '../dom';
import { EASE_IN, play } from '../motion';
import { repaint, setState, state, type State } from '../state';
import { once, toast } from '../ui/feedback';
import { glass, type Tone } from '../ui/glass';
import { closeSheet, onClosed, openSheet, type View } from '../ui/sheet';
import { secureFirst } from './secure';
import { continueSetup } from './setup-view';

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
 * up yet" until it connects with the new configuration, which the sheet goes on to.
 */
export function reconnect(d: Device) {
  if (secureFirst()) return;
  const here = state()?.here === d.id;
  openSheet(() =>
    ask({
      icon: 'refresh',
      tone: 'orange',
      title: fmt(_('Reconnect %s?'), d.name),
      text: here
        ? _(
            'It gets new keys. This device is connected through its current settings: it disconnects a few seconds after you confirm. Add the new ones that open next.',
          )
        : _('It gets new keys and its current settings stop working. Set it up again with the new ones that open next.'),
      action: _('Reconnect'),
      cls: 'accent',
      run: async () => {
        try {
          const r = await call<{ config: ClientConfig; state: State }>(`devices/${d.id}`, { action: 'reconnect' });
          setState(r.state);
          repaint();
          await continueSetup(r.state.person.devices.find((x) => x.id === d.id) ?? { ...d, handshake: 0 }, r.config);
        } catch (er) {
          toast((er as Error).message, true);
        }
      },
    }),
  );
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
