// A server's page: everything of one server behind one door (the owner's structure, 2026-11-11). The admin's row,
// the way back to all servers and the server's name; under them its parts on one track across the page: Overview ·
// People · Places · Settings. Inside Settings the parts (General · Core · Network) stand in the admin's rail on the
// left, a jump pill on a phone; the other three take the page's whole width. People and Places are the People page
// scoped to the server (people.ts): a person's page takes the list's place, a device opens as a dialog over it
// (device-dialog.ts). Two LuCI views draw it: `server` (its Overview and settings: ?server=&p=) and `people` (its
// people and their places: the People page's own addresses), so every link to a person or a device still works.
//
// Which server: the address names it (?server=), else the person or the device it names is on it, else the one this
// tab looked at last, else the first. The server's changes wait for «Apply» as in Settings (the same Changes).

import type { HealthCheck, Server, Status } from '../../../shared/types';
import { share } from '../../../shared/live/share';
import { api, type InterfacesData, type ServiceLog, type ServiceLogEntry } from '../../api';
import { h } from '../../../portal/dom';
import { num } from '../../../shared/i18n';
import { ic } from '../../ui/icons';
import { tabs } from '../../ui/tabs';
import { rail, publishScrollPad } from '../../ui/rail';
import { pageHead } from '../../ui/page-head';
import { glass } from '../../ui/glass';
import { copyText } from '../../ui/files';
import { errorText, notify } from '../../ui/toast';
import { serverState } from '../../servers/state';
import { here, href, serverUrl, type ServerPart } from '../../shell/routes';
import { navRow } from '../../shell/nav';
import { canWrite } from '../../shell/role';
import type { Page } from '../../shell/view';
import { createPoller } from '../../state/poller';
import { enter } from '../../ui/entrance';
import { peopleOnline } from '../../people/lines';
import { parseRoute } from '../../people/route';
import { stageChecks, stageStates, type StageId, type StageState } from '../../servers/path';
import { runFix } from '../../flows/health-fix';
import type { ServerCtx } from '../settings/ctx';
import { Changes } from '../settings/changes';
import { guardLeaving } from '../settings/pending-dock';
import { ServerPeople } from './people';
import { ServerOverview } from './overview';
import { settingsParts } from './settings';
import { Parts } from '../settings/parts';
import { putChildren } from '../../../portal/ui/put';

export interface ServerData {
  st: Status;
  sl: ServiceLog | null;
}

const PARTS: ServerPart[] = ['overview', 'people', 'places', 'general', 'core', 'network'];
const SETTINGS: ServerPart[] = ['general', 'core', 'network'];
type Top = 'overview' | 'people' | 'places' | 'settings';
const topOf = (p: ServerPart): Top => (SETTINGS.includes(p) ? 'settings' : (p as Top));
const worst = (...s: StageState[]): 'bad' | 'warn' | undefined => (s.includes('bad') ? 'bad' : s.includes('warn') ? 'warn' : undefined);

/** The part an address says. */
function partOf(): ServerPart {
  const q = new URLSearchParams(location.search);
  if (here().view === 'people') return q.get('view') === 'map' ? 'places' : 'people';
  const p = q.get('p') as ServerPart | null;
  return p && PARTS.includes(p) ? p : 'overview';
}

/** Where this tab's server is kept between its pages (People's own addresses do not name it). */
const KEEP = 'dawnline-server';
const kept = (): string | null => {
  try {
    return sessionStorage.getItem(KEEP);
  } catch {
    return null;
  }
};

/** Health checks cost more than a status: at most this often (ms). */
const HEALTH_EVERY = 120_000;

export class ServerPage implements Page<ServerData> {
  private st!: Status;
  private srv!: Server;
  private part: ServerPart = partOf();
  private write = canWrite();
  private checks: HealthCheck[] | null = null;
  private healthAt = 0;
  private ifs: InterfacesData | null = null;
  private log: ServiceLogEntry[] = [];
  private page = h('div', { class: 'page sv' });
  private box = h('div', { class: 'sv-view' });
  private headBox = h('div', { class: 'sv-head' });
  private trackBox = h('div', { class: 'sv-track' });
  /** Settings' own frame: its rail beside the part on screen (kept while one part gives way to another). */
  private rail = rail(_('Settings'), (id) => this.go(id as ServerPart));
  private setSlot = h('div', { class: 'sv-set st-grp' });
  private parts = new Parts();
  private setWrap = h(
    'div',
    { class: 'st-cols sv-setcols' },
    h('aside', { class: 'st-rail' }, this.rail.el),
    h('div', { class: 'st-main' }, this.rail.jump, this.setSlot),
  );
  /** The settings part last looked at: «Settings» opens on it again. */
  private lastSet: ServerPart = 'general';
  private people: ServerPeople | null = null;
  private peopleEl: HTMLElement | null = null;
  private ov: ServerOverview | null = null;
  private shown: ServerPart | '' = '';
  /** The server's changes that wait for «Apply» (the dock at the window's foot). */
  private changes = new Changes({
    ctx: () => (this.srv ? this.ctx() : null),
    reload: () => this.reload(),
    repaint: () => this.repaint(),
    applied: () => this.go('overview'),
    column: () => this.setSlot,
  });

