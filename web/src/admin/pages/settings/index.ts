// Settings: how the router and Dawnline itself are set up (a server's own
// settings are its page's, pages/server). A rail of sections on the left
// (ui/rail.ts; a jump pill on a narrow page) and the ONE section it picks on
// the right (router/): the rail swaps the view, ?p= names it (route.ts), and
// each swap is a step of the history.
//
// Nothing is saved on a press: a setting waits for «Apply» in the dock at
// the window's foot (changes.ts); leaving the page while any waits is asked
// about first (pending-dock.ts).
//
// Live: the status, the service log, the settings and the backups on the
// live revision, 30 s as the fallback; the Health checks when the page opens
// and at most every 2 minutes after; updates_status every 10 s only while
// Updates is on screen; the portal's addresses once its section is. A part
// is built again only when what it shows changed, and never while it is
// typed in.

import type { HealthCheck, Status } from '../../../shared/types';
import { api, type Backup, type PortalInfo, type ServiceLog, type SettingsData, type UpdatesStatus } from '../../api';
import { h } from '../../../portal/dom';
import { draftSections, withDraft, type DraftSection } from '../../system/draft';
import { still } from '../../../portal/motion';
import { refill } from '../../ui/reshape';
import { createPoller } from '../../state/poller';
import { canWrite } from '../../shell/role';
import { navRow } from '../../shell/nav';
import { href } from '../../shell/routes';
import { ownVisits, visit } from '../../shell/visit';
import { onNavigate } from '../../ui/nav';
import { enter } from '../../ui/entrance';
import { plain } from '../../shell/sheets';
import { errorText, notify } from '../../ui/toast';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { pageHead } from '../../ui/page-head';
import { publishScrollPad, rail, scrollerOf, type RailGroup } from '../../ui/rail';
import { runFix } from '../../flows/health-fix';
import { runOperation } from '../../flows/operation';
import { Changes } from './changes';
import { guardLeaving } from './pending-dock';
import { partOf, type RouterPart } from './route';
import { Parts, type Part } from './parts';
import type { RouterCtx } from './router/ctx';
import { UpdateNotice } from './router/notice';
import { routerRail, routerSection } from './router';

/** Health checks cost more than a status: at most this often (ms). */
const HEALTH_EVERY = 120_000;

export interface SettingsPageData {
  st: Status;
  sl: ServiceLog;
  set: SettingsData;
  upd: UpdatesStatus;
  backups: Backup[];
}

export class SettingsPage {
  private view: RouterPart = partOf(location.search);
  private write = canWrite();
  private data!: SettingsPageData;
  private skew = 0;
  private checks: HealthCheck[] | null = null;
  private healthAt = 0;
  private portal: PortalInfo | null = null;
  private portalAsked = false;
  private yc!: RouterCtx;
  private page!: HTMLElement;
  private headBox = h('div');
  private rtBox = h('div', { class: 'st-grp', 'data-g': 'router' });
  private parts = new Parts();
  private rail = rail(_('Settings’ sections'), (id) => this.go(id as RouterPart));
  private notice = new UpdateNotice(() => this.yc.op({ what: 'app', title: _('Updating Dawnline') }));
  private changes = new Changes({
    // the router's own settings only: no server's changes wait here
    ctx: () => null,
    column: () => this.rtBox,
    reload: () => this.reload(),
    // the context is built again first: the router's answer with what waits over it
    repaint: () => {
      this.take(this.data);
      this.paint(false);
    },
    settings: () => (this.data ? { set: this.data.set, upd: this.data.upd.policy } : null),
    tookSettings: (set) => void (this.data = { ...this.data, set }),
    applied: () => undefined,
  });
  private askLeave!: (leave: () => void) => void;

  /** The page builds on the router's answers from its first line: it waits for them under its shape (shell/waiting.ts). */
  load(): Promise<SettingsPageData> {
    return this.fetch();
  }

  /** The answers the page stands on. */
  private async fetch(): Promise<SettingsPageData> {
    const was = this.data as SettingsPageData | undefined;
    const [st, sl, set, upd, bk] = await Promise.all([
      api.status(1),
      api.serviceLog(),
      api.settingsGet(),
      was && this.view !== 'updates' ? Promise.resolve(was.upd) : api.updatesStatus(),
      api.backupList().catch(() => ({ backups: [] as Backup[] })),
    ]);
    return { st, sl, set, upd, backups: bk.backups };
  }

