// Settings › Internet and Home network, the two ends of a server's path. How
// internet traffic leaves: two tiles with what each costs (straight to the
// WAN, or like a home device through the router's own proxies and filters,
// with whether that works now), and the WAN as a pill with its list. What
// home access reaches: the router's networks as tiles (the LAN found by
// itself, the rest folded: why each is not offered), whether devices reach
// each other as three tiles, circles and the home services as lists with
// their actions in sight (flows/circle.ts, flows/home-service.ts).
// server_interfaces takes the whole choice: what rewrites nobody's
// configuration is saved at once; the home networks and going between
// «apart» and «together» wait for «Apply» with the page's other changes.

import type { Device, MeshMode, Person, PortalNets, PortalRouters } from '../../../shared/types';
import { api, type InterfacesData, type NetDevice } from '../../api';
import { h } from '../../../portal/dom';
import { fmt, locale } from '../../../shared/i18n';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { fact, facts, optionTiles, way, type OptionState } from '../../ui/option-tiles';
import { netSwitches } from '../../widgets/net-switches';
import { visibility } from '../../widgets/visibility';
import { compList, compRow } from '../../ui/comp-row';
import { reMark, switchRow } from '../../ui/edit-rows';
import { valuePick } from '../../ui/measure';
import { cap, card, note, section } from '../../ui/section';
import { meshRewrites } from '../../servers/rollout';
import { refetchOf, type NetPatch } from '../../servers/pending';
import { circleColor, openCircle } from '../../flows/circle';
import { findAtHome, openService, type ServiceCtx } from '../../flows/home-service';
import { installSheet } from '../../flows/install';
import { peopleAt } from '../../shell/routes';
import { replaces } from '../../../portal/ui/carry';
import { carryChips, foldLine, said, unfoldLine } from '../../../portal/ui/chips-motion';
import { asksOf, behindRefetch, netsOf, reachers, routerAsks, routersOf, takenFor, wishOf } from '../../servers/behind';
import { askWarnings, declineMenu, takeAsk, type Answer } from '../../flows/behind-ask';
import { netValues } from '../../widgets/net-values';
import type { ServerCtx } from './ctx';
import { stageHead, stageHealth, waits } from './stages';

/** The whole choice server_interfaces takes, as it stands. */
interface Choice {
  auto_wan: boolean;
  wan_device: string;
  auto_lan: boolean;
  lan_devices: string[];
  lan_like: boolean;
  mesh: MeshMode;
}

const choiceOf = (d: InterfacesData): Choice => ({
  auto_wan: d.config.auto_wan,
  wan_device: d.config.wan_device || d.detected.wan || d.saved.wan || '',
  auto_lan: d.config.auto_lan,
  lan_devices: d.config.lan_devices,
  lan_like: d.config.lan_like,
  mesh: d.config.mesh ?? (d.config.device_mesh ? 'all' : 'off'),
});

/** Save a server's choice with `patch` over it; rejects with the router's reason. The page reads the router after. */
export async function saveInterfaces(srv: string, d: InterfacesData, patch: Partial<Choice>): Promise<void> {
  const v = { ...choiceOf(d), ...patch };
  await api.serverInterfaces(
    srv,
    v.auto_wan,
    v.auto_wan ? '' : v.wan_device,
    v.auto_lan,
    v.lan_devices,
    v.lan_like,
    v.mesh !== 'off',
    v.mesh,
  );
}

const loading = () => card(note(_('Loading interfaces…')));

// ── Internet ─────────────────────────────────────────────────────────────────────────────────────────────────

