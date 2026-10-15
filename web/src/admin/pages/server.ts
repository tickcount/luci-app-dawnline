// Servers: a setup wizard when nothing is configured; otherwise one tab per
// server. Each opens on its Overview (who is online, traffic, map, activity)
// followed by its settings (General, Interfaces, Network, Disguise,
// Advanced); every settings section saves on its own and applies at once.

import type { Server, Status } from '../../shared/types';
import { E } from '../e';
import { api, type SetupDefaults } from '../api';
import { attempt, button, callout, closeModal, confirmDialog, copyText, modal, notify } from '../ui';
import { icon } from '../../shared/icons';
import { duration } from '../../shared/format';
import { accessCards } from '../interfaces';
import { checkAccess, whoReaches } from '../access';
import { card, group, input, row, sw } from '../kit';
import { methodInfo, methodPicker, type Method } from '../disguise';
import { ServerOverview } from './overview';
import { PeoplePage } from './people';

type Section = 'overview' | 'people' | 'connection' | 'access' | 'disguise' | 'tunnel';
const SECTIONS: [Section, string][] = [
  ['overview', 'Overview'],
  ['people', 'People'],
  ['connection', 'Connection'],
  ['access', 'Access'],
  ['disguise', 'Disguise'],
  ['tunnel', 'Tunnel'],
];
/** Section names from before the regrouping, for old links. */
const OLD_SECTIONS: Record<string, Section> = { general: 'connection', network: 'connection', interfaces: 'access', advanced: 'tunnel' };
/** `.conf` names of the disguise parameters, in file order. */
const CONF: [string, string][] = [
  ['jc', 'Jc'],
  ['jmin', 'Jmin'],
  ['jmax', 'Jmax'],
  ['s1', 'S1'],
  ['s2', 'S2'],
  ['s3', 'S3'],
  ['s4', 'S4'],
  ['h1', 'H1'],
  ['h2', 'H2'],
  ['h3', 'H3'],
  ['h4', 'H4'],
  ['i1', 'I1'],
  ['i2', 'I2'],
  ['i3', 'I3'],
  ['i4', 'I4'],
  ['i5', 'I5'],
  ['header_protection_key', 'HeaderProtectionKey'],
  ['content_padding_addition', 'ContentPaddingAddition'],
  ['rekey_after_time', 'RekeyAfterTime'],
  ['rekey_timeout', 'RekeyTimeout'],
  ['reject_after_time', 'RejectAfterTime'],
  ['keepalive_timeout', 'KeepaliveTimeout'],
  ['max_handshake_attempts', 'MaxHandshakeAttempts'],
  ['random_trailers', 'RandomTrailers'],
  ['disable_cookies', 'DisableCookies'],
];

/**
 * The applied parameters, grouped by what they do, with a plain-language
 * line per group. Collapsed by default; copyable as config lines.
 */
