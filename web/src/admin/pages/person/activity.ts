// Person page: where they connected from (one line, the map on request) and their activity.

import { E } from '../../e';
import { button } from '../../ui/button';
import { dropdown } from '../../ui/menu';
import { icon } from '../../../shared/icons';
import { fill, fmt, num, plural } from '../../../shared/i18n';
import { ConnectionMap, rangeControl } from '../../map';
import { eventRow, eventText } from '../../events/render';
import { clearLogDialog, exportEvents } from '../../logs';
import { openDevice } from '../../device';
import type { PersonPage } from './index';

function mapCard(page: PersonPage): HTMLElement {
  const st = page.st;
  const head = E('div', { class: 'dl-panel-head pad' }, [
    E('h3', {}, _('Locations')),
    E('span', { class: 'dl-spacer' }),
    st.geo.enabled ? rangeControl('30d', (r) => page.map?.setRange(r), false) : '',
    button(
      _('Hide'),
      () => {
        page.mapOpen = false;
        page.map?.destroy();
        page.map = null;
        page.paintPlaces();
      },
      'neutral',
    ),
  ]);
  if (!st.geo.enabled)
    return E('div', { class: 'dl-panel flush' }, [
      head,
      E(
        'div',
        { class: 'dl-map-off' },
        fill(_('Locations are off. %s.'), E('a', { href: L.url('admin/services/dawnline/settings') }, _('Turn them on in Settings'))),
      ),
    ]);
  const map = new ConnectionMap(
    {
      openPerson: () => undefined,
      openDevice: (_pid, did) => {
        const d = page.p.devices.find((x) => x.id === did);
        if (d) void openDevice(page.p, d, page.deviceOpts());
      },
    },
    '30d',
    280,
  );
  page.map = map;
  requestAnimationFrame(() => map.mount(page.mapData()));
  return E('div', { class: 'dl-panel flush' }, [head, map.el]);
}

/** Where they connected from: one line, the map on request; null while the open map is already there. */
export function placesPart(page: PersonPage): HTMLElement | null {
  const st = page.st;
  if (!st.geo.enabled)
    return E('div', { class: 'dl-places' }, [
      icon('pin'),
      E('div', { class: 'dl-stack' }, [
        E('span', {}, _('Locations are off')),
        E('span', { class: 'dl-sub' }, _('City-level, from the client IP')),
      ]),
      E('span', { class: 'dl-spacer' }),
      E('a', { class: 'cbi-button cbi-button-neutral', href: L.url('admin/services/dawnline/settings') }, _('Turn on')),
    ]);
  if (page.mapOpen) return page.map && page.parts.places.contains(page.map.el) ? null : mapCard(page);
  const since = st.now - 30 * 86400;
  const pts = st.geo.points.filter((g) => g.person === page.p.id && g.ts >= since).sort((a, b) => b.ts - a.ts);
  const places = [...new Set(pts.map((g) => g.city || g.country).filter(Boolean))];
  const last = pts[0];
  return E('div', { class: 'dl-places' }, [
    icon('pin'),
    E('div', { class: 'dl-stack' }, [
      E('span', {}, last ? last.city || last.country : _('No locations yet')),
      E(
        'span',
        { class: 'dl-sub' },
        last
          ? [plural(places.length, '%s place in 30 days', '%s places in 30 days'), last.org].filter(Boolean).join(' · ')
          : _('Shown after a device connects'),
      ),
    ]),
    E('span', { class: 'dl-spacer' }),
    pts.length
      ? button(
          _('Show map'),
          () => {
            page.mapOpen = true;
            page.paintPlaces();
          },
          'neutral',
        )
      : '',
  ]);
}

/** The latest 10 events about them; back-and-forth network changes (Wi-Fi ⇄ mobile) fold into one row. */
export function activityPart(page: PersonPage): HTMLElement {
  const p = page.p;
  const st = page.st;
  const all = page.events.filter((e) => e.person === p.id);
  const rows: HTMLElement[] = [];
  const latest = [...all].reverse();
  for (let i = 0; i < latest.length && rows.length < 10; i++) {
    const e = latest[i];
    let n = 1;
    while (e.type === 'roam' && latest[i + n]?.type === 'roam' && latest[i + n].device === e.device) n++;
    const row = eventRow(st, e, { server: false, person: p.id });
    if (n > 1) {
      const main = row.querySelector('.dl-row-main') as HTMLElement;
      dom.content(main, [...eventText(st, e, p.id).slice(0, 3), E('span', { class: 'dl-muted' }, plural(n, '%s time', '%s times'))]);
      main.title = latest
        .slice(i, i + n)
        .map((x) => x.detail ?? '')
        .join('\n');
    }
    rows.push(row);
    i += n - 1;
  }
  const more = button(
    [icon('more')],
    () =>
      dropdown(more, [
        { label: _('Export CSV'), icon: icon('download'), run: () => exportEvents(st, all, 'csv', p.id) },
        { label: _('Export JSON'), icon: icon('download'), run: () => exportEvents(st, all, 'json', p.id) },
        null,
        {
          label: fmt(_("Clear %s's activity"), p.name),
          icon: icon('trash'),
          danger: true,
          run: () =>
            clearLogDialog(
              fmt(_("Clear %s's activity"), p.name),
              fmt(_('Removes events about %s and their devices.'), p.name),
              { person: p.id },
              () => page.refresh(),
            ),
        },
      ]),
    'neutral',
    { title: _('Export or clear'), class: 'cbi-button cbi-button-neutral dl-icon-only' },
  );
  return E('div', { class: 'dl-panel flush' }, [
    E('div', { class: 'dl-panel-head pad' }, [
      E('h3', {}, _('Activity')),
      E('span', { class: 'dl-sub' }, all.length > 10 ? fmt(_('latest 10 of %s'), num(all.length)) : ''),
      E('span', { class: 'dl-spacer' }),
      more,
    ]),
    rows.length ? rows : E('div', { class: 'dl-row dl-muted' }, _('Nothing yet.')),
  ]);
}
