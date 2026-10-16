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
import { card, group, needRow, row } from '../ui/layout';
import { icon } from '../../shared/icons';
import { duration } from '../../shared/format';
import { accessCards } from '../interfaces';
import { checkAccess, whoReaches } from '../access';
import { methodPicker, type Method } from '../disguise';
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
    // and so is anything that has the keyboard focus.
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
            [E('i', { class: `dot ${x.up ? 'ok' : 'bad'}` }), E('b', {}, x.name)],
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
    const st = this.st;
    const part = (ic: string, body: (Node | string)[]) => E('span', { class: 'dl-addrbar-seg' }, [icon(ic), ...body]);
    const addr = srv.endpoint || '—';
    // "Turn on" while the server is off (turning off lives in Connection; the same
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
          !srv.enabled ? 'Turned off' : srv.up ? 'Running' : srv.blocked ? 'Can’t start' : 'Not running',
        ),
        st.settings.paused_all && srv.enabled ? E('span', { class: 'dl-pill warn' }, 'Off') : '',
        E('span', { class: 'dl-spacer' }),
        actions,
      ]),
      E('div', { class: 'dl-addrbar' }, [
        E(
          'button',
          { type: 'button', class: 'dl-addrbar-seg main', title: 'Copy address', click: () => copyText(addr, 'Address copied') },
          [icon('globe'), E('span', { class: 'dl-mono' }, addr), icon('copy')],
        ),
        part('tunnel', [E('span', { class: 'dl-mono' }, `${coreOf(srv).label} :${srv.port}`)]),
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
        'Connection',
        [
          E('p', { class: 'dl-muted' }, 'The name people see, where devices find the router, and DNS. The port is on AmneziaWG.'),
          group('router', 'Server', 'What people see', [row('Name', name, 'Shown to people in their portal and apps.')]),
          group('globe', 'Devices connect to', 'Where the router answers from the internet', [
            row(
              'Public address',
              endpoint,
              'Hostname or IP of the router on the internet. A DDNS name keeps links working when your IP changes. It must not go through Cloudflare: use a DNS-only name or an IP.',
            ),
          ]),
          group('file', 'For every device', 'Changing it marks devices “Update config” until they import again', [
            row('DNS for devices', dns, 'Empty = this router, which sends each query where your home network would.'),
          ]),
        ],
        [E('span'), button('Save', () => this.save(srv, { name: name.value, endpoint: endpoint.value, dns: dns.value }), 'positive')],
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

    type Page = { id: string; title: string; render: () => Node; check?: () => string | null };
    const serverPage: Page = {
      id: 'server',
      title: 'Server',
      render: () =>
        E('div', { class: 'dl-wizard-groups' }, [
          E(
            'p',
            { class: 'dl-muted' },
            'Where devices connect to. A hostname that always points at your router (DDNS) keeps links working when your IP changes.',
          ),
          group('router', 'Server', 'What people see', [row('Name', field('name'), 'Shown to people in their portal and apps.')]),
          group('globe', 'Devices connect to', 'Where the router answers from the internet', [
            row(
              'Public address',
              field('endpoint', { placeholder: 'vpn.example.com', class: 'cbi-input-text dl-mono' }),
              'Hostname or IP address of your router on the internet. Not through Cloudflare: use a DNS-only name or an IP.',
            ),
          ]),
        ]),
      check: () => (!state.endpoint ? 'Fill in the public address.' : null),
    };
    const awgPage: Page = {
      id: 'awg',
      title: 'AmneziaWG',
      render: () =>
        E('div', { class: 'dl-wizard-groups' }, [
          group('globe', 'Listening', 'Where devices reach AmneziaWG from the internet', [
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
          group('shield', 'Disguise', 'So networks that block VPNs do not recognise the tunnel. Off = plain WireGuard', [
            methodPicker(d.awg, state.preset, (m) => (state.preset = m), undefined, d.awg_state?.tools !== false),
          ]),
        ]),
      check: () => (!state.port || !state.subnet ? 'Fill in the UDP port and subnet.' : null),
    };
    const portalPage: Page = {
      id: 'portal',
      title: 'Portal',
      render: () => {
        const portalPort = field('portal_port', { inputmode: 'numeric', class: 'cbi-input-text dl-w-port dl-mono' });
        const portRow = row('Listening port', portalPort, 'TCP port on WAN for the portal; the whole port belongs to it.');
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
                { disabled: missing.length > 0, title: missing.length ? 'Install AmneziaWG first' : null },
              ),
        ]),
      ]);
    };
    paint();
    return root;
  }
}
