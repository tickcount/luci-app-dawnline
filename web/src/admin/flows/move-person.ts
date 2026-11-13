// Moving a person to another server, or giving one without a server one
// (the concept's vMove): the servers as option rows, then the question as the
// next view of the same sheet: their devices that have connected stop until
// they take their set-up again (the other server has its own address and
// key), circles and home networks of the old server stay behind, a server
// that is off is said too. A person without devices, or without a server
// yet, moves at once.

import type { Person, Server, Status } from '../../shared/types';
import { api } from '../api';
import { h } from '../../portal/dom';
import { closeSheet, go, head, openSheet, sub, type View } from '../../portal/ui/sheet';
import { fmt, num } from '../../shared/i18n';
import { glass } from '../ui/glass';
import { ic } from '../ui/icons';
import { errorText, notify } from '../ui/toast';
import { say } from '../shell/toast';
import { askView } from './ask';

export interface MoveCtx {
  person: Person;
  st: Status;
  /** Moved: the page reads the router again. */
  moved(): void;
}

async function move(c: MoveCtx, s: Server) {
  await api.personUpdate(c.person.id, { server: s.id });
  closeSheet();
  say(fmt(_('%s: server %s'), c.person.name, s.name));
  c.moved();
}

function vAsk(c: MoveCtx, s: Server): View {
  const n = c.person.devices.filter((d) => d.handshake && !d.disabled).length;
  return askView({
    icon: 'server',
    tone: 'orange',
    title: fmt(_('%s → %s?'), c.person.name, s.name),
    text: [
      fmt(
        N_(
          n,
          '%s device stops connecting until it takes its set-up again: %s has its own address and key.',
          '%s devices stop connecting until they take their set-up again: %s has its own address and key.',
        ),
        num(n),
        s.name,
      ),
      ' ',
      _('Circles and home networks of the old server stay behind.'),
      s.enabled ? '' : ` ${fmt(_('%s is turned off: devices do not connect until it is on.'), s.name)}`,
    ],
    action: _('Move'),
    cls: 'warn',
    run: () => move(c, s),
  });
}

function vMove(c: MoveCtx): View {
  const p = c.person;
  const cur = c.st.servers.find((s) => s.id === p.server);
  const others = c.st.servers.filter((s) => s.id !== p.server);
  const pick = (s: Server) => {
    if (cur && p.devices.some((d) => d.handshake && !d.disabled)) return go(() => vAsk(c, s));
    move(c, s).catch((e) => notify(errorText(e), 'error', 10000));
  };
  const opts = h(
    'div',
    { class: 'opts', role: 'list' },
    ...others.map((s) =>
      h(
        'button',
        { type: 'button', class: 'opt', role: 'listitem', onclick: () => pick(s) },
        glass('server', s.enabled ? 'blue' : 'grey'),
        h(
          'span',
          { class: 'opt-t' },
          h('b', {}, s.name),
          h('span', { class: 'mono' }, `${s.endpoint || _('no address')}:${s.port}`),
          s.enabled ? null : h('span', { class: 'warn-t' }, _('Turned off')),
        ),
        ic('chevron', 'i opt-chev'),
      ),
    ),
  );
  const title = cur ? fmt(_('Move · %s'), p.name) : fmt(_('Server · %s'), p.name);
  const el = h(
    'div',
    { class: 'view' },
    head(title),
    sub(
      cur ? fmt(_('Now on %s. Access, end date and limits stay.'), cur.name) : _('No server yet: their devices have nowhere to connect.'),
    ),
    opts,
  );
  return { el, label: title };
}

export const movePerson = (c: MoveCtx) => openSheet(() => vMove(c));
