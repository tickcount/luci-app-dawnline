// Diagnostics: Health (watchdog, checks, recent problems) and Log (activity
// and the service log in one list) as two tabs. ?tab=log opens the Log; the
// old Health and Activity addresses come here.

import type { Status } from '../../../shared/types';
import { E } from '../../e';
import { api, type ServiceLog } from '../../api';
import { createPoller } from '../../state/poller';
import { HealthTab } from './health';
import { LogTab } from './log';

type Tab = 'health' | 'log';
type Events = Awaited<ReturnType<typeof api.events>>;
type Loaded = [Status, Events, ServiceLog];

const TABS: Tab[] = ['health', 'log'];

const tabLabel = (t: Tab) => (t === 'log' ? _('Log') : _('Health'));

/** The whole log is large (up to 20,000 events): fetched only for the Log tab. A "since" cursor on the router would make it cheap. */
const LOG_LIMIT = 20000;

export class DiagnosticsPage {
  tab: Tab = new URLSearchParams(location.search).get('tab') === 'log' ? 'log' : 'health';
  health!: HealthTab;
  log!: LogTab;
  segEl = E('div', { class: 'dl-seg dl-srvsections dl-diag-tabs', role: 'tablist', 'aria-label': _('Diagnostics') });
  subEl = E('span', { class: 'dl-muted' });
  actionsEl = E('div', { class: 'dl-row-actions' });
  bodyEl = E('div', {});
  /** When the events were last fetched (ms); switching to the Log refreshes stale ones. */
  eventsAt = 0;

  load(): Promise<Loaded> {
    // The checks take a moment: Health shows first and runs them in the background (see show()).
    this.eventsAt = Date.now();
    return Promise.all([api.status(1), api.events(LOG_LIMIT), api.serviceLog()]);
  }

  render([st, ev, sl]: Loaded): HTMLElement {
    this.log = new LogTab(st, ev, sl.log);
    this.health = new HealthTab(st, sl, ev.events, () => {
      this.show('log');
      this.log.show('problems');
    });
    this.show(this.tab);
    // The service log every 10 s; the activity log only while the Log tab shows it.
    createPoller({
      fetch: async () => {
        const withEvents = this.tab === 'log';
        const [n, e] = await Promise.all([
          api.serviceLog().catch(() => null),
          withEvents ? api.events(LOG_LIMIT).catch(() => null) : Promise.resolve(null),
        ]);
        return n || e ? { n, e } : null;
      },
      every: 10,
      active: () => this.bodyEl.isConnected,
      apply: ({ n, e }) => this.take(n, e),
    });
    return E('div', {}, [
      E('div', { class: 'dl-pagehead' }, [
        E('div', { class: 'dl-stack' }, [E('h2', { class: 'dl-h1' }, _('Diagnostics')), this.subEl]),
        this.actionsEl,
      ]),
      this.segEl,
      this.bodyEl,
    ]);
  }

  take(n: ServiceLog | null, e: Events | null) {
    if (e) {
      this.log.take(e);
      this.eventsAt = Date.now();
    }
    if (n) this.log.system = n.log;
    if (n) this.health.paintLive(n, e?.events ?? this.health.events);
    if (this.tab === 'log') this.log.paint();
  }

  /**
   * Show a tab. The address stays as it is: changing it (even with
   * history.replaceState) makes Outline's router load the whole page again.
   */
  show(tab: Tab) {
    this.tab = tab;
    dom.content(
      this.segEl,
      TABS.map((k) =>
        E(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: k === tab ? 'on' : '',
            'aria-selected': k === tab ? 'true' : 'false',
            click: () => k !== this.tab && this.show(k),
          },
          tabLabel(k),
        ),
      ),
    );
    // Both tabs stay alive; only the visible one is in the page.
    this.bodyEl.replaceChildren(tab === 'log' ? this.log.el : this.health.el);
    this.subEl.textContent =
      tab === 'log' ? this.log.sub : _('Everything Dawnline depends on, checked live. The watchdog repairs what it can on its own.');
    dom.content(this.actionsEl, tab === 'log' ? this.log.actions() : '');
    if (tab === 'log') {
      this.log.paint();
      // Health doesn't poll the activity log: catch up when the Log opens.
      if (Date.now() - this.eventsAt > 10_000)
        void api
          .events(LOG_LIMIT)
          .then((e) => this.take(null, e))
          .catch(() => null);
    } else if (!this.health.checks) void this.health.run();
  }
}