  /** Read everything again now (after a change made here). */
  private async reload() {
    const d = await this.fetch().catch((e) => (notify(errorText(e), 'error', 10000), null));
    if (!d) return;
    this.take(d);
    this.paint(true);
  }

  /** The Health checks, in the background (they take a moment: DNS, ports, certificates). */
  private async runHealth() {
    this.healthAt = Date.now();
    const r = await api.health().catch(() => null);
    if (!r) return;
    this.checks = r.checks;
    this.take({ ...this.data, sl: { watchdog: r.watchdog, log: r.log } });
    this.paint(true);
  }

  /** Run a check's fix from the section it stands in; the checks come back with it. */
  private fix(fix: string) {
    return runFix(fix, {
      took: (r) => {
        this.checks = r.checks;
        this.healthAt = Date.now();
        this.take({ ...this.data, sl: { watchdog: r.watchdog, log: r.log } });
        this.paint(true);
      },
      again: () => {
        void this.runHealth();
        void this.reload();
      },
    });
  }

  private take(d: SettingsPageData) {
    this.data = d;
    const st = d.st;
    this.skew = st.now - Date.now() / 1000;
    const now = () => Date.now() / 1000 + this.skew;
    const busy = () => this.data.upd.job?.state === 'running';
    this.yc = {
      st,
      // the router's answer with the settings that wait over it (system/draft.ts)
      set: withDraft(d.set, this.changes.settingsDraft, d.upd.policy),
      upd: d.upd,
      backups: d.backups,
      checks: this.checks,
      portal: this.portal,
      write: this.write,
      now,
      // nothing is saved on a press: it waits for «Apply» in the dock
      save: async (values) => this.changes.stageSettings(values),
      reload: () => this.reload(),
      fix: (f) => this.fix(f),
      busy,
      op: (o) => {
        if (busy()) return notify(_('Another component action is already running'), 'warning');
        runOperation({ ...o, done: () => void this.reload() });
      },
    };
  }

  render(data: SettingsPageData): HTMLElement {
    this.take(data);
    const main = h('div', { class: 'st-main' }, this.rail.jump, this.rtBox);
    this.page = h(
      'div',
      { class: 'page settings' },
      navRow(),
      this.headBox,
      h('div', { class: 'st-cols' }, h('aside', { class: 'st-rail' }, this.rail.el), main),
    );
    this.paint(false);
    publishScrollPad(this.page);
    this.askLeave = guardLeaving({ waiting: () => this.changes.count, drop: () => this.changes.leave() });
    // a link to another section of this view, wherever it stands on the page, is taken in place
    this.page.addEventListener('click', (e) => {
      if (e.defaultPrevented || !plain(e)) return;
      const a = e.composedPath().find((x): x is HTMLAnchorElement => x instanceof HTMLAnchorElement && !!x.href);
      if (a && a.target !== '_blank' && this.takes(a.href)) e.preventDefault();
    });
    const stop = ownVisits((url) => {
      if (this.takes(url)) return true;
      if (!this.changes.count) return false;
      // asked from here: the page's own taking is over, the move is the shell's (or the browser's)
      this.askLeave(() => {
        stop();
        visit(url);
      });
      return true;
    });
    const back = () => this.arrive();
    addEventListener('popstate', back);
    const off = onNavigate(() => {
      off();
      stop();
      removeEventListener('popstate', back);
    });
    createPoller({
      fetch: () => this.fetch(),
      every: 30,
      live: true,
      active: () => this.page.isConnected,
      apply: (d) => {
        this.take(d);
        this.paint(true);
        if (Date.now() - this.healthAt > HEALTH_EVERY) void this.runHealth();
      },
    });
    createPoller({
      fetch: () => api.updatesStatus(),
      every: 10,
      active: () => this.page.isConnected && this.view === 'updates',
      apply: (u) => {
        const was = this.data.upd;
        if (u.job?.id === was.job?.id && u.job?.state === was.job?.state && u.check?.time === was.check?.time) return;
        this.take({ ...this.data, upd: u });
        this.paint(true);
      },
    });
    void this.runHealth();
    return this.page;
  }