function paramsView(o: Record<string, string>): HTMLElement | null {
  const has = (k: string) => o[k] != null && o[k] !== '';
  const keys = CONF.filter(([k]) => has(k));
  if (!keys.length) return null;
  const val = (k: string, name: string) =>
    E('span', { class: 'dl-pv' }, [E('i', {}, name), E('b', {}, k === 'header_protection_key' ? `${o[k].slice(0, 6)}••••` : o[k])]);
  const group = (title: string, ic: string, text: string, ks: string[]) => {
    const present = CONF.filter(([k]) => ks.includes(k) && has(k));
    return present.length
      ? E('div', { class: 'dl-pgroup' }, [
          E('div', { class: 'dl-pgroup-head' }, [icon(ic), E('b', {}, title)]),
          E('p', {}, text),
          E(
            'div',
            { class: 'dl-pvals' },
            present.map(([k, n]) => val(k, n)),
          ),
        ])
      : '';
  };
  const jc = Number(o.jc || 0);
  const signature = (o.i1 ?? '').includes('0x8580')
    ? 'A first packet shaped like a DNS answer.'
    : 'Extra packets sent before the handshake.';
  const conf = keys.map(([k, n]) => `${n} = ${o[k]}`).join('\n');
  const body = E('div', { class: 'dl-pgrid' }, [
    group(
      'Junk packets',
      'zap',
      jc ? `${jc} random packet${jc === 1 ? '' : 's'} of ${o.jmin}–${o.jmax} bytes before each handshake.` : 'No junk packets.',
      ['jc', 'jmin', 'jmax'],
    ),
    group('Padding', 'archive', 'Random bytes in front of handshake, cookie and data packets, so their sizes do not match WireGuard.', [
      's1',
      's2',
      's3',
      's4',
    ]),
    group('Packet types', 'key', 'The values that replace WireGuard’s recognisable message types.', ['h1', 'h2', 'h3', 'h4']),
    group('Signatures', 'globe', signature, ['i1', 'i2', 'i3', 'i4', 'i5']),
    group('Protection', 'lock', 'AmneziaWG 3.1: encrypted headers, random tails and extra padding on data packets.', [
      'header_protection_key',
      'content_padding_addition',
      'random_trailers',
      'disable_cookies',
    ]),
    group('Timing', 'clock', 'Handshake and key timers vary within these ranges instead of WireGuard’s fixed values.', [
      'rekey_after_time',
      'rekey_timeout',
      'reject_after_time',
      'keepalive_timeout',
      'max_handshake_attempts',
    ]),
  ]);
  return E('details', { class: 'dl-params' }, [
    E('summary', {}, [
      icon('chevron'),
      E('span', {}, 'Current parameters'),
      E('span', { class: 'dl-pcount' }, String(keys.length)),
      E('span', { class: 'dl-spacer' }),
      E(
        'button',
        {
          type: 'button',
          class: 'dl-linkbtn',
          click: (ev: Event) => {
            ev.preventDefault();
            copyText(conf, 'Parameters copied');
          },
        },
        'Copy as config',
      ),
    ]),
    body,
  ]);
}

const url = (server?: string, section?: string) => {
  const q = new URLSearchParams();
  if (server) q.set('server', server);
  if (section && section !== 'overview') q.set('section', section);
  const s = q.toString();
  return `${L.url('admin/network/dawnline/server')}${s ? `?${s}` : ''}`;
};

export class ServerPage {
  st!: Status;
  noFooter = true;
  root = E('div', { class: 'dl-root' });
  section: Section = 'overview';
  srvId = '';
  /** Per-server sections kept between switches (the map stays mounted). */
  ov: Record<string, ServerOverview> = {};
  pp: Record<string, PeoplePage> = {};
  tabsEl = E('div', {});
  headEl = E('div', {});
  secEl = E('div', {});
  bodyEl = E('div', { class: 'dl-srvbody' });

  async load(): Promise<[Status, SetupDefaults | null]> {
    const st = await api.status(31);
    const d = st.servers.length ? null : await api.setupDefaults();
    return [st, d];
  }

  render([st, d]: [Status, SetupDefaults | null]): Node {
    this.st = st;
    if (!st.servers.length && d) return this.wizard(d);
    // Deep links (?server=…&section=…) pick the starting tab; switching later
    // happens in place, without touching the URL (the theme's router would
    // treat that as a navigation and redraw the page).
    const q = new URLSearchParams(location.search);
    const raw = q.get('section') ?? '';
    const want = (OLD_SECTIONS[raw] ?? raw) as Section;
    if (SECTIONS.some(([k]) => k === want)) this.section = want;
    this.srvId = (st.servers.find((x) => x.id === q.get('server')) ?? st.servers[0]).id;
    dom.content(this.root, [this.tabsEl, this.headEl, this.secEl, this.bodyEl]);
    this.paint();
    // Live numbers on the Overview; settings forms are left alone while open.
    poll.add(async () => {
      if (this.section !== 'overview') return;
      const n = await api.status(31).catch(() => null);
      if (!n || !n.servers.length) return;
      this.st = n;
      const srv = this.current();
      dom.content(this.headEl, this.head(srv));
      this.paintTabs();
      this.ov[srv.id]?.update(n);
    }, 10);
    return this.root;
  }

  current(): Server {
    return this.st.servers.find((x) => x.id === this.srvId) ?? this.st.servers[0];
  }

  async refresh() {
    const st = await api.status(31).catch(() => null);
    if (!st) return;
    this.st = st;
    if (!st.servers.length) location.href = url();
    else this.paint();
  }

  /* ---------------- page ---------------- */

