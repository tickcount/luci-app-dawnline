// A server's Overview section (first tab on the Servers page): who is
// online, traffic, disguise, the connection map, activity and what needs
// attention — all limited to the people on that server.

import type { Device, Person, Status } from '../../shared/types';
import { E } from '../e';
import { api } from '../api';
import { svg } from '../ui/layout';
import { attachTip } from '../ui/tooltip';
import { icon } from '../../shared/icons';
import { ago, bits, bytes, date, daysLeft, endsIn, endsSoon, initials, todayOf } from '../../shared/format';
import { ConnectionMap, rangeControl, type Range } from '../map';
import { personUrl } from '../urls';
import { eventRow } from '../events/render';
import { scoped } from '../state/scope';
import { repaint } from '../state/poller';
import { daysTile, speedTile } from '../widgets/tiles';
import { coreOf } from '../cores';
import { healthNotices, runFix } from '../widgets/health';
import { attempt } from '../ui/toast';
import { isIpv4 } from '../netcheck';
import { onNavigate } from '../ui/nav';

interface Attention {
  tone: string;
  text: (Node | string)[];
  /** A button or link that deals with it. */
  action?: Node;
}

/** Things worth the admin's attention, most important first. */
function attention(st: Status): Attention[] {
  const out: Attention[] = [];
  const link = (href: string, t: string) => E('a', { href }, t);
  const today = todayOf(st.series);
  // AmneziaWG itself can't run: the health notice says so once, not "Tunnel down" for every server.
  const awg = !!st.awg_state && !st.awg_state.ok;
  for (const s of st.servers)
    if (s.enabled && s.blocked)
      // The reason, not just "down": its interface name is taken by a network section Dawnline didn't make.
      out.push({ tone: 'bad', text: [`${s.name} ${s.blocked}. `, link(L.url('admin/network/dawnline/diagnostics'), 'Open Diagnostics')] });
    else if (s.enabled && !s.up && !awg)
      out.push({
        tone: 'bad',
        text: [`Tunnel ${s.ifname} is down. `, link(L.url('admin/network/dawnline/diagnostics'), 'Open Diagnostics')],
      });
  for (const p of st.people) {
    if (p.state === 'quota') out.push({ tone: 'warn', text: [link(personUrl(p.id), p.name), ' reached the data limit.'] });
    else if (p.state === 'expired') out.push({ tone: 'warn', text: [link(personUrl(p.id), p.name), '’s access has ended.'] });
    else {
      const left = daysLeft(p.expires, today);
      if (endsSoon(p, left)) out.push({ tone: '', text: [link(personUrl(p.id), p.name), `’s access ${endsIn(left as number)}.`] });
      // "Keep access" at the end date: nothing changes on its own, so it is said here.
      else if (left != null && left < 0 && p.expire_action === 'notify')
        out.push({ tone: '', text: [link(personUrl(p.id), p.name), `’s end date passed (${date(p.expires)}) · access kept.`] });
      if (p.quota_limit && p.quota_used >= p.quota_limit * 0.9)
        out.push({ tone: '', text: [link(personUrl(p.id), p.name), ' has used 90% of the data limit.'] });
    }
  }
  const stale = st.people.flatMap((p) => p.devices.filter((d) => d.config_stale).map((d) => [p, d] as const));
  if (stale.length)
    out.push({
      tone: 'warn',
      text:
        stale.length === 1
          ? [
              link(personUrl(stale[0][0].id, stale[0][1].id), `${stale[0][0].name} · ${stale[0][1].name}`),
              ' needs its configuration again.',
            ]
          : [`${stale.length} devices need their configuration again (networks or DNS changed).`],
    });
  // A server that gives devices an IPv4 that is no longer the router's: one click puts the new one in.
  for (const s of st.servers)
    if (st.wan && isIpv4(s.endpoint) && s.endpoint !== st.wan)
      out.push({
        tone: 'warn',
        text: [
          `Public address changed: ${s.name} still gives devices ${s.endpoint}, the router is ${st.wan} now. `,
          E(
            'button',
            {
              type: 'button',
              class: 'dl-fix',
              click: async (ev: Event) => {
                const b = ev.currentTarget as HTMLButtonElement;
                b.disabled = true;
                await attempt(
                  () => api.serverUpdate(s.id, { endpoint: st.wan }),
                  `${s.name} uses ${st.wan} now — devices need their configuration again`,
                );
                b.disabled = false;
              },
            },
            'Use the new address',
          ),
          ' A DDNS name would follow it by itself.',
        ],
      });
  if (st.servers.some((s) => s.lan_like) && st.like_home.error)
    out.push({
      tone: 'warn',
      text: [`Internet through the LAN is off: ${st.like_home.error} `, link(L.url('admin/network/dawnline/diagnostics'), 'Details')],
    });
  // Only while setting up: an admin who keeps the portal off has decided so.
  if (!st.settings.portal_enabled && !st.people.length)
    out.push({ tone: '', text: ['The personal portal is off. ', link(L.url('admin/network/dawnline/settings'), 'Turn on')] });
  return out;
}

