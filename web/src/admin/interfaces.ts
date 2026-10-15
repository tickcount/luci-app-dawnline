// Interfaces card (Server page): auto-detected WAN and LAN, plus a picker for
// the interfaces that make up a server's home network.

import type { MeshMode, Server, Status } from '../shared/types';
import { E } from './e';
import { api, type IfaceCategory, type InterfacesData, type NetDevice } from './api';
import { circleChips, homeServices } from './access';
import { attempt, button, notify } from './ui';
import { installMissing } from './pkgs';
import { attachTip } from './charts';
import { icon } from '../shared/icons';

const GROUPS: [IfaceCategory, string][] = [
  ['wan', 'WAN'],
  ['ethernet', 'Ethernet'],
  ['wifi', 'Wi-Fi'],
  ['vpn', 'VPN & tunnels'],
  ['other', 'Other'],
];

const ICON: Record<NetDevice['kind'], string> = {
  wan: 'globe',
  ethernet: 'ethernet',
  bridge: 'bridge',
  wifi: 'wifi',
  vpn: 'tunnel',
  other: 'link',
};

function sw(on: boolean, label: string, onChange: (v: boolean) => void): HTMLButtonElement {
  const b = E(
    'button',
    {
      type: 'button',
      role: 'switch',
      class: `dl-switch${on ? ' on' : ''}`,
      'aria-checked': on ? 'true' : 'false',
      'aria-label': label,
      click: () => {
        const v = !b.classList.contains('on');
        b.classList.toggle('on', v);
        b.setAttribute('aria-checked', v ? 'true' : 'false');
        onChange(v);
      },
    },
    E('i'),
  ) as HTMLButtonElement;
  return b;
}

/**
 * Server → Access: how internet traffic leaves (Internet) and what home access
 * reaches (Home network: networks, devices reaching each other, services).
 * Both cards share one draft; either Save stores it.
 */