  // ── where the page is ───────────────────────────────────────────────────────────────────────────────────────

  /** An address of this page: it goes to that section in place. */
  private takes(url: string): boolean {
    const to = new URL(url, location.href);
    if (to.origin !== location.origin || to.pathname !== location.pathname) return false;
    this.go(partOf(to.search));
    return true;
  }

  /** The address moved under the page (Back, Forward): the section follows it. */
  private arrive() {
    const p = partOf(location.search);
    if (p !== this.view) this.show(p);
  }

  /** A section picked (the rail, the jump menu, a link): a step of the history. */
  private go(p: RouterPart) {
    if (p === this.view) return this.toTop(true);
    history.pushState(null, '', `${location.pathname}?p=${p}`);
    this.show(p);
  }

  /** Put a section on screen: it comes in as a page does (ui/entrance.ts), from the top of the column. */
  private show(view: RouterPart) {
    this.view = view;
    this.paint(false);
    this.toTop(false);
    enter(this.rtBox);
  }

  /** The top of the sections' column back in sight, when the page was scrolled past it. */
  private toTop(smooth: boolean) {
    const sc = scrollerOf(this.page);
    const top = sc instanceof Window ? 0 : sc.getBoundingClientRect().top;
    const cols = this.page.querySelector<HTMLElement>('.st-cols');
    if (cols && cols.getBoundingClientRect().top < top)
      cols.scrollIntoView({ block: 'start', behavior: smooth && !still() ? 'smooth' : 'auto' });
  }

  // ── what is drawn ───────────────────────────────────────────────────────────────────────────────────────────

  private head(): HTMLElement {
    const fw = this.data.upd.firmware;
    return pageHead({
      icon: glass('settings', 'grey', 'gi'),
      title: _('Settings'),
      facts: [
        fw?.version ? `OpenWrt ${fw.version}` : null,
        fw?.arch || fw?.target || null,
        this.write ? null : [ic('eye'), _('View only')],
      ],
      acts: [],
    });
  }

  private groups(): RailGroup[] {
    const to = (p: string) => href({ view: 'settings', query: `p=${p}` });
    // one group: the page's head says what it is of
    return [{ label: '', items: routerRail(this.yc, to) }];
  }

  /** Draw the view on screen where it stands; `quiet`: a part being typed in is left alone. */
  private paint(quiet: boolean) {
    const head = this.head();
    if (this.headBox.textContent !== head.textContent) refill(this.headBox, [head]);
    this.parts.put(this.rtBox, [this.routerPart(this.view)], quiet);
    this.rail.set(this.groups());
    this.rail.current(this.view);
    this.changes.sync();
  }

  /** The router's section on screen, with the key of what it shows; the portal's addresses are asked for once it is. */
  private routerPart(view: RouterPart): Part {
    const y = this.yc;
    if (view === 'portal' && !this.portalAsked) {
      this.portalAsked = true;
      void api
        .portalInfo()
        .then((p) => {
          this.portal = p;
          this.take(this.data);
          this.paint(true);
        })
        .catch(() => undefined);
    }
    this.notice.sync(this.data.upd, this.write && this.data.upd.job?.state !== 'running');
    const checks = y.checks?.map((k) => [k.id, k.status, k.detail, k.fix]);
    // what the sections count of the people (who would fetch again after a change of the fallback DNS)
    const people = y.st.people.map((p) => [
      p.id,
      p.server,
      p.access,
      p.dns_mode,
      p.devices.map((d) => [d.id, d.disabled, d.handshake > 0]),
    ]);
    const waits = draftSections(this.changes.settingsDraft).has(view as DraftSection);
    return [
      view,
      () => {
        const sx = routerSection(view, y, this.notice.el);
        // «not applied» at the end of the head of a section that has a value waiting
        if (waits)
          sx.querySelector('.kt-sx-h')?.append(h('span', { class: 'kt-sx-end' }, h('span', { class: 'reimp kt-wait' }, _('not applied'))));
        return sx;
      },
      JSON.stringify([y.set, y.upd, y.backups, y.portal, checks, people, y.st.settings, this.write, waits]),
    ];
  }
}