export function internetSection(c: ServerCtx): HTMLElement {
  const d = c.ifs;
  if (!d) return section(stageHead(c, 'internet'), loading());
  const v = choiceOf(d);
  const routeNext = c.staged('route')?.net?.lan_like;
  const wanWaits = c.staged('wan')?.net;
  const routeTitle = (home: boolean) => (home ? _('Like a home device') : _('Direct'));
  const lh = d.like_home;
  const needs = v.lan_like ? (d.needs ?? []) : [];
  const wans = d.devices.filter((x) => !x.own && !x.master && x.zone && !x.missing);
  const found = d.detected.wan || d.saved.wan || '';
  const wanNow = (v.auto_wan ? found : v.wan_device) || '';
  const wanShown = v.auto_wan ? fmt(_('%s · auto'), wanNow || '—') : wanNow;
  const wanOn = v.auto_wan ? '' : v.wan_device;
  const routeState = (home: boolean): OptionState =>
    routeNext != null ? (routeNext === home ? 'next' : v.lan_like === home ? 'was' : '') : v.lan_like === home ? 'on' : '';
  const stop = {
    dev: { icon: 'phone', label: _('Device') },
    router: { icon: 'router', label: _('Router') },
    net: { icon: 'globe', label: _('Internet') },
  };
  const works = v.lan_like && c.srv.enabled ? (needs.length ? 'needs' : lh.active && lh.bridged ? 'ok' : 'down') : '';
  return section(
    stageHead(c, 'internet'),
    card(
      stageHealth(c, 'internet'),
      cap(_('How devices’ internet traffic leaves')),
      // the two ways a packet may take, drawn: the option that adds a stop shows it (ui/option-tiles.ts)
      optionTiles<'direct' | 'home'>({
        label: _('How devices’ internet traffic leaves'),
        cls: 'kt-op-way',
        write: c.write,
        options: [
          {
            id: 'direct',
            title: _('Direct'),
            state: routeState(false),
            picture: way([stop.dev, stop.router, stop.net]),
            text: _('Straight to the WAN, past this router’s proxies and filters.'),
            body: [facts(fact(_('The fastest way'), 'zap'), fact(_('DNS: this router')))],
          },
          {
            id: 'home',
            title: _('Like a home device'),
            state: routeState(true),
            warn: works === 'needs' || works === 'down',
            picture: way([stop.dev, stop.router, { icon: 'filter', label: _('Proxies and filters'), extra: true }, stop.net]),
            text: _('Through this router’s proxies and filters, as from a device at home.'),
            body: [facts(fact(_('Up to a third slower on two cores'), 'zap'), fact(_('A packet crosses the router twice')))],
          },
        ],
        // the one in use pressed while the other waits: the waiting choice is taken back
        pick: (id) =>
          (id === 'home') === v.lan_like
            ? c.unstage('route')
            : c.change({
                kind: 'route',
                value: routeTitle(id === 'home'),
                label: fmt(_('Internet traffic: %s'), routeTitle(id === 'home')),
                net: { lan_like: id === 'home' },
              }),
      }),
      routeNext == null ? null : note(waits(routeTitle(v.lan_like)), 'warn'),
      works === 'needs'
        ? h(
            'div',
            { class: 'srv-note warn' },
            glass('globe', 'orange'),
            h(
              'span',
              { class: 'sn-t' },
              h('b', {}, fmt(_('Needs %s.'), new Intl.ListFormat(locale(), { type: 'conjunction' }).format(needs))),
              h('span', {}, _('Until they are installed, internet traffic goes straight to the WAN.')),
            ),
            c.write
              ? h(
                  'button',
                  { type: 'button', class: 'btn tint sm', onclick: () => installSheet('home', needs, () => void c.reload()) },
                  h('span', {}, _('Install')),
                )
              : null,
          )
        : works === 'ok'
          ? note(fmt(_('Works: traffic enters %s as %s.'), lh.dev ?? 'LAN', lh.address ?? ''), 'ok')
          : works === 'down'
            ? note(
                `${fmt(_('Not working: %s'), lh.error ?? _('the link is down'))} ${_('Internet traffic goes straight to the WAN for now.')}`,
                'warn',
              )
            : null,
      h(
        'div',
        { class: 'editrow static pickrow' },
        h('span', {}, 'WAN'),
        valuePick<string>({
          label: _('WAN interface'),
          value: wanWaits ? (wanWaits.auto_wan ? fmt(_('%s · auto'), found || '—') : (wanWaits.wan_device ?? '')) : wanShown,
          pill: true,
          write: c.write,
          on: wanWaits ? (wanWaits.auto_wan ? '' : (wanWaits.wan_device ?? '')) : wanOn,
          options: [
            { id: '', label: _('Detect automatically'), sub: found ? fmt(_('now %s'), found) : _('not found') },
            ...wans.map((x) => ({ id: x.name, label: x.name, sub: fmt(_('zone %s'), x.zone) })),
          ],
          pick: (id) => {
            if (id === wanOn) return c.unstage('wan');
            const shown = id || fmt(_('%s · auto'), found || '—');
            c.change({
              kind: 'wan',
              value: shown,
              label: fmt(_('WAN: %s'), shown),
              net: id ? { auto_wan: false, wan_device: id } : { auto_wan: true },
            });
          },
        }),
      ),
      wanWaits ? note(waits(wanShown), 'warn') : null,
      note(_('The interface with the default route: the server port opens there and Internet access leaves through it.')),
    ),
  );
}

