// A server's Overview section (first tab on the Servers page): who is
// online, traffic, disguise, the connection map, activity and what needs
// attention — all limited to the people on that server.

import type { DayUsage, Device, LogEvent, Person, Status } from '../../shared/types';
import { E } from '../e';
import { api } from '../api';
import { svg } from '../ui';
import { icon } from '../../shared/icons';
import { ago, bits, bytes, daysLeft, initials } from '../../shared/format';
import { ConnectionMap, rangeControl, type Range } from '../map';
import { attachTip } from '../charts';
import { methodInfo } from '../disguise';
import { personUrl } from '../urls';

const EVENT_TONE: Record<string, string> = {
  connect: 'ok',
  disconnect: '',
  roam: '',
  device_added: 'ok',
  device_removed: '',
  person_added: '',
  person_removed: '',
  paused: 'warn',
  resumed: 'ok',
  paused_all: 'warn',
  resumed_all: 'ok',
  portal_blocked: 'bad',
  person_changed: '',
  devices_removed: 'warn',
};

/** The icon in an event's tile: the device's kind for device events, else what happened. */
const EVENT_ICON: Record<string, string> = {
  devices_removed: 'trash',
  link_changed: 'link',
  person_added: 'plus',
  person_removed: 'trash',
  person_changed: 'edit',
  paused: 'pause',
  resumed: 'play',
  paused_all: 'pause',
  resumed_all: 'play',
};

function eventIcon(st: Status, e: LogEvent): string {
  if (e.device) {
    const d = st.people.flatMap((p) => p.devices).find((x) => x.id === e.device);
    return d?.kind ?? e.dkind ?? 'other';
  }
  return EVENT_ICON[e.type] ?? 'activity';
}

const ADMIN_TYPES = ['person_added', 'person_removed', 'person_changed', 'paused_all', 'resumed_all'];

/** Who did it. Older events have no `by`: LuCI and the portal marked it in the detail. */
export function eventBy(e: LogEvent): 'admin' | 'portal' | null {
  if (e.by) return e.by;
  if (ADMIN_TYPES.includes(e.type) || e.detail === 'by admin' || e.detail?.endsWith(' (admin)')) return 'admin';
  if (e.detail?.endsWith(' (portal)')) return 'portal';
  return null;
}

/** The detail without the old "(admin)" / "(portal)" / "by admin" marks. */
function plainDetail(e: LogEvent): string {
  return (e.detail ?? '').replace(/ \((admin|portal)\)$/, '').replace(/^by admin$/, '');
}