  /** The way back's word: «All servers» with several, «Overview» with one. */
  private backWord = h('span');

  /** Every opening asks the router, and the page comes in when it has answered (shell/waiting.ts). */
  async load(): Promise<ServerData> {
    const [st, sl] = await Promise.all([api.status(60), api.serviceLog().catch(() => null)]);
    return { st, sl };
  }

  /** Which server: the address names it, else the person or the device it names is on it, else this tab's last. */
  private pick(st: Status): Server {
    const q = new URLSearchParams(location.search);
    const r = parseRoute(location.search.replace(/^\?/, ''));
    const of = st.people.find((p) => (r.id ? p.id === r.id : r.device ? p.devices.some((x) => x.id === r.device) : false))?.server;
    const id = q.get('server') ?? of ?? kept();
    const srv = st.servers.find((s) => s.id === id) ?? st.servers[0];
    try {
      sessionStorage.setItem(KEEP, srv.id);
    } catch {
      /* a private window: the address or the first server will do */
    }
    return srv;
  }

  render(d: ServerData): HTMLElement {
    const st = (this.st = d.st);
    this.log = d.sl?.log ?? [];
    this.page.append(navRow());
    if (!st.servers.length) {
      // no server yet: Overview has the way to make the first one
      location.replace(href({ view: 'overview' }));
      return this.page;
    }
    this.srv = this.pick(st);
    this.backWord.textContent = st.servers.length > 1 ? _('All servers') : _('Overview');
    const back = h(
      'nav',
      { class: 'back sv-back' },
      h('a', { class: 'back-a', href: href({ view: 'overview' }) }, ic('chevron'), this.backWord),
    );
    this.page.append(back, this.headBox, this.trackBox, this.box);
    publishScrollPad(this.page);
    this.paintFrame();
    this.show();
    // Back and Forward between the server's own parts (a sheet's own history entry is the sheet's)
    addEventListener('popstate', (e) => {
      if ((e.state as { sheet?: boolean } | null)?.sheet || !this.page.isConnected) return;
      this.part = partOf();
      this.show(true);
    });
    // the checks and the interfaces are this server's: asked once it is known
    void this.slow();
    createPoller({
      fetch: () => api.status(60),
      every: 30,
      live: true,
      active: () => this.page.isConnected,
      apply: (s) => this.land(s),
    });
    guardLeaving({ waiting: () => this.changes.count, drop: () => this.changes.leave() });
    return this.page;
  }

  private take(st: Status) {
    // laid over the last answer: what did not change is the object it was, and what reads it knows it by that
    this.st = share(this.st, st);
    this.srv = this.st.servers.find((s) => s.id === this.srv.id) ?? this.st.servers[0];
  }

  /** A status from the router: drawn in place. */
  private land(s: Status) {
    if (!s.servers.length) return void (location.href = href({ view: 'overview' }));
    this.take(s);
    this.paintFrame();
    this.ov?.update(this.ctx());
    this.people?.take(s);
    if (Date.now() - this.healthAt > HEALTH_EVERY) void this.slow();
  }

  /** What takes a moment on the router: the Health checks and the server's interfaces. */
  private async slow() {
    this.healthAt = Date.now();
    const [hl, ifs] = await Promise.all([api.health().catch(() => null), api.interfaces(this.srv.id).catch(() => null)]);
    if (hl) {
      this.checks = share(this.checks, hl.checks);
      this.log = share(this.log, hl.log ?? this.log);
    }
    this.ifs = ifs ?? this.ifs;
    // in the background: a section being typed in is left as it is
    this.repaint(true);
  }

  /** Read the router again and draw the part on screen from it. */
  private async reload() {
    const [st, ifs, hl] = await Promise.all([
      api.status(60).catch(() => null),
      api.interfaces(this.srv.id).catch(() => null),
      api.health().catch(() => null),
    ]);
    if (st) this.take(st);
    this.ifs = ifs ?? this.ifs;
    if (hl) this.checks = share(this.checks, hl.checks);
    this.repaint();
    if (st) this.people?.take(st);
  }