// ── Home network ─────────────────────────────────────────────────────────────────────────────────────────────

const KIND_ICON: Record<NetDevice['kind'], string> = {
  wan: 'globe',
  ethernet: 'lan',
  bridge: 'home',
  wifi: 'wifi',
  vpn: 'tunnel',
  other: 'other',
};

/** A router's own tunnel of a named protocol wears that product's mark (ui/glass.ts); another VPN is a tunnel. */
const MARKED = new Set(['wireguard', 'amneziawg']);

/** Why an interface is not offered, in a few words. */
function why(x: NetDevice, wan: string): string {
  if (x.missing) return _('Not present right now');
  if (x.own) return _('This server');
  if (x.master) return fmt(_('Port of %s'), x.master);
  if (x.name === wan) return `${_('Internet')}${x.zone ? ` · ${fmt(_('zone %s'), x.zone)}` : ''}`;
  return x.nets.length ? x.nets.join(', ') : _('No IPv4 network');
}

/** "Now: eth1, was eth0." / "Not found now: using eth0." */
function found(live: string | null, saved: string): string {
  if (live) return saved && saved !== live ? fmt(_('Now: %s, was %s.'), live, saved) : fmt(_('Now: %s.'), live);
  return saved ? fmt(_('Not found now: using %s.'), saved) : _('Not found.');
}

const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

