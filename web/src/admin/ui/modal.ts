// LuCI's modal with Dawnline's body and button row, and a confirm dialog that
// always settles: replacing or closing its modal (another dialog, the
// operation modal, a navigation) answers "no".

import type { Child } from '../luci.d';
import { E } from '../e';
import { onNavigate } from './nav';

/** The answer of the confirm dialog on screen, if any. */
let pending: ((ok: boolean) => void) | null = null;

function settle(ok = false) {
  const p = pending;
  pending = null;
  p?.(ok);
}

export function modal(title: string, body: Child, actions: Child, cls = '') {
  settle();
  ui.showModal(title, [E('div', { class: `dl-modal ${cls}` }, body), E('div', { class: 'button-row' }, actions)]);
}

export function closeModal() {
  settle();
  ui.hideModal();
}

/** "Cancel" (or another label) that closes the modal. */
export function cancelButton(label = 'Cancel', danger = false): HTMLElement {
  return E(
    'button',
    { class: `cbi-button ${danger ? 'cbi-button-negative' : 'cbi-button-neutral'}`, type: 'button', click: closeModal },
    label,
  );
}

export function confirmDialog(title: string, body: Child, confirmLabel = 'Confirm', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    modal(title, body, [
      cancelButton(),
      ' ',
      E(
        'button',
        {
          class: `cbi-button ${danger ? 'cbi-button-negative' : 'cbi-button-positive'}`,
          type: 'button',
          click: () => {
            const p = pending;
            pending = null;
            ui.hideModal();
            p?.(true);
          },
        },
        confirmLabel,
      ),
    ]);
    pending = resolve;
  });
}

onNavigate(() => {
  if (!pending) return;
  settle();
  ui.hideModal();
});