export function eventText(st: Status, e: LogEvent): Node[] {
  const person = st.people.find((p) => p.id === e.person);
  const who = person?.name ?? e.pname ?? e.person ?? '';
  const dev = person?.devices.find((d) => d.id === e.device)?.name ?? e.dname ?? '';
  const b = (t: string) => E('b', {}, t);
  const m = (t: string) => E('span', { class: 'dl-muted' }, t);
  const mono = (t: string) => E('span', { class: 'dl-mono' }, t);
  /** An address; at home, the name of the device that has it, with the address in brackets. */
  const addr = (ip: string) =>
    e.hosts?.[ip]
      ? [E('span', { class: 'dl-ev-host' }, [E('b', {}, e.hosts[ip]), E('span', { class: 'dl-faint' }, ` (${ip})`)])]
      : [mono(ip)];
  // What the bold name is (a person, a device), said before it in grey.
  const kind = (t: string) => E('span', { class: 'dl-ev-kind' }, `${t} `);
  const wd = dev ? `${who} · ${dev}` : who;
  const detail = plainDetail(e);
  const devName = detail || dev || 'a device';
  // The admin's own actions start with an accent "You".
  const you = (verb: string) => [E('span', { class: 'dl-you' }, 'You'), m(` ${verb} `)];
  if (eventBy(e) === 'admin')
    switch (e.type) {
      case 'device_added':
        return [...you('added'), kind('device'), b(devName), m(' for '), b(who)];
      case 'device_removed':
        return [...you('removed'), kind('device'), b(devName), m(' from '), b(who)];
      case 'paused':
        return [...you('paused'), kind('person'), b(who)];
      case 'resumed':
        return [...you('resumed'), kind('person'), b(who)];
      case 'device_changed': {
        const renamed = detail.startsWith('renamed from ');
        return [
          ...you(renamed ? 'renamed' : detail),
          kind('device'),
          b(dev || 'a device'),
          m(' of '),
          b(who),
          ...(renamed ? [m(` · was ${detail.slice(13)}`)] : []),
        ];
      }
      case 'device_keys':
        return [...you('issued new keys for'), kind('device'), b(devName), m(' of '), b(who), m(' · it needs its new configuration')];
      case 'link_changed':
        return [...you('issued a new link for'), kind('person'), b(who), m(' · the old link stopped working')];
      case 'paused_all':
        return [E('span', { class: 'dl-you' }, 'You'), m(' paused everyone')];
      case 'resumed_all':
        return [E('span', { class: 'dl-you' }, 'You'), m(' resumed everyone')];
    }
  switch (e.type) {
    case 'connect':
      return [
        kind('Device'),
        b(wd),
        m(' connected'),
        ...(e.detail ? [m(' from '), ...addr(e.detail)] : []),
        ...(e.where ? [m(` · ${e.where}`)] : []),
      ];
    case 'disconnect':
      return [kind('Device'), b(wd), m(' went offline')];
    case 'roam':
      return [
        kind('Device'),
        b(wd),
        m(' changed network '),
        ...(e.detail ?? '').split(' → ').flatMap((ip, i) => (i ? [m(' → '), ...addr(ip)] : addr(ip))),
      ];
    case 'device_added':
      return [
        kind('Person'),
        b(who),
        m(' added '),
        kind('device'),
        b(devName),
        ...(eventBy(e) === 'portal' ? [m(' on their portal')] : []),
      ];
    case 'device_removed':
      return [
        kind('Person'),
        b(who),
        m(' removed '),
        kind('device'),
        b(devName),
        ...(eventBy(e) === 'portal' ? [m(' on their portal')] : []),
      ];
    case 'device_keys':
      return [kind('Person'), b(who), m(' issued new keys for '), kind('device'), b(devName), m(' on their portal')];
    case 'person_added':
      return [...you('added'), kind('person'), b(e.detail ?? who)];
    case 'person_removed':
      return [...you('removed'), kind('person'), b(e.detail ?? who)];
    case 'person_changed':
      // The detail lists changed fields by their option names (device_limit, expire_action).
      return [...you('changed'), kind('person'), b(who), ...(detail ? [m(` · ${detail.replace(/_/g, ' ')}`)] : [])];
    case 'paused':
      return [kind('Person'), b(who), m(` paused — ${e.detail ?? ''}`)];
    case 'resumed':
      return [kind('Person'), b(who), m(' resumed'), ...(e.detail && e.detail !== 'active' ? [m(` — ${e.detail}`)] : [])];
    case 'paused_all':
      return [m('Everyone paused')];
    case 'resumed_all':
      return [m('Everyone resumed')];
    case 'portal_blocked':
      return [
        E('b', { class: 'dl-sys-src' }, 'Personal portal'),
        m(' blocked '),
        mono(e.detail ?? ''),
        m(' for 15 min after too many wrong codes'),
      ];
    case 'devices_removed':
      return [kind('Person'), b(who), m(' — all devices removed, end date reached')];
    default:
      return [m(`${e.type}${e.detail ? `: ${e.detail}` : ''}`)];
  }
}

/** Events about the router rather than people look like service log lines: icon tile, colour by outcome. */
const SYSTEM_EVENT: Record<string, [string, string]> = {
  portal_blocked: ['globe', 'bad'],
};

/** With several servers, which one a person's event happened on (left out where that is clear). */
function serverPill(st: Status, e: LogEvent): HTMLElement | '' {
  if (st.servers.length < 2 || !e.person) return '';
  const p = st.people.find((x) => x.id === e.person);
  const srv = p && st.servers.find((s) => s.id === p.server);
  return srv ? E('span', { class: 'dl-ev-srv', title: 'Server' }, srv.name) : '';
}