  /** Everything: server tabs, head, section tabs and the current section. */
  paint() {
    this.paintTabs();
    dom.content(this.headEl, this.head(this.current()));
    this.paintSections();
    this.showSection(this.section);
  }

  paintTabs() {
    const srv = this.current();
    dom.content(
      this.tabsEl,
      E('div', { class: 'dl-srvtabs', role: 'tablist', 'aria-label': 'Servers' }, [
        ...this.st.servers.map((x) =>
          E(
            'button',
            {
              type: 'button',
              role: 'tab',
              class: `dl-srvtab${x.id === srv.id ? ' on' : ''}`,
              'aria-selected': x.id === srv.id ? 'true' : 'false',
              click: () => {
                if (x.id === this.srvId) return;
                this.srvId = x.id;
                this.paint();
              },
            },
            [E('i', { class: `dot ${x.up ? 'ok' : 'bad'}` }), E('b', {}, x.name), E('span', { class: 'dl-mono dl-faint' }, `:${x.port}`)],
          ),
        ),
        E('button', { type: 'button', class: 'dl-srvtab add', click: () => this.addServer() }, [icon('plus'), 'Add server']),
      ]),
    );
  }

  paintSections() {
    dom.content(
      this.secEl,
      E(
        'div',
        { class: 'dl-seg dl-srvsections', role: 'tablist', 'aria-label': 'Server' },
        SECTIONS.map(([k, t]) =>
          E(
            'button',
            {
              type: 'button',
              role: 'tab',
              'data-section': k,
              class: k === this.section ? 'on' : '',
              'aria-selected': k === this.section ? 'true' : 'false',
              click: () => this.showSection(k),
            },
            t,
          ),
        ),
      ),
    );
  }

