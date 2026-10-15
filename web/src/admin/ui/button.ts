// Buttons: stock LuCI markup (cbi-button) so themes style them. A click runs
// the action once (disabled and spinning until it settles); failures become a toast.

import type { Child } from '../luci.d';
import { E } from '../e';
import { icon } from '../../shared/icons';
import { errorText, notify } from './toast';

export type ButtonKind = 'action' | 'positive' | 'negative' | 'neutral' | 'apply' | 'remove' | 'edit' | 'add' | 'reset' | 'save';

export function button(
  label: Child,
  onClick: (ev: MouseEvent) => unknown,
  kind: ButtonKind = 'neutral',
  extra: Record<string, unknown> = {},
): HTMLButtonElement {
  // E() sets every non-null attribute, so `disabled: false` would still
  // disable the button: boolean state goes through the property.
  const { disabled, ...attrs } = extra;
  const btn = E(
    'button',
    {
      class: `cbi-button cbi-button-${kind}`,
      type: 'button',
      ...attrs,
      click: async (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add('spinning');
        try {
          await onClick(ev);
        } catch (e) {
          notify(errorText(e), 'error');
        } finally {
          btn.disabled = false;
          btn.classList.remove('spinning');
        }
      },
    },
    label,
  ) as HTMLButtonElement;
  btn.disabled = !!disabled;
  return btn;
}

export function iconButton(name: string, title: string, onClick: (ev: MouseEvent) => unknown, kind: ButtonKind = 'neutral', cls = '') {
  return button([icon(name), E('span', { class: 'dl-btn-label' }, title)], onClick, kind, {
    title,
    class: `cbi-button cbi-button-${kind} dl-icon-btn ${cls}`.trim(),
  });
}
