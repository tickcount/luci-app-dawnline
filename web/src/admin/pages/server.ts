// Servers: a setup wizard when nothing is configured; otherwise one tab per
// server. Each opens on its Overview (who is online, traffic, map, activity)
// followed by People, Connection, Access and AmneziaWG (its own settings come
// from ../cores/awg). Every settings section saves on its own and applies at
// once.

import type { Server, Status } from '../../shared/types';
import { E } from '../e';
import { api, type SetupDefaults } from '../api';
import { button } from '../ui/button';
import { cancelButton, closeModal, confirmDialog, modal } from '../ui/modal';
import { copyText } from '../ui/files';
import { attempt, errorText, notify } from '../ui/toast';
import { input, seg, sw } from '../ui/controls';
import { card, firstBad, group, liveRow, needRow, row } from '../ui/layout';
import { dnsHelp, endpointProbe, hostHelp, nameHelp, portalPortHelp, portHelp, rangeHelp, rangeOf, subnetOf } from '../netcheck';
import { icon } from '../../shared/icons';
import { ago, duration } from '../../shared/format';
import { accessCards } from '../interfaces';
import { checkAccess, whoReaches } from '../access';
import { defaultMethod, methodPicker } from '../disguise';
import { coreOf } from '../cores';
import { installAwg } from '../pkgs';
import { createPoller, focusInside, repaint, type Poller } from '../state/poller';
import { ServerOverview } from './overview';
import { PeoplePage } from './people';

