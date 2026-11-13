// Overview's head: the router's glass and name; after it the router's state
// in one phrase that counts the checks («2 warnings») and leads down to their
// list on this page (health.ts), then Dawnline's version, its servers and
// devices, «View only» for a read-only login. The notice and the watchdog's
// news are the list's, not the head's.

import { h } from '../../../portal/dom';
import { plural } from '../../../shared/i18n';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { fact, pageHead } from '../../ui/page-head';
import { healthUrl } from '../../shell/routes';
import { stateLine } from '../../overview/model';
import type { OverviewCtx } from './ctx';

/** `toHealth`: bring the checks into view (a plain click stays on the page; the address is for a new tab). */
export function overviewHead(c: OverviewCtx, toHealth: () => void): HTMLElement {
  const st = c.st;
  const line = stateLine(c.checks, c.checksFailed);
  const state = h('a', { class: `ph-state ov-state${line.tone ? ` ${line.tone}-t` : ''}`, href: healthUrl() }, line.text);
  state.addEventListener('click', (e) => {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    toHealth();
  });
  const devices = st.people.reduce((n, p) => n + p.devices.length, 0);
  const head = pageHead({ icon: glass('router', 'grey'), title: st.hostname || 'OpenWrt' });
  head
    .querySelector('.ph-sub')
    ?.replaceChildren(
      ...[
        fact(state),
        fact(`Dawnline ${st.version}`),
        fact(plural(st.servers.length, '%s server', '%s servers')),
        fact(plural(devices, '%s device', '%s devices')),
        c.write ? null : fact([ic('eye'), _('View only')]),
      ].filter((f): f is HTMLElement => !!f),
    );
  return head;
}
