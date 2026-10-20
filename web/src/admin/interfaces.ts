// Interfaces card (Server page): auto-detected WAN and LAN, plus a picker for
// the interfaces that make up a server's home network.

import type { MeshMode, Server, Status } from '../shared/types';
import { E } from './e';
import { api, type IfaceCategory, type InterfacesData, type NetDevice } from './api';
import { circleChips, homeServices } from './access';
import { button } from './ui/button';
import { attempt, notify } from './ui/toast';
import { seg, sw } from './ui/controls';
import { attachTip } from './ui/tooltip';
import { installMissing } from './pkgs';
import { icon } from '../shared/icons';
import { fill, fmt, locale, plural } from '../shared/i18n';

/** Groups of "Other interfaces", in order, with their headings. */
const groups = (): [IfaceCategory, string][] => [
  ['wan', 'WAN'],
  ['ethernet', 'Ethernet'],
  ['wifi', 'Wi-Fi'],
  ['vpn', _('VPN & tunnels')],
  ['other', _('Other')],
];

const ICON: Record<NetDevice['kind'], string> = {
  wan: 'globe',
  ethernet: 'ethernet',
  bridge: 'bridge',
  wifi: 'wifi',
  vpn: 'tunnel',
  other: 'link',
};

/** Server → Access cards; `update` takes a new status without touching the draft. */
export interface AccessCards {
  el: HTMLElement;
  update(st: Status): void;
}

/**
 * Server → Access: how internet traffic leaves (Internet) and what home access
 * reaches (Home network: networks, devices reaching each other, services).
 * Both cards share one draft; either Save stores it. Changes that apply at
 * once (devices reaching each other, services, circles) call `refresh`, which
 * brings a new status here through `update`: the draft stays as it is.
 */
