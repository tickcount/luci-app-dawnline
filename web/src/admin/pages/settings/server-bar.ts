// What is done to a server as a whole, from its page's General part
// (pages/server/settings.ts): turning it on (at once) or off (asked first:
// everyone on it disconnects), and removing it (asked, with what goes with
// it; a backup is made first).

import { api } from '../../api';
import { closeSheet, onClosed, openSheet } from '../../../portal/ui/sheet';
import { fmt, plural } from '../../../shared/i18n';
import { errorText, notify } from '../../ui/toast';
import { say } from '../../shell/toast';
import { href } from '../../shell/routes';
import { askView } from '../../flows/ask';
import type { ServerCtx } from './ctx';

/** Turn the server on, or off after asking; resolves with whether it took (the question closed: false). */
export function turnServer(c: ServerCtx, on: boolean): Promise<boolean> {
  if (on)
    return c.update({ enabled: '1' }).then(
      () => {
        say(_('Server turned on'));
        return true;
      },
      (e) => {
        notify(errorText(e), 'error', 10000);
        return false;
      },
    );
  const n = c.st.people.filter((p) => p.server === c.srv.id).length;
  return new Promise((res) => {
    let took = false;
    openSheet(() =>
      askView({
        icon: 'pause',
        tone: 'orange',
        title: fmt(_('Turn off %s?'), c.srv.name),
        text: [
          plural(
            n,
            'The tunnel stops and %s person is disconnected until you turn it back on. Nothing is deleted.',
            'The tunnel stops and %s people are disconnected until you turn it back on. Nothing is deleted.',
          ),
        ],
        action: _('Turn off'),
        cls: 'warn',
        run: async () => {
          await c.update({ enabled: '0' });
          took = true;
          closeSheet();
          say(_('Server turned off'));
        },
      }),
    );
    onClosed(() => res(took));
  });
}

export function removeServer(c: ServerCtx) {
  const n = c.st.people.filter((p) => p.server === c.srv.id).length;
  openSheet(() =>
    askView({
      icon: 'trash',
      tone: 'red',
      title: fmt(_('Remove %s?'), c.srv.name),
      text: [
        plural(
          n,
          'This removes the tunnel, its firewall rules and %s person with all their devices. A backup is made first.',
          'This removes the tunnel, its firewall rules and %s people with all their devices. A backup is made first.',
        ),
      ],
      action: _('Remove'),
      cls: 'red',
      run: async () => {
        await api.serverDelete(c.srv.id);
        closeSheet();
        say(_('Server removed'));
        // the server's page is gone with it: back to all servers
        location.href = href({ view: 'overview' });
      },
    }),
  );
}