export class ServerOverview {
  st!: Status;
  el = E('div', { class: 'dl-srvov' });
  map: ConnectionMap | null = null;
  range: Range = 'online';
  parts: Record<string, HTMLElement> = {};
  healthAt = 0;

  /** `go` switches the Servers page to another section in place. */
  constructor(
    readonly srvId: string,
    private go?: (section: string, filter?: string) => void,
  ) {}

  /** Build once; later calls to update() keep the map instance. */
  mount(st: Status): HTMLElement {
    this.st = scoped(st, this.srvId);
    for (const k of ['health', 'bento', 'side', 'activity']) this.parts[k] = E('div', {});
    dom.content(this.el, [
      this.parts.health,
      this.parts.bento,
      this.mapCard(),
      E('div', { class: 'dl-grid2' }, [this.parts.activity, this.parts.side]),
    ]);
    this.paint();
    void this.loadHealth();
    return this.el;
  }

  /** New status; a `quiet` (periodic) update leaves alone a part that has the keyboard focus. */
  update(st: Status, quiet = false) {
    this.st = scoped(st, this.srvId);
    this.paint(quiet);
    this.map?.update(this.mapData());
    // Health checks cost more than a status call: once a minute is plenty.
    if (Date.now() - this.healthAt > 60_000) void this.loadHealth();
  }

  /** Notices above the bento for the checks that failed (with their fix), only while Health has any. */
  async loadHealth() {
    this.healthAt = Date.now();
    const r = await api.health().catch(() => null);
    if (!r) return;
    const again = () => void this.loadHealth();
    const run = async (fix: string) => {
      if (!(await runFix(fix))) return;
      again();
      // The network restarts a second after the answer: look again once it is back.
      if (fix === 'netrestart') setTimeout(again, 5000);
    };
    repaint(
      this.parts.health,
      healthNotices(r.checks, (fix) => void run(fix), again),
      true,
    );
  }

  mapData() {
    return { geo: this.st.geo, people: this.st.people, now: this.st.now };
  }