  /** Jump to a section, optionally with a People filter (from the Overview). */
  go(k: Section, filter?: string) {
    const pp = this.pp[this.current().id];
    if (filter && pp) {
      pp.filter = filter as PeoplePage['filter'];
      if (pp.el) pp.decorate();
    } else if (filter) {
      const page = (this.pp[this.current().id] = new PeoplePage());
      page.filter = filter as PeoplePage['filter'];
    }
    this.showSection(k);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Overview and People stay alive between tab switches. Take them out before
   * dom.content() runs: it forgets LuCI's registry of every node it removes,
   * and a form put back afterwards fails on its next render ("setting '_class'").
   */
  detachKept() {
    const kept = [...Object.values(this.ov).map((o) => o.el), ...Object.values(this.pp).map((p) => p.el)];
    for (const el of kept) if (el && this.bodyEl.contains(el)) el.remove();
  }

  /** Swap only the section body; the rest of the page stays as it is. */
  showSection(k: Section) {
    this.section = k;
    this.secEl.querySelectorAll<HTMLElement>('[data-section]').forEach((b) => {
      const on = b.dataset.section === k;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const st = this.st;
    const srv = this.current();
    const body: Record<Section, () => Node> = {
      overview: () => {
        const ov = this.ov[srv.id];
        if (!ov) return (this.ov[srv.id] = new ServerOverview(srv.id, (k, f) => this.go(k as Section, f))).mount(st);
        ov.update(st);
        return ov.el;
      },
      people: () => {
        const pp = this.pp[srv.id];
        if (pp?.el) {
          void pp.poll();
          return pp.el;
        }
        const holder = E('div', {}, E('p', { class: 'dl-muted' }, 'Loading people…'));
        const page = (this.pp[srv.id] ??= new PeoplePage());
        page.embed(st, srv.id).then((node) => {
          if (holder.isConnected) dom.content(holder, node);
          else holder.replaceChildren(node);
        });
        return holder;
      },
      connection: () => this.connection(srv),
      access: () => this.access(srv),
      disguise: () => this.disguise(srv),
      tunnel: () => this.tunnel(srv),
    };
    const node = body[k]();
    this.detachKept();
    dom.content(this.bodyEl, node);
  }

  /** Name and state, the address bar, and the page actions. */
  head(srv: Server): HTMLElement {
    const st = this.st;
    const seg = (ic: string, body: (Node | string)[]) => E('span', { class: 'dl-addrbar-seg' }, [icon(ic), ...body]);
    const addr = `${srv.endpoint || '—'}:${srv.port}`;
    // "Turn on" while the server is off (turning off lives in Tunnel; the same
    // button also lifts an old router-wide pause).
    const off = !srv.enabled || st.settings.paused_all;
    const actions = E('div', { class: 'dl-actions' }, [
      off
        ? button(
            [icon('play'), ' Turn on'],
            async () => {
              if (st.settings.paused_all && !(await attempt(() => api.pauseAll(false)))) return;
              if (!srv.enabled) await this.save(srv, { enabled: '1' }, 'Server turned on');
              else await this.refresh();
            },
            'positive',
          )
        : '',
    ]);
    // Actions sit on the name's line; the address bar gets the whole next line.
    return E('div', { class: 'dl-srvpagehead' }, [
      E('div', { class: 'dl-title-row' }, [
        E('h2', { class: 'dl-h1' }, srv.name),
        E(
          'span',
          { class: `dl-pill ${!srv.enabled ? 'off' : srv.up ? 'ok' : 'bad'}` },
          !srv.enabled ? 'Turned off' : srv.up ? 'Running' : 'Not running',
        ),
        st.settings.paused_all && srv.enabled ? E('span', { class: 'dl-pill warn' }, 'Off') : '',
        E('span', { class: 'dl-spacer' }),
        actions,
      ]),
      E('div', { class: 'dl-addrbar' }, [
        E(
          'button',
          { type: 'button', class: 'dl-addrbar-seg main', title: 'Copy address and port', click: () => copyText(addr, 'Address copied') },
          [icon('globe'), E('span', { class: 'dl-mono' }, addr), icon('copy')],
        ),
        seg('tunnel', [E('span', { class: 'dl-mono' }, srv.ifname)]),
        seg('network', [E('span', { class: 'dl-mono' }, srv.subnet)]),
        srv.up ? seg('clock', [`up ${duration(srv.uptime)}`]) : '',
      ]),
    ]);
  }

  async save(srv: Server, values: Record<string, unknown>, ok = 'Saved') {
    if (await attempt(() => api.serverUpdate(srv.id, values), ok)) await this.refresh();
  }

  /** How devices find the server and what goes into their configuration. */
  connection(srv: Server): HTMLElement {
    const name = input(srv.name, { placeholder: 'Home' });
    const endpoint = input(srv.endpoint, { placeholder: 'vpn.example.com', class: 'cbi-input-text dl-mono' });
    const port = input(String(srv.port), { inputmode: 'numeric', class: 'cbi-input-text dl-w-port dl-mono' });
    const dns = input(srv.dns.join(', '), { placeholder: 'This router (recommended)', class: 'cbi-input-text dl-mono' });
    const mtu = input(String(srv.mtu ?? ''), { placeholder: '1380', inputmode: 'numeric', class: 'cbi-input-text dl-w-port dl-mono' });
    const ka = input(String(srv.keepalive ?? ''), { placeholder: '25', inputmode: 'numeric', class: 'cbi-input-text dl-w-port dl-mono' });
    return card(
      'Connection',
      [
        E('p', { class: 'dl-muted' }, 'How devices find this server, and what goes into their configuration.'),
        group('router', 'Server', 'What people see', [row('Name', name, 'Shown to people in their portal.')]),
        group('globe', 'Devices connect to', 'Where the tunnel answers from the internet', [
          row(
            'Public address',
            endpoint,
            'Hostname or IP of the router on the internet. A DDNS name keeps links working when your IP changes.',
          ),
          row('UDP port', port, 'Opened on the WAN firewall automatically.'),
        ]),
        group('file', 'In every device configuration', 'Changing these marks devices “Update config” until they import again', [
          row('DNS for devices', dns, 'Empty = this router, which sends each query where your home network would.'),
          row('MTU', mtu, 'Lower it if some sites hang on mobile networks.'),
          row('Keep-alive', ka, 'Seconds between packets devices send to keep NAT open. 0 = off.'),
        ]),
      ],
      [
        E('span'),
        button(
          'Save',
          () =>
            this.save(srv, {
              name: name.value,
              endpoint: endpoint.value,
              port: port.value,
              dns: dns.value,
              mtu: mtu.value,
              keepalive: ka.value,
            }),
          'positive',
        ),
      ],
    );
  }

  /** Where devices may go and how their traffic leaves: internet path, home network, services, circles. */
  access(srv: Server): HTMLElement {
    const reload = () => this.refresh();
    return E('div', { class: 'dl-stack gap16' }, [
      accessCards(srv, this.st, reload),
      E('div', { class: 'dl-health-cols' }, [whoReaches(this.st, srv), checkAccess(this.st, srv)]),
    ]);
  }

  disguise(srv: Server): HTMLElement {
    const current = methodInfo(srv.preset) ? (srv.preset as Method) : undefined;
    let selected: Method = current ?? 'standard';
    const action = button('', () => this.applyDisguise(srv, selected, selected === current), 'positive');
    const label = () => {
      dom.content(action, selected === current ? [icon('reset'), ' Generate new values'] : `Switch to ${methodInfo(selected)!.title}`);
    };
    label();
    const params = paramsView(srv.obf ?? {});
    return card(
      'Disguise',
      [
        E(
          'p',
          { class: 'dl-muted' },
          'AmneziaWG reshapes the tunnel so networks that block VPNs do not recognise it. Every device gets these settings in its configuration.',
        ),
        methodPicker(
          this.st.awg,
          selected,
          (m) => {
            selected = m;
            label();
          },
          current,
        ),
        !this.st.awg.v3
          ? callout('info', [
              'This router runs an older AmneziaWG. ',
              E('b', {}, 'Maximum'),
              ' becomes available with kmod-amneziawg and amneziawg-tools 3.1.',
            ])
          : '',
        params ?? '',
      ],
      [E('span', { class: 'dl-sub' }, 'Applies at once. Every device on this server must import its configuration again.'), action],
    );
  }

  async applyDisguise(srv: Server, m: Method, same: boolean) {
    const info = methodInfo(m)!;
    const people = this.st.people.filter((p) => p.server === srv.id);
    const devices = people.reduce((n, p) => n + p.devices.length, 0);
    const ok = await confirmDialog(
      same ? 'Generate new disguise values?' : `Switch to ${info.title}?`,
      `${devices} device${devices === 1 ? '' : 's'} stop connecting until they import their configuration again (from their personal link or from you).${m === 'max' ? ' They need an app with AmneziaWG 3.1.' : ''}`,
      same ? 'Generate and apply' : 'Switch and apply',
      true,
    );
    if (!ok) return;
    if (await attempt(() => api.serverObfuscation(srv.id, m), same ? 'New values applied' : `${info.title} applied`)) {
      notify('Devices are marked “Update config” until they import again.', 'info', 6000);
      await this.refresh();
    }
  }

  /** Technical details that rarely change, then the danger zone. */
  tunnel(srv: Server): HTMLElement {
    const people = this.st.people.filter((p) => p.server === srv.id).length;
    const toggle = button(
      srv.enabled ? 'Turn off' : 'Turn on',
      async () => {
        if (
          srv.enabled &&
          !(await confirmDialog(
            `Turn off ${srv.name}?`,
            `The tunnel stops and ${people} ${people === 1 ? 'person is' : 'people are'} disconnected until you turn it back on. Nothing is deleted.`,
            'Turn off',
            true,
          ))
        )
          return;
        await this.save(srv, { enabled: srv.enabled ? '0' : '1' }, srv.enabled ? 'Server turned off' : 'Server turned on');
      },
      srv.enabled ? 'negative' : 'positive',
    );
    return E('div', { class: 'dl-stack gap16' }, [
      card(
        'Tunnel',
        [
          E('p', { class: 'dl-muted' }, 'Technical details. They are set when the server is created and rarely change.'),
          row('Interface', E('span', { class: 'dl-mono' }, `${srv.ifname} · router ${srv.address}`)),
          row('Tunnel subnet', E('span', { class: 'dl-mono' }, srv.subnet), 'Device addresses come from it.'),
          row(
            'Server public key',
            E('span', { class: 'dl-keyrow' }, [
              E('code', { class: 'dl-mono' }, srv.public_key),
              button([icon('copy')], () => copyText(srv.public_key, 'Public key copied'), 'neutral', {
                title: 'Copy',
                class: 'cbi-button cbi-button-neutral dl-icon-only sm',
              }),
            ]),
          ),
        ],
        [],
      ),
      card(
        'Danger zone',
        [
          E('div', { class: 'dl-setrow' }, [
            E('div', { class: 'dl-stack' }, [
              E('span', { class: 'dl-setrow-label' }, srv.enabled ? 'Turn off this server' : 'This server is off'),
              E(
                'span',
                { class: 'dl-sub' },
                srv.enabled
                  ? 'Stops the tunnel and disconnects everyone on it. Settings and people are kept.'
                  : 'Nobody can connect. Turn it on to bring the tunnel back.',
              ),
            ]),
            E('div', { class: 'dl-setrow-ctl' }, toggle),
          ]),
          E('div', { class: 'dl-setrow' }, [
            E('div', { class: 'dl-stack' }, [
              E('span', { class: 'dl-setrow-label' }, 'Remove server'),
              E(
                'span',
                { class: 'dl-sub' },
                `Removes the tunnel, its firewall rules and ${people} ${people === 1 ? 'person' : 'people'} with all their devices. A backup is made first.`,
              ),
            ]),
            E(
              'div',
              { class: 'dl-setrow-ctl' },
              button([icon('trash'), ' Remove'], () => this.remove(srv), 'negative'),
            ),
          ]),
        ],
        [],
        'danger',
      ),
    ]);
  }

  /* ---------------- add / remove ---------------- */

  async addServer() {
    const d = await attempt(() => api.setupDefaults());
    if (!d) return;
    dom.content(
      this.root,
      this.wizard(d, true, () => {
        dom.content(this.root, [this.tabsEl, this.headEl, this.secEl, this.bodyEl]);
        this.paint();
      }),
    );
  }

  async remove(srv: Server) {
    const people = this.st.people.filter((p) => p.server === srv.id);
    modal(
      `Remove ${srv.name}?`,
      [
        E(
          'p',
          {},
          `This removes the tunnel, its firewall rules and ${people.length} ${people.length === 1 ? 'person' : 'people'} with all their devices. A backup is made first.`,
        ),
      ],
      [
        E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
        ' ',
        button(
          'Remove',
          async () => {
            closeModal();
            if (await attempt(() => api.serverDelete(srv.id), 'Server removed'))
              setTimeout(() => {
                location.href = url();
              }, 800);
          },
          'negative',
        ),
      ],
    );
  }

  /* ---------------- wizard ---------------- */

  /**
   * Setup wizard. `extra` adds one more server next to existing ones: the
   * portal is already set up then, so that step is left out.
   */
  wizard(d: SetupDefaults, extra = false, onCancel?: () => void): HTMLElement {
    const state = {
      id: d.id,
      name: d.name,
      endpoint: d.endpoint,
      port: d.port,
      subnet: d.subnet,
      preset: 'standard' as Method,
      // Off by default: the portal opens a port on WAN, so it is a choice.
      portal: false,
      portal_port: d.portal_port || 8443,
      lan_like: true,
      lan_zone: d.lan_zone,
      wan_zone: d.wan_zone,
    };
    let step = 0;
    const root = E('div', { class: 'dl-wizard' });
    const field = (key: 'id' | 'name' | 'endpoint' | 'port' | 'subnet' | 'portal_port', attrs: Record<string, unknown> = {}) => {
      const el = input(String(state[key]), attrs);
      el.addEventListener('input', () => {
        (state as any)[key] = key === 'port' || key === 'portal_port' ? Number(el.value) : el.value.trim();
      });
      return el;
    };

    const steps = extra ? ['Connection', 'Disguise'] : ['Connection', 'Disguise', 'Portal'];
    const pages: (() => Node)[] = [
      () =>
        E('div', { class: 'dl-wizard-groups' }, [
          E(
            'p',
            { class: 'dl-muted' },
            'Where devices connect to. A hostname that always points at your router (DDNS) keeps links working when your IP changes.',
          ),
          group('router', 'Server', 'What people see', [row('Name', field('name'), 'Shown to people in their portal.')]),
          group('globe', 'Devices connect to', 'Where the tunnel answers from the internet', [
            row(
              'Public address',
              field('endpoint', { placeholder: 'vpn.example.com', class: 'cbi-input-text dl-mono' }),
              'Hostname or IP address of your router on the internet.',
            ),
            row(
              'UDP port',
              field('port', { inputmode: 'numeric', class: 'cbi-input-text dl-w-port dl-mono' }),
              'Opened on the WAN firewall automatically. A random high port is fine.',
            ),
          ]),
          group('network', 'Tunnel network', 'Addresses devices get inside the tunnel', [
            row(
              'Tunnel subnet',
              field('subnet', { class: 'cbi-input-text dl-mono' }),
              `Must not overlap your networks (${d.taken.join(', ') || 'none found'}).`,
            ),
          ]),
        ]),
      () =>
        E('div', {}, [
          E(
            'p',
            {},
            'AmneziaWG reshapes the tunnel so networks that block VPNs do not recognise it. Every device gets these settings automatically; you can change the method later.',
          ),
          methodPicker(d.awg, state.preset, (m) => (state.preset = m)),
        ]),
      () => {
        const portalPort = field('portal_port', { inputmode: 'numeric', class: 'cbi-input-text dl-w-port dl-mono' });
        const portRow = row('Listening port', portalPort, 'TCP port on WAN for the portal; the whole port belongs to it.');
        portRow.hidden = !state.portal;
        // Off | On, Off first: the same segmented control as in Settings.
        const onOff = E(
          'div',
          { class: 'dl-seg', role: 'radiogroup', 'aria-label': 'Personal portal' },
          (['off', 'on'] as const).map((v) =>
            E(
              'button',
              {
                type: 'button',
                role: 'radio',
                class: (v === 'on') === state.portal ? 'on' : '',
                'aria-checked': (v === 'on') === state.portal ? 'true' : 'false',
                click: (ev: Event) => {
                  state.portal = v === 'on';
                  portRow.hidden = !state.portal;
                  onOff.querySelectorAll('button').forEach((x) => {
                    const sel = x === ev.currentTarget;
                    x.classList.toggle('on', sel);
                    x.setAttribute('aria-checked', sel ? 'true' : 'false');
                  });
                },
              },
              v === 'on' ? 'On' : 'Off',
            ),
          ),
        );
        return E('div', { class: 'dl-wizard-groups' }, [
          group('home', 'Internet like a home device', 'How devices reach the internet', [
            row(
              'Through the home network',
              sw(state.lan_like, 'Internet like a home device', (v) => (state.lan_like = v)),
              'Whatever handles home traffic on this router (proxies, filters, DNS) handles theirs too. Change it later under Servers → Access.',
            ),
          ]),
          group('link', 'Personal portal', 'A page where each person adds their own devices with their personal link', [
            row('Portal', onOff, 'Off: only you add devices, from LuCI. On: people manage their devices within the limits you set.'),
            portRow,
          ]),
        ]);
      },
    ];

    const paint = () => {
      dom.content(root, [
        E('h2', {}, extra ? 'Add a server' : 'Set up Dawnline'),
        E(
          'div',
          { class: 'dl-steps' },
          steps.map((s, i) =>
            E('span', { class: `dl-step${i === step ? ' current' : i < step ? ' done' : ''}` }, [
              E('b', {}, i < step ? '✓' : String(i + 1)),
              s,
            ]),
          ),
        ),
        E('div', { class: 'dl-panel' }, pages[step]()),
        E('div', { class: 'dl-actions' }, [
          step > 0
            ? button('Back', () => {
                step--;
                paint();
              })
            : onCancel
              ? button('Cancel', onCancel)
              : '',
          E('span', { class: 'dl-spacer' }),
          step < steps.length - 1
            ? button(
                'Next',
                () => {
                  if (step === 0 && (!state.endpoint || !state.port || !state.subnet)) {
                    notify('Fill in the public address, port and subnet.', 'warning');
                    return;
                  }
                  step++;
                  paint();
                },
                'positive',
              )
            : button(
                'Create server',
                async () => {
                  // An extra server leaves the portal settings alone (undefined is not sent).
                  const r = await attempt(
                    () =>
                      api.serverCreate(
                        state.id,
                        state.name,
                        d.ifname,
                        state.port,
                        state.subnet,
                        state.endpoint,
                        d.mtu,
                        state.preset,
                        state.lan_zone,
                        state.wan_zone,
                        state.lan_like,
                        extra ? undefined : state.portal,
                        extra ? undefined : state.portal_port,
                      ),
                    'Server created',
                  );
                  if (r)
                    setTimeout(() => {
                      location.href = url(r.id);
                    }, 1500);
                },
                'positive',
              ),
        ]),
      ]);
    };
    paint();
    return root;
  }
}