const meshWords = (m: MeshMode) => ({ off: _('No', 'devices see each other'), all: _('Everyone'), circles: _('In circles') })[m];
/** The home networks' card: a network a switch (widgets/net-switches.ts), the interfaces not offered, the LAN found by itself. */
function networksCard(c: ServerCtx, d: InterfacesData): HTMLElement {
  const cfg = choiceOf(d);
  const waiting = c.staged('home')?.net;
  const v = { ...cfg, ...waiting };
  const live = d.detected.lan || d.saved.lan || '';
  const wan = (cfg.auto_wan ? d.detected.wan || d.saved.wan : cfg.wan_device) || '';
  const lans = new Set(v.lan_devices);
  const had = new Set(cfg.lan_devices);
  const auto = (x: NetDevice) => v.auto_lan && x.name === live;
  const blocked = (x: NetDevice) => !!x.own || !!x.master || x.name === wan || auto(x);
  const pickable = (x: NetDevice) => auto(x) || lans.has(x.name) || (!blocked(x) && (x.nets.length > 0 || !!x.missing));
  /** The home networks' choice with `patch` over what waits: back to the server's own, nothing waits. */
  const stage = (patch: NetPatch, value: string) => {
    const next = { ...waiting, ...patch };
    if (next.lan_devices && same(next.lan_devices, cfg.lan_devices)) delete next.lan_devices;
    if (next.auto_lan === cfg.auto_lan) delete next.auto_lan;
    if (!Object.keys(next).length) return c.unstage('home');
    c.change({ kind: 'home', value, label: _('Home networks'), net: next });
  };
  const again = c.write
    ? h('button', { type: 'button', class: 'knob', 'aria-label': _('Read again'), title: _('Read again') }, ic('refresh'))
    : null;
  again?.addEventListener('click', () => void c.reload());
  const nets = [...d.effective.home].flatMap((x) => x.nets.map((n) => `${n} (${x.dev})`));
  return card(
    stageHealth(c, 'home'),
    cap(_('The router’s networks home access leads to'), reMark(refetchOf('home', c.srv.id, c.st.people)), again),
    netSwitches({
      rows: d.devices.filter(pickable).map((x) => ({
        name: x.name,
        icon: x.kind === 'vpn' && MARKED.has(x.proto ?? '') ? x.proto! : (KIND_ICON[x.kind] ?? 'other'),
        nets: x.nets,
        zone: x.zone,
        on: auto(x) || lans.has(x.name),
        auto: auto(x),
        missing: x.missing,
        waits: !auto(x) && lans.has(x.name) !== had.has(x.name),
      })),
      rest: d.devices.filter((x) => !pickable(x)).map((x) => ({ name: x.name, why: why(x, wan) })),
      note: _('Everyone with home access reaches these, unless their page leaves one out.'),
      write: c.write,
      flip: (name, on) => {
        const next = new Set(lans);
        if (on) next.add(name);
        else next.delete(name);
        stage({ lan_devices: [...next] }, name);
      },
    }),
    waiting ? note(waits(nets.length ? nets.join(', ') : _('no home network')), 'warn') : null,
    switchRow(
      {
        title: _('Auto-detect LAN'),
        sub: `${_('Adds the LAN this router uses.')} ${found(d.detected.lan, d.saved.lan)}`,
        on: v.auto_lan,
        icon: 'lan',
        flip: async (on) => {
          stage({ auto_lan: on }, on ? _('On') : _('Off'));
          return true;
        },
      },
      c.write,
    ),
  );
}

/** A row's router is a way to it: its name with its person, a link that opens the device's dialog. */
const opens = (c: ServerCtx, p: Person, dev: Device): HTMLElement =>
  h(
    'a',
    { class: 'nb-open', href: peopleAt({ server: c.srv.id, id: p.id, device: dev.id }), title: fmt(_('Open %s'), dev.name) },
    dev.name,
    h('span', { class: 'faint' }, ` · ${p.name}`),
    ic('chevron'),
  );

/**
 * The networks behind people's routers: a row a router (its name with its person, a way to its dialog), its
 * networks as values edited where they stand (widgets/net-values.ts). A change waits for «Apply» with the page's
 * others, as one change whatever the number of routers (servers/pending.ts `behind`). What a router's owner asked
 * for on their own page is answered in its row, at once (flows/behind-ask.ts): the router itself at the row's
 * end, a network on its chip.
 */
