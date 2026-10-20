// Components: Dawnline, AmneziaWG and the OpenWrt packages Dawnline adds, each
// with its version, a check, updates, other versions and roll back. Every
// operation runs in the updater and is followed in one modal with its log
// (see ../../updater/operation). Settings → Updates holds the automatic checks
// and updates. The blocks live in ./hero, ./awg, ./packages and ./activity.

import { E } from '../../e';
import { api, type Release, type UpdateComponent, type UpdateJob, type UpdatesStatus } from '../../api';
import { button, iconButton } from '../../ui/button';
import { dropdown } from '../../ui/menu';
import { notify } from '../../ui/toast';
import { attachTip } from '../../ui/tooltip';
import { pill } from '../../ui/badges';
import { icon } from '../../../shared/icons';
import { ago } from '../../../shared/format';
import { fmt, num, plural } from '../../../shared/i18n';
import { runOperation } from '../../updater/operation';
import { jobComponent, runningComponent } from '../../updater/jobs';
import { hero } from './hero';
import { awgRows } from './awg';
import { packageRows } from './packages';
import { activity } from './activity';

/** A ⋯ menu entry; null in a list is a separator. */
export interface MenuEntry {
  label: string;
  ic: string;
  warn?: boolean;
  run: () => unknown;
}

export class ComponentsPage {
  st!: UpdatesStatus;
  root = E('div', { class: 'dl-upd' });
  /**
   * The job the modal follows, so the poll does not open a second one:
   * 'starting' from the click until the operation knows its job.
   */
  following: string | null = null;
  /** Versions list: open state and the loaded pages (failed loads are not kept). */
  versOpen = false;
  versPage = 1;
  versCache = new Map<number, Release[]>();
  /** Release notes of the version on offer, for the bullets in the Dawnline block. */
  notes = new Map<string, { items: string[]; total: number } | null>();
  /** The AmneziaWG "Build and translation" fold, once opened or closed by hand. */
  awgOpen: boolean | null = null;
  /** Dawnline's Translation fold. */
  langOpen = false;

  load() {
    return api.updatesStatus();
  }

  render(st: UpdatesStatus) {
    this.st = st;
    this.paint();
    // A job started elsewhere (another tab, the schedule) or before a reload: follow it.
    if (st.job?.state === 'running') void this.follow(st.job);
    poll.add(async () => {
      if (!this.root.isConnected) return;
      const n = await api.updatesStatus().catch(() => null);
      if (!n) return;
      const was = this.st;
      this.st = n;
      // While a click is starting its job, that job is the click's to follow.
      if (n.job?.state === 'running' && this.following !== 'starting' && n.job.id !== this.following) void this.follow(n.job);
      if (
        n.job?.id !== was.job?.id ||
        n.job?.state !== was.job?.state ||
        n.job?.phase !== was.job?.phase ||
        n.check?.time !== was.check?.time
      )
        this.paint();
    }, 5);
    return this.root;
  }

  get busy() {
    return this.st.job?.state === 'running';
  }

  async refresh(st?: UpdatesStatus | null) {
    this.st = st ?? (await api.updatesStatus().catch(() => null)) ?? this.st;
    this.paint();
  }

  /** Run `what` in the operation modal; the cards refresh when it ends. */
  async op(what: string, title: string, version?: string) {
    if (this.busy || this.following === 'starting') {
      notify(_('Another component action is already running'), 'warning');
      return;
    }
    this.following = 'starting';
    this.paint();
    const comp = jobComponent(what);
    const job = await runOperation(what, {
      title,
      version,
      onJob: (j) => (this.following = j.id),
      onDone: (s) => this.refresh(s),
      onUpdate: (s) => {
        const c = s.check?.components ?? {};
        if (comp === 'amneziawg' && c.amneziawg?.current)
          void this.op(
            `amneziawg:${c.amneziawg.current}${c.amneziawg.ru ? ':ru' : ''}`,
            _('Updating AmneziaWG'),
            c.amneziawg.installed ?? undefined,
          );
        else void this.op('app', _('Updating Dawnline'), this.st.version);
      },
    });
    if (this.following === 'starting') this.following = job?.id ?? null;
    void this.refresh();
  }

  async follow(job: UpdateJob) {
    this.following = job.id;
    // [check, automatic update, update] per component.
    const titles: Record<string, string[]> = {
      app: [_('Checking Dawnline'), _('Automatic update: Dawnline'), _('Updating Dawnline')],
      amneziawg: [_('Checking AmneziaWG'), _('Automatic update: AmneziaWG'), _('Updating AmneziaWG')],
      pkgs: [_('Checking system packages'), _('Automatic update: system packages'), _('Updating system packages')],
      all: [_('Checking components'), _('Automatic update: components'), _('Updating components')],
    };
    await runOperation(
      null,
      {
        title: (titles[runningComponent(job)] ?? titles.all)[job.action === 'check' ? 0 : job.auto ? 1 : 2],
        onDone: (s) => this.refresh(s),
      },
      job,
    );
  }

