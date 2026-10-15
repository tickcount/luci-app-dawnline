// Diagnostics → Health, and the Updates page.

import type { HealthCheck, LogEvent, Status } from '../../shared/types';
import { eventRow } from './overview';
import { isProblem, systemRow, type LogItem } from './activity';
import { E } from '../e';
import { api, type AwgSource, type Health, type Needs, type ServiceLog, type UpdatesStatus } from '../api';
import { installFeature } from '../pkgs';
import { attempt, button, callout, confirmDialog } from '../ui';
import { icon } from '../../shared/icons';
import { ago, clock } from '../../shared/format';
import { sw } from '../kit';

const ICON: Record<HealthCheck['status'], string> = { ok: 'check', warn: 'alert', error: 'x', skip: 'pause' };
const FIX_LABEL: Record<string, string> = { apply: 'Repair', sync: 'Reload devices', restart: 'Restart service', updates: 'Open updates' };

/** Diagnostics → Health: the watchdog, the checks and the latest problems from the log. */
export class HealthTab {
  st: Status;
  el = E('div', {});
  wdEl = E('div', {});
  checksEl = E('div', { class: 'dl-panel' });
  recentEl = E('div', { class: 'dl-panel flush dl-recent' });
  sl: ServiceLog;
  events: LogEvent[];
  checks: HealthCheck[] | null = null;
  /** Shows the Log tab on its Problems filter. */
  toLog: () => void;
  summary = E('div', {});

  constructor(st: Status, sl: ServiceLog, events: LogEvent[], toLog: () => void) {
    this.st = st;
    this.sl = sl;
    this.events = events;
    this.toLog = toLog;
    dom.content(this.el, [this.summary, this.wdEl, E('div', { class: 'dl-health-cols' }, [this.checksEl, this.recentEl])]);
    this.paintChecks();
    this.paintLive(sl, events);
  }

  /** Run the checks (they take a moment: DNS, ports, certificates). */
  async run(fix?: string) {
    const r = fix ? await attempt(() => api.healthFix(fix), 'Done') : await api.health().catch(() => null);
    if (!r) return;
    this.take(r);
  }

  take(r: Health) {
    this.checks = r.checks;
    this.paintChecks();
    this.paintLive(r, this.events);
  }

  paintChecks() {
    const checks = this.checks;
    if (!checks) {
      dom.content(this.summary, '');
      dom.content(this.checksEl, [
        E('div', { class: 'dl-panel-head' }, [E('h3', {}, 'Checks')]),
        E('p', { class: 'dl-muted dl-loading' }, 'Running checks…'),
      ]);
      return;
    }
    const bad = checks.filter((c) => c.status === 'error').length;
    const warn = checks.filter((c) => c.status === 'warn').length;
    dom.content(
      this.summary,
      bad
        ? callout('error', `${bad} problem${bad > 1 ? 's' : ''} need attention.`)
        : warn
          ? callout('warn', `${warn} warning${warn > 1 ? 's' : ''}.`)
          : callout('ok', 'All checks passed.'),
    );
    const repaired = new Map<string, number>();
    for (const x of this.sl.watchdog.repairs) repaired.set(x.id, Math.max(repaired.get(x.id) ?? 0, x.ts));
    const refresh = () => this.run();
    dom.content(this.checksEl, [
      E('div', { class: 'dl-panel-head' }, [E('h3', {}, 'Checks'), E('span', { class: 'dl-spacer' }), button('Run again', refresh)]),
      E(
        'ul',
        { class: 'dl-checks' },
        checks.map((c) =>
          E('li', {}, [
            E('span', { class: `dl-check-icon ${c.status}` }, icon(ICON[c.status])),
            E('div', { class: 'dl-check-body' }, [
              E('div', { class: 'dl-check-title' }, c.title),
              E('div', { class: 'dl-check-detail' }, c.detail),
              repaired.has(c.id)
                ? E('div', { class: 'dl-check-repaired' }, `Repaired by the watchdog at ${clock(repaired.get(c.id)!)}`)
                : '',
            ]),
            c.fix
              ? c.fix.startsWith('install:')
                ? button('Install', () => installFeature(c.fix!.slice(8) as keyof Needs, refresh), 'action')
                : c.fix === 'updates'
                  ? E('a', { class: 'cbi-button cbi-button-action', href: L.url('admin/network/dawnline/updates') }, FIX_LABEL.updates)
                  : button(FIX_LABEL[c.fix] ?? 'Fix', () => this.run(c.fix!), 'action')
              : '',
          ]),
        ),
      ),
    ]);
  }