export function eventRow(st: Status, e: LogEvent, opts: { server?: boolean } = {}): HTMLElement {
  const sys = SYSTEM_EVENT[e.type];
  const by = eventBy(e);
  return E('div', { class: `dl-row${by === 'admin' ? ' dl-ev-by-admin' : sys ? ` dl-ev-by-system ${sys[1]}` : ''}` }, [
    by === 'admin'
      ? E('span', { class: 'dl-ev-tile', title: 'Done by you in LuCI' }, icon('admin'))
      : sys
        ? E('span', { class: 'dl-ev-tile sys' }, icon(sys[0]))
        : E('span', { class: `dl-ev-tile ev ${EVENT_TONE[e.type] ?? ''}` }, icon(eventIcon(st, e))),
    E('span', { class: 'dl-row-main' }, eventText(st, e)),
    opts.server === false ? '' : serverPill(st, e),
    E('span', { class: 'dl-faint dl-nowrap', title: new Date(e.ts * 1000).toLocaleString() }, ago(e.ts, st.now)),
  ]);
}

/** Things worth the admin's attention, most important first. */
function attention(st: Status): { tone: string; text: (Node | string)[] }[] {
  const out: { tone: string; text: (Node | string)[] }[] = [];
  const link = (href: string, t: string) => E('a', { href }, t);
  for (const s of st.servers)
    if (s.enabled && !s.up)
      out.push({
        tone: 'bad',
        text: [`Tunnel ${s.ifname} is down. `, link(L.url('admin/network/dawnline/diagnostics'), 'Open Diagnostics')],
      });
  if (st.settings.paused_all) out.push({ tone: 'warn', text: ['Everyone is paused.'] });
  for (const p of st.people) {
    if (p.state === 'quota') out.push({ tone: 'warn', text: [link(personUrl(p.id), p.name), ' reached the data limit.'] });
    else if (p.state === 'expired') out.push({ tone: 'warn', text: [link(personUrl(p.id), p.name), '’s access has ended.'] });
    else {
      const left = daysLeft(p.expires);
      if (left != null && left >= 0 && left <= Math.max(p.expire_warn, 3))
        out.push({ tone: '', text: [link(personUrl(p.id), p.name), `’s access ends in ${left} day${left === 1 ? '' : 's'}.`] });
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
  if (st.servers.some((s) => s.lan_like) && st.like_home.error)
    out.push({
      tone: 'warn',
      text: [`Internet through the LAN is off: ${st.like_home.error} `, link(L.url('admin/network/dawnline/diagnostics'), 'Details')],
    });
  if (!st.settings.portal_enabled)
    out.push({ tone: '', text: ['The personal portal is off. ', link(L.url('admin/network/dawnline/settings'), 'Turn on')] });
  return out;
}

/**
 * The status as seen from one server: its people, their devices, traffic,
 * map points and events (plus router-wide events without a person).
 */
export function scoped(st: Status, srvId: string): Status {
  const srv = st.servers.find((s) => s.id === srvId) ?? st.servers[0];
  const people = st.people.filter((p) => p.server === srv.id);
  const ids = new Set(people.map((p) => p.id));
  const devices = people.flatMap((p) => p.devices);
  const sum = (f: (p: Person) => [number, number]) =>
    people.reduce<[number, number]>(
      (a, p) => {
        const v = f(p);
        return [a[0] + v[0], a[1] + v[1]];
      },
      [0, 0],
    );
  const today = srv.series?.[srv.series.length - 1];
  return {
    ...st,
    servers: [srv],
    people,
    series: srv.series ?? st.series,
    events: st.events.filter((e) => (e.person ? ids.has(e.person) : true)),
    geo: { ...st.geo, points: st.geo.points.filter((g) => ids.has(g.person)) },
    totals: {
      people: people.length,
      devices: devices.length,
      online: devices.filter((d) => d.online).length,
      active: people.filter((p) => p.state === 'active').length,
      today: today ? [today.rx, today.tx] : [0, 0],
      month: sum((p) => p.month),
    },
  };
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

  update(st: Status) {
    this.st = scoped(st, this.srvId);
    this.paint();
    this.map?.update(this.mapData());
    // Health checks cost more than a status call: once a minute is plenty.
    if (Date.now() - this.healthAt > 60_000) void this.loadHealth();
  }

  /** A strip above the bento, only while Health has warnings or errors. */
  async loadHealth() {
    this.healthAt = Date.now();
    const r = await api.health().catch(() => null);
    if (!r) return;
    const bad = r.checks.filter((c) => c.status === 'warn' || c.status === 'error');
    if (!bad.length) {
      dom.content(this.parts.health, '');
      return;
    }
    const errors = bad.filter((c) => c.status === 'error').length;
    const label = `${bad.length} ${errors ? (bad.length === 1 ? 'problem' : 'problems') : bad.length === 1 ? 'warning' : 'warnings'}`;
    dom.content(
      this.parts.health,
      E('div', { class: `dl-healthstrip ${errors ? 'bad' : 'warn'}` }, [
        E('span', { class: 'dl-healthstrip-title' }, [icon('alert'), label]),
        ...bad.slice(0, 3).map((c) => {
          const it = E('span', { class: 'dl-healthstrip-item' }, c.title);
          attachTip(it, () => [E('div', { class: 'dl-tip-title' }, c.title), E('div', { class: 'dl-muted' }, c.detail)]);
          return it;
        }),
        bad.length > 3 ? E('span', { class: 'dl-sub' }, `+${bad.length - 3} more`) : '',
        E(
          'a',
          { href: L.url('admin/network/dawnline/diagnostics') },
          bad.some((c) => c.fix) ? 'Fix in Diagnostics →' : 'Open Diagnostics →',
        ),
      ]),
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
    this.map = new ConnectionMap(
      {
        openPerson: (id) => (location.href = personUrl(id)),
        openDevice: (id, dev) => (location.href = personUrl(id, dev)),
      },
      this.range,
    );
    const legend = E('div', { class: 'dl-map-legend' }, [
      E('span', {}, [E('i', { class: 'dot ok' }), 'Online']),
      E('span', {}, [E('i', { class: 'dot' }), 'Seen recently']),
      E('span', {}, [E('i', { class: 'line' }), 'Live tunnel']),
    ]);
    const wrap = E('div', { class: 'dl-map-wrap' }, [this.map.el, legend]);
    requestAnimationFrame(() => this.map!.mount(this.mapData()));
    return E('div', { class: 'dl-panel flush' }, [head, wrap]);
  }

  paint() {
    const st = this.st;
    const srv = st.servers[0];
    const slots = st.people.reduce((a, p) => a + Math.max(0, p.device_limit - p.devices.length), 0);
    const online = st.people.flatMap((p) => p.devices.filter((d) => d.online));

    dom.content(
      this.parts.bento,
      E('div', { class: 'dl-bento' }, [this.onlineTile(online), this.speedTile(), this.disguiseTile(srv), this.monthTile(slots)]),
    );

    const att = attention(st);
    dom.content(
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
              .map((a) => E('div', { class: 'dl-attn-item dl-row' }, [E('span', { class: `dl-ev-dot ${a.tone}` }), E('span', {}, a.text)]))
          : E('div', { class: 'dl-row dl-muted' }, [icon('check'), 'All good. Nothing needs you right now.']),
      ]),
    );

    const events = [...st.events].reverse().slice(0, 8);
    dom.content(
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
    );
  }

  /**
   * Who is connected right now, and nothing else. One or two people: avatar,
   * name, device icons and city; three or more: a grid of avatars (two rows,
   * then +N). The device badge is the main device, or a count. Hover: a live
   * card with speed, devices and today's traffic. Nobody: when someone was last seen.
   */
  onlineTile(_online: Device[]): HTMLElement {
    const st = this.st;
    const CAP = 12;
    const today = (d: Device) => d.spark[d.spark.length - 1] ?? 0;
    const cityOf = (d: Device) => st.geo.points.find((g) => g.device === d.id && g.city)?.city;
    const home = (d: Device) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(d.endpoint ?? '');
    const where = (d: Device) => (home(d) ? 'home' : cityOf(d)) ?? '';
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
            devs.map((d) => E('span', { class: 'dl-hc-dev' }, [icon(d.kind), [d.name, where(d)].filter(Boolean).join(' · ')])),
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
              where(devs[0]) ? E('span', {}, ` · ${where(devs[0])}`) : '',
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
            E('span', {}, 'Nobody is connected'),
            last
              ? E('span', { class: 'dl-sub' }, `Last: ${last.p.name}, ${ago(last.d.handshake, st.now)}`)
              : E('span', { class: 'dl-sub' }, 'No device has connected yet'),
          ]),
    ]);
  }

  /**
   * Throughput right now (from the agent's minute samples): download and
   * upload side by side, the last 15 minutes as a small chart, today's total.
   */
  speedTile(): HTMLElement {
    return speedTile(this.st.servers[0]?.rate ?? [], this.st.now, this.st.totals.today);
  }

  disguiseTile(srv: Status['servers'][number]): HTMLElement {
    const m = methodInfo(srv.preset);
    const o = srv.obf ?? {};
    const segs = (n: number, cls: string) =>
      E(
        'span',
        { class: `dl-segs ${cls}` },
        [0, 1, 2, 3].map((i) => E('i', { class: i < n ? 'on' : '' })),
      );
    // The values devices carry, in words.
    const chips: string[] = [];
    if (+o.jc) chips.push(`${o.jc} junk · ${o.jmin}–${o.jmax} B`);
    const pad = ['s1', 's2', 's3', 's4'].filter((k) => +o[k]).map((k) => `${k.toUpperCase()} ${o[k]}`);
    if (pad.length) chips.push(pad.slice(0, 2).join(' · ') + (pad.length > 2 ? ` +${pad.length - 2}` : ''));
    if (['h1', 'h2', 'h3', 'h4'].some((k) => o[k] && o[k] !== String(['h1', 'h2', 'h3', 'h4'].indexOf(k) + 1))) chips.push('H1–H4 random');
    if (o.i1) chips.push(o.i1.includes('0x8580') ? 'DNS-like first packet' : 'Signature packets');
    if (o.header_protection_key) chips.push('Encrypted headers');
    if (!chips.length) chips.push(m?.id === 'off' ? 'Plain WireGuard' : 'No values yet');
    return E('div', { class: 'dl-bento-tile dl-disg' }, [
      E('div', { class: 'dl-bento-head' }, [
        E('span', { class: 'dl-metric-label' }, 'Disguise'),
        E('a', { href: `${L.url('admin/network/dawnline/server')}?server=${encodeURIComponent(srv.id)}&section=disguise` }, 'Change'),
      ]),
      E('div', { class: 'dl-disg-id' }, [
        E('span', { class: 'dl-disg-ic' }, icon(m?.ic ?? 'shield')),
        E('span', { class: 'dl-stack' }, [E('b', {}, m ? m.title : 'Custom'), E('span', { class: 'dl-sub' }, m ? m.short : 'Set by hand')]),
      ]),
      m
        ? E('div', { class: 'dl-disg-meters' }, [
            E('span', {}, 'Stealth'),
            segs(m.stealth, 'acc'),
            E('span', {}, 'Speed'),
            segs(m.speed, 'ok'),
          ])
        : '',
      E(
        'div',
        { class: 'dl-disg-chips' },
        chips.map((c) => E('span', {}, c)),
      ),
    ]);
  }

  /** The last 30 days, today on the right, with the peak; plus the people summary. */
  monthTile(slots: number): HTMLElement {
    const t = this.st.totals;
    const paused = this.st.people.filter((p) => p.state !== 'active').length;
    return daysTile(
      this.st.series,
      `${t.people} ${t.people === 1 ? 'person' : 'people'}${paused ? ` · ${paused} paused` : ''} · ${slots} device slot${slots === 1 ? '' : 's'} free`,
    );
  }
}

