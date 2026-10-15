// Settings → Remove Dawnline from this router.

import { E } from '../../e';
import { api } from '../../api';
import { button } from '../../ui/button';
import { cancelButton, closeModal, modal } from '../../ui/modal';
import { attempt } from '../../ui/toast';
import { input } from '../../ui/controls';
import { section } from './common';

function uninstall() {
  const confirmInput = input('', { placeholder: 'remove' });
  modal(
    'Remove Dawnline?',
    [
      E(
        'p',
        {},
        'Everyone is disconnected and the tunnel, firewall rules and portal are removed. A backup is made first. Type “remove” to confirm.',
      ),
      confirmInput,
    ],
    [
      cancelButton(),
      ' ',
      button(
        'Remove Dawnline',
        async () => {
          if (await attempt(() => api.uninstall(confirmInput.value.trim()), 'Dawnline removed')) {
            closeModal();
            setTimeout(() => location.reload(), 800);
          }
        },
        'negative',
      ),
    ],
  );
}

export function dangerCard(): HTMLElement {
  return section(
    'danger',
    'Remove Dawnline from this router',
    [
      E(
        'p',
        { class: 'dl-muted' },
        'Deletes the tunnel, firewall rules, access table and hostnames Dawnline created, and stops the service. People and keys are kept in a backup.',
      ),
    ],
    [E('span'), button('Remove', () => uninstall(), 'negative')],
    'danger',
  );
}