  /** The watchdog card and recent problems; refreshed by the page poll without running the checks again. */
  paintLive(sl: ServiceLog, events: LogEvent[]) {
    this.sl = sl;
    this.events = events;
    const wd = sl.watchdog;
    const stale = wd.beat != null && wd.now - wd.beat > 180;
    const today = wd.repairs.filter((x) => wd.now - x.ts < 86400);
    const lastRep = today[today.length - 1];
    const toggle = sw(wd.enabled, 'Watchdog repairs', async (v) => {
      const ok = await attempt(() => api.settingsUpdate({ watchdog: v ? '1' : '0' }), v ? 'Watchdog on' : 'Watchdog off');
      if (!ok) toggle.classList.toggle('on', !v);
      const n = await api.serviceLog().catch(() => null);
      if (n) this.paintLive(n, this.events);
    });
    dom.content(
      this.wdEl,
      E('div', { class: 'dl-panel dl-wd' }, [
        E('div', { class: 'dl-wd-head' }, [
          E('span', { class: `dl-wd-tile${wd.enabled ? '' : ' off'}` }, icon('shield')),
          E('div', { class: 'dl-stack' }, [
            E('span', { class: 'dl-wd-title' }, 'Watchdog'),
            E(
              'span',
              { class: 'dl-sub' },
              wd.enabled
                ? 'Every minute it checks the tunnels and services and repairs what it can on its own.'
                : 'Off: problems are only written to the log. Nothing is repaired on its own.',
            ),
          ]),
          E('span', { class: 'dl-spacer' }),
          toggle,
        ]),
        E('div', { class: 'dl-wd-foot' }, [
          E(
            'div',
            { class: 'dl-wd-chips' },
            wd.targets.map((t) =>
              E(
                'span',
                {
                  class: `dl-check-chip${t.ok ? '' : ' error'}`,
                  title: t.ok ? 'OK' : `Not working${t.tries ? ` · ${t.tries} repair${t.tries > 1 ? 's' : ''}` : ''}`,
                },
                [icon(t.ok ? 'check' : 'x'), t.name],
              ),
            ),
          ),
          E(
            'span',
            { class: `dl-sub${stale ? ' dl-warn-text' : ''}` },
            stale
              ? `The agent has not checked in for ${Math.round((wd.now - wd.beat!) / 60)} min; cron restarts it after 5.`
              : [
                  wd.last ? `Looked ${ago(wd.last, wd.now)}` : 'Starts within a minute',
                  ' · ',
                  today.length
                    ? `${today.length} repair${today.length > 1 ? 's' : ''} today, last ${lastRep.name} at ${clock(lastRep.ts)}`
                    : 'no repairs today',
                ],
          ),
        ]),
      ]),
    );
    this.paintRecent();
  }

  /** Problems from the last 7 days, both kinds, newest first. */
  paintRecent() {
    const since = Date.now() / 1000 - 7 * 86400;
    const items: LogItem[] = [...this.events.map((ev) => ({ ts: ev.ts, ev })), ...this.sl.log.map((sys) => ({ ts: sys.ts, sys }))]
      .filter((x) => x.ts >= since && isProblem(x))
      .sort((a, b) => b.ts - a.ts);
    const head = E('div', { class: 'dl-panel-head pad' }, [
      E('h3', {}, 'Recent problems'),
      E('span', { class: 'dl-spacer' }),
      items.length ? E('a', { href: '#', click: (e: Event) => (e.preventDefault(), this.toLog()) }, 'All in Log →') : '',
    ]);
    if (!items.length) {
      dom.content(this.recentEl, [
        head,
        E('div', { class: 'dl-recent-empty' }, [
          E('span', { class: 'dl-check-icon ok' }, icon('check')),
          'No problems in the last 7 days.',
        ]),
      ]);
      return;
    }
    dom.content(this.recentEl, [
      head,
      ...items.slice(0, 8).map((x) => {
        if (x.sys) {
          const e = x.sys;
          const key = `${e.ts}|${e.msg}`;
          return systemRow(
            e,
            this.open.has(key),
            () => {
              if (!this.open.delete(key)) this.open.add(key);
              this.paintRecent();
            },
            clock(e.ts),
          );
        }
        const row = eventRow(this.st, x.ev!);
        row.lastElementChild!.textContent = clock(x.ts);
        return row;
      }),
    ]);
  }

