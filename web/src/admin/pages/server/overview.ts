// A server's Overview (IA-3): does this server work now, and who on it waits for a decision. The head names the
// server (its state, the address devices connect to, its core); «now» in numbers over the 30-day line, as Overview
// has it, of this server's people; the rollout open while devices fetch a new configuration; who waits for a
// decision, each with their one action; the checks that did not pass, each leading to the settings part it is
// about; the path check. All of it the real parts (pages/overview, widgets/rollout, pages/settings/check).

import type { HealthCheck } from '../../../shared/types';
import { h } from '../../../portal/dom';
import { todayOf } from '../../../shared/format';
import { fmt, plural } from '../../../shared/i18n';
import { routerDay } from '../../events/clock';
import { ic } from '../../ui/icons';
import { secHead } from '../../ui/page-head';
import { compList, compRow } from '../../ui/comp-row';
import { refill } from '../../ui/reshape';
import { LiveMeter } from '../../state/meter';
import { pollMeter } from '../../state/meterpoll';
import { rollout } from '../../servers/rollout';
import { stageOf, type StageId } from '../../servers/path';
import { rolloutStrip } from '../../widgets/rollout';
import type { ServerCtx } from '../../pages/settings/ctx';
import type { OverviewCtx } from '../../pages/overview/ctx';
import { nowCard, type NowCard } from '../../pages/overview/now';
import { waitActions, waitList } from '../../pages/overview/waiting';
import { checkSection } from '../../pages/settings/check';
import type { ServerPart as Part } from '../../shell/routes';
import { putChildren } from '../../../portal/ui/put';

const peopleOf = (st: ServerCtx['st'], id: string) => st.people.filter((p) => p.server === id);

/** The settings part a stage's checks are fixed in. */
const PART_OF: Record<StageId, Part> = {
  devices: 'core',
  disguise: 'core',
  entry: 'general',
  tunnel: 'network',
  internet: 'network',
  home: 'network',
};
const partTitle = (p: Part) => ({ general: _('General'), core: _('Core'), network: _('Network') })[p as 'general'] ?? '';

export class ServerOverview {
  el = h('div', { class: 'sv-ov ov' });
  private c: ServerCtx;
  private rollBox = h('div', { class: 'sv-roll' });
  private waitBox = h('section', { class: 'ov-wait' });
  private healthBox = h('section', { class: 'sv-health' });
  private checkBox = h('div');
  private now: NowCard;
  private meter = new LiveMeter();
  private checkKey = '';
  /** What the last drawing read (see update). */
  private read: unknown[] = [];

  constructor(
    c: ServerCtx,
    private to: (p: Part) => void,
  ) {
    this.c = c;
    this.now = nowCard(this.scoped());
    this.el.append(h('div', { class: 'ov-now' }, this.now.el), this.rollBox, this.waitBox, this.healthBox, this.checkBox);
    waitActions(this.waitBox, () => this.scoped());
    pollMeter(
      this.meter,
      () => this.el.isConnected && this.c.srv.enabled && this.c.srv.up,
      () => this.speed(),
    );
  }

  /** Overview's context with only this server's people and numbers. */
  private scoped(): OverviewCtx {
    const c = this.c;
    const people = peopleOf(c.st, c.srv.id);
    const st = { ...c.st, people, servers: [c.srv], series: c.srv.series.length ? c.srv.series : c.st.series };
    return {
      st,
      checks: c.checks,
      checksFailed: false,
      sl: null,
      write: c.write,
      now: c.now,
      speedOf: () => null,
      today: () => ({ now: c.now(), today: todayOf(st.series) || routerDay(c.now(), st.tz) }),
      reload: c.reload,
      recheck: async () => undefined,
      fix: c.fix,
    };
  }

  private speed() {
    const c = this.c;
    if (!c.srv.enabled || !c.srv.up) return this.now.speed({ down: 0, up: 0, top: [], line: [], why: _('The server is not running') });
    const ms = Date.now();
    const all = this.meter.speed(c.srv.id, ms);
    if (!all.pts.length) {
      // before the meter's first answer: the router's last minute
      const r = c.srv.rate[c.srv.rate.length - 1];
      return this.now.speed({ down: r?.[2] ?? 0, up: r?.[1] ?? 0, top: [], line: [] });
    }
    const top = peopleOf(c.st, c.srv.id)
      .filter((p) => p.online > 0)
      .map((p) => {
        const v = this.meter.speed(
          c.srv.id,
          ms,
          p.devices.map((d) => d.id),
        );
        return { p, v: v.rx + v.tx };
      })
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 2);
    this.now.speed({ down: all.tx, up: all.rx, top, line: all.pts.map((p) => p[2]) });
  }

  update(c: ServerCtx) {
    this.c = c;
    const s = c.srv;
    // Drawn again only when something it could show is another object than at the last answer (the page lays
    // each answer over the last, shared/live/share.ts): the router's clock alone, which every answer moves, is
    // no change. What is said relative to now moves on with the minute.
    const reads: unknown[] = [s, c.checks, c.log, c.write, this.el.clientWidth < 560, Math.floor(c.now() / 60)];
    for (const [k, v] of Object.entries(c.st)) if (k !== 'now') reads.push(v);
    const same = reads.length === this.read.length && reads.every((v, i) => v === this.read[i]);
    this.read = reads;
    if (same) return;
    const sc = this.scoped();
    this.now.update(sc);
    this.speed();
    const strip = rollout(c.st.people, s.id) ? rolloutStrip({ st: c.st, srv: s, log: c.log, now: c.now(), write: c.write }) : null;
    refill(this.rollBox, strip ? [strip] : []);
    refill(this.waitBox, waitList(sc, this.el.clientWidth > 0 && this.el.clientWidth < 560));
    refill(this.healthBox, this.health());
    const key = `${s.id}:${peopleOf(c.st, s.id).length}`;
    if (key !== this.checkKey) {
      this.checkKey = key;
      putChildren(this.checkBox, [checkSection(c)]);
    }
  }

  /** The server's own checks: what did not pass as rows that lead to the part it is fixed in; else one quiet line. */
  private health(): HTMLElement[] {
    const c = this.c;
    const mine = (c.checks ?? []).filter((k) => stageOf(k.id, c.srv.id));
    const failed = mine.filter((k) => k.status === 'warn' || k.status === 'error');
    const passed = mine.filter((k) => k.status === 'ok').length;
    const row = (k: HealthCheck) => {
      const part = PART_OF[stageOf(k.id, c.srv.id)!];
      const go = h('button', { type: 'button', class: 'pill-link' }, fmt(_('Settings › %s'), partTitle(part)), ic('chevron'));
      go.addEventListener('click', () => this.to(part));
      return compRow({
        icon: 'pulse',
        tone: k.status === 'error' ? 'red' : 'orange',
        title: k.problem ?? k.title,
        line: k.detail,
        acts: [go],
      });
    };
    return [
      secHead(_('Health'), c.checks ? fmt(_('%s of %s fine'), passed, mine.length) : _('checking…')),
      failed.length
        ? compList(...failed.map(row))
        : h(
            'div',
            { class: 'checks' },
            compRow({
              icon: 'pulse',
              tone: 'green',
              title: c.checks ? plural(passed, '%s check passed', '%s checks passed') : _('Checking the server…'),
              line: _('The tunnel, the way in, the firewall and the home networks of this server.'),
            }),
          ),
    ];
  }
}
