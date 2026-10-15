// Diagnostics: Health (watchdog, checks, recent problems) and Log (activity
// and the service log in one list) as two tabs. ?tab=log opens the Log; the
// old Health and Activity addresses come here.

import type { Status } from '../../shared/types';
import { E } from '../e';
import { api, type Health, type ServiceLog } from '../api';
import { HealthTab } from './maintenance';
import { LogTab } from './activity';

type Tab = 'health' | 'log';
type Loaded = [Status, Awaited<ReturnType<typeof api.events>>, ServiceLog, Health | null];

const TABS: [Tab, string][] = [
  ['health', 'Health'],
  ['log', 'Log'],
];

export class DiagnosticsPage {
  tab: Tab = new URLSearchParams(location.search).get('tab') === 'log' ? 'log' : 'health';
  health!: HealthTab;
  log!: LogTab;
  segEl = E('div', { class: 'dl-seg dl-srvsections dl-diag-tabs', role: 'tablist', 'aria-label': 'Diagnostics' });
  subEl = E('span', { class: 'dl-muted' });
  actionsEl = E('div', { class: 'dl-row-actions' });
  bodyEl = E('div', {});

  load(): Promise<Loaded> {
    // The checks take a moment: only wait for them when Health opens first.
    return Promise.all([
      api.status(1),
      api.events(20000),
      api.serviceLog(),
      this.tab === 'health' ? api.health().catch(() => null) : Promise.resolve(null),
    ]);
  }

  render([st, ev, sl, h]: Loaded): HTMLElement {
    this.log = new LogTab(st, ev, sl.log);
    this.health = new HealthTab(st, sl, ev.events, () => {
      this.show('log');
      this.log.show('problems');
    });
    if (h) this.health.take(h);
    this.show(this.tab);
    poll.add(async () => {
      if (!this.bodyEl.isConnected) return;
      const [n, e] = await Promise.all([api.serviceLog().catch(() => null), api.events(20000).catch(() => null)]);
      if (e) this.log.take(e);
      if (n) this.log.system = n.log;
      if (n) this.health.paintLive(n, e?.events ?? this.health.events);
      if (this.tab === 'log' && (n || e)) this.log.paint();
    }, 10);
    return E('div', {}, [
      E('div', { class: 'dl-pagehead' }, [
        E('div', { class: 'dl-stack' }, [E('h2', { class: 'dl-h1' }, 'Diagnostics'), this.subEl]),
        this.actionsEl,
      ]),
      this.segEl,
      this.bodyEl,
    ]);
  }

  show(tab: Tab) {
    this.tab = tab;
    const url = new URL(location.href);
    if (tab === 'log') url.searchParams.set('tab', 'log');
    else url.searchParams.delete('tab');
    history.replaceState(null, '', url);
    dom.content(
      this.segEl,
      TABS.map(([k, t]) =>
        E(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: k === tab ? 'on' : '',
            'aria-selected': k === tab ? 'true' : 'false',
            click: () => k !== this.tab && this.show(k),
          },
          t,
        ),
      ),
    );
    // Both tabs stay alive; only the visible one is in the page.
    this.bodyEl.replaceChildren(tab === 'log' ? this.log.el : this.health.el);
    this.subEl.textContent =
      tab === 'log' ? this.log.sub : 'Everything Dawnline depends on, checked live. The watchdog repairs what it can on its own.';
    dom.content(this.actionsEl, tab === 'log' ? this.log.actions() : '');
    if (tab === 'log') this.log.paint();
    else if (!this.health.checks) void this.health.run();
  }
}
