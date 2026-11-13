// No server yet: the portal's single card, what Dawnline will set up in three
// steps, the one button that starts it (the new server's sheet,
// flows/new-server.ts) and the quiet way back from a backup (Settings'
// Backups). A read-only login is told who sets it up. Settings shows it in
// the server's place, Overview as its first card.

import { h } from '../../../portal/dom';
import type { SetupDefaults } from '../../api';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { settingsUrl } from '../../shell/routes';
import { newServer } from '../../flows/new-server';

export function firstRun(d: SetupDefaults | null, write: boolean): HTMLElement {
  const step = (icon: string, title: string, text: string) => h('li', {}, glass(icon, 'grey'), h('span', {}, h('b', {}, title), text));
  return h(
    'div',
    { class: 'gone first-card' },
    glass('dawnline', 'blue'),
    h('h2', {}, _('Set up Dawnline')),
    h(
      'p',
      {},
      _(
        'An AmneziaWG server on this router and personal links for people. It takes a couple of minutes: the address, the disguise, the portal.',
      ),
    ),
    h(
      'ol',
      { class: 'first-steps' },
      step('server', _('Server'), _('the address and port: we check the router can be reached from the internet')),
      step('amneziawg', 'AmneziaWG', _('installed if needed, and the disguise picked')),
      step('portal', _('Portal'), _('personal links people add their own devices with')),
    ),
    write && d
      ? h('button', { type: 'button', class: 'btn accent block', onclick: () => newServer(d, false) }, h('span', {}, _('Start')))
      : h('p', {}, _('An admin with write access sets the server up.')),
    write
      ? h('a', { class: 'btn soft block', href: settingsUrl('backups') }, ic('archive'), h('span', {}, _('Restore from a backup')))
      : null,
  );
}