export function accessCards(srv: Server, first: Status, refresh: () => Promise<unknown>): AccessCards {
  const serverId = srv.id;
  let st = first;
  const root = E(
    'div',
    { class: 'dl-stack gap16' },
    E('section', { class: 'dl-setsec' }, E('div', { class: 'dl-setsec-body' }, E('p', { class: 'dl-muted' }, _('Loading interfaces…')))),
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
  const services = homeServices(st, serverId, refresh);
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
      ? _('Not present right now')
      : x.own
        ? _('This server')
        : x.master
          ? fmt(_('Port of %s'), x.master)
          : isWan
            ? `${_('Internet')}${x.zone ? ` · ${fmt(_('zone %s'), x.zone)}` : ''}`
            : x.nets.length
              ? x.nets.join(', ')
              : _('No IPv4 network');
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
        isAuto ? E('span', { class: 'dl-if-badge ok' }, _('Auto')) : sel ? E('span', { class: 'dl-if-check' }, icon('check')) : '',
      ],
    );
    attachTip(el, () => [
      E('div', { class: 'dl-tip-title' }, x.name),
      E('div', { class: 'dl-muted' }, [
        x.logical ? fmt(_('Interface %s'), x.logical) : _('No netifd interface'),
        ' · ',
        x.zone ? fmt(_('zone %s'), x.zone) : _('no firewall zone'),
      ]),
      x.members.length ? E('div', { class: 'dl-muted' }, fmt(_('Ports: %s'), x.members.join(', '))) : '',
      x.nets.length ? E('div', { class: 'dl-mono' }, x.nets.join(', ')) : '',
      noZone ? E('div', { class: 'dl-warn' }, _('Not in a firewall zone: the firewall rejects this traffic.')) : '',
      x.master ? E('div', { class: 'dl-muted' }, fmt(_('Choose %s to include it.'), x.master)) : '',
    ]);
    return el;
  }

  /** Tile colour: green while traffic really enters the LAN, orange when it should but can't. */
  function likeHomeTone(): string {
    const lh = d.like_home;
    // A server that is off has no link on purpose.
    if (!lanLike || !d.config.lan_like || !srv.enabled) return '';
    return !d.needs?.length && lh.active && lh.bridged ? 'ok' : 'warn';
  }

  function likeHomeText(): (Node | string)[] {
    const lh = d.like_home;
    if (!lanLike) return [_('Off: internet traffic goes straight to the WAN, past whatever handles home traffic on this router.')];
    if (d.needs?.length)
      return [
        E('span', { class: 'dl-warn' }, fmt(_('Needs %s.'), new Intl.ListFormat(locale(), { type: 'conjunction' }).format(d.needs))),
        ' ',
        _('Until they are installed, internet traffic goes straight to the WAN.'),
      ];
    if (!d.config.lan_like)
      return [_('Internet traffic will enter the router from your LAN, so it is handled like any home device. Save to turn on.')];
    // A server that is off has no link on purpose: describe the setting, not its state.
    if (!srv.enabled)
      return [
        _('Internet traffic enters the router from your LAN, so whatever handles home traffic (proxies, filters, DNS) handles it too.'),
      ];
    if (lh.active && lh.bridged)
      return fill(
        _('Internet traffic enters %s as %s, so whatever handles home traffic (proxies, filters, DNS) handles it too.'),
        E('span', { class: 'dl-mono' }, lh.dev ?? ''),
        E('span', { class: 'dl-mono' }, lh.address ?? ''),
      );
    return [
      E('span', { class: 'dl-warn' }, fmt(_('Not working: %s'), lh.error ?? _('the link is down'))),
      ' ',
      _('Internet traffic goes straight to the WAN for now.'),
    ];
  }

  const meshText = (m: MeshMode): string =>
    ({
      off: _("Devices of different people never reach each other; a person's own devices don't either."),
      all: _('Devices of people with home access reach each other, like home devices do. Internet-only people never.'),
      circles: _('Within a circle: family sees family, guests see guests. Everyone reaches their own devices. Internet-only people never.'),
    })[m];

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
    if (live)
      return E('span', {}, [
        ' ',
        ...(saved && saved !== live ? fill(_('Now: %s, was %s.'), mono(live), mono(saved)) : fill(_('Now: %s.'), mono(live))),
      ]);
    return E('span', {}, [' ', ...(saved ? fill(_('Not found now: using %s.'), mono(saved)) : [_('Not found.')])]);
  };

  function paint() {
    const wanSel = E(
      'select',
      {
        class: 'cbi-input-select',
        'aria-label': _('Internet interface'),
        change: (ev: Event) => {
          wanDev = (ev.target as HTMLSelectElement).value;
          paint();
        },
      },
      d.devices
        .filter((x) => !x.own && !x.master && x.zone && !x.missing)
        .map((x) =>
          E('option', { value: x.name, selected: x.name === wanDev ? 'selected' : null }, `${x.name} · ${fmt(_('zone %s'), x.zone)}`),
        ),
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
        _('Save'),
        async () => {
          const r = await attempt(
            () => api.serverInterfaces(serverId, autoWan, autoWan ? '' : wanDev, autoLan, [...lans], lanLike, mesh !== 'off', mesh),
            _('Access saved'),
          );
          if (!r) return;
          take(r, true);
          if (r.nets_changed && r.lan_only)
            notify(
              plural(
                r.lan_only,
                '%s person has Home-only access: their devices need the configuration again to reach the new networks.',
                '%s people have Home-only access: their devices need the configuration again to reach the new networks.',
              ),
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
          E('h3', {}, _('Internet')),
          E('span', { class: 'dl-spacer' }),
          E('span', { class: 'dl-sub' }, _('People with Internet or Both')),
        ]),
        setrow(
          'home',
          _('Internet like a home device'),
          likeHomeText(),
          [
            lanLike && d.needs?.length ? button(_('Install'), () => installMissing('home', d.needs!, () => load(false)), 'positive') : '',
            sw(lanLike, _('Internet like a home device'), (v) => {
              lanLike = v;
              paint();
            }),
          ],
          likeHomeTone(),
        ),
        setrow(
          'globe',
          _('Auto-detect WAN'),
          [
            _('The interface with the default route: the server port opens there and Internet access leaves through it.'),
            hint(d.detected.wan, d.saved.wan),
          ],
          [
            autoWan ? '' : wanSel,
            sw(autoWan, _('Auto-detect WAN'), (v) => {
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
            ? [
                _('Internet like a home device'),
                currentWan() ? [' · ', ...fill(_('leaves through %s'), E('span', { class: 'dl-mono' }, currentWan()))] : '',
              ]
            : currentWan()
              ? fill(_('Internet straight to %s'), E('span', { class: 'dl-mono' }, currentWan()))
              : _('No WAN found'),
        ),
        save(netDirty),
      ]),
    ]);

    const meshSeg = seg(
      [
        ['off', _('Off')],
        ['all', _('Everyone')],
        ['circles', _('Circles')],
      ] as [MeshMode, string][],
      mesh,
      {
        label: _('Devices reach each other'),
        cls: 'sm',
        optimistic: false,
        // Applies at once, like the choices on a person's page.
        onChange: async (v) => {
          const t = { off: _('Off'), all: _('Everyone'), circles: _('Circles') }[v];
          if (!(await attempt(() => api.serverUpdate(serverId, { mesh: v }), fmt(_('Devices reach each other: %s'), t)))) return;
          mesh = v;
          d.config.mesh = v;
          paint();
          await refresh();
        },
      },
    );

    const homeCard = E('section', { class: 'dl-setsec dl-ifcard' }, [
      E('div', { class: 'dl-setsec-body' }, [
        E('div', { class: 'dl-panel-head' }, [
          E('h3', {}, _('Home network')),
          E('span', { class: 'dl-spacer' }),
          E('span', { class: 'dl-sub' }, _('People with Home or Both')),
          button([icon('reset'), ' ', _('Rescan')], () => load(false), 'neutral', { title: _('Read the interfaces again') }),
        ]),
        setrow(
          'network',
          _('Networks'),
          _(
            'Everyone with home access reaches these, unless their page leaves one out; their devices can be reached from here too. Click one to add or remove it.',
          ),
          '',
          '',
          netPicker(),
        ),
        setrow(
          'link',
          _('Devices reach each other'),
          meshText(mesh),
          meshSeg,
          '',
          mesh === 'circles' ? circleChips(st, serverId, refresh) : undefined,
        ),
        services.el,
      ]),
      E('div', { class: 'dl-setsec-foot' }, [
        E(
          'span',
          { class: 'dl-sub dl-if-summary' },
          nets.length
            ? fill(
                _('Home access reaches %s'),
                E(
                  'span',
                  {},
                  nets.flatMap(([n, dev], i) => [i ? ', ' : '', E('span', { class: 'dl-mono' }, n), ` (${dev})`]),
                ),
              )
            : _('No home network: Home access reaches nothing but this router.'),
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
        : E('span', { class: 'dl-warn' }, _('No home network: Home access reaches nothing but this router.')),
      E('label', { class: 'dl-boxrow' }, [
        E('span', { class: 'dl-stack' }, [
          E('span', {}, _('Auto-detect LAN')),
          E('span', { class: 'dl-sub' }, [_('Adds the LAN this router uses.'), hint(d.detected.lan, d.saved.lan)]),
        ]),
        sw(autoLan, _('Auto-detect LAN'), (v) => {
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
                E('span', {}, _('Other interfaces')),
                E('span', { class: 'dl-pcount' }, String(rest.length)),
              ]),
              E('div', { class: 'dl-params-body' }, [
                E(
                  'span',
                  { class: 'dl-sub' },
                  _('The WAN, this server, ports and Wi-Fi of a bridge (they come with it) and interfaces without an IPv4 network.'),
                ),
                ...groups().map(([cat, label]) => {
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
  return {
    el: root,
    update(n: Status) {
      st = n;
      services.update(n);
      if (d) paint();
    },
  };
}
