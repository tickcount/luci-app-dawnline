// Settings › Remove Dawnline: the dangerous section. What removing does, in
// one line, and the one red button; the question with the word to type is in
// its sheet (flows/uninstall.ts). A read-only login is told who can.

import { h } from '../../../../portal/dom';
import { ic } from '../../../ui/icons';
import { card, note, section } from '../../../ui/section';
import { uninstallSheet } from '../../../flows/uninstall';
import type { RouterCtx } from './ctx';

export function removeSection(y: RouterCtx): HTMLElement {
  return section(
    { id: 'remove', icon: 'trash', title: _('Remove Dawnline'), tone: 'red', danger: true },
    card(
      h(
        'div',
        { class: 'st-rm' },
        h(
          'p',
          { class: 'st-rm-t' },
          _(
            'Deletes the tunnel, firewall rules, access table and hostnames Dawnline created, and stops the service. People and keys are kept in a backup.',
          ),
        ),
        y.write
          ? h(
              'button',
              { type: 'button', class: 'btn red sm', onclick: () => uninstallSheet() },
              ic('trash'),
              h('span', {}, _('Remove Dawnline')),
            )
          : note(_('An admin with write access can remove it.')),
      ),
    ),
  );
}
