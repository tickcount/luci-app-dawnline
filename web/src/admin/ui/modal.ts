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
  const bodyEl = E('div', { class: `dl-modal ${cls}` }, body);
  const rowEl = E('div', { class: 'button-row' }, actions);
  // Enter in a field submits: the dialog's positive button (buttons, selects
  // and text areas keep their own Enter).
  bodyEl.addEventListener('keydown', (ev: KeyboardEvent) => {
    // Escape closes the dialog only: a drawer under it stays (it listens on the document).
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeModal();
      return;
    }
    if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target as HTMLElement;
    if (!t || ['TEXTAREA', 'BUTTON', 'SELECT', 'A'].includes(t.tagName)) return;
    const go = rowEl.querySelector<HTMLButtonElement>('.cbi-button-positive');
    if (!go || go.disabled) return;
    ev.preventDefault();
    go.click();
  });
  ui.showModal(title, [bodyEl, rowEl]);
}

export function closeModal() {
  settle();
  ui.hideModal();
}

/** "Cancel" (or another label) that closes the modal. */
export function cancelButton(label = _('Cancel'), danger = false): HTMLElement {
  return E(
    'button',
    { class: `cbi-button ${danger ? 'cbi-button-negative' : 'cbi-button-neutral'}`, type: 'button', click: closeModal },
    label,
  );
}

export function confirmDialog(title: string, body: Child, confirmLabel = _('Confirm'), danger = false): Promise<boolean> {
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
