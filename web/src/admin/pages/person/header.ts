// Person page: the name block with its actions, and the traffic tiles.

import { E } from '../../e';
import { iconButton } from '../../ui/button';
import { dropdown, type MenuItem } from '../../ui/menu';
import { stateBadge } from '../../ui/badges';
import { icon } from '../../../shared/icons';
import { ago, bytes, date, initials, isoDay } from '../../../shared/format';
import { copyPersonLink } from '../../invite';
import { daysTile, speedTile } from '../../widgets/tiles';
import { editNote, invite, newLink, remove, rename } from './dialogs';
import type { PersonPage } from './index';

export function headPart(page: PersonPage): HTMLElement {
  const p = page.p;
  const st = page.st;
  const lastSeen = p.online ? 'online now' : p.last_seen ? `last seen ${ago(p.last_seen, st.now)}` : 'never connected';
  const added = p.created ? `Added ${date(isoDay(new Date(p.created * 1000)))}` : '';
  // The personal link is not in the status: its actions ask for it while there is one.
  const portal = p.has_link ?? st.settings.portal_enabled;
  const menu: (MenuItem | null)[] = [
    { label: 'Rename', icon: icon('edit'), run: () => rename(page) },
    { label: p.note ? 'Edit note' : 'Add note', icon: icon('file'), run: () => editNote(page) },
    ...(portal
      ? [
          null,
          { label: 'Invite card', icon: icon('qr'), run: () => invite(page) },
          { label: 'New link', icon: icon('key'), run: () => newLink(page) },
        ]
      : []),
    null,
    {
      label: p.paused ? 'Resume' : 'Pause',
      icon: icon(p.paused ? 'play' : 'pause'),
      warn: !p.paused,
      run: () => page.patch({ paused: !p.paused }, p.paused ? 'Resumed' : 'Paused'),
    },
    { label: 'Delete', icon: icon('trash'), danger: true, run: () => remove(page) },
  ];
  return E('div', { class: 'dl-person-head' }, [
    E('div', { class: 'dl-pagehead' }, [
      E('div', { class: 'dl-person-id' }, [
        E('span', { class: `dl-avatar lg${p.online ? ' online' : ''}` }, initials(p.name)),
        E('div', { class: 'dl-stack' }, [
          E('div', { class: 'dl-title-row' }, [E('h2', { class: 'dl-h1' }, p.name), stateBadge(p)]),
          E('span', { class: 'dl-faint', title: added }, `${p.devices.length} of ${p.device_limit} devices · ${lastSeen}`),
        ]),
      ]),
      E('div', { class: 'dl-pcard-actions' }, [
        portal ? iconButton('link', 'Copy link', () => copyPersonLink(p.id), 'neutral', 'dl-icon-only') : '',
        iconButton('more', 'More', (ev: MouseEvent) => dropdown(ev.currentTarget as HTMLElement, menu), 'neutral', 'dl-icon-only'),
      ]),
    ]),
    // Under the name block, not inside it, so the avatar centres on name + status; indented to the name.
    p.note
      ? E('button', { type: 'button', class: 'dl-pnote', title: 'Edit note', click: () => editNote(page) }, [
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
    daysTile(page.series, `${bytes(p.month[0] + p.month[1])} this month`),
  ]);
}