/** Throughput over the last 15 minutes plus today's total. */
export function speedTile(rate: [number, number, number][], now: number, today: [number, number]): HTMLElement {
  const pts = rate.slice(-15);
  const last = pts[pts.length - 1];
  const fresh = last && now - last[0] < 180;
  const down = fresh ? last[2] : 0,
    up = fresh ? last[1] : 0;
  const [rx, tx] = today;
  const W = 200,
    H = 40;
  const max = Math.max(1, ...pts.map((p) => Math.max(p[1], p[2])));
  const line = (k: 1 | 2) => pts.map((p, i) => `${pts.length > 1 ? (i / (pts.length - 1)) * W : W},${H - 2 - (p[k] / max) * (H - 6)}`);
  const dl = line(2),
    ul = line(1);
  const chart =
    pts.length > 1
      ? svg(
          `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="dl-speed-chart" aria-hidden="true">` +
            `<path d="M${dl.join(' L')} L${W},${H} L0,${H}Z" class="area"/><path d="M${dl.join(' L')}" class="line"/>` +
            `<path d="M${ul.join(' L')}" class="line up"/></svg>`,
        )
      : E('div', { class: 'dl-speed-wait' }, [E('i'), E('span', {}, 'Collecting… 1 point a minute')]);
  const col = (label: string, ic: string, cls: string, v: number) =>
    E('div', { class: 'dl-speed-col' }, [
      E('span', { class: 'dl-sub' }, [E('span', { class: cls }, ic), ` ${label}`]),
      E('span', { class: 'dl-speed-val' }, bits(v)),
    ]);
  if (pts.length > 1)
    attachTip(chart as HTMLElement, () => {
      const p = pts[pts.length - 1];
      return [
        E('div', { class: 'dl-tip-title' }, new Date(p[0] * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })),
        E('div', {}, `↓ ${bits(p[2])} · ↑ ${bits(p[1])}`),
      ];
    });
  return E('div', { class: 'dl-bento-tile' }, [
    E('div', { class: 'dl-bento-head' }, [
      E('span', { class: 'dl-metric-label' }, 'Speed now'),
      E('span', { class: 'dl-sub' }, 'last 15 min'),
    ]),
    E('div', { class: 'dl-speed-cols' }, [col('Download', '↓', 'dl-dn', down), col('Upload', '↑', 'dl-up', up)]),
    chart,
    E('div', { class: 'dl-speed-today' }, [
      E('span', {}, ['Today ', E('b', {}, bytes(rx + tx))]),
      E('span', {}, [E('span', { class: 'dl-dn' }, '↓'), ` ${bytes(tx)}  `, E('span', { class: 'dl-up' }, '↑'), ` ${bytes(rx)}`]),
    ]),
  ]);
}

