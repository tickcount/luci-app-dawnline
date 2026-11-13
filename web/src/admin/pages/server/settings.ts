// A server's settings on its own page, three parts shown one at a time, every field in sight:
//   General: what the server is whatever serves it (its name, whether it runs, the address devices connect to,
//            removing it);
//   Core:    what is the tunnel core's own. AmneziaWG today (its disguise, the MTU and keep-alive of its
//            configurations, its interface and key); another core would bring its own part here, the rest of the
//            page staying as it is;
//   Network: where the tunnel leads (its own network and DNS, how internet traffic leaves, the home networks,
//            who sees whom, home services).
// The sections are the builders of pages/settings (stages.ts, disguise.ts, networks.ts), grouped by part; every
// change of them waits for «Apply» in the page's dock (pages/settings/changes.ts). Each is a part with a key of what
// it shows (pages/settings/parts.ts): it is built again only when that moved, and never while it is typed in.

import { h } from '../../../portal/dom';
import { fmt, plural } from '../../../shared/i18n';
import { card, note, section } from '../../ui/section';
import { compList, compRow } from '../../ui/comp-row';
import { switchRow, textRow } from '../../ui/edit-rows';
import { errorText, notify } from '../../ui/toast';
import { say } from '../../shell/toast';
import { nameHelp } from '../../netcheck';
import type { ServerPart } from '../../shell/routes';
import type { ServerCtx } from '../settings/ctx';
import type { Part } from '../settings/parts';
import { devicesSection, entrySection, keysSection, tunnelSection } from '../settings/stages';
import { disguiseSection } from '../settings/disguise';
import { homeSection, internetSection } from '../settings/networks';
import { removeServer, turnServer } from '../settings/server-bar';

/** A section under another name on this page (a stage's own name is the path's word for it). */
const retitle = (s: HTMLElement, title: string): HTMLElement => {
  const h2 = s.querySelector('.kt-sx-h h2');
  if (h2) h2.textContent = title;
  return s;
};

function serverSection(c: ServerCtx): HTMLElement {
  const s = c.srv;
  const name = textRow(
    {
      label: _('Name'),
      value: s.name,
      refuse: (v) => {
        const r = nameHelp(
          v,
          c.st.servers.filter((x) => x.id !== s.id).map((x) => x.name),
        );
        return r.bad ? r.text : null;
      },
      // a name typed and confirmed is saved as it is (it changes nothing of how the server works)
      ask: (v) =>
        void c.update({ name: v }).then(
          () => say(fmt(_('Renamed: %s'), v)),
          (e) => notify(errorText(e), 'error', 10000),
        ),
    },
    c.write,
  );
  const on = switchRow(
    {
      title: s.enabled ? _('Turned on') : _('Turned off'),
      // how it runs and for how long is the page's head's to say
      sub: s.enabled
        ? _('Turning it off disconnects everyone on it; nothing is deleted.')
        : _('The tunnel is stopped: nobody on this server connects.'),
      on: s.enabled,
      icon: 'server',
      // on at once; off is asked first (pages/settings/server-bar.ts)
      flip: (next) => turnServer(c, next),
    },
    c.write,
  );
  return section({ id: 'server', icon: 'server', title: _('Server') }, card(name, on));
}

function removeSection(c: ServerCtx): HTMLElement {
  const n = c.st.people.filter((p) => p.server === c.srv.id).length;
  const remove = c.write ? h('button', { type: 'button', class: 'btn red sm' }, h('span', {}, _('Remove'))) : null;
  remove?.addEventListener('click', () => removeServer(c));
  return section(
    { id: 'remove', icon: 'trash', title: _('Removal'), tone: 'red', danger: true },
    card(
      compList(
        compRow({
          icon: 'trash',
          tone: 'red',
          title: _('Remove the server'),
          line: plural(
            n,
            'With its %s person and all their devices. A backup is made first.',
            'With its %s people and all their devices. A backup is made first.',
          ),
          acts: [remove],
        }),
      ),
    ),
  );
}

/** The core's own card: which core serves the server, and that everything under it is that core's. */
const coreCard = (c: ServerCtx): HTMLElement =>
  h(
    'div',
    { class: 'card sv-core', 'data-id': 'core' },
    // a component row lives in a list (.checks), which rounds its ends
    h(
      'div',
      { class: 'checks' },
      compRow({
        // the core's own mark (as in Settings › Updates), not a generic shield
        icon: 'amneziawg',
        tone: 'blue',
        title: 'AmneziaWG',
        line: `${fmt(_('The tunnel core of this server · interface %s'), c.srv.ifname)} · ${_('installed')}`,
      }),
    ),
    note(_('The core decides how devices connect: its protocol, its disguise and its apps. Everything below is this core’s own.')),
  );

type Make = [id: string, make: (c: ServerCtx) => HTMLElement];

const PARTS: Record<'general' | 'core' | 'network', Make[]> = {
  general: [
    ['server', serverSection],
    ['entry', (c) => retitle(entrySection(c), _('Address'))],
    ['remove', removeSection],
  ],
  core: [
    ['core', coreCard],
    ['disguise', disguiseSection],
    ['devices', (c) => retitle(devicesSection(c), _('Configuration of devices'))],
    ['keys', keysSection],
  ],
  network: [
    ['tunnel', (c) => retitle(tunnelSection(c), _('Tunnel network and DNS'))],
    ['internet', internetSection],
    ['home', homeSection],
  ],
};

/** A section whose notice stands right under its head says only how many did not pass there: the notice has the words. */
function quietAside(sx: HTMLElement): HTMLElement {
  const n = sx.querySelectorAll('.st-health .srv-note').length;
  const st = sx.querySelector<HTMLElement>('.kt-sx-h .kt-sx-st:not(.ok):not(.off) span');
  if (n && st)
    st.textContent = sx.querySelector('.st-health .srv-note.bad')
      ? plural(n, '%s problem', '%s problems')
      : plural(n, '%s warning', '%s warnings');
  return sx;
}

/**
 * One part of a server's settings as its sections (no head of its own: the page's rail names the part); `key`: what
 * they all show (the server, its checks, what waits), so a section is built again only when that moved.
 */
export const settingsParts = (p: ServerPart, c: ServerCtx, key: string): Part[] =>
  (PARTS[p as 'general'] ?? []).map(([id, make]) => [id, () => quietAside(make(c)), key]);
