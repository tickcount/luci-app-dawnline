// The router's networks home access leads to, as a list of switches (Settings › Home network). One row a
// network: its glass (blue while home access leads there), its name, its subnet in mono and its firewall zone as the
// line under it, the switch at the end. The LAN the router found by itself is on and locked, with «Auto» beside its
// switch; a network no firewall zone holds wears its reason in warn in the zone's place (the section's notice says
// the rest once). A choice that waits for «Apply» is said in the row's own line. The interfaces that cannot be home
// networks fold under the list, by why they are not offered: a reason once, with the interfaces it holds for
// (six ports of one bridge are one row, not the same words six times).
//
// Why not tiles: a tile says «one of», a switch says «this one too»; the tiles' corner mark sat on their text.

import { h } from '../../portal/dom';
import { fmt, plural } from '../../shared/i18n';
import { glass } from '../ui/glass';
import { ic } from '../ui/icons';
import { unfold } from '../ui/reshape';
import { tip } from '../../portal/ui/tip';
import { flippedNow } from '../../portal/ui/carry';

interface NetRow {
  name: string;
  icon: string;
  /** Its IPv4 networks. */
  nets: string[];
  zone: string | null;
  on: boolean;
  /** Found by itself (Auto-detect LAN): on, and not turned off here. */
  auto?: boolean;
  /** Not present right now. */
  missing?: boolean;
  /** The choice differs from what the server has: it waits for «Apply». */
  waits?: boolean;
}

export interface NetSwitches {
  rows: NetRow[];
  /** Interfaces that are not offered, with why. */
  rest: { name: string; why: string }[];
  /** What turning one on means, under the list. */
  note: string;
  write: boolean;
  flip(name: string, on: boolean): void;
}

function row(o: NetSwitches, r: NetRow): HTMLElement {
  const noZone = r.on && !r.zone && !r.missing;
  const line = h(
    'span',
    { class: 'sw-sub' },
    r.nets.length ? h('span', { class: 'mono' }, r.nets.join(', ')) : _('No IPv4 network'),
    h('span', { class: 'ph-sep', 'aria-hidden': 'true' }, ' · '),
    r.missing
      ? h('span', { class: 'warn-t' }, _('not present right now'))
      : noZone
        ? h('span', { class: 'warn-t' }, _('no firewall zone'))
        : r.zone
          ? fmt(_('zone %s'), r.zone)
          : _('no firewall zone'),
    r.waits ? h('span', { class: 'warn-t' }, ` · ${_('not applied')}`) : null,
  );
  const press = o.write && !r.auto;
  const el = h(
    press ? 'button' : 'div',
    {
      type: press ? 'button' : null,
      class: `swrow kt-net${r.on ? ' on' : ''}${noZone ? ' warn' : ''}${r.auto ? ' locked' : ''}`,
      role: press ? 'switch' : null,
      'aria-checked': press ? String(r.on) : null,
    },
    glass(r.icon, noZone ? 'orange' : 'blue'),
    h('span', { class: 'sw-t' }, h('b', {}, r.name), line),
    r.auto ? h('span', { class: 'kt-net-auto' }, _('Auto')) : null,
    o.write || r.on ? h('span', { class: 'sw', 'aria-hidden': 'true' }) : null,
  );
  if (r.auto)
    tip(el.querySelector<HTMLElement>('.kt-net-auto')!, () =>
      _('The LAN this router uses, found by itself. Turn «Auto-detect LAN» off to choose it yourself.'),
    );
  if (press)
    el.addEventListener('click', () => {
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', String(on));
      flippedNow(el);
      o.flip(r.name, on);
    });
  return el;
}

export function netSwitches(o: NetSwitches): HTMLElement {
  // by reason, in the order the reasons first come
  const why = new Map<string, string[]>();
  for (const x of o.rest) why.set(x.why, [...(why.get(x.why) ?? []), x.name]);
  const more = h(
    'div',
    { class: 'kt-net-rest', hidden: true },
    ...[...why].map(([reason, names]) =>
      h(
        'div',
        { class: 'kt-net-why' },
        h('b', {}, reason),
        h('span', { class: 'kt-net-ifs' }, ...names.map((n) => h('span', { class: 'mono' }, n))),
      ),
    ),
  );
  const fold = o.rest.length
    ? h(
        'button',
        {
          type: 'button',
          class: 'pill-link kt-net-more',
          'aria-expanded': 'false',
          onclick: (e: Event) => {
            const b = e.currentTarget as HTMLElement;
            const open = b.getAttribute('aria-expanded') !== 'true';
            b.setAttribute('aria-expanded', String(open));
            unfold(more, open);
          },
        },
        plural(o.rest.length, '%s interface is not offered', '%s interfaces are not offered'),
        ic('chevron'),
      )
    : null;
  return h(
    'div',
    { class: 'kt-nets' },
    o.rows.length
      ? h('div', { class: 'kt-net-list', role: 'group' }, ...o.rows.map((r) => row(o, r)))
      : h('p', { class: 'desc warn-t' }, _('No home network: Home access reaches nothing but this router.')),
    o.rows.length ? h('p', { class: 'kt-net-note' }, o.note) : null,
    fold,
    more,
  );
}
