// Person page: the finer access choices (home services, home networks, DNS)
// and the Devices and circle tiles.

import { E } from '../../e';
import { notify } from '../../ui/toast';
import { chipToggle, seg } from '../../ui/controls';
import { dropdown } from '../../ui/menu';
import { attachTip } from '../../ui/tooltip';
import { icon } from '../../../shared/icons';
import { ago, initials } from '../../../shared/format';
import { circleDialog, circleDot, homeAccess } from '../../access';
import type { PersonPage } from './index';

/**
 * DNS for Home-only access. The internet does not go through the tunnel, so
 * by default the device keeps its own DNS; home names are opt-in.
 */
export function dnsPicker(page: PersonPage): HTMLElement {
  const p = page.p;
  const choice = seg(
    [
      ['device', 'Device’s own DNS'],
      ['home', 'Home names'],
    ],
    p.dns_mode,
    {
      label: 'DNS',
      cls: 'sm',
      optimistic: false,
      onChange: (v) =>
        page.patch(
          { dns_mode: v },
          v === 'home' ? 'Home names on — devices need their configuration again' : 'Device DNS — devices need their configuration again',
        ),
    },
  );
  const fb = page.st.settings.home_dns_fallback;
  return E('div', { class: 'dl-stack gap4 dl-dnspick' }, [
    E('div', { class: 'dl-row-actions' }, [E('span', { class: 'dl-sub' }, 'DNS'), choice]),
    E(
      'span',
      { class: 'dl-sub' },
      p.dns_mode === 'home'
        ? [
            'Names like ',
            E('span', { class: 'dl-mono' }, `nas.${page.st.settings.domain}`),
            ' work. Internet names are resolved at home, so they depend on the tunnel',
            fb
              ? [' (', E('span', { class: 'dl-mono' }, fb), ' takes over when it is down).']
              : ' — with no fallback set, they stop when it is down.',
          ]
        : 'Internet keeps working exactly as without the VPN. Reach home devices by IP address.',
    ),
  ]);
}

/** Home networks this person reaches, when the server has more than one. */
export function netsPicker(page: PersonPage): HTMLElement | '' {
  const p = page.p;
  const srv = page.st.servers.find((x) => x.id === p.server);
  const all = srv?.home ?? [];
  if (all.length < 2) return '';
  const picked = new Set(p.home_nets?.length ? p.home_nets : all.map((h) => h.dev));
  return E('div', { class: 'dl-stack gap4' }, [
    E(
      'div',
      { class: 'dl-chips-row' },
      all.map((h) =>
        chipToggle(
          h.dev,
          picked.has(h.dev),
          () => {
            const next = new Set(picked);
            if (!next.delete(h.dev)) next.add(h.dev);
            if (!next.size) return notify('Keep at least one network, or choose Internet only.', 'warning', 5000);
            const list = next.size === all.length ? [] : [...next];
            void page.patch(
              { home_nets: list },
              list.length ? `${p.name} reaches ${list.join(', ')}` : `${p.name} reaches every home network`,
            );
          },
          { title: h.nets.join(', ') },
        ),
      ),
    ),
    E(
      'span',
      { class: 'dl-sub' },
      p.home_nets?.length
        ? `Home networks ${p.name} reaches. Networks added to the server later stay out.`
        : `Home networks ${p.name} reaches: all of them. Untick one to keep ${p.name} out of it.`,
    ),
  ]);
}

/** Optional narrowing of home-network access to selected services; the request gets a copy of the choice. */
export function servicesPicker(page: PersonPage): HTMLElement {
  const chosen = new Set(page.p.services ?? []);
  return E('div', { class: 'dl-stack gap4' }, [
    E(
      'div',
      { class: 'dl-chips-row' },
      page.st.services.map((sv) =>
        chipToggle(
          sv.name,
          chosen.has(sv.id),
          () => {
            // A copy: the chips show the saved choice until the router has it (a failed save changes nothing).
            const next = new Set(chosen);
            if (!next.delete(sv.id)) next.add(sv.id);
            void page.patch({ services: [...next] }, next.size ? 'Home services updated' : 'Whole home network');
          },
          { title: `${sv.address}${sv.ports.length ? ` · ${sv.ports.join(', ')}` : ''}` },
        ),
      ),
    ),
    E(
      'span',
      { class: 'dl-sub' },
      chosen.size ? 'Only the selected services at home.' : 'Whole home network. Pick services to narrow it down.',
    ),
  ]);
}

