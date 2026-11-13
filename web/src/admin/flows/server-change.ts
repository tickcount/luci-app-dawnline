// The one question before a server's staged changes are applied
// (servers/pending.ts): what changes, which devices fetch their configuration
// again after all of it (each counted once: of how many people, those of
// people without access now, those not set up yet), and whether they stop
// connecting meanwhile or keep working the old way. One change is asked in
// its own words; several are named in a list under one title. After it the
// page's rollout strip counts the devices (the router marks them stale).

import { h, type Kid } from '../../portal/dom';
import { closeSheet, onClosed, openSheet } from '../../portal/ui/sheet';
import { fmt, plural } from '../../shared/i18n';
import type { Refetch } from '../servers/rollout';
import type { Staged, Summary } from '../servers/pending';
import { askView } from './ask';

/** The question's title for one change. */
function title(c: Staged): string {
  if (c.title) return c.title;
  switch (c.kind) {
    case 'address':
      return fmt(_('Address for devices: %s?'), c.value);
    case 'port':
      return fmt(_('UDP port: %s?'), c.value);
    case 'subnet':
      return fmt(_('Tunnel network: %s?'), c.value);
    case 'dns':
      return fmt(_('DNS for devices: %s?'), c.value);
    case 'mtu':
      return fmt(_('MTU: %s?'), c.value);
    case 'keepalive':
      return fmt(_('Keep-alive: %s?'), c.value);
    case 'mesh':
    case 'rule':
      return c.apart ? _('Keep devices apart?') : fmt(_('Devices see each other: %s?'), c.value);
    case 'route':
      return fmt(_('Internet traffic: %s?'), c.value);
    case 'wan':
      return fmt(_('WAN: %s?'), c.value);
    case 'home':
      return _('Change the home networks?');
    case 'behind':
      return _('Change the networks behind routers?');
    case 'portal_routers':
      return fmt(_('Adding a router on people’s pages: %s?'), c.value);
    case 'portal_nets':
      return fmt(_('Changing a router’s networks on people’s pages: %s?'), c.value);
    case 'renew':
      return _('Generate new disguise values?');
    case 'disguise':
      return fmt(_('Disguise: %s?'), c.value);
  }
}

/** What happens to the `n` devices until they fetch it, for one change. */
function consequence(c: Staged, n: number): string {
  switch (c.kind) {
    case 'disguise':
    case 'renew':
      return plural(
        n,
        '%s device stops connecting until it fetches its configuration again: it has the old disguise.',
        '%s devices stop connecting until they fetch their configuration again: theirs has the old disguise.',
      );
    case 'address':
      return plural(
        n,
        '%s device stops connecting until it fetches its configuration again: it has the old address.',
        '%s devices stop connecting until they fetch their configuration again: theirs has the old address.',
      );
    case 'port':
      return plural(
        n,
        '%s device stops connecting until it fetches its configuration again: it has the old port.',
        '%s devices stop connecting until they fetch their configuration again: theirs has the old port.',
      );
    case 'subnet':
      return plural(
        n,
        '%s device stops connecting until it fetches its configuration again: its address is from the old network.',
        '%s devices stop connecting until they fetch their configuration again: their addresses are from the old network.',
      );
    case 'dns':
      return plural(
        n,
        '%s device keeps asking the old DNS until it fetches its configuration again. Its connection is not interrupted.',
        '%s devices keep asking the old DNS until they fetch their configuration again. Their connection is not interrupted.',
      );
    case 'mtu':
      return plural(
        n,
        '%s device stays on the old MTU until it fetches its configuration again. Its connection is not interrupted.',
        '%s devices stay on the old MTU until they fetch their configuration again. Their connection is not interrupted.',
      );
    case 'keepalive':
      return plural(
        n,
        '%s device keeps its old keep-alive until it fetches its configuration again. Its connection is not interrupted.',
        '%s devices keep their old keep-alive until they fetch their configuration again. Their connection is not interrupted.',
      );
    case 'mesh':
      return c.apart
        ? `${_('The router stops letting devices reach each other at once.')} ${plural(
            n,
            '%s device fetches its configuration again to drop the extra routes.',
            '%s devices fetch their configuration again to drop the extra routes.',
          )}`
        : plural(
            n,
            '%s device sees the others once it fetches its configuration again. Until then it works the old way.',
            '%s devices see the others once they fetch their configuration again. Until then they work the old way.',
          );
    case 'home':
      return plural(
        n,
        '%s device reaches the new home networks once it fetches its configuration again. Until then it works the old way.',
        '%s devices reach the new home networks once they fetch their configuration again. Until then they work the old way.',
      );
    case 'behind':
      return plural(
        n,
        '%s device reaches these networks once it fetches its configuration again. Until then it works the old way.',
        '%s devices reach these networks once they fetch their configuration again. Until then they work the old way.',
      );
    // the router's own side: no device fetches anything for these (they are never asked about alone)
    case 'rule':
    case 'route':
    case 'wan':
    case 'portal_routers':
    case 'portal_nets':
      return '';
  }
}

/** The same for several changes at once: the worst of them says it. */
const together = (s: Summary): string =>
  s.breaks
    ? plural(
        s.refetch.n,
        '%s device stops connecting until it fetches its configuration again.',
        '%s devices stop connecting until they fetch their configuration again.',
      )
    : plural(
        s.refetch.n,
        '%s device works the old way until it fetches its configuration again. Its connection is not interrupted.',
        '%s devices work the old way until they fetch their configuration again. Their connection is not interrupted.',
      );

/** Whose devices they are, beyond the count. */
const whose = (r: Refetch): Kid[] => [
  r.people > 1 ? ` ${plural(r.people, 'They belong to %s person.', 'They belong to %s people.')}` : null,
  r.paused
    ? ` ${plural(r.paused, '%s of them belongs to someone without access now: it fetches it when access is back.', '%s of them belong to people without access now: they fetch it when access is back.')}`
    : null,
  r.fresh
    ? ` ${plural(r.fresh, '%s more is not set up yet: it gets the new one right away.', '%s more are not set up yet: they get the new one right away.')}`
    : null,
];

/** «3 devices fetch the configuration», after the toast's own words. */
export const fetches = (n: number): string => plural(n, '%s device fetches the configuration', '%s devices fetch the configuration');

/**
 * Ask once about every staged change, then `run` them. Resolves with whether they were made (the question shut:
 * false; the router refusing: its reason in a toast, the question stays open).
 */
export function askChanges(list: Staged[], s: Summary, run: () => Promise<void>): Promise<boolean> {
  const one = list.length === 1 ? list[0] : null;
  const more = list.map((x) => x.more).filter(Boolean);
  const text: Kid[] = one
    ? [h('span', {}, consequence(one, s.refetch.n)), ...whose(s.refetch), one.more ? ` ${one.more}` : null]
    : [
        h('span', { class: 'ask-list' }, ...list.map((x) => h('b', {}, x.label))),
        h('span', {}, together(s)),
        ...whose(s.refetch),
        more.length ? ` ${more.join(' ')}` : null,
      ];
  return new Promise((res) => {
    let took = false;
    openSheet(() =>
      askView({
        icon: 'refresh',
        tone: 'orange',
        title: one ? title(one) : plural(list.length, 'Apply %s change?', 'Apply %s changes?'),
        text,
        action: one ? _('Change') : _('Apply'),
        cls: 'warn',
        run: async () => {
          await run();
          took = true;
          closeSheet();
        },
      }),
    );
    onClosed(() => res(took));
  });
}