  /**
   * The part on screen drawn again where it stands (a change began or stopped waiting, was applied, or the router
   * answered); `quiet`: nobody asked for it, so a section being typed in stays.
   */
  private repaint(quiet = false) {
    this.paintFrame();
    this.ov?.update(this.ctx());
    if (topOf(this.part) === 'settings' && this.shown === this.part) this.paintSet(quiet);
    this.changes.sync();
  }

  /** The settings part on screen, its sections built again only where what they show moved (pages/settings/parts.ts). */
  private paintSet(quiet: boolean) {
    const c = this.ctx();
    const s = c.srv;
    // what the sections read, without what only counts traffic (that moves with every poll)
    const key = JSON.stringify([
      { ...s, series: 0, rate: 0, uptime: 0, peers: 0, online: 0 },
      c.checks?.map((k) => [k.id, k.status, k.detail, k.fix]),
      c.ifs,
      this.changes.all,
      c.st.settings,
      c.st.wan,
      c.st.servers.map((x) => x.name),
      c.st.circles,
      c.st.people
        .filter((p) => p.server === s.id)
        .map((p) => [
          p.id,
          p.name,
          p.access,
          p.dns_mode,
          p.circle,
          // a router's networks and what its owner asked for are the Network section's rows
          p.devices.map((d) => [d.id, d.disabled, d.handshake > 0, d.name, d.kind, d.lan_bypass, d.behind, d.ask, d.waiting, d.declined]),
        ]),
      this.write,
    ]);
    this.setSlot.dataset.part = this.part;
    this.parts.put(this.setSlot, settingsParts(this.part, c, key), quiet);
  }

  /** What the server's own parts read (Settings' sections take it as it is). */
  private ctx(): ServerCtx {
    const srv = this.srv;
    const failed = stageChecks(this.checks ?? [], srv.id);
    const skew = this.st.now - Date.now() / 1000;
    return {
      st: this.st,
      srv,
      checks: this.checks,
      failed,
      states: stageStates(this.st, srv, failed),
      ifs: this.ifs && this.ifs.server === srv.id ? this.ifs : null,
      log: this.log,
      write: this.write,
      now: () => Date.now() / 1000 + skew,
      update: async (values) => {
        try {
          await api.serverUpdate(srv.id, values);
        } finally {
          await this.reload();
        }
      },
      change: (s) => this.changes.change(s),
      staged: (kind) => this.changes.staged(kind),
      unstage: (kind) => this.changes.unstage(kind),
      reload: () => this.reload(),
      fix: (f) =>
        runFix(f, {
          took: (r) => {
            this.checks = share(this.checks, r.checks);
            this.healthAt = Date.now();
            this.log = share(this.log, r.log ?? this.log);
            this.repaint();
          },
          again: () => void this.reload(),
        }),
      current: () => this.ctx(),
    };
  }

