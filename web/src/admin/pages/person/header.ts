// Person page: the name block with its actions, and the traffic tiles.

import { E } from '../../e';
import { button, iconButton } from '../../ui/button';
import { dropdown, type MenuItem } from '../../ui/menu';
import { statePill } from '../../ui/badges';
import { icon } from '../../../shared/icons';
import { ago, bytes, date, initials, isoDay } from '../../../shared/format';
import { fmt } from '../../../shared/i18n';
import { copyPersonLink } from '../../invite';
import { daysTile, speedTile } from '../../widgets/tiles';
import { editNote, invite, moveToServer, newLink, remove, rename } from './dialogs';
import type { PersonPage } from './index';

export function headPart(page: PersonPage): HTMLElement {
  const p = page.p;
  const st = page.st;
  const lastSeen = p.online ? _('online now') : p.last_seen ? fmt(_('last seen %s'), ago(p.last_seen, st.now)) : _('never connected');
  const added = p.created ? fmt(_('Added %s', 'date'), date(isoDay(new Date(p.created * 1000)))) : '';
  // The personal link is not in the status: its actions ask for it while there is one.
  const portal = p.has_link ?? st.settings.portal_enabled;
  const menu: (MenuItem | null)[] = [
    { label: _('Rename'), icon: icon('edit'), run: () => rename(page) },
    { label: p.note ? _('Edit note') : _('Add note'), icon: icon('file'), run: () => editNote(page) },
    // With one server there is nowhere to move to.
    ...(st.servers.length > 1 ? [{ label: _('Move to server…'), icon: icon('server'), run: () => moveToServer(page) }] : []),
    ...(portal
      ? [
          null,
          { label: _('Invite card'), icon: icon('qr'), run: () => invite(page) },
          { label: _('New link'), icon: icon('key'), run: () => newLink(page) },
        ]
      : []),
    null,
    // While paused, Resume is the page's own button (as the server's Turn on).
    ...(p.paused ? [] : [{ label: _('Pause'), icon: icon('pause'), warn: true, run: () => page.patch({ paused: true }, _('Paused')) }]),
    { label: _('Delete'), icon: icon('trash'), danger: true, run: () => remove(page) },
  ];
  return E('div', { class: 'dl-person-head' }, [
    E('div', { class: 'dl-pagehead' }, [
      E('div', { class: 'dl-person-id' }, [
        E('span', { class: `dl-avatar lg${p.online ? ' online' : ''}` }, initials(p.name)),
        E('div', { class: 'dl-stack' }, [
          E('div', { class: 'dl-title-row' }, [E('h2', { class: 'dl-h1' }, p.name), statePill(p)]),
          E(
            'span',
            { class: 'dl-faint', title: added },
            `${fmt(N_(p.device_limit, '%s of %s device', '%s of %s devices'), p.devices.length, p.device_limit)} · ${lastSeen}`,
          ),
        ]),
      ]),
      E('div', { class: 'dl-pcard-actions' }, [
        // White, as the server's Turn on.
        p.paused ? button([icon('play'), ` ${_('Resume')}`], () => page.patch({ paused: false }, _('Resumed')), 'add') : '',
        portal ? iconButton('link', _('Copy link'), () => copyPersonLink(p.id), 'neutral', 'dl-icon-only') : '',
        iconButton('more', _('More'), (ev: MouseEvent) => dropdown(ev.currentTarget as HTMLElement, menu), 'neutral', 'dl-icon-only'),
      ]),
    ]),
    // Under the name block, not inside it, so the avatar centres on name + status; indented to the name.
    p.note
      ? E('button', { type: 'button', class: 'dl-pnote', title: _('Edit note'), click: () => editNote(page) }, [
          icon('file'),
          E('span', {}, p.note),
        ])
      : '',
  ]);
}

/** Speed now and the last 30 days, the same tiles as the server Overview; speed only while a device is online. */
export function trafficPart(page: PersonPage): HTMLElement {
  const p = page.p;
  // Today on the router: the last day of the series.
  const todayUse = page.series[page.series.length - 1];
  return E('div', { class: `dl-person-live${p.online ? '' : ' solo'}` }, [
    p.online ? speedTile(p.rate ?? [], page.st.now, todayUse ? [todayUse.rx, todayUse.tx] : [0, 0]) : '',
    daysTile(page.series, fmt(_('%s this month'), bytes(p.month[0] + p.month[1]))),
  ]);
}