  paint() {
    const st = this.st;
    const c = st.check?.components ?? {};
    const fw = st.firmware;
    const pk = packageRows(this, c.packages);
    // AmneziaWG missing from the router is not "up to date", whatever the last check said.
    const awgMissing = (st.needs?.awg ?? []).length > 0;
    const awgUpdate = !awgMissing && c.amneziawg?.update && c.amneziawg.installed ? 1 : 0;
    const n = awgUpdate + pk.updates;
    dom.content(this.root, [
      E('div', { class: 'dl-pagehead' }, [
        E('div', { class: 'dl-stack' }, [
          E('h2', { class: 'dl-h1' }, _('Components')),
          E(
            'span',
            { class: 'dl-faint' },
            [
              fw?.version ? `OpenWrt ${fw.version} · ${fw.target}` : '',
              st.check ? fmt(_('checked %s'), ago(st.check.time, st.now)) : _('not checked yet'),
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        ]),
        E('div', { class: 'dl-row-actions' }, [
          E(
            'a',
            { class: 'cbi-button cbi-button-neutral dl-icon-btn', href: `${L.url('admin/network/dawnline/settings')}?section=updates` },
            [icon('edit'), ' ', _('Settings')],
          ),
          button([icon('refresh'), ' ', _('Check all')], () => this.op('check', _('Checking all components')), 'neutral', {
            disabled: this.busy,
          }),
        ]),
      ]),
      hero(this, c.app),
      E('div', { class: 'dl-comp-cols' }, [
        E('section', { class: 'dl-panel flush' }, [
          E('div', { class: 'dl-panel-head pad' }, [
            E('h3', {}, _('Components')),
            E('span', { class: 'dl-spacer' }),
            E(
              'span',
              { class: 'dl-faint dl-comp-count' },
              awgMissing
                ? n
                  ? `${_('AmneziaWG not installed')} · ${plural(n, '%s update', '%s updates')}`
                  : _('AmneziaWG not installed')
                : !c.amneziawg && !c.packages
                  ? ''
                  : n
                    ? fmt(N_(n, '%s of %s needs an update', '%s of %s need an update'), num(n), num(1 + pk.total))
                    : _('Everything is up to date'),
            ),
          ]),
          E('div', {}, [...awgRows(this, c.amneziawg), ...pk.rows]),
        ]),
        activity(this),
      ]),
    ]);
  }

  /** The state pill of a component; a running job wins. */
  state(comp: string, x: UpdateComponent | undefined, latest: string): Node {
    const j = this.st.job;
    if (j?.state === 'running') {
      const norm = (v: string) => (v === 'packages' ? 'pkgs' : v);
      const comps = j.action === 'check' ? [norm(j.component || 'all')] : (j.component ?? '').split(' ').map((v) => norm(jobComponent(v)));
      if (comps.includes(comp) || comps.includes('all'))
        return E('button', { type: 'button', class: 'dl-pill info dl-comp-run', title: _('Show progress'), click: () => this.follow(j) }, [
          j.action === 'check' ? _('Checking…') : _('Updating…'),
        ]);
    }
    if (!x) return pill('', _('Not checked'));
    if (x.error) return pill('warn', _('Check failed'), x.error);
    if (x.update) return pill('info', _('Update available'));
    if (x.status === 'dev') return pill('info', _('Newer than release'), fmt(_('The latest release is %s'), latest));
    return pill('ok', _('Up to date'));
  }

  /** ⋯ menu; null is a separator. Actions refuse to start while a job runs (see op). */
  more(items: (MenuEntry | null)[]) {
    const b: HTMLButtonElement = button(
      [icon('more')],
      () =>
        dropdown(
          b,
          items
            // A separator only between items: none first, last or twice in a row.
            .filter((x, i, a) => x !== null || (i > 0 && i < a.length - 1 && a[i - 1] !== null && a.slice(i + 1).some(Boolean)))
            .map((x) => (x ? { label: x.label, icon: icon(x.ic), warn: x.warn, run: x.run } : null)),
        ),
      'neutral',
      { title: _('More'), 'aria-label': _('More') },
    );
    return b;
  }

  /** Check and ⋯; `label` adds the word (the Dawnline block), the list keeps round icons with a tooltip. */
  round(check: () => void, menu: (MenuEntry | null)[], label = false) {
    const busy = this.busy ? ' is-busy' : '';
    let btn: HTMLButtonElement;
    if (label)
      btn = button([icon('refresh'), ' ', _('Check')], check, 'neutral', {
        class: `cbi-button cbi-button-neutral dl-comp-check${busy}`,
        'aria-label': _('Check for updates'),
      });
    else {
      btn = iconButton('refresh', _('Check for updates'), check, 'neutral', busy.trim());
      // Dawnline's own tooltip (the browser's title tip is slow and plain).
      btn.removeAttribute('title');
      btn.setAttribute('aria-label', _('Check for updates'));
      attachTip(btn, () => [_('Check for updates')]);
    }
    return E('span', { class: 'dl-comp-ic' }, [btn, this.more(menu)]);
  }

  /** A row of the list: icon tile, name and a mono line, then its controls. */
  row(ic: string, name: string, sub: (Node | string)[], right: (Node | string)[]) {
    return E('div', { class: 'dl-row' }, [
      E('span', { class: 'dl-group-ic' }, icon(ic)),
      E('span', { class: 'dl-row-main dl-stack' }, [E('b', {}, name), E('span', { class: 'dl-mono dl-faint dl-comp-sub' }, sub)]),
      ...right,
    ]);
  }
}