export function accessCards(srv: Server, st: Status, reload: () => void): HTMLElement {
  const serverId = srv.id;
  const root = E(
    'div',
    { class: 'dl-stack gap16' },
    E('section', { class: 'dl-setsec' }, E('div', { class: 'dl-setsec-body' }, E('p', { class: 'dl-muted' }, 'Loading interfaces…'))),
  );
  let d: InterfacesData;
  let autoWan = true,
    wanDev = '',
    autoLan = true,
    lanLike = true,
    mesh: MeshMode = 'all';
  // "Other interfaces" stays open or folded across repaints.
  let otherOpen = false;
  // Built once: it reads the devices at home, which should not happen on every repaint.
  const services = homeServices(st, serverId, reload);
  let lans = new Set<string>();
  let initial = '';

  const snapshot = () => JSON.stringify([lanLike, autoWan, autoWan ? '' : wanDev, autoLan, [...lans].sort()]);
  const liveLan = () => d.detected.lan || d.saved.lan || '';
  const currentWan = () => (autoWan ? d.detected.wan || d.saved.wan : wanDev) || '';
  const byName = () => new Map(d.devices.map((x) => [x.name, x]));

  /** Home devices as the server would use them after Save. */
  const homeDevs = (): NetDevice[] => {
    const m = byName();
    const names = [...(autoLan && liveLan() ? [liveLan()] : []), ...[...lans].filter((n) => n !== liveLan())];
    return names.filter((n) => n !== currentWan()).map((n) => m.get(n) ?? ({ name: n, nets: [], missing: true } as unknown as NetDevice));
  };

  const take = (r: InterfacesData, resetChoice: boolean) => {
    d = r;
    if (resetChoice) {
      autoWan = r.config.auto_wan;
      wanDev = r.config.wan_device || r.detected.wan || r.saved.wan || '';
      autoLan = r.config.auto_lan;
      lanLike = r.config.lan_like;
      mesh = r.config.mesh ?? (r.config.device_mesh ? 'all' : 'off');
      lans = new Set(r.config.lan_devices);
      initial = snapshot();
    }
    paint();
  };

  const load = async (reset: boolean) => {
    const r = await api.interfaces(serverId).catch((e: Error) => {
      notify(e.message, 'error');
      return null;
    });
    if (r) take(r, reset);
  };

  /** Can be part of the home network (or already is). */
  function pickable(x: NetDevice): boolean {
    const isAuto = autoLan && x.name === liveLan();
    const blocked = !!x.own || !!x.master || x.name === currentWan() || isAuto;
    return isAuto || lans.has(x.name) || (!blocked && (x.nets.length > 0 || !!x.missing));
  }

  function tile(x: NetDevice): HTMLElement {
    const isAuto = autoLan && x.name === liveLan();
    const isWan = x.name === currentWan();
    const sel = !isAuto && lans.has(x.name);
    const blocked = !!x.own || !!x.master || isWan || isAuto;
    const usable = !blocked && (x.nets.length > 0 || sel || !!x.missing);
    const noZone = (sel || isAuto) && !x.zone && !x.missing;
    const sub = x.missing
      ? 'Not present right now'
      : x.own
        ? 'This server'
        : x.master
          ? `Port of ${x.master}`
          : isWan
            ? `Internet${x.zone ? ` · zone ${x.zone}` : ''}`
            : x.nets.length
              ? x.nets.join(', ')
              : 'No IPv4 network';
    const el = E(
      'button',
      {
        type: 'button',
        class: `dl-if${sel ? ' sel' : ''}${isAuto ? ' auto' : ''}${!usable && !sel && !isAuto ? ' off' : ''}${noZone ? ' warn' : ''}`,
        'aria-pressed': sel || isAuto ? 'true' : 'false',
        // aria-disabled, not disabled: the tooltip should still explain why.
        'aria-disabled': usable ? null : 'true',
        click: () => {
          if (!usable) return;
          if (lans.has(x.name)) lans.delete(x.name);
          else lans.add(x.name);
          paint();
        },
      },
      [
        E('span', { class: 'dl-if-ic' }, icon(ICON[x.kind] ?? 'link')),
        E('span', { class: 'dl-if-main' }, [E('span', { class: 'dl-if-name' }, x.name), E('span', { class: 'dl-if-sub' }, sub)]),
        isAuto ? E('span', { class: 'dl-if-badge ok' }, 'Auto') : sel ? E('span', { class: 'dl-if-check' }, icon('check')) : '',
      ],
    );
    attachTip(el, () => [
      E('div', { class: 'dl-tip-title' }, x.name),
      E('div', { class: 'dl-muted' }, [
        x.logical ? `Interface ${x.logical}` : 'No netifd interface',
        x.zone ? ` · zone ${x.zone}` : ' · no firewall zone',
      ]),
      x.members.length ? E('div', { class: 'dl-muted' }, `Ports: ${x.members.join(', ')}`) : '',
      x.nets.length ? E('div', { class: 'dl-mono' }, x.nets.join(', ')) : '',
      noZone ? E('div', { class: 'dl-warn' }, 'Not in a firewall zone: the firewall rejects this traffic.') : '',
      x.master ? E('div', { class: 'dl-muted' }, `Choose ${x.master} to include it.`) : '',
    ]);
    return el;
  }

  /** Tile colour: green while traffic really enters the LAN, orange when it should but can't. */
  function likeHomeTone(): string {
    const lh = d.like_home;
    if (!lanLike || !d.config.lan_like) return '';
    return !d.needs?.length && lh.active && lh.bridged ? 'ok' : 'warn';
  }

  function likeHomeText(): (Node | string)[] {
    const lh = d.like_home;
    if (!lanLike) return ['Off: internet traffic goes straight to the WAN, past whatever handles home traffic on this router.'];
    if (d.needs?.length)
      return [
        E('span', { class: 'dl-warn' }, `Needs ${d.needs.join(' and ')}.`),
        ' Until they are installed, internet traffic goes straight to the WAN.',
      ];
    if (!d.config.lan_like)
      return ['Internet traffic will enter the router from your LAN, so it is handled like any home device. Save to turn on.'];
    if (lh.active && lh.bridged)
      return [
        'Internet traffic enters ',
        E('span', { class: 'dl-mono' }, lh.dev ?? ''),
        ' as ',
        E('span', { class: 'dl-mono' }, lh.address ?? ''),
        ', so whatever handles home traffic (proxies, filters, DNS) handles it too.',
      ];
    return [
      E('span', { class: 'dl-warn' }, `Not working: ${lh.error ?? 'the link is down'}`),
      ' Internet traffic goes straight to the WAN for now.',
    ];
  }

  const MESH_TEXT: Record<MeshMode, string> = {
    off: "Devices of different people never reach each other; a person's own devices don't either.",
    all: 'Devices of people with home access reach each other, like home devices do. Internet-only people never.',
    circles: 'Within a circle: family sees family, guests see guests. Everyone reaches their own devices. Internet-only people never.',
  };

  function setrow(
    ic: string,
    label: (Node | string)[] | string,
    sub: (Node | string)[] | string,
    ctl: Node | (Node | string)[] | '',
    tone = '',
    below?: Node,
  ) {
    return E('div', { class: below ? 'dl-setrow head' : 'dl-setrow' }, [
      E('div', { class: 'dl-lh-main' }, [
        E('span', { class: `dl-need-ic ${tone}` }, icon(ic)),
        E('div', { class: 'dl-stack' }, [E('span', { class: 'dl-setrow-label' }, label), E('span', { class: 'dl-sub' }, sub), below ?? '']),
      ]),
      E('div', { class: 'dl-setrow-ctl' }, ctl),
    ]);
  }

  const hint = (live: string | null, saved: string) => {
    const mono = (t: string) => E('span', { class: 'dl-mono' }, t);
    if (live) return E('span', {}, [' Now: ', mono(live), ...(saved && saved !== live ? [', was ', mono(saved)] : []), '.']);
    return E('span', {}, saved ? [' Not found now: using ', mono(saved), '.'] : [' Not found.']);
  };

  function paint() {
    const wanSel = E(
      'select',
      {
        class: 'cbi-input-select',
        'aria-label': 'Internet interface',
        change: (ev: Event) => {
          wanDev = (ev.target as HTMLSelectElement).value;
          paint();
        },
      },
      d.devices
        .filter((x) => !x.own && !x.master && x.zone && !x.missing)
        .map((x) => E('option', { value: x.name, selected: x.name === wanDev ? 'selected' : null }, `${x.name} · zone ${x.zone}`)),
    ) as HTMLSelectElement;

    const home = homeDevs();
    const nets = home.flatMap((x) => x.nets.map((n) => [n, x.name] as const));
    // Draft vs saved, per card: [lanLike, autoWan, wan, autoLan, lans].
    const now = JSON.parse(snapshot()) as unknown[];
    const was = JSON.parse(initial) as unknown[];
    const changed = (...i: number[]) => i.some((k) => JSON.stringify(now[k]) !== JSON.stringify(was[k]));
    const netDirty = changed(0, 1, 2);
    const homeDirty = changed(3, 4);
    const save = (on: boolean) =>
      button(
        'Save',
        async () => {
          const r = await attempt(
            () => api.serverInterfaces(serverId, autoWan, autoWan ? '' : wanDev, autoLan, [...lans], lanLike, mesh !== 'off', mesh),
            'Access saved',
          );
          if (!r) return;
          take(r, true);
          if (r.nets_changed && r.lan_only)
            notify(
              `${r.lan_only} ${r.lan_only === 1 ? 'person has' : 'people have'} Home-only access: their devices need the configuration again to reach the new networks.`,
              'warning',
              10000,
            );
        },
        'positive',
        { disabled: !on },
      );

    const internet = E('section', { class: 'dl-setsec dl-ifcard' }, [
      E('div', { class: 'dl-setsec-body' }, [
        E('div', { class: 'dl-panel-head' }, [
          E('h3', {}, 'Internet'),
          E('span', { class: 'dl-spacer' }),
          E('span', { class: 'dl-sub' }, 'People with Internet or Both'),
        ]),
        setrow(
          'home',
          'Internet like a home device',
          likeHomeText(),
          [
            lanLike && d.needs?.length ? button('Install', () => installMissing('home', d.needs!, () => load(false)), 'positive') : '',
            sw(lanLike, 'Internet like a home device', (v) => {
              lanLike = v;
              paint();
            }),
          ],
          likeHomeTone(),
        ),
        setrow(
          'globe',
          'Auto-detect WAN',
          [
            'The interface with the default route: the server port opens there and Internet access leaves through it.',
            hint(d.detected.wan, d.saved.wan),
          ],
          [
            autoWan ? '' : wanSel,
            sw(autoWan, 'Auto-detect WAN', (v) => {
              autoWan = v;
              paint();
            }),
          ],
        ),
      ]),
      E('div', { class: 'dl-setsec-foot' }, [
        E(
          'span',
          { class: 'dl-sub' },
          lanLike
            ? ['Internet like a home device', currentWan() ? [' · leaves through ', E('span', { class: 'dl-mono' }, currentWan())] : '']
            : currentWan()
              ? ['Internet straight to ', E('span', { class: 'dl-mono' }, currentWan())]
              : 'No WAN found',
        ),
        save(netDirty),
      ]),
    ]);

    const meshSeg = E(
      'div',
      { class: 'dl-seg sm', role: 'radiogroup', 'aria-label': 'Devices reach each other' },
      (
        [
          ['off', 'Off'],
          ['all', 'Everyone'],
          ['circles', 'Circles'],
        ] as const
      ).map(([v, t]) =>
        E(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: mesh === v ? 'on' : '',
            'aria-checked': mesh === v ? 'true' : 'false',
            // Applies at once, like the choices on a person's page.
            click: async () => {
              if (mesh === v) return;
              if (await attempt(() => api.serverUpdate(serverId, { mesh: v }), `Devices reach each other: ${t}`)) reload();
            },
          },
          t,
        ),
      ),
    );

    const homeCard = E('section', { class: 'dl-setsec dl-ifcard' }, [
      E('div', { class: 'dl-setsec-body' }, [
        E('div', { class: 'dl-panel-head' }, [
          E('h3', {}, 'Home network'),
          E('span', { class: 'dl-spacer' }),
          E('span', { class: 'dl-sub' }, 'People with Home or Both'),
          button([icon('reset'), ' Rescan'], () => load(false), 'neutral', { title: 'Read the interfaces again' }),
        ]),
        setrow(
          'network',
          'Networks',
          'Everyone with home access reaches these, unless their page leaves one out; their devices can be reached from here too. Click one to add or remove it.',
          '',
          '',
          netPicker(),
        ),
        setrow(
          'link',
          'Devices reach each other',
          MESH_TEXT[mesh],
          meshSeg,
          '',
          mesh === 'circles' ? circleChips(st, serverId, reload) : undefined,
        ),
        services,
      ]),
      E('div', { class: 'dl-setsec-foot' }, [
        E(
          'span',
          { class: 'dl-sub dl-if-summary' },
          nets.length
            ? ['Home access reaches ', ...nets.flatMap(([n, dev], i) => [i ? ', ' : '', E('span', { class: 'dl-mono' }, n), ` (${dev})`])]
            : 'No home network: Home access reaches nothing but this router.',
        ),
        save(homeDirty),
      ]),
    ]);

    // Keep the page where it is: replacing the cards would otherwise jump to the top.
    const y = window.scrollY;
    root.style.minHeight = `${root.offsetHeight}px`;
    dom.content(root, [internet, homeCard]);
    root.style.minHeight = '';
    window.scrollTo({ top: y });
  }

  /** Interfaces that can be home networks as tiles; the rest folded, by kind. */
  function netPicker(): HTMLElement {
    const avail = d.devices.filter(pickable);
    const rest = d.devices.filter((x) => !pickable(x));
    return E('div', { class: 'dl-stack gap8 dl-netpick' }, [
      avail.length
        ? E('div', { class: 'dl-ifgrid' }, avail.map(tile))
        : E('span', { class: 'dl-warn' }, 'No home network: Home access reaches nothing but this router.'),
      E('label', { class: 'dl-boxrow' }, [
        E('span', { class: 'dl-stack' }, [
          E('span', {}, 'Auto-detect LAN'),
          E('span', { class: 'dl-sub' }, ['Adds the LAN this router uses.', hint(d.detected.lan, d.saved.lan)]),
        ]),
        sw(autoLan, 'Auto-detect LAN', (v) => {
          autoLan = v;
          paint();
        }),
      ]),
      rest.length
        ? E(
            'details',
            {
              class: 'dl-params',
              open: otherOpen ? '' : null,
              toggle: (ev: Event) => (otherOpen = (ev.currentTarget as HTMLDetailsElement).open),
            },
            [
              E('summary', {}, [
                icon('chevron'),
                E('span', {}, 'Other interfaces'),
                E('span', { class: 'dl-pcount' }, String(rest.length)),
              ]),
              E('div', { class: 'dl-params-body' }, [
                E(
                  'span',
                  { class: 'dl-sub' },
                  'The WAN, this server, ports and Wi-Fi of a bridge (they come with it) and interfaces without an IPv4 network.',
                ),
                ...GROUPS.map(([cat, label]) => {
                  const list = rest.filter((x) => x.category === cat);
                  return list.length
                    ? E('div', { class: 'dl-ifgroup' }, [E('h4', {}, label), E('div', { class: 'dl-ifgrid' }, list.map(tile))])
                    : '';
                }),
              ]),
            ],
          )
        : '',
    ]);
  }

  load(true);
  return root;
}
