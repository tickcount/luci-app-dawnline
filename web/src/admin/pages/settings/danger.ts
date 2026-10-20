// Settings → Remove Dawnline from this router.

import { E } from '../../e';
import { api } from '../../api';
import { button } from '../../ui/button';
import { cancelButton, closeModal, modal } from '../../ui/modal';
import { attempt } from '../../ui/toast';
import { input } from '../../ui/controls';
import { fmt } from '../../../shared/i18n';
import { section } from './common';

/** The word the router demands to remove Dawnline: the same in every language. */
const WORD = 'remove';

function uninstall() {
  const confirmInput = input('', { placeholder: WORD });
  // Live only once the word is typed, as the router itself demands.
  const go = button(
    _('Remove Dawnline'),
    async () => {
      if (await attempt(() => api.uninstall(confirmInput.value.trim()), _('Dawnline removed'))) {
        closeModal();
        setTimeout(() => location.reload(), 800);
      }
    },
    'negative',
    { disabled: true },
  );
  confirmInput.addEventListener('input', () => {
    go.disabled = confirmInput.value.trim() !== WORD;
  });
  modal(
    _('Remove Dawnline?'),
    [
      E(
        'p',
        {},
        fmt(
          _(
            'Everyone is disconnected and the tunnel, firewall rules and portal are removed. A backup is made first. Type “%s” to confirm.',
          ),
          WORD,
        ),
      ),
      confirmInput,
    ],
    [cancelButton(), ' ', go],
  );
}

export function dangerCard(): HTMLElement {
  return section(
    'danger',
    _('Remove Dawnline from this router'),
    [
      E(
        'p',
        { class: 'dl-muted' },
        _(
          'Deletes the tunnel, firewall rules, access table and hostnames Dawnline created, and stops the service. People and keys are kept in a backup.',
        ),
      ),
    ],
    [E('span'), button(_('Remove'), () => uninstall(), 'negative')],
    'danger',
  );
}