/** `awg` is the server's core section (named after its core; the key stays for old links). */
type Section = 'overview' | 'people' | 'connection' | 'access' | 'awg';
const SECTIONS: [Section, string][] = [
  ['overview', 'Overview'],
  ['people', 'People'],
  ['connection', 'Connection'],
  ['access', 'Access'],
  ['awg', ''],
];
/** Section names from before the regrouping, for old links. */
const OLD_SECTIONS: Record<string, Section> = {
  general: 'connection',
  network: 'connection',
  interfaces: 'access',
  advanced: 'awg',
  disguise: 'awg',
  tunnel: 'awg',
  core: 'awg',
};
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
  poller?: Poller<Status>;

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
    // Live numbers on the Overview; settings forms are left alone while open,
    // and so is anything that has the keyboard focus. A page object survives
    // Outline's navigation: the previous visit's poller must not pile up.
    this.poller?.stop();
    this.poller = createPoller({
      fetch: () => api.status(31),
      every: 30,
      live: true,
      active: () => this.section === 'overview' && this.root.isConnected,
      apply: (n, quiet) => {
        if (!n.servers.length) return;
        this.st = n;
        this.paintHead(quiet);
        this.ov[this.current().id]?.update(n, quiet);
      },
    });
    return this.root;
  }

  /** Server tabs and the head from the current status. */
  paintHead(quiet = false) {
    repaint(this.headEl, this.head(this.current()), quiet);
    if (!quiet || !focusInside(this.tabsEl)) this.paintTabs();
  }

  /** New status for the head and tabs, without rebuilding the section (forms keep what was typed). */
  async refreshStatus(): Promise<Status | null> {
    const st = await api.status(31).catch(() => null);
    if (!st?.servers.length) return null;
    this.st = st;
    this.paintHead();
    return st;
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
            [E('i', { class: `dot ${!x.enabled ? 'warn' : x.up ? 'ok' : 'bad'}` }), E('b', {}, x.name)],
          ),
        ),
        E('button', { type: 'button', class: 'dl-srvtab add', click: () => this.addServer() }, [icon('plus'), 'Add server']),
      ]),
    );
  }

  paintSections() {
    const core = coreOf(this.current());
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
            k === 'awg' ? core.label : t,
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
          void pp.update();
          return pp.el;
        }
        const holder = E('div', {}, E('p', { class: 'dl-muted' }, 'Loading people…'));
        const page = (this.pp[srv.id] ??= new PeoplePage());
        page
          .embed(st, srv.id)
          .then((node) => {
            if (holder.isConnected) dom.content(holder, node);
            else holder.replaceChildren(node);
          })
          .catch((e) => {
            // Try again on the next visit instead of keeping a broken page.
            delete this.pp[srv.id];
            dom.content(holder, E('p', { class: 'dl-muted' }, `Couldn't show people: ${errorText(e)}`));
          });
        return holder;
      },
      connection: () => this.connection(srv),
      access: () => this.access(srv),
      awg: () => this.awg(srv),
    };
    const node = body[k]();
    this.detachKept();
    dom.content(this.bodyEl, node);
  }

  /** Name and state, the address bar, and the page actions. */
  head(srv: Server): HTMLElement {
    const part = (ic: string, body: (Node | string)[]) => E('span', { class: 'dl-addrbar-seg' }, [icon(ic), ...body]);
    const addr = srv.endpoint || '—';
    // "Turn on" while the server is off (turning off lives in Connection).
    const actions = E('div', { class: 'dl-actions' }, [
      !srv.enabled
        ? button(
            [icon('play'), ' Turn on'],
            () => this.save(srv, { enabled: '1' }, 'Server turned on'),
            // White, as the other main actions (Add person).
            'add',
          )
        : '',
    ]);
    // Actions sit on the name's line; the address bar gets the whole next line.
    return E('div', { class: 'dl-srvpagehead' }, [
      E('div', { class: 'dl-title-row' }, [
        E('h2', { class: 'dl-h1' }, srv.name),
        E(
          'span',
          // Off on purpose is a warning (yellow), not a failure (red).
          { class: `dl-pill ${!srv.enabled ? 'warn' : srv.up ? 'ok' : 'bad'}` },
          !srv.enabled ? 'Turned off' : srv.up ? 'Running' : srv.blocked ? 'Can’t start' : 'Not running',
        ),
        E('span', { class: 'dl-spacer' }),
        actions,
      ]),
      E('div', { class: 'dl-addrbar' }, [
        E(
          'button',
          { type: 'button', class: 'dl-addrbar-seg main', title: 'Copy address', click: () => copyText(addr, 'Address copied') },
          [icon('globe'), E('span', { class: 'dl-mono' }, addr), icon('copy')],
        ),
        part(coreOf(srv).id === 'awg' ? 'amneziawg' : 'tunnel', [E('span', { class: 'dl-mono' }, `${coreOf(srv).label} :${srv.port}`)]),
        srv.up ? part('clock', [`up ${duration(srv.uptime)}`]) : '',
      ]),
      // The reason the tunnel can't run at all ("can't use the network interface awg0: it exists and isn't Dawnline's").
      srv.blocked ? E('div', { class: 'dl-note warn' }, [icon('alert'), E('span', {}, `${srv.name} ${srv.blocked}.`)]) : '',
    ]);
  }

  async save(srv: Server, values: Record<string, unknown>, ok = 'Saved') {
    if (await attempt(() => api.serverUpdate(srv.id, values), ok)) await this.refresh();
  }

  /** The name, where devices find the router, DNS; then the danger zone. */
  connection(srv: Server): HTMLElement {
    const name = input(srv.name, { placeholder: 'Home' });
    const endpoint = input(srv.endpoint, { placeholder: 'vpn.example.com', class: 'cbi-input-text dl-mono' });
    const dns = input(srv.dns.join(', '), { placeholder: 'This router (recommended)', class: 'cbi-input-text dl-mono' });
    const people = this.st.people.filter((p) => p.server === srv.id).length;
    const toggle = button(
      [icon(srv.enabled ? 'pause' : 'play'), srv.enabled ? ' Turn off' : ' Turn on'],
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
    const portalHost = this.st.settings.portal_host;
    const nameRow = liveRow('Name', name, () => nameHelp(name.value, [], 'Shown to people in their portal and apps.'));
    // Where the address points is checked on the router as it is typed (debounced).
    const ep = endpointProbe(
      () => ({ host: endpoint.value, port: srv.port, id: srv.id }),
      (h, id, port) => api.endpointProbe(h, id, port),
      () => epRow.refresh(),
      { empty: portalHost ? `Empty = the portal’s address (${portalHost}).` : 'Empty = the portal’s address.' },
    );
    const epRow = liveRow('Public address', endpoint, ep.help);
    endpoint.addEventListener('input', ep.schedule);
    ep.schedule();
    const reached = srv.reached
      ? `Reached from the internet ${ago(srv.reached, this.st.now)}.`
      : 'Never reached from the internet yet — test with a phone on mobile data.';
    const dnsRow = liveRow('DNS for devices', dns, () => dnsHelp(dns.value, srv.address));
    return E('div', { class: 'dl-stack gap16' }, [
      card(
        'Connection',
        [
          E('p', { class: 'dl-muted' }, 'The name people see, where devices find the router, and DNS. The port is on AmneziaWG.'),
          group('router', 'Server', 'What people see', [nameRow]),
          group(
            'globe',
            'Devices connect to',
            'A DDNS name keeps links working when your IP changes; not through Cloudflare (use a DNS-only name or an IP)',
            [epRow, E('div', { class: `dl-sub ${srv.reached ? 'ok' : 'warn'}` }, reached)],
          ),
          group('file', 'For every device', 'Changing it marks devices “Update config” until they import again', [dnsRow]),
        ],
        [
          E('span'),
          button(
            'Save',
            () => {
              const bad = firstBad([nameRow, epRow, dnsRow]);
              if (bad) {
                notify(bad, 'warning');
                return;
              }
              return this.save(srv, { name: name.value, endpoint: endpoint.value, dns: dns.value });
            },
            'positive',
          ),
        ],
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
              E('span', { class: 'dl-setrow-label' }, 'Change the tunnel network'),
              E(
                'span',
                { class: 'dl-sub' },
                `Devices have ${rangeOf(srv.subnet)}.x addresses now. A new range when it clashes with a network you connect to; every device then needs its configuration again.`,
              ),
            ]),
            E(
              'div',
              { class: 'dl-setrow-ctl' },
              button([icon('edit'), ' Change'], () => this.changeSubnet(srv), 'negative'),
            ),
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

  /**
   * Where devices may go and how their traffic leaves: internet path, home
   * network, services, circles. Changes that apply at once refresh the status
   * in place, so an unsaved interface choice survives them.
   */
  access(srv: Server): HTMLElement {
    let who = whoReaches(this.st, srv);
    const cards = accessCards(srv, this.st, async () => {
      const st = await this.refreshStatus();
      if (!st) return;
      const s2 = st.servers.find((x) => x.id === srv.id) ?? srv;
      cards.update(st);
      const n = whoReaches(st, s2);
      who.replaceWith(n);
      who = n;
    });
    return E('div', { class: 'dl-stack gap16' }, [cards.el, E('div', { class: 'dl-health-cols' }, [who, checkAccess(this.st, srv)])]);
  }

  /** The server's core: for AmneziaWG the listening port, MTU, keep-alive, disguise and tunnel. */
  awg(srv: Server): HTMLElement {
    const ctx = {
      st: this.st,
      save: (values: Record<string, unknown>, ok?: string) => this.save(srv, values, ok),
      refresh: () => this.refresh(),
    };
    return E('div', { class: 'dl-stack gap16' }, [coreOf(srv).settingsCard(ctx, srv)]);
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

  /** A new tunnel network: checked as you type against the router's networks, then every device renumbered. */
  async changeSubnet(srv: Server) {
    const taken = await attempt(() => api.serverPorts(srv.id));
    if (!taken) return;
    const nets = taken.networks ?? [];
    const devices = this.st.people.filter((p) => p.server === srv.id).reduce((n, p) => n + p.devices.length, 0);
    const range = input(rangeOf(srv.subnet), { class: 'cbi-input-text dl-mono dl-w-range' });
    const rangeRow = liveRow('Address range', range, () => rangeHelp(range.value, nets, ''));
    modal(
      'Change the tunnel network',
      [
        rangeRow,
        E(
          'p',
          { class: 'dl-muted' },
          devices
            ? `${devices} device${devices === 1 ? ' gets a new address and stops' : 's get new addresses and stop'} connecting until ${devices === 1 ? 'it imports its' : 'they import their'} configuration again (from their personal link or from you).`
            : 'No devices on this server yet: nothing else changes.',
        ),
      ],
      [
        cancelButton(),
        ' ',
        button(
          'Change',
          async () => {
            const h = rangeRow.help();
            if (h.bad) {
              notify(h.text, 'warning');
              return;
            }
            const subnet = subnetOf(range.value);
            if (subnet === srv.subnet) {
              closeModal();
              return;
            }
            if (await attempt(() => api.serverUpdate(srv.id, { subnet }), 'Tunnel network changed')) {
              closeModal();
              if (devices) notify('Devices are marked “Update config” until they import again.', 'info', 6000);
              await this.refresh();
            }
          },
          'negative',
        ),
      ],
    );
    setTimeout(() => range.select(), 50);
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
        cancelButton(),
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
      // The tunnel's first three numbers ("10.77.0"): it is that /24.
      range: rangeOf(d.subnet),
      preset: defaultMethod(d.awg),
      // Off by default: the portal opens a port on WAN, so it is a choice.
      portal: false,
      portal_port: d.portal_port || 8443,
      lan_like: true,
      lan_zone: d.lan_zone,
      wan_zone: d.wan_zone,
    };
    let step = 0;
    // The portal takes the server's port number (TCP beside UDP) until it is changed by hand.
    let portalSame = !extra && state.portal_port === state.port;
    const ipLinks = () => /^\d{1,3}(\.\d{1,3}){3}$/.test(state.endpoint);
    const portHelpNow = () =>
      portHelp(
        state.port,
        d.udp_taken ?? [],
        `Opened on the WAN firewall automatically.${state.port === 4500 ? ' 4500 is IPsec’s port: most networks let it through.' : ''}`,
      );
    const FROM: Record<string, string> = {
      ddns: 'From your DDNS name.',
      cert: 'From your Let’s Encrypt certificate.',
      wan: 'Your WAN address now — it may change; a DDNS name is better.',
      portal: 'The portal’s address.',
    };
    const ep = endpointProbe(
      () => ({ host: state.endpoint, port: state.port }),
      (h, _id, port) => api.endpointProbe(h, '', port),
      () => epRow?.refresh(),
      { idle: () => (state.endpoint === d.endpoint && d.endpoint_from ? (FROM[d.endpoint_from] ?? '') : '') },
    );
    let epRow: ReturnType<typeof liveRow> | null = null;
    // Nobody on the internet reaches a private or CGNAT address: say it before the first step.
    const wanNote =
      d.wan_kind === 'cgnat' || d.wan_kind === 'private'
        ? needRow(
            'alert',
            'warn',
            d.wan_kind === 'cgnat' ? 'Your router has no public address (CGNAT)' : `Your router is behind another router (WAN ${d.wan_ip})`,
            d.wan_kind === 'cgnat'
              ? 'The ISP shares one address: devices can only connect if the ISP gives you a public address or IPv6. Ask them, or use a DDNS name that points at an IPv6 address.'
              : 'Forward the UDP port on the upstream router to this one and use a DDNS name or that router’s public address here.',
            '',
          )
        : '';
    const restartNote =
      d.awg_state?.tools && d.awg_state.handler === false
        ? E('div', { class: 'dl-note warn' }, [
            icon('alert'),
            E('span', {}, 'Creating the server restarts the network for a few seconds: AmneziaWG was installed after the network started.'),
          ])
        : '';
    const rangeHelpNow = () => rangeHelp(state.range, d.networks ?? [], rangeOf(d.subnet));
    const portalHelpNow = () => portalPortHelp(state.portal_port, d.tcp_taken ?? [], ipLinks());
    const root = E('div', { class: 'dl-wizard' });
    const field = (key: 'id' | 'name' | 'endpoint' | 'port' | 'range' | 'portal_port', attrs: Record<string, unknown> = {}) => {
      const el = input(String(state[key]), attrs);
      el.addEventListener('input', () => {
        if (key === 'port' || key === 'portal_port') (state as any)[key] = el.value.trim() === '' ? 0 : Number(el.value);
        else (state as any)[key] = el.value.trim();
        if (key === 'port' && portalSame) state.portal_port = state.port;
        if (key === 'portal_port') portalSame = state.portal_port === state.port;
      });
      return el;
    };

    type Page = { id: string; title: string; render: () => Node; check?: () => string | null };
    const serverPage: Page = {
      id: 'server',
      title: 'Server',
      render: () =>
        E('div', { class: 'dl-wizard-groups' }, [
          E(
            'p',
            { class: 'dl-muted' },
            extra
              ? 'One more server: another port or disguise for networks where the first does not get through, or its own home access rules. People are moved between servers from their page.'
              : 'Where devices connect to. A hostname that always points at your router (DDNS) keeps links working when your IP changes.',
          ),
          group('router', 'Server', 'What people see', [
            liveRow('Name', field('name'), () => nameHelp(state.name, [], 'Shown to people in their portal and apps.')),
          ]),
          group(
            'globe',
            'Devices connect to',
            'A hostname or IP address of your router on the internet; not through Cloudflare (use a DNS-only name or an IP). IPv6 works too, and is the way out of CGNAT',
            [
              (() => {
                const el = field('endpoint', { placeholder: 'vpn.example.com', class: 'cbi-input-text dl-mono' });
                epRow = liveRow('Public address', el, ep.help);
                el.addEventListener('input', ep.schedule);
                ep.schedule();
                return epRow;
              })(),
            ],
          ),
          wanNote,
          restartNote,
        ]),
      check: () => {
        const n = nameHelp(state.name);
        if (n.bad) return `Name: ${n.text}`;
        const h = hostHelp(state.endpoint, state.port);
        return h.bad ? `Public address: ${h.text}` : null;
      },
    };
    const awgPage: Page = {
      id: 'awg',
      title: 'AmneziaWG',
      render: () =>
        E('div', { class: 'dl-wizard-groups' }, [
          group('globe', 'Listening', 'Where devices reach AmneziaWG from the internet', [
            liveRow('UDP port', field('port', { inputmode: 'numeric', class: 'cbi-input-text dl-w-port dl-mono' }), portHelpNow),
          ]),
          group('network', 'Tunnel network', 'Addresses devices get inside the tunnel', [
            (() => {
              const el = field('range', {
                class: 'cbi-input-text dl-w-range dl-mono',
                'aria-label': 'First three numbers of the device addresses',
              });
              return liveRow(
                'Device addresses',
                el,
                rangeHelpNow,
                E('span', { class: 'dl-suffixed' }, [el, E('span', { class: 'dl-mono' }, '.x')]),
              );
            })(),
          ]),
          group('shield', 'Disguise', 'So networks that block VPNs do not recognise the tunnel. Off = plain WireGuard', [
            methodPicker(d.awg, state.preset, (m) => (state.preset = m), undefined, d.awg_state?.tools !== false),
          ]),
        ]),
      check: () => {
        const p = portHelpNow();
        if (p.bad) return `UDP port: ${p.text}`;
        const r = rangeHelpNow();
        return r.bad ? `Device addresses: ${r.text}` : null;
      },
    };
    const portalPage: Page = {
      id: 'portal',
      title: 'Portal',
      render: () => {
        const portalPort = field('portal_port', { inputmode: 'numeric', class: 'cbi-input-text dl-w-port dl-mono' });
        const portRow = liveRow('Listening port', portalPort, portalHelpNow);
        portRow.hidden = !state.portal;
        // Off | On, Off first: the same segmented control as in Settings.
        const onOff = seg(
          [
            ['off', 'Off'],
            ['on', 'On'],
          ],
          state.portal ? 'on' : 'off',
          {
            label: 'Personal portal',
            onChange: (v) => {
              state.portal = v === 'on';
              portRow.hidden = !state.portal;
            },
          },
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
      check: () => {
        if (!state.portal) return null;
        const h = portalHelpNow();
        return h.bad ? `Portal port: ${h.text}` : null;
      },
    };
    const pages = (): Page[] => [serverPage, awgPage, extra ? null : portalPage].filter((x): x is Page => x != null);
    const aw = d.awg_state;
    const missing = aw?.missing ?? [];
    // Without AmneziaWG the server would only show "Tunnel down": say so first and offer to install it.
    const awgNotice = missing.length
      ? E('div', { class: 'dl-list dl-notices' }, [
          needRow(
            'shield',
            'bad',
            'AmneziaWG isn’t installed',
            `The tunnel needs ${missing.join(' and ')}. Install the build made for this firmware, then create the server.`,
            button('Install', () => installAwg(() => location.reload()), 'positive'),
          ),
        ])
      : aw && !aw.loaded
        ? E('div', { class: 'dl-list dl-notices' }, [
            needRow(
              'shield',
              'warn',
              'AmneziaWG’s kernel module doesn’t load on this firmware',
              'Try another build in Components, or update OpenWrt. The server can’t start until it loads.',
              E('a', { class: 'cbi-button cbi-button-neutral', href: L.url('admin/network/dawnline/updates') }, 'Open Components'),
            ),
          ])
        : '';

    const paint = () => {
      const ps = pages();
      if (step >= ps.length) step = ps.length - 1;
      dom.content(root, [
        E('h2', {}, extra ? 'Add a server' : 'Set up Dawnline'),
        awgNotice,
        E(
          'div',
          { class: 'dl-steps' },
          ps.map((s, i) =>
            E('span', { class: `dl-step${i === step ? ' current' : i < step ? ' done' : ''}` }, [
              E('b', {}, i < step ? '✓' : String(i + 1)),
              s.title,
            ]),
          ),
        ),
        E('div', { class: 'dl-panel' }, ps[step].render()),
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
          step < ps.length - 1
            ? button(
                'Next',
                () => {
                  const err = ps[step].check?.();
                  if (err) {
                    notify(err, 'warning');
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
                  for (const pg of ps) {
                    const err = pg.check?.();
                    if (err) {
                      notify(err, 'warning');
                      return;
                    }
                  }
                  // An extra server leaves the portal settings alone (undefined is not sent).
                  const r = await attempt(
                    () =>
                      api.serverCreate(
                        state.id,
                        state.name,
                        d.ifname,
                        state.port,
                        subnetOf(state.range),
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
                  if (!r) return;
                  // A network restart drops the connection to LuCI for a few seconds.
                  if (r.network_restart) notify('Restarting the network so it knows AmneziaWG: back in a few seconds');
                  setTimeout(
                    () => {
                      location.href = url(r.id);
                    },
                    r.network_restart ? 10000 : 1500,
                  );
                },
                'positive',
                { disabled: missing.length > 0, title: missing.length ? 'Install AmneziaWG first' : null },
              ),
        ]),
      ]);
    };
    paint();
    return root;
  }
}