/** The circle this person's devices share (servers where devices reach each other in circles). */
export function circleTile(page: PersonPage): HTMLElement | '' {
  const p = page.p;
  const st = page.st;
  const srv = st.servers.find((x) => x.id === p.server);
  if (srv?.mesh !== 'circles' || !homeAccess(p)) return '';
  const circles = st.circles.filter((c) => c.server === p.server);
  const ci = circles.find((c) => c.id === p.circle);
  const mates = ci ? st.people.filter((x) => x.id !== p.id && x.circle === ci.id && homeAccess(x)).map((x) => x.name) : [];
  const change: HTMLElement = E(
    'button',
    {
      type: 'button',
      class: 'dl-chipbtn',
      click: () =>
        dropdown(change, [
          ...circles.map((c) => ({
            label: c.name,
            icon: circleDot(c),
            run: () => c.id !== p.circle && page.patch({ circle: c.id }, `${p.name} is in ${c.name}`),
          })),
          p.circle ? { label: 'No circle', icon: icon('x'), run: () => page.patch({ circle: '' }, `${p.name} is in no circle`) } : null,
          { label: 'New circle', icon: icon('plus'), run: () => circleDialog(st, p.server, null, () => page.refresh()) },
        ]),
    },
    'Change',
  );
  // As the other tiles: the name is the value; who is in it as avatars.
  const people = ci ? st.people.filter((x) => x.circle === ci.id && homeAccess(x)) : [p];
  return E('div', { class: 'dl-tile2' }, [
    E('div', { class: 'dl-tile2-label' }, [E('span', {}, 'Devices see each other'), change]),
    E('div', { class: 'dl-tile2-row' }, [
      E('span', { class: 'dl-tile2-value' }, ci ? ci.name : 'No circle'),
      E(
        'span',
        { class: 'dl-avstack', title: people.map((x) => x.name).join(', ') },
        people.slice(0, 5).map((x) => E('span', { class: 'dl-avatar sm' }, initials(x.name))),
      ),
    ]),
    E(
      'span',
      { class: 'dl-sub' },
      !ci ? `Only ${p.name}'s own devices` : mates.length ? [p.name, ...mates].join(', ') : `Nobody else in ${ci.name} yet`,
    ),
  ]);
}

/** Device limit with a slot per device; never below the devices in use. */
export function devTile(page: PersonPage): HTMLElement {
  const p = page.p;
  const now = page.st.now;
  const slots = E('div', { class: 'dl-slots' });
  // Devices added over the limit get their own soft orange slots after the allowed ones.
  for (let i = 0; i < Math.max(p.device_limit, p.devices.length); i++) {
    const d = p.devices[i];
    const over = i >= p.device_limit;
    const slot = E('i', { class: over ? 'over' : d ? 'used' : '' });
    attachTip(slot, () => [
      E('div', { class: 'dl-tip-title' }, d ? `${d.name}${over ? ' · over the limit' : ''}` : 'Free slot'),
      E(
        'div',
        { class: 'dl-muted' },
        d ? (d.online ? 'Connected' : d.handshake ? `Last seen ${ago(d.handshake, now)}` : 'Not set up yet') : 'They can add a device here',
      ),
    ]);
    slots.appendChild(slot);
  }
  const floor = Math.max(1, p.devices.length);
  const minus = E(
    'button',
    {
      type: 'button',
      'aria-label': 'Allow fewer devices',
      disabled: p.device_limit <= floor ? 'disabled' : null,
      click: () => page.patch({ device_limit: String(p.device_limit - 1) }),
    },
    '−',
  );
  if (p.device_limit <= floor && p.devices.length > 1)
    attachTip(minus, () => [
      E('div', { class: 'dl-tip-title' }, `${p.devices.length} devices in use`),
      E('div', { class: 'dl-muted' }, 'Remove a device first to lower the limit'),
    ]);
  return E('div', { class: 'dl-tile2' }, [
    E('div', { class: 'dl-tile2-label' }, 'Devices'),
    E('div', { class: 'dl-tile2-row' }, [
      E('span', { class: 'dl-tile2-value' }, [String(p.devices.length), E('span', { class: 'dl-faint' }, ` / ${p.device_limit}`)]),
      E('div', { class: 'dl-stepper' }, [
        minus,
        E(
          'button',
          {
            type: 'button',
            'aria-label': 'Allow more devices',
            disabled: p.device_limit >= 32 ? 'disabled' : null,
            click: () => page.patch({ device_limit: String(p.device_limit + 1) }),
          },
          '+',
        ),
      ]),
    ]),
    slots,
  ]);
}
