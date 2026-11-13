// Removing Dawnline from the router, in the portal's sheet: what goes (the
// tunnels, firewall rules, access table, hostnames and the portal; people and
// keys stay in a backup made first) and the word the router demands, typed
// in the field. The button stays shut until the word is there. After it the
// page reloads (the views have nothing left to show).

import { api } from '../api';
import { h } from '../../portal/dom';
import { openSheet, closeSheet, type View } from '../../portal/ui/sheet';
import { once } from '../../portal/ui/feedback';
import { badLine } from '../../portal/ui/bad-line';
import { fmt } from '../../shared/i18n';
import { glass } from '../ui/glass';
import { errorText } from '../ui/toast';
import { say } from '../shell/toast';

/** The word rpc uninstall demands: the same in every language. */
const WORD = 'remove';

function view(): View {
  const input = h('input', {
    type: 'text',
    placeholder: WORD,
    'aria-label': _('Type the word to confirm'),
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    class: 'mono',
    'data-1p-ignore': true,
  }) as HTMLInputElement;
  const { el: bad, say: refuse, unsay } = badLine();
  const go = h('button', { type: 'button', class: 'btn red', disabled: true }, h('span', {}, _('Remove'))) as HTMLButtonElement;
  input.addEventListener('input', () => {
    unsay();
    go.disabled = input.value.trim() !== WORD;
  });
  go.addEventListener('click', () =>
    once(go, async () => {
      try {
        await api.uninstall(input.value.trim());
      } catch (e) {
        return refuse(errorText(e));
      }
      closeSheet();
      say(_('Dawnline removed'));
      setTimeout(() => location.reload(), 800);
    }),
  );
  const el = h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'ask' },
      glass('trash', 'red', 'gi xl'),
      h('h3', {}, _('Remove Dawnline?')),
      h(
        'p',
        {},
        fmt(
          _(
            'Everyone is disconnected and the tunnel, firewall rules and portal are removed. A backup is made first. Type “%s” to confirm.',
          ),
          WORD,
        ),
      ),
      h('label', { class: 'field rm-f' }, input),
      bad,
      h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'btn soft', onclick: () => closeSheet() }, _('Cancel')), go),
    ),
  );
  requestAnimationFrame(() => input.focus({ preventScroll: true }));
  return { el, label: _('Remove Dawnline?'), asks: true };
}

export const uninstallSheet = () => openSheet(view);