function behindCard(c: ServerCtx, d: InterfacesData): HTMLElement {
  const routers = routersOf(c.st.people, c.srv.id);
  const own = d.devices.filter((x) => !x.own && x.nets.length).map((x) => ({ name: x.name, nets: x.nets }));
  // what waits is the staged change's own: taken back in the dock, it is taken back here
  const waiting = c.staged('behind')?.behind ?? {};
  const shown = (dev: Device): string[] => waiting[dev.id] ?? netsOf(dev);
  const redraw = () => void c.current().reload();
  const stage = (dev: Device, next: string[]) => {
    const all = { ...waiting };
    if (next.join() === netsOf(dev).join()) delete all[dev.id];
    else all[dev.id] = next;
    const changed = routers.filter((r) => all[r.d.id]);
    if (!changed.length) return c.unstage('behind');
    const what = changed.map((r) => `${r.d.name}: ${all[r.d.id].join(', ') || _('none')}`).join(' · ');
    // only the devices that reach a changed router are told its networks
    const fetch = [...new Set(changed.flatMap((r) => reachers(c.st.people, c.srv, r.p, r.d).map((x) => x.d.id)))];
    c.change({ kind: 'behind', value: what, label: fmt(_('Networks behind %s'), what), behind: all, fetch });
  };
  const rows = routers.map(({ p, d: dev }) => {
    // A router asked for on its owner's page: the whole of it is one question (its networks came with it),
    // answered at the row's end. Taken, it is a device with those networks; turned down, it leaves this list.
    if (routerAsks(dev)) {
      const asked = wishOf(dev);
      const answer: Answer = { p, d: dev, nets: asked, router: true, changed: redraw };
      const box = h(
        'span',
        { class: 'nb-nets' },
        ...asked.map((n) =>
          h('span', { class: 'nb-chip mono nb-asked nb-still', 'data-k': `n:${n}`, 'data-s': 'asked' }, h('span', { class: 'nb-cb' }, n)),
        ),
        asked.length ? null : h('span', { class: 'nb-none' }, _('No network behind it')),
      );
      carryChips(`behind:${dev.id}`, box);
      const line = h('span', { class: 'nb-say here-t' }, fmt(_('%s asks to add this router on their page'), p.name));
      const no = act('x', _('Decline'), () => declineMenu(no, answer));
      // the two answers stand together (a row's end on a wide page, under its words on a narrow one); a login that
      // only reads sees the question without them
      const answers = c.write
        ? h(
            'span',
            { class: 'nb-asks-b' },
            act(
              'check',
              _('Accept'),
              () =>
                void takeAsk(answer).then((bad) => {
                  if (!bad) return;
                  line.className = 'nb-say bad-t';
                  line.textContent = bad;
                  said(line);
                }),
              'tint',
            ),
            no,
          )
        : null;
      return h(
        'div',
        { class: 'chk kt-cr nb-row nb-asks', 'data-dev': dev.id },
        glass('router', 'blue'),
        h(
          'span',
          { class: 'chk-t' },
          h('b', {}, opens(c, p, dev)),
          box,
          line,
          ...askWarnings(p, dev, c.srv, true, asked.length > 0).map((w) => h('span', { class: 'nb-ask-w' }, ic('alert'), w)),
        ),
        answers,
      );
    }
    const nets = shown(dev);
    const asks = asksOf(dev).filter((n) => !nets.includes(n));
    const line = h('span', { class: 'nb-say' });
    const one = (n: string): Answer => ({ p, d: dev, nets: [n], router: false, changed: redraw });
    return h(
      'div',
      { class: 'chk kt-cr nb-row', 'data-dev': dev.id },
      glass('router', waiting[dev.id] ? 'orange' : nets.length ? 'blue' : 'grey'),
      h(
        'span',
        { class: 'chk-t' },
        h('b', {}, opens(c, p, dev)),
        netValues({
          key: `behind:${dev.id}`,
          nets,
          was: netsOf(dev),
          asked: asks,
          taken: takenFor(c.st.servers, own, c.st.people, dev, shown),
          write: c.write,
          line,
          // asked for on its owner's page: said under the chips while it waits for an answer
          rest: asks.length
            ? fmt(c.write ? _('%s asked on their page: accept or decline') : _('%s asked for it on their page'), p.name)
            : undefined,
          restTone: 'here',
          ask: {
            accept: (n, refused) => void takeAsk(one(n)).then((bad) => bad && refused(bad)),
            decline: (at, n) => declineMenu(at, one(n)),
          },
          set: (next) => stage(dev, next),
        }),
        line,
      ),
    );
  });
  const waitingNow = routers.filter((r) => waiting[r.d.id]).map((r) => `${r.d.name}: ${netsOf(r.d).join(', ') || _('none')}`);
  const waitNote = waitingNow.length ? note(waits(waitingNow.join(' · ')), 'warn') : null;
  waitNote?.classList.add('nb-wn');
  const el = card(
    cap(_('Networks behind people’s routers'), reMark(behindRefetch(c.st.people, c.srv, routers))),
    routers.length ? compList(...rows) : note(_('No routers yet: a router is a person’s device of the kind «Router».')),
    waitNote,
    note(
      _(
        'A router brings its own network along: home devices and people with home access reach it through the tunnel, and it reaches what its person reaches.',
      ),
    ),
  );
  // The card a press here drew again (ui/carry.ts): the line that says what waits unfolds under the list when it
  // comes and folds away when it goes, so the cards below travel with it. Not the card's own height: its rows glide
  // to theirs by themselves (ui/chips-motion.ts), and a glide around a glide ends in a step.
  const old = replaces(`behind-card:${c.srv.id}`, el);
  if (old) {
    const was = old.querySelector<HTMLElement>('.nb-wn');
    requestAnimationFrame(() => {
      if (!el.isConnected) return;
      const last = el.lastElementChild;
      if (!last) return;
      if (waitNote && !was) unfoldLine(waitNote, last);
      else if (!waitNote && was) foldLine(was, el, last);
      // a router turned down: its row folds away where it stood, the rows under it coming up
      const list = el.querySelector<HTMLElement>('.checks');
      const before = [...old.querySelectorAll<HTMLElement>('.nb-row')];
      const now = new Set([...el.querySelectorAll<HTMLElement>('.nb-row')].map((r) => r.dataset.dev));
      for (const r of before) {
        if (now.has(r.dataset.dev) || !list) continue;
        const after = [...list.children].find(
          (x) => before.findIndex((y) => y.dataset.dev === (x as HTMLElement).dataset.dev) > before.indexOf(r),
        );
        foldLine(r, list, after ?? null);
      }
    });
  }
  return el;
}