  /** The server's head, its track and the rail of its settings, as the part on screen has them. */
  private paintFrame() {
    const srv = this.srv;
    const mine = this.st.people.filter((p) => p.server === srv.id);
    const s = this.ctx().states;
    const st = (...ids: StageId[]) => worst(...ids.map((i) => s[i]));
    const state = serverState(srv);
    const host = srv.endpoint || this.st.settings.portal_host || '';
    const head = pageHead({
      icon: glass('server', srv.enabled && !srv.up ? 'red' : srv.enabled ? 'blue' : 'grey'),
      title: srv.name,
      facts: [
        h('span', { class: `ph-state ${state.tone}-t` }, state.text),
        host
          ? h(
              'button',
              {
                type: 'button',
                class: 'ph-copy mono',
                title: _('Copy address'),
                onclick: () => void copyText(`${host}:${srv.port}`, _('Address copied')).catch((e) => notify(errorText(e), 'error')),
              },
              `${host}:${srv.port}`,
            )
          : null,
        'AmneziaWG',
        this.write ? null : _('View only'),
      ],
    });
    if (this.headBox.textContent !== head.textContent) putChildren(this.headBox, [head]);
    const top = topOf(this.part);
    if (top === 'settings') this.lastSet = this.part;
    const tone = { general: st('entry'), core: st('devices', 'disguise'), network: st('tunnel', 'internet', 'home') };
    const any = worst(...(Object.values(tone).filter(Boolean) as StageState[]));
    const key = `${top}|${mine.length}|${peopleOnline(mine)}|${any ?? ''}`;
    if (this.trackBox.dataset.k !== key) {
      this.trackBox.dataset.k = key;
      const t = tabs<Top>(
        [
          { id: 'overview', label: _('Overview'), icon: 'dashboard' },
          { id: 'people', label: _('People'), icon: 'people', sub: num(mine.length) },
          { id: 'places', label: _('Places'), icon: 'pin' },
          { id: 'settings', label: _('Settings'), icon: 'sliders' },
        ],
        top,
        (id) => this.go(id === 'settings' ? this.lastSet : id),
        { cls: 'sv-tabs icons', label: _('The server’s sections'), keep: 'server-parts' },
      );
      // a settings part that is not fine marks «Settings» (the rail names the part)
      if (any) t.el.querySelector('.tab[data-id="settings"]')?.append(h('span', { class: `sv-al ${any}-t` }, ic('alert')));
      putChildren(this.trackBox, [t.el]);
    }
    const to = (p: ServerPart) => serverUrl(srv.id, p);
    this.rail.set([
      {
        label: '',
        items: [
          { id: 'general', icon: 'server', line: 'terminal', title: _('General'), tone: tone.general, href: to('general') },
          { id: 'core', icon: 'core', line: 'chip', title: _('Core'), value: 'AmneziaWG', tone: tone.core, href: to('core') },
          { id: 'network', icon: 'lan', line: 'ethernet', title: _('Network'), tone: tone.network, href: to('network') },
        ],
      },
    ]);
    if (top === 'settings') this.rail.current(this.part);
  }

  /** A part picked on the track or the rail. */
  private go(p: ServerPart) {
    if (p === this.part) return;
    const peopleish = p === 'people' || p === 'places';
    this.part = p;
    if (peopleish && this.people) {
      // the People page is there already: it goes to its other view (or its list) by its own moves
      if (this.box.firstElementChild !== this.peopleEl) history.pushState(null, '', serverUrl(this.srv.id, p));
      if (this.mountPeople()) enter(this.box);
      this.people.go({ view: p === 'places' ? 'map' : undefined });
    } else {
      history.pushState(null, '', serverUrl(this.srv.id, p));
      this.show(true);
    }
    this.paintFrame();
  }

  /** People's head names the part: the list of people, or their places. */
  private titlePeople() {
    const t = this.peopleEl?.querySelector(':scope > .ph .ph-title');
    if (t) t.textContent = this.part === 'places' ? _('Places') : _('People');
  }

  /** People in the part's place; true when it was not there. */
  private mountPeople(): boolean {
    if (!this.peopleEl || this.box.firstElementChild === this.peopleEl) return false;
    putChildren(this.box, [this.peopleEl]);
    this.shown = this.part;
    this.titlePeople();
    return true;
  }

  /**
   * The part on screen; `enters`: it was picked on the page (or Back, Forward), and comes in as a page does
   * (ui/entrance.ts). The first one comes in with the page.
   */
  private show(enters = false) {
    const p = this.part;
    this.page.dataset.part = p;
    if (p === 'people' || p === 'places') {
      if (!this.people) {
        this.people = new ServerPeople(this.srv.id, () => {
          // the People page moved by itself (its view, Back): the track follows
          if (!this.peopleEl?.isConnected) return;
          this.part = partOf();
          this.page.dataset.part = this.part;
          this.titlePeople();
          this.paintFrame();
        });
        this.peopleEl = this.people.render(this.st);
      }
      if (this.mountPeople() && enters) enter(this.box);
      this.shown = p;
      this.titlePeople();
      this.paintFrame();
      return;
    }
    let el: HTMLElement;
    if (p === 'overview') {
      this.ov ??= new ServerOverview(this.ctx(), (to) => this.go(to));
      this.ov.update(this.ctx());
      el = this.ov.el;
    } else {
      // a settings part: inside Settings' frame, the rail kept
      this.paintSet(false);
      el = this.setWrap;
    }
    const was = this.shown;
    if (this.box.firstElementChild !== el) {
      putChildren(this.box, [el]);
      if (enters) enter(this.box);
    } else if (enters && was !== p) enter(this.setSlot);
    this.shown = p;
    this.paintFrame();
    this.changes.sync();
    // a section the address asks for (a stage of the path): brought into view
    const s = new URLSearchParams(location.search).get('s');
    if (s) requestAnimationFrame(() => this.box.querySelector(`[data-id="${CSS.escape(s)}"]`)?.scrollIntoView({ block: 'start' }));
  }
}
