// A device's own actions from its ⋯ menu: Rename, Reconnect (new keys, then
// the set-up of the new ones) and Remove. A question comes before what cannot
// be undone; the action's button stays busy until the router answers.

import type { ClientConfig, Device } from '../../shared/types';
import { call } from '../api';
import { h, ic } from '../dom';
import { EASE_IN, play } from '../motion';
import { repaint, setState, state, type State } from '../state';
import { once, toast } from '../ui/feedback';
import { glass, type Tone } from '../ui/glass';
import { closeSheet, head, onClosed, openSheet, type View } from '../ui/sheet';
import { secureFirst } from './secure';
import { continueSetup } from './setup-view';

/** A question before something that cannot be undone: the action's icon in its colour, what happens, Cancel and the action. */
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
      { class: 'center-col ask' },
      glass(o.icon, o.tone, 'gi xl'),
      h('h3', {}, o.title),
      h('p', {}, o.text),
      h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'btn soft', onclick: () => closeSheet() }, 'Cancel'), ok),
    ),
  );
  return { el, label: o.title, asks: true };
}

export function rename(d: Device) {
  openSheet(() => {
    const input = h('input', { type: 'text', maxlength: 48, 'aria-label': 'Device name', autocomplete: 'off' }) as HTMLInputElement;
    input.value = d.name;
    const save = h('button', { class: 'go', type: 'submit', 'aria-label': 'Save' }, ic('check')) as HTMLButtonElement;
    input.addEventListener('input', () => save.classList.toggle('ready', !!input.value.trim() && input.value.trim() !== d.name));
    const form = h('form', { class: 'field', autocomplete: 'off' }, input, save);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name || name === d.name) return;
      void once(save, async () => {
        try {
          const r = await call<{ state: State }>(`devices/${d.id}`, { action: 'rename', name });
          setState(r.state);
          onClosed(() => {
            repaint();
            toast('Renamed');
          });
          closeSheet();
        } catch (er) {
          toast((er as Error).message, true);
        }
      });
    });
    setTimeout(() => input.select(), 60);
    return { el: h('div', { class: 'view' }, head(`Rename ${d.name}`), form), label: `Rename ${d.name}` };
  });
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
      title: `Reconnect ${d.name}?`,
      text: here
        ? 'It gets new keys. This device is connected through its current settings: it disconnects a few seconds after you confirm. Add the new ones that open next.'
        : 'It gets new keys and its current settings stop working. Set it up again with the new ones that open next.',
      action: 'Reconnect',
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
      title: `Remove ${d.name}?`,
      text: 'Its connection stops working at once. You can add it again later.',
      action: 'Remove',
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
              toast('Device removed');
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