/**
 * What people may do about routers on their own pages, two rules of this server: whether a person may add a router
 * at all (off: their page offers no «Router» among the kinds, only the admin adds one; on request: it waits for
 * the admin's answer; at once: as any other device), and whether a network behind it is asked for or made at once.
 * Both wait for «Apply», as every setting of a server does.
 */
function portalCard(c: ServerCtx): HTMLElement {
  type Rule = PortalRouters | PortalNets;
  const words: Record<Rule, string> = { off: _('Off'), ask: _('On request'), free: _('At once') };
  const r = (c.staged('portal_routers')?.values?.portal_routers as PortalRouters | undefined) ?? c.srv.portal_routers;
  const n = (c.staged('portal_nets')?.values?.portal_nets as PortalNets | undefined) ?? c.srv.portal_nets;
  const row = <R extends Rule>(
    kind: 'portal_routers' | 'portal_nets',
    name: string,
    label: string,
    on: R,
    has: R,
    options: { id: R; sub: string }[],
  ) =>
    h(
      'div',
      { class: 'editrow static pickrow' },
      h('span', {}, name),
      valuePick<R>({
        label,
        value: words[on],
        pill: true,
        write: c.write,
        on,
        options: options.map((o) => ({ id: o.id, label: words[o.id], sub: o.sub })),
        // back to what the server has: it stops waiting
        pick: (id) =>
          id === has ? c.unstage(kind) : c.change({ kind, value: words[id], label: `${name}: ${words[id]}`, values: { [kind]: id } }),
      }),
    );
  // one line under the two, for what the choice means; in the pending tone where something is made with no answer
  // of the admin's (other people's devices fetch their configuration again by a person's doing)
  const means =
    r === 'off'
      ? _('People’s pages offer no «Router» among the kinds: only you add one, on a person’s page.')
      : r === 'ask' && n === 'ask'
        ? _(
            'A router and every network behind it wait in the card above for your answer. Taking a network away is the person’s to do at once.',
          )
        : r === 'ask'
          ? _('A router waits for your answer; once it is taken, its person changes its networks with no answer of yours.')
          : n === 'ask'
            ? _('A router is added at once and connects as one device; the networks behind it wait for your answer.')
            : _(
                'A router and its networks work as soon as a person adds them, and other people’s devices fetch their configuration again.',
              );
  const staged = c.staged('portal_routers') || c.staged('portal_nets');
  return card(
    cap(_('Routers on people’s pages')),
    row('portal_routers', _('Adding a router'), _('Adding a router on people’s pages'), r, c.srv.portal_routers, [
      { id: 'off', sub: _('only you add one') },
      { id: 'ask', sub: _('you accept each router') },
      { id: 'free', sub: _('as any other device') },
    ]),
    r === 'off'
      ? null
      : row('portal_nets', _('Changing its networks'), _('Changing a router’s networks on people’s pages'), n, c.srv.portal_nets, [
          { id: 'ask', sub: _('you accept each network') },
          { id: 'free', sub: _('it works as soon as it is added') },
        ]),
    staged ? note(waits(`${words[c.srv.portal_routers]} · ${words[c.srv.portal_nets]}`), 'warn') : null,
    note(means, r === 'free' || (r === 'ask' && n === 'free') ? 'warn' : ''),
  );
}