  open = new Set<string>();
}

/** What Dawnline adds to OpenWrt; the portal's HTTPS and certificates only matter while it is on. */
const SYS_ITEMS: { title: string; sub: string; pkgs: string[]; feature: keyof Needs; optional?: boolean }[] = [
  { title: 'ip-full · veth', sub: 'Policy routing and the home-like link', pkgs: ['ip-full', 'kmod-veth'], feature: 'home' },
  { title: 'OpenSSL', sub: 'HTTPS for the personal portal', pkgs: ['libustream-openssl', 'openssl-util'], feature: 'https' },
  { title: 'ACME', sub: 'Let’s Encrypt certificate for the portal', pkgs: ['acme', 'acme-acmesh-dnsapi'], feature: 'acme', optional: true },
];

export class UpdatesPage {
  root!: HTMLElement;
  running = false;

  load() {
    return api.updatesStatus();
  }

  render(st: UpdatesStatus) {
    this.root = E('div', { class: 'dl-root dl-upd' });
    this.paint(st);
    poll.add(async () => {
      const n = await api.updatesStatus().catch(() => null);
      if (n && n.job?.state === 'running') this.paint(n);
      else if (n && this.running) {
        this.running = false;
        this.paint(n);
        // A new Dawnline is installed: load its pages instead of running the old bundle.
        if (n.job?.component === 'app' && n.job.state === 'done') {
          ui.menu?.flushCache();
          setTimeout(() => location.reload(), 1500);
        }
      }
    }, 3);
    return this.root;
  }

