// Interfaces card (Server page): auto-detected WAN and LAN, plus a picker for
// the interfaces that make up a server's home network.

import { E } from './e';
import { api, type IfaceCategory, type InterfacesData, type NetDevice } from './api';
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

export function interfacesCard(serverId: string, title = 'Interfaces'): HTMLElement {
  const root = E(
    'section',
    { class: 'dl-setsec dl-ifcard' },
    E('div', { class: 'dl-setsec-body' }, E('p', { class: 'dl-muted' }, 'Loading interfaces…')),
  );
  let d: InterfacesData;
  let autoWan = true,
    wanDev = '',
    autoLan = true,
    lanLike = true,
    mesh = true;
  let lans = new Set<string>();
  let initial = '';

  const snapshot = () => JSON.stringify([lanLike, mesh, autoWan, autoWan ? '' : wanDev, autoLan, [...lans].sort()]);
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
      mesh = r.config.device_mesh;
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

    // What auto-detection finds now; the remembered one (used when nothing is found) only when it differs.
    const hint = (live: string | null, saved: string) => {
      const mono = (t: string) => E('span', { class: 'dl-mono' }, t);
      if (live) return E('span', {}, [' Now: ', mono(live), ...(saved && saved !== live ? [', was ', mono(saved)] : []), '.']);
      return E('span', {}, saved ? [' Not found now: using ', mono(saved), '.'] : [' Not found.']);
    };

    const groups = GROUPS.map(([cat, label]) => {
      const list = d.devices.filter((x) => x.category === cat);
      return list.length ? E('div', { class: 'dl-ifgroup' }, [E('h4', {}, label), E('div', { class: 'dl-ifgrid' }, list.map(tile))]) : '';
    });

    const home = homeDevs();
    const nets = home.flatMap((x) => x.nets.map((n) => [n, x.name] as const));
    const dirty = snapshot() !== initial;
    const save = button(
      'Save',
      async () => {
        const r = await attempt(
          () => api.serverInterfaces(serverId, autoWan, autoWan ? '' : wanDev, autoLan, [...lans], lanLike, mesh),
          'Interfaces saved',
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
      { disabled: !dirty },
    );

    dom.content(root, [
      E('div', { class: 'dl-setsec-body' }, [
        E('div', { class: 'dl-panel-head' }, [
          E('h3', {}, title),
          E('span', { class: 'dl-spacer' }),
          button([icon('reset'), ' Rescan'], () => load(false), 'neutral', { title: 'Read the interfaces again' }),
        ]),
        E('div', { class: 'dl-setrow' }, [
          E('div', { class: 'dl-lh-main' }, [
            E('span', { class: `dl-need-ic ${likeHomeTone()}` }, icon('home')),
            E('div', { class: 'dl-stack' }, [
              E('span', { class: 'dl-setrow-label' }, 'Internet like a home device'),
              E('span', { class: 'dl-sub' }, likeHomeText()),
            ]),
          ]),
          E('div', { class: 'dl-setrow-ctl dl-if-wanctl' }, [
            lanLike && d.needs?.length ? button('Install', () => installMissing('home', d.needs!, () => load(false)), 'positive') : '',
            sw(lanLike, 'Internet like a home device', (v) => {
              lanLike = v;
              paint();
            }),
          ]),
        ]),
        E('div', { class: 'dl-setrow' }, [
          E('div', { class: 'dl-lh-main' }, [
            E('span', { class: 'dl-need-ic' }, icon('link')),
            E('div', { class: 'dl-stack' }, [
              E('span', { class: 'dl-setrow-label' }, 'Devices reach each other'),
              E(
                'span',
                { class: 'dl-sub' },
                'Devices of people with Home access can open connections to each other on this server, like home devices do. Internet-only people never.',
              ),
            ]),
          ]),
          E(
            'div',
            { class: 'dl-setrow-ctl' },
            sw(mesh, 'Devices reach each other', (v) => {
              mesh = v;
              paint();
            }),
          ),
        ]),
        E('div', { class: 'dl-setrow' }, [
          E('div', { class: 'dl-lh-main' }, [
            E('span', { class: 'dl-need-ic' }, icon('globe')),
            E('div', { class: 'dl-stack' }, [
              E('span', { class: 'dl-setrow-label' }, 'Auto-detect WAN'),
              E('span', { class: 'dl-sub' }, [
                'The interface with the default route: the server port opens there and Internet access leaves through it.',
                hint(d.detected.wan, d.saved.wan),
              ]),
            ]),
          ]),
          E('div', { class: 'dl-setrow-ctl dl-if-wanctl' }, [
            autoWan ? '' : wanSel,
            sw(autoWan, 'Auto-detect WAN', (v) => {
              autoWan = v;
              paint();
            }),
          ]),
        ]),
        E('div', { class: 'dl-setrow' }, [
          E('div', { class: 'dl-lh-main' }, [
            E('span', { class: 'dl-need-ic' }, icon('network')),
            E('div', { class: 'dl-stack' }, [
              E('span', { class: 'dl-setrow-label' }, 'Auto-detect LAN'),
              E('span', { class: 'dl-sub' }, ['Adds the detected LAN to the home network.', hint(d.detected.lan, d.saved.lan)]),
            ]),
          ]),
          E(
            'div',
            { class: 'dl-setrow-ctl' },
            sw(autoLan, 'Auto-detect LAN', (v) => {
              autoLan = v;
              paint();
            }),
          ),
        ]),
        E('div', { class: 'dl-iflead' }, [
          E('b', {}, 'Home network'),
          E(
            'span',
            { class: 'dl-sub' },
            'What people with Home access can reach, and where their devices can be reached from. Click to add an interface; bridge ports and Wi-Fi in a bridge come with the bridge.',
          ),
        ]),
        ...groups,
      ]),
      E('div', { class: 'dl-setsec-foot' }, [
        E(
          'span',
          { class: 'dl-sub dl-if-summary' },
          nets.length
            ? [
                'Home access reaches ',
                ...nets.flatMap(([n, dev], i) => [i ? ', ' : '', E('span', { class: 'dl-mono' }, n), ` (${dev})`]),
                lanLike ? ' · Internet like a home device' : currentWan() ? ` · Internet via ${currentWan()}` : '',
              ]
            : ['No home network: Home access reaches nothing but this router.', currentWan() ? ` Internet via ${currentWan()}.` : ''],
        ),
        save,
      ]),
    ]);
  }

  load(true);
  return root;
}