/** Who sees whom: the rule on a track and its groups drawn with the server's people (widgets/visibility.ts). */
function meshCard(c: ServerCtx): HTMLElement {
  const srv = c.srv;
  const mesh = srv.mesh;
  const next = (c.staged('mesh')?.values?.mesh as MeshMode | undefined) ?? null;
  const cctx = { st: c.st, srv: srv.id, changed: () => c.reload() };
  return card(
    cap(
      _('Devices see each other'),
      reMark(meshRewrites(mesh, mesh === 'off' ? 'all' : 'off') ? refetchOf('mesh', srv.id, c.st.people) : 0),
    ),
    visibility({
      mode: mesh,
      next,
      people: c.st.people.filter((p) => p.server === srv.id),
      circles: c.st.circles.filter((x) => x.server === srv.id),
      color: circleColor,
      write: c.write,
      pick: (m) => {
        if (m === mesh) return c.unstage('mesh');
        // between «everyone» and «in circles» nobody's routes change (`rule`): it waits too, with no device to fetch
        c.change({
          kind: meshRewrites(mesh, m) ? 'mesh' : 'rule',
          value: meshWords(m),
          label: fmt(_('Devices see each other: %s'), meshWords(m)),
          apart: m === 'off',
          values: { mesh: m },
        });
      },
      circle: (ci) => openCircle(cctx, ci),
    }),
  );
}

const act = (icon: string, label: string, run: () => void, cls = 'soft') =>
  h('button', { type: 'button', class: `btn ${cls} sm`, onclick: run }, ic(icon), h('span', {}, label));

const edit = (c: ServerCtx, label: string, run: () => void) =>
  c.write ? h('button', { type: 'button', class: 'knob', 'aria-label': label, title: _('Change'), onclick: run }, ic('edit')) : null;

/** The home services shared by all servers. */
function servicesCard(c: ServerCtx): HTMLElement {
  const sc: ServiceCtx = { services: () => c.current().st.services, changed: () => c.reload() };
  const rows = c.st.services.map((sv) =>
    compRow({
      icon: 'service',
      title: sv.name,
      line: `${sv.address}${sv.ports.length ? `:${sv.ports.join(', ')}` : ` · ${_('all ports')}`}`,
      mono: true,
      acts: [edit(c, fmt('%s: %s', _('Change'), sv.name), () => openService(sc, sv))],
    }),
  );
  return card(
    cap(
      `${_('Home services · shared by all servers')} · ${c.st.services.length}`,
      c.write ? act('search', _('Find at home'), () => findAtHome(sc, c.srv.id)) : null,
      c.write ? act('plus', _('Service'), () => openService(sc, null), 'tint') : null,
    ),
    c.st.services.length ? compList(...rows) : note(_('No services yet.')),
    note(_('Who reaches which service is picked on the person: People › a person › «What they reach».')),
  );
}

export function homeSection(c: ServerCtx): HTMLElement {
  const d = c.ifs;
  if (!d) return section(stageHead(c, 'home'), loading());
  return section(stageHead(c, 'home'), networksCard(c, d), behindCard(c, d), portalCard(c), meshCard(c), servicesCard(c));
}
