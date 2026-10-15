// Diagnostics → Health: the watchdog, the checks and the latest problems.

import type { HealthCheck, LogEvent, Status } from '../../../shared/types';
import { E } from '../../e';
import { api, type Health, type ServiceLog } from '../../api';
import { button } from '../../ui/button';
import { attempt } from '../../ui/toast';
import { sw, setSwitch } from '../../ui/controls';
import { callout } from '../../ui/layout';
import { icon } from '../../../shared/icons';
import { ago, clock } from '../../../shared/format';
import { isProblem, type LogItem } from '../../events/model';
import { eventRow, systemRow } from '../../events/render';
import { fixAction, runFix } from '../../widgets/health';

const ICON: Record<HealthCheck['status'], string> = { ok: 'check', warn: 'alert', error: 'x', skip: 'pause' };

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
    const r = fix ? await runFix(fix) : await api.health().catch(() => null);
    if (!r) return;
    this.take(r);
    // The network restarts a second after the answer: look again once it is back.
    if (fix === 'netrestart') setTimeout(() => this.el.isConnected && void this.run(), 5000);
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
            fixAction(c, (fix) => void this.run(fix), refresh),
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
      if (!ok) setSwitch(toggle, !v);
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
    const since = (this.sl.watchdog.now || Date.now() / 1000) - 7 * 86400;
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
        return eventRow(this.st, x.ev!, { time: clock(x.ts) });
      }),
    ]);
  }

  open = new Set<string>();
}
