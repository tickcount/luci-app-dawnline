// A question in the portal's sheet (its .ask: the action's glass in its tone,
// what happens, Cancel and the action), before something that cannot be taken
// back or that rewrites a device's configuration. The action's button stays
// busy (the portal's orb) until its work is done; an error says why in a toast
// and leaves the question open.

import { h, type Kid } from '../../portal/dom';
import { closeSheet, type View } from '../../portal/ui/sheet';
import { once } from '../../portal/ui/feedback';
import { glass } from '../ui/glass';
import { errorText, notify } from '../ui/toast';

export interface Ask {
  icon: string;
  tone: 'red' | 'orange' | 'blue';
  title: string;
  text: Kid[];
  action: string;
  /** The action button's look: red (removes), warn (rewrites). */
  cls: 'red' | 'warn' | 'accent';
  run(): Promise<void>;
}

export function askView(o: Ask): View {
  const ok = h(
    'button',
    {
      type: 'button',
      class: `btn ${o.cls}`,
      onclick: (e: Event) =>
        once(e.currentTarget as HTMLButtonElement, async () => {
          try {
            await o.run();
          } catch (err) {
            notify(errorText(err), 'error', 10000);
          }
        }),
    },
    h('span', {}, o.action),
  );
  const el = h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'ask' },
      glass(o.icon, o.tone, 'gi xl'),
      h('h3', {}, o.title),
      h('p', {}, ...o.text),
      h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'btn soft', onclick: () => closeSheet() }, _('Cancel')), ok),
    ),
  );
  return { el, label: o.title, asks: true };
}
