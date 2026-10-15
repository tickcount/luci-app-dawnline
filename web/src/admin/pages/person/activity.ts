// Person page: where they connected from (one line, the map on request) and their activity.

import { E } from '../../e';
import { button } from '../../ui/button';
import { dropdown } from '../../ui/menu';
import { icon } from '../../../shared/icons';
import { ConnectionMap, rangeControl } from '../../map';
import { eventRow, eventText } from '../../events/render';
import { clearLogDialog, exportEvents } from '../../logs';
import { openDevice } from '../../device';
import type { PersonPage } from './index';

function mapCard(page: PersonPage): HTMLElement {
  const st = page.st;
  const head = E('div', { class: 'dl-panel-head pad' }, [
    E('h3', {}, 'Locations'),
    E('span', { class: 'dl-spacer' }),
    st.geo.enabled ? rangeControl('30d', (r) => page.map?.setRange(r), false) : '',
    button(
      'Hide',
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
      E('div', { class: 'dl-map-off' }, [
        'Locations are off. ',
        E('a', { href: L.url('admin/network/dawnline/settings') }, 'Turn them on in Settings'),
        '.',
      ]),
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
        E('span', {}, 'Locations are off'),
        E('span', { class: 'dl-sub' }, 'City-level, from the client IP'),
      ]),
      E('span', { class: 'dl-spacer' }),
      E('a', { class: 'cbi-button cbi-button-neutral', href: L.url('admin/network/dawnline/settings') }, 'Turn on'),
    ]);
  if (page.mapOpen) return page.map && page.parts.places.contains(page.map.el) ? null : mapCard(page);
  const since = st.now - 30 * 86400;
  const pts = st.geo.points.filter((g) => g.person === page.p.id && g.ts >= since).sort((a, b) => b.ts - a.ts);
  const places = [...new Set(pts.map((g) => g.city || g.country).filter(Boolean))];
  const last = pts[0];
  return E('div', { class: 'dl-places' }, [
    icon('pin'),
    E('div', { class: 'dl-stack' }, [
      E('span', {}, last ? last.city || last.country : 'No locations yet'),
      E(
        'span',
        { class: 'dl-sub' },
        last
          ? `${places.length} place${places.length === 1 ? '' : 's'} in 30 days${last.org ? ` · ${last.org}` : ''}`
          : 'Shown after a device connects',
      ),
    ]),
    E('span', { class: 'dl-spacer' }),
    pts.length
      ? button(
          'Show map',
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
    const row = eventRow(st, e, { server: false });
    if (n > 1) {
      const main = row.querySelector('.dl-row-main') as HTMLElement;
      dom.content(main, [...eventText(st, e).slice(0, 3), E('span', { class: 'dl-muted' }, `${n} times`)]);
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
        { label: 'Export CSV', icon: icon('download'), run: () => exportEvents(st, all, 'csv', p.id) },
        { label: 'Export JSON', icon: icon('download'), run: () => exportEvents(st, all, 'json', p.id) },
        null,
        {
          label: `Clear ${p.name}'s activity`,
          icon: icon('trash'),
          danger: true,
          run: () =>
            clearLogDialog(`Clear ${p.name}'s activity`, `Removes events about ${p.name} and their devices.`, { person: p.id }, () =>
              page.refresh(),
            ),
        },
      ]),
    'neutral',
    { title: 'Export or clear', class: 'cbi-button cbi-button-neutral dl-icon-only' },
  );
  return E('div', { class: 'dl-panel flush' }, [
    E('div', { class: 'dl-panel-head pad' }, [
      E('h3', {}, 'Activity'),
      E('span', { class: 'dl-sub' }, all.length > 10 ? `latest 10 of ${all.length}` : ''),
      E('span', { class: 'dl-spacer' }),
      more,
    ]),
    rows.length ? rows : E('div', { class: 'dl-row dl-muted' }, 'Nothing yet.'),
  ]);
}