  paint(st: UpdatesStatus) {
    const job = st.job;
    this.running = job?.state === 'running';
    const c = st.check?.components ?? {};
    const fw = st.firmware;
    const app = c.app,
      awg = c.amneziawg,
      pk = c.packages;
    const busy = { disabled: this.running };
    const pill = (tone: '' | 'ok' | 'accent' | 'warn' | 'bad', text: string) => E('span', { class: `dl-pill ${tone}` }, text);
    const row = (title: Node | string | (Node | string)[], sub: Node | string | (Node | string)[], right: Node | string) =>
      E('div', { class: 'dl-upd-row' }, [
        E('span', { class: 'dl-stack' }, [E('span', { class: 'dl-upd-name' }, title), E('span', { class: 'dl-sub' }, sub)]),
        right,
      ]);
    const sec = (ic: string, title: string, sub: string, right: Node | string, rows: Node[] = []) =>
      E('section', { class: 'dl-setsec dl-upd-sec' }, [
        E('div', { class: 'dl-upd-head' }, [
          E('span', { class: 'dl-group-ic' }, icon(ic)),
          E('span', { class: 'dl-stack' }, [E('b', {}, title), E('span', { class: 'dl-sub' }, sub)]),
          right,
        ]),
        ...rows,
      ]);
    const date = (d: string | null) =>
      d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

    // Dawnline
    const appSec = sec(
      'sunrise',
      'Dawnline',
      app?.repo ? `${st.version} · ${app.repo}` : st.version,
      !app
        ? pill('', 'Not checked')
        : app.update
          ? button(`Update to ${app.latest}`, () => this.run('app'), 'positive', busy)
          : app.latest
            ? pill('ok', 'Up to date')
            : pill('', 'No releases yet'),
    );

    // AmneziaWG: one row per build source, then the translation
    const srcs = awg?.sources ?? {};
    const ids = Object.keys(srcs) as AwgSource[];
    const awgRows = ids.map((id) => {
      const x = srcs[id]!;
      const mine = awg?.current === id;
      const sub: (Node | string)[] = [
        x.version
          ? `${x.tag} build${x.date ? ` · ${date(x.date)}` : ''} · ${x.gen === '3.1' ? 'devices need AmneziaVPN with 3.1' : 'works with every AmneziaWG app'}`
          : `No build for OpenWrt ${fw?.version ?? ''}`,
      ];
      const right = !x.version
        ? pill('', 'No build')
        : mine
          ? awg?.update
            ? button('Update', () => this.runAwg(id, !!awg.ru, x.gen), 'positive', busy)
            : pill('ok', 'Installed')
          : button('Switch', () => this.runAwg(id, !!awg?.ru, x.gen), 'neutral', busy);
      return row([x.gen ? `AmneziaWG ${x.gen}` : 'AmneziaWG', E('span', { class: 'dl-faint' }, ` · ${x.label}`)], sub, right);
    });
    if (awg?.current && srcs[awg.current]?.version)
      awgRows.push(
        row(
          'Russian translation',
          'LuCI pages for AmneziaWG in Russian',
          button(awg.ru ? 'Remove' : 'Add', () => this.runAwg(awg.current!, !awg.ru, awg.gen), 'neutral', busy),
        ),
      );
    const awgSec = sec(
      'shield',
      'AmneziaWG',
      awg?.installed ? `${awg.gen ? `${awg.gen} · ` : ''}${awg.installed} · changing it restarts every tunnel` : 'Not installed',
      !awg ? pill('', 'Not checked') : '',
      awgRows.length ? awgRows : [row('Builds for this router', 'Check for updates to see them.', '')],
    );

    // System packages: one row per thing Dawnline adds
    const pkgs = pk?.pkgs ?? {};
    const rows: Node[] = [];
    // Only what the features in use need: the home-like link, and HTTPS and certificates while the portal is on.
    const items = SYS_ITEMS.filter((it) => (it.feature === 'home' ? st.home : st.portal));
    for (const it of items) {
      const present = it.pkgs.filter((p) => pkgs[p]?.installed);
      // The package itself and what is released with it (the rest of LuCI, libopenssl, rpcd)
      const upd = [...new Set(present.flatMap((p) => [...(pkgs[p]?.latest ? [p] : []), ...(pkgs[p]?.with ?? [])]))];
      // What the router lacks for this feature (any TLS module counts for HTTPS, not only OpenSSL's).
      const lacks = st.needs?.[it.feature] ?? it.pkgs.filter((p) => !pkgs[p]?.installed);
      if (lacks.length) {
        rows.push(
          row(
            it.title,
            it.optional ? `Not installed · ${it.sub}` : E('span', { class: 'dl-upd-bad' }, `Missing ${lacks.join(', ')} · ${it.sub}`),
            button('Install', () => this.runPkgs(lacks, it.title), 'neutral', busy),
          ),
        );
      } else if (upd.length) {
        const main = present.find((p) => pkgs[p]?.latest);
        const v: (Node | string)[] = main
          ? [E('span', { class: 'dl-mono' }, [`${pkgs[main]!.installed} → `, E('b', {}, pkgs[main]!.latest!)])]
          : [];
        const rel = upd.filter((p) => p !== main);
        if (rel.length)
          v.push(
            `${main ? ' · ' : ''}${rel.length <= 2 ? `${main ? 'with ' : ''}${rel.join(', ')}` : `${main ? '+' : ''}${rel.length} related packages`}`,
          );
        rows.push(
          row(
            it.title,
            v,
            button(
              'Update',
              () =>
                this.runPkgs(
                  present.filter((p) => pkgs[p]?.latest || pkgs[p]?.with?.length),
                  it.title,
                  upd,
                ),
              'neutral',
              busy,
            ),
          ),
        );
      } else rows.push(row(it.title, it.sub, pill('ok', 'Up to date')));
    }
    const shown = items.flatMap((it) => it.pkgs).filter((k) => pkgs[k]?.installed);
    const allUpd = [...new Set(shown.flatMap((k) => [...(pkgs[k].latest ? [k] : []), ...(pkgs[k].with ?? [])]))];
    const pkgSec = sec(
      'package',
      'System packages',
      !pk
        ? 'What Dawnline adds to OpenWrt'
        : allUpd.length
          ? `${allUpd.length} update${allUpd.length === 1 ? '' : 's'} from the OpenWrt ${fw?.version?.replace(/\.\d+$/, '') ?? ''} feeds`
          : 'What Dawnline adds to OpenWrt is current',
      !pk
        ? pill('', 'Not checked')
        : allUpd.length
          ? button(
              'Update all',
              () =>
                this.runPkgs(
                  shown.filter((k) => pkgs[k].latest || pkgs[k].with?.length),
                  'all packages',
                  allUpd,
                ),
              'positive',
              busy,
            )
          : '',
      pk ? rows : [],
    );

    // The last job, folded
    const jobCard = job
      ? E('details', { class: 'dl-params dl-upd-job', open: this.running ? 'open' : null }, [
          E('summary', {}, [
            icon('chevron'),
            E('span', {}, 'Last job'),
            pill(
              job.state === 'done' ? 'ok' : job.state === 'failed' ? 'bad' : 'warn',
              job.state === 'running' ? job.phase || 'Running' : job.state === 'done' ? 'Finished' : 'Failed',
            ),
            E(
              'span',
              { class: 'dl-sub' },
              `${job.action === 'check' ? 'check' : (job.component ?? '')} · ${clock(job.started)}${job.finished ? ` · ${job.finished - job.started} s` : ''}`,
            ),
          ]),
          job.error ? callout('error', job.error) : '',
          E('pre', { class: 'dl-log' }, job.log.join('\n')),
        ])
      : '';

    const total = allUpd.length + (app?.update ? 1 : 0) + (awg?.update ? 1 : 0);
    const facts = [
      fw?.version ? `OpenWrt ${fw.version} · ${fw.target}` : '',
      st.check ? (total ? `${total} update${total === 1 ? '' : 's'} ready` : 'everything is current') : 'not checked yet',
      st.check ? `checked ${clock(st.check.time)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    dom.content(this.root, [
      E('div', { class: 'dl-pagehead' }, [
        E('div', { class: 'dl-stack' }, [E('h2', { class: 'dl-h1' }, 'Updates'), E('span', { class: 'dl-faint' }, facts)]),
        button([icon('refresh'), ' Check now'], () => this.run('check'), 'neutral', busy),
      ]),
      appSec,
      awgSec,
      pkgSec,
      jobCard,
    ]);
  }

  async runAwg(id: AwgSource, ru: boolean, gen: string | null | undefined) {
    const ok = await confirmDialog(
      gen ? `Install AmneziaWG ${gen}?` : 'Install AmneziaWG?',
      'Every AmneziaWG tunnel on the router restarts for a few seconds, HomeTunnel too. Devices stay configured.',
      'Install',
    );
    if (ok) this.start(`amneziawg:${id}${ru ? ':ru' : ''}`);
  }

  /** names: Dawnline's own packages (the updater adds their family); shown: everything that will change. */
  async runPkgs(names: string[], what: string, shown = names) {
    const ok = await confirmDialog(
      `Update ${what}?`,
      `${shown.join(', ')} from the OpenWrt feeds. Services that use them restart for a moment.`,
      'Update',
    );
    if (ok) this.start(`pkgs:${names.join(',')}`);
  }

  async run(what: string) {
    if (what !== 'check') {
      const ok = await confirmDialog(
        `Update ${what === 'app' ? 'Dawnline' : what}?`,
        'A backup is made first. The page reloads when it finishes.',
        'Update',
      );
      if (!ok) return;
    }
    this.start(what);
  }

  async start(what: string) {
    if (await attempt(() => api.updatesRun(what))) {
      this.running = true;
      const n = await api.updatesStatus().catch(() => null);
      if (n) this.paint(n);
    }
  }
}