/** Daily traffic for the last 30 days, today on the right. */
export function daysTile(series: DayUsage[], note: string): HTMLElement {
  const days = series.slice(-30);
  const vals = days.map((d) => d.rx + d.tx);
  const max = Math.max(1, ...vals);
  const total = vals.reduce((a, v) => a + v, 0);
  const peakI = vals.reduce((a, v, i) => (v > vals[a] ? i : a), 0);
  const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const bars = E(
    'div',
    { class: 'dl-bento-bars' },
    days.map((d, i) => {
      const v = vals[i];
      const bar = E('i', { class: i === days.length - 1 ? 'hi' : '', style: `height:${Math.max(4, (v / max) * 100)}%` });
      attachTip(bar, () => [
        E('div', { class: 'dl-tip-title' }, i === days.length - 1 ? `Today · ${label(d.day)}` : label(d.day)),
        E('div', {}, bytes(v)),
        E('div', { class: 'dl-muted dl-mono' }, `↓ ${bytes(d.tx)} ↑ ${bytes(d.rx)}`),
      ]);
      return bar;
    }),
  );
  return E('div', { class: 'dl-bento-tile month' }, [
    E('div', { class: 'dl-bento-head' }, [
      E('span', {}, [E('span', { class: 'dl-metric-label' }, 'Last 30 days'), E('b', { class: 'dl-bento-total' }, bytes(total))]),
      vals[peakI] > 0 ? E('span', { class: 'dl-sub' }, `peak ${bytes(vals[peakI])} · ${label(days[peakI].day)}`) : '',
    ]),
    days.length ? bars : E('p', { class: 'dl-muted' }, 'No traffic yet.'),
    E('div', { class: 'dl-bento-head' }, [
      E('span', { class: 'dl-sub' }, days.length ? label(days[0].day) : ''),
      E('span', { class: 'dl-sub' }, note),
      E('span', { class: 'dl-sub' }, 'today'),
    ]),
  ]);
}