  mapCard(): HTMLElement {
    const st = this.st;
    const head = E('div', { class: 'dl-panel-head pad' }, [
      E('div', { class: 'dl-stack' }, [
        E('h3', {}, 'Where people connect from'),
        E('span', { class: 'dl-sub' }, 'City-level, from the client IP · locations cached on the router'),
      ]),
      E('span', { class: 'dl-spacer' }),
      rangeControl(this.range, (r) => {
        this.range = r;
        this.map?.setRange(r);
      }),
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
    this.map?.destroy();
    this.map = new ConnectionMap(
      {
        openPerson: (id) => (location.href = personUrl(id)),
        openDevice: (id, dev) => (location.href = personUrl(id, dev)),
      },
      this.range,
    );
    // A WebGL map outlives the page's DOM unless it is told: free it when
    // Outline navigates away (the page object itself may be reused).
    const offNav = onNavigate(() => {
      offNav();
      this.map?.destroy();
      this.map = null;
    });
    const legend = E('div', { class: 'dl-map-legend' }, [
      E('span', {}, [E('i', { class: 'line live' }), 'Live tunnel']),
      E('span', {}, [E('i', { class: 'line' }), 'Seen recently']),
    ]);
    const wrap = E('div', { class: 'dl-map-wrap' }, [this.map.el, legend]);
    requestAnimationFrame(() => this.map!.mount(this.mapData()));
    return E('div', { class: 'dl-panel flush' }, [head, wrap]);
  }

  paint(quiet = false) {
    const st = this.st;
    const srv = st.servers[0];

    repaint(
      this.parts.bento,
      E('div', { class: 'dl-bento' }, [this.onlineTile(), this.speedTile(), coreOf(srv).overviewTile(srv), this.monthTile()]),
      quiet,
    );

    const att = attention(st);
    repaint(
      this.parts.side,
      E('div', { class: 'dl-panel flush' }, [
        E('div', { class: 'dl-panel-head pad' }, [
          E('h3', {}, 'Needs attention'),
          E('span', { class: 'dl-spacer' }),
          E('a', { href: L.url('admin/network/dawnline/diagnostics') }, 'Health'),
        ]),
        att.length
          ? att
              .slice(0, 8)
              .map((a) =>
                E('div', { class: 'dl-attn-item dl-row' }, [
                  E('span', { class: `dl-ev-dot ${a.tone}` }),
                  E('span', {}, a.text),
                  a.action ?? '',
                ]),
              )
          : E('div', { class: 'dl-row dl-muted' }, [icon('check'), 'All good. Nothing needs you right now.']),
      ]),
      quiet,
    );

    const events = [...st.events].reverse().slice(0, 8);
    repaint(
      this.parts.activity,
      E('div', { class: 'dl-panel flush' }, [
        E('div', { class: 'dl-panel-head pad' }, [
          E('h3', {}, 'Activity'),
          E('span', { class: 'dl-spacer' }),
          E('a', { href: `${L.url('admin/network/dawnline/diagnostics')}?tab=log` }, 'View all'),
        ]),
        events.length
          ? events.map((e) => eventRow(st, e))
          : E('div', { class: 'dl-row dl-muted' }, 'Nothing yet. Connections, new devices and pauses appear here.'),
      ]),
      quiet,
    );
  }

  /**
   * Who is connected right now, and nothing else. One or two people: avatar,
   * name, device icons and city; three or more: a grid of avatars (two rows,
   * then +N). The device badge is the main device, or a count. Hover: a live
   * card with speed, devices and today's traffic. Nobody: when someone was last seen.
   */
  onlineTile(): HTMLElement {
    const st = this.st;
    const off = st.servers[0] ? !st.servers[0].enabled : false;
    const CAP = 12;
    const today = (d: Device) => d.spark[d.spark.length - 1] ?? 0;
    const cityOf = (d: Device) => st.geo.points.find((g) => g.device === d.id && g.city)?.city;
    const home = (d: Device) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(d.endpoint ?? '');
    // Where a device is: its city, or "LAN" when it connects from the home network (the hover
    // card adds its address there).
    const where = (d: Device, ip = false): string => (home(d) ? (ip && d.endpoint ? `LAN · ${d.endpoint}` : 'LAN') : (cityOf(d) ?? ''));
    const connectedAt = (d: Device) => [...st.events].reverse().find((e) => e.type === 'connect' && e.device === d.id)?.ts ?? 0;
    const on = st.people
      .map((p) => ({ p, devs: p.devices.filter((d) => d.online).sort((a, b) => today(b) - today(a)) }))
      .filter((x) => x.devs.length)
      .sort((a, b) => b.devs.reduce((n, d) => n + today(d), 0) - a.devs.reduce((n, d) => n + today(d), 0));
    const big = on.length <= 2;

    const card = ({ p, devs }: { p: Person; devs: Device[] }): Node[] => {
      const starts = devs.map(connectedAt).filter(Boolean);
      const since = starts.length ? Math.min(...starts) : 0;
      const pts = (p.rate ?? []).slice(-15);
      const last = pts[pts.length - 1];
      const fresh = last && st.now - last[0] < 180 ? last : null;
      const W = 200,
        H = 30,
        max = Math.max(1, ...pts.map((x) => Math.max(x[1], x[2])));
      const line = (k: 1 | 2) => pts.map((x, i) => `${pts.length > 1 ? (i / (pts.length - 1)) * W : W},${H - 2 - (x[k] / max) * (H - 6)}`);
      const chart =
        pts.length > 1
          ? svg(
              `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="dl-hc-chart" aria-hidden="true">` +
                `<path d="M${line(2).join(' L')} L${W},${H} L0,${H}Z" class="area"/><path d="M${line(2).join(' L')}" class="dn"/><path d="M${line(1).join(' L')}" class="up"/></svg>`,
            )
          : '';
      const idle = !fresh || (fresh[1] < 64 && fresh[2] < 64);
      const reach = p.access === 'both' ? ['home', 'globe'] : p.access === 'lan' ? ['home'] : ['globe'];
      return [
        E('div', { class: 'dl-hc' }, [
          E('div', { class: 'dl-hc-head' }, [
            E('span', { class: 'dl-onl-av sm' }, initials(p.name)),
            E('span', { class: 'dl-stack' }, [
              E('b', {}, p.name),
              E('span', { class: 'dl-hc-since' }, since ? `online for ${ago(since, st.now).replace(' ago', '')}` : 'online'),
            ]),
            E(
              'span',
              { class: 'dl-hc-reach' },
              reach.map((r) => E('span', { class: `dl-ibadge ${r === 'home' ? 'lan' : 'inet'}` }, icon(r))),
            ),
          ]),
          E('div', { class: 'dl-hc-speed' }, [
            E(
              'div',
              { class: 'dl-hc-speed-row' },
              idle
                ? [E('span', { class: 'dl-faint' }, 'Idle right now')]
                : [
                    E('span', {}, [E('span', { class: 'dl-dn' }, '↓'), ` ${bits(fresh![2])}`]),
                    E('span', {}, [E('span', { class: 'dl-up' }, '↑'), ` ${bits(fresh![1])}`]),
                    E('span', { class: 'dl-spacer' }),
                    E('span', { class: 'dl-faint' }, '15 min'),
                  ],
            ),
            chart,
          ]),
          E(
            'div',
            { class: 'dl-hc-devs' },
            devs.map((d) => E('span', { class: 'dl-hc-dev' }, [icon(d.kind), d.name, where(d) ? [' · ', where(d, true)] : ''])),
          ),
          E('div', { class: 'dl-hc-foot' }, [
            E(
              'span',
              { class: 'dl-faint' },
              `${bytes(devs.reduce((n, d) => n + today(d), 0))} today · ${bytes(p.month[0] + p.month[1])} this month`,
            ),
          ]),
        ]),
      ];
    };

    const person = (x: { p: Person; devs: Device[] }) => {
      const { p, devs } = x;
      const badge = E('span', { class: 'dl-onl-dev' }, devs.length > 1 ? String(devs.length) : icon(devs[0].kind));
      const el = E('a', { class: `dl-onl-p${big ? '' : ' sm'}`, href: personUrl(p.id), 'aria-label': `${p.name}, online` }, [
        E('span', { class: 'dl-onl-av' }, [initials(p.name), badge]),
        big ? E('span', { class: 'dl-onl-name' }, p.name) : '',
        big
          ? E('span', { class: 'dl-onl-meta' }, [
              ...devs.slice(0, 3).map((d) => icon(d.kind)),
              devs.length > 3 ? `+${devs.length - 3}` : '',
              where(devs[0]) ? E('span', {}, [' · ', where(devs[0])]) : '',
            ])
          : '',
      ]);
      attachTip(el, () => card(x));
      return el;
    };

    const count = E('b', { class: `dl-onl-count${on.length ? '' : ' none'}` }, String(on.length));
    const ndev = on.reduce((n, x) => n + x.devs.length, 0);
    if (on.length)
      attachTip(count, () => [`${on.length} ${on.length === 1 ? 'person' : 'people'} · ${ndev} device${ndev === 1 ? '' : 's'}`]);
    const shown = on.length > CAP ? on.slice(0, CAP - 1) : on;
    const last = st.people
      .flatMap((p) => p.devices.map((d) => ({ p, d })))
      .filter((x) => x.d.handshake)
      .sort((a, b) => b.d.handshake - a.d.handshake)[0];
    return E('div', { class: 'dl-bento-tile online' }, [
      E('div', { class: 'dl-bento-head' }, [E('span', { class: 'dl-metric-label' }, 'Online'), count]),
      on.length
        ? E('div', { class: `dl-onl-row${big ? '' : ' grid'}` }, [
            ...shown.map(person),
            on.length > CAP
              ? E(
                  'a',
                  {
                    class: 'dl-onl-p sm more',
                    href: `${L.url('admin/network/dawnline/server')}?server=${encodeURIComponent(this.srvId)}&section=people&filter=online`,
                    title: 'Everyone online',
                    click: (ev: Event) => {
                      if (this.go) {
                        ev.preventDefault();
                        this.go('people', 'online');
                      }
                    },
                  },
                  [E('span', { class: 'dl-onl-av' }, `+${on.length - shown.length}`)],
                )
              : '',
          ])
        : E('div', { class: 'dl-onl-empty' }, [
            // A server that is off takes no connections: say so rather than "nobody".
            E('span', {}, off ? 'The server is turned off' : 'Nobody is connected'),
            last
              ? E('span', { class: 'dl-sub' }, `Last: ${last.p.name}, ${ago(last.d.handshake, st.now)}`)
              : E('span', { class: 'dl-sub' }, off ? 'Devices connect once it is on' : 'No device has connected yet'),
          ]),
    ]);
  }

  /**
   * Throughput right now (from the agent's minute samples): download and
   * upload side by side, the last 15 minutes as a small chart, today's total.
   */
  speedTile(): HTMLElement {
    const srv = this.st.servers[0];
    return speedTile(srv?.rate ?? [], this.st.now, this.st.totals.today, srv ? !srv.enabled : false);
  }

  /** The last 30 days, today on the right, with the peak. */
  monthTile(): HTMLElement {
    // Who used the most this month (the People sort has it too, a click away).
    const top = [...this.st.people]
      .map((p) => [p, p.month[0] + p.month[1]] as const)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    return daysTile(this.st.series, top.length ? `Most: ${top.map(([p, n]) => `${p.name} ${bytes(n)}`).join(' · ')}` : '');
  }
}
