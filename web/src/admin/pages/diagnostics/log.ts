// Diagnostics → Log: people's activity and the service log (tunnel and
// service starts, stops, watchdog repairs, errors) in one list, grouped by
// day, with filters, export and clearing.

import type { LogEvent, Status } from '../../../shared/types';
import { E } from '../../e';
import { api, type LogCategory, type LogsInfo, type ServiceLogEntry } from '../../api';
import { button } from '../../ui/button';
import { dropdown } from '../../ui/menu';
import { icon } from '../../../shared/icons';
import { CATEGORIES, CATEGORY_LABEL, categoryOf, isProblem, retentionText, type LogItem } from '../../events/model';
import { dayTitle, eventRow, systemRow } from '../../events/render';
import { clearLogDialog, exportEvents } from '../../logs';

export type LogKind = 'all' | LogCategory | 'system';
type Events = Awaited<ReturnType<typeof api.events>>;

/** Rows painted at a time; "Show more" adds another page. */
const PAGE = 300;
const KINDS: LogKind[] = ['all', 'connections', 'people', 'system', 'problems'];

export class LogTab {
  st: Status;
  events: LogEvent[] = [];
  system: ServiceLogEntry[] = [];
  policy!: LogsInfo['policy'];
  kind: LogKind = 'all';
  shown = PAGE;
  open = new Set<string>();
  list = E('div', {});
  /** Retention, for the page subtitle. */
  sub = '';
  tabs = E('div', { class: 'dl-seg', role: 'tablist' });
  el: HTMLElement;

  constructor(st: Status, ev: Events, system: ServiceLogEntry[]) {
    this.st = st;
    this.take(ev);
    this.system = system;
    this.el = E('div', {}, [E('div', { class: 'dl-toolbar' }, [this.tabs]), this.list]);
    this.paint();
  }

  /** Export and Clear, for the page head. */
  actions(): HTMLElement[] {
    const suffix = () => (this.kind === 'all' ? '' : this.kind);
    const run = (format: 'csv' | 'json') => () => {
      const items = this.filtered().reverse();
      exportEvents(
        this.st,
        items.filter((x) => x.ev).map((x) => x.ev!),
        format,
        suffix(),
        items.filter((x) => x.sys).map((x) => x.sys!),
      );
    };
    const exp = button([icon('download'), ' Export'], () =>
      dropdown(exp, [
        { label: 'CSV (spreadsheet)', icon: icon('download'), run: run('csv') },
        { label: 'JSON', icon: icon('download'), run: run('json') },
      ]),
    );
    const clear = button([icon('trash'), ' Clear'], () =>
      clearLogDialog(
        'Clear the log',
        'Removes events from the log on the router.',
        {},
        () => this.reload(),
        this.kind === 'all' ? undefined : this.kind,
        true,
      ),
    );
    return [exp, clear];
  }

  take(r: Events) {
    this.events = r.events;
    this.policy = r.policy;
    const off = CATEGORIES.filter((c) => !r.policy.categories.includes(c));
    this.sub = `${retentionText(r.policy)}${off.length ? ` Not recorded: ${off.map((c) => CATEGORY_LABEL[c].toLowerCase()).join(', ')}.` : ''}`;
  }

  async reload() {
    const [r, sl] = await Promise.all([api.events(20000).catch(() => null), api.serviceLog().catch(() => null)]);
    if (r) this.take(r);
    if (sl) this.system = sl.log;
    this.paint();
  }

  items(): LogItem[] {
    return [...this.events.map((ev) => ({ ts: ev.ts, ev })), ...this.system.map((sys) => ({ ts: sys.ts, sys }))].sort(
      (a, b) => b.ts - a.ts,
    );
  }

  matches(x: LogItem, k: LogKind) {
    if (k === 'all') return true;
    if (k === 'problems') return isProblem(x);
    if (k === 'system') return !!x.sys;
    return !!x.ev && categoryOf(x.ev.type) === k;
  }

  /** Newest first, matching the current tab. */
  filtered(): LogItem[] {
    return this.items().filter((x) => this.matches(x, this.kind));
  }

  paintTabs(all: LogItem[]) {
    dom.content(
      this.tabs,
      KINDS.map((k) =>
        E(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: k === this.kind ? 'on' : '',
            'aria-selected': k === this.kind ? 'true' : 'false',
            click: () => this.show(k),
          },
          [
            k === 'all' ? 'All' : k === 'system' ? 'System' : CATEGORY_LABEL[k],
            E('b', {}, String(all.filter((x) => this.matches(x, k)).length)),
          ],
        ),
      ),
    );
  }

  show(k: LogKind) {
    this.kind = k;
    this.shown = PAGE;
    this.paint();
  }

  paint() {
    this.paintTabs(this.items());
    const items = this.filtered();
    if (!items.length) {
      dom.content(
        this.list,
        E('div', { class: 'dl-empty' }, [E('p', {}, this.events.length || this.system.length ? 'No events match.' : 'The log is empty.')]),
      );
      return;
    }
    const groups: HTMLElement[] = [];
    let day = '';
    let panel: HTMLElement | null = null;
    for (const x of items.slice(0, this.shown)) {
      const t = dayTitle(x.ts);
      if (t !== day) {
        day = t;
        panel = E('div', { class: 'dl-panel flush' }, E('div', { class: 'dl-panel-head pad' }, E('h3', {}, t)));
        groups.push(panel);
      }
      const time = new Date(x.ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      if (x.sys) {
        const key = `${x.sys.ts}|${x.sys.msg}`;
        panel!.appendChild(
          systemRow(
            x.sys,
            this.open.has(key),
            () => {
              if (!this.open.delete(key)) this.open.add(key);
              this.paint();
            },
            time,
          ),
        );
      } else {
        panel!.appendChild(eventRow(this.st, x.ev!, { time }));
      }
    }
    if (items.length > this.shown)
      groups.push(
        E(
          'div',
          { class: 'dl-more-row' },
          button(`Show ${Math.min(PAGE, items.length - this.shown)} more of ${items.length - this.shown}`, () => {
            this.shown += PAGE;
            this.paint();
          }),
        ),
      );
    dom.content(this.list, groups);
  }
}
