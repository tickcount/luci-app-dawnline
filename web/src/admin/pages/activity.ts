// Activity: the full event log, grouped by day, with filters, search,
// export and clearing.

import type { LogEvent, Status } from '../../shared/types';
import { E } from '../e';
import { api, type LogCategory, type LogsInfo } from '../api';
import { button, dropdown } from '../ui';
import { icon } from '../../shared/icons';
import { installPalette } from '../palette';
import { CATEGORIES, CATEGORY_LABEL, categoryOf, clearLogDialog, exportEvents } from '../logs';
import { eventRow, eventText } from './overview';

type Kind = 'all' | LogCategory;
type Loaded = [Status, Awaited<ReturnType<typeof api.events>>];

/** Rows painted at a time; "Show more" adds another page. */
const PAGE = 300;

function dayTitle(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function retentionText(p: LogsInfo['policy']): string {
  const age = p.keep_days > 0 ? `${p.keep_days} day${p.keep_days === 1 ? '' : 's'}` : 'no age limit';
  const where =
    p.persist === 'off'
      ? 'kept in memory only (lost on reboot)'
      : `saved to flash ${p.persist === '10min' ? 'every 10 minutes' : 'hourly'}`;
  return `Kept for ${age}, up to ${p.max.toLocaleString('en-GB')} events, ${where}.`;
}

export class ActivityPage {
  st!: Status;
  events: LogEvent[] = [];
  policy!: LogsInfo['policy'];
  kind: Kind = 'all';
  query = '';
  shown = PAGE;
  list = E('div', {});
  sub = E('span', { class: 'dl-muted' });
  tabs = E('div', { class: 'dl-seg', role: 'tablist' });

  async load(): Promise<Loaded> {
    return Promise.all([api.status(1), api.events(20000)]);
  }

  render([st, ev]: Loaded): HTMLElement {
    this.st = st;
    this.take(ev);
    installPalette(st);
    const search = E('input', {
      type: 'search',
      class: 'dl-search-input',
      placeholder: 'Search people, devices, IPs',
      input: (e: Event) => {
        this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
        this.shown = PAGE;
        this.paint();
      },
    });
    const exp = button([icon('download'), ' Export'], () =>
      dropdown(exp, [
        {
          label: 'CSV (spreadsheet)',
          icon: icon('download'),
          run: () => exportEvents(this.st, this.filtered().reverse(), 'csv', this.kind === 'all' ? '' : this.kind),
        },
        {
          label: 'JSON',
          icon: icon('download'),
          run: () => exportEvents(this.st, this.filtered().reverse(), 'json', this.kind === 'all' ? '' : this.kind),
        },
      ]),
    );
    const clear = button([icon('trash'), ' Clear'], () =>
      clearLogDialog(
        'Clear activity',
        'Removes events from the log on the router.',
        {},
        () => this.reload(),
        this.kind === 'all' ? undefined : this.kind,
      ),
    );
    this.paint();
    poll.add(async () => {
      const r = await api.events(20000).catch(() => null);
      if (r) {
        this.take(r);
        this.paint();
      }
    }, 15);
    return E('div', {}, [
      E('div', { class: 'dl-pagehead' }, [
        E('div', { class: 'dl-stack' }, [E('h2', { class: 'dl-h1' }, 'Activity'), this.sub]),
        E('div', { class: 'dl-row-actions' }, [exp, clear]),
      ]),
      E('div', { class: 'dl-toolbar' }, [
        this.tabs,
        E('span', { class: 'dl-spacer' }),
        E('label', { class: 'dl-search' }, [icon('search'), search]),
      ]),
      this.list,
    ]);
  }

  take(r: Awaited<ReturnType<typeof api.events>>) {
    this.events = r.events;
    this.policy = r.policy;
    const off = CATEGORIES.filter((c) => !r.policy.categories.includes(c));
    this.sub.textContent = `${retentionText(r.policy)}${off.length ? ` Not recorded: ${off.map((c) => CATEGORY_LABEL[c].toLowerCase()).join(', ')}.` : ''}`;
  }

  async reload() {
    const r = await api.events(20000).catch(() => null);
    if (r) {
      this.take(r);
      this.paint();
    }
  }

  /** Newest first, matching the current tab and search. */
  filtered(): LogEvent[] {
    return [...this.events].reverse().filter((e) => {
      if (this.kind !== 'all' && categoryOf(e.type) !== this.kind) return false;
      if (!this.query) return true;
      const text = eventText(this.st, e)
        .map((n) => n.textContent ?? '')
        .join(' ');
      return `${text} ${e.detail ?? ''} ${e.where ?? ''}`.toLowerCase().includes(this.query);
    });
  }

  paintTabs() {
    const count = (k: Kind) => (k === 'all' ? this.events.length : this.events.filter((e) => categoryOf(e.type) === k).length);
    dom.content(
      this.tabs,
      (['all', ...CATEGORIES] as Kind[]).map((k) =>
        E(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: k === this.kind ? 'on' : '',
            click: () => {
              this.kind = k;
              this.shown = PAGE;
              this.paint();
            },
          },
          [k === 'all' ? 'All' : CATEGORY_LABEL[k], E('b', {}, String(count(k)))],
        ),
      ),
    );
  }

  paint() {
    this.paintTabs();
    const evs = this.filtered();
    if (!evs.length) {
      dom.content(this.list, E('div', { class: 'dl-empty' }, [E('p', {}, this.events.length ? 'No events match.' : 'The log is empty.')]));
      return;
    }
    const groups: HTMLElement[] = [];
    let day = '';
    let panel: HTMLElement | null = null;
    for (const e of evs.slice(0, this.shown)) {
      const t = dayTitle(e.ts);
      if (t !== day) {
        day = t;
        panel = E('div', { class: 'dl-panel flush' }, E('div', { class: 'dl-panel-head pad' }, E('h3', {}, t)));
        groups.push(panel);
      }
      const row = eventRow(this.st, e);
      row.lastElementChild!.textContent = new Date(e.ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      panel!.appendChild(row);
    }
    if (evs.length > this.shown)
      groups.push(
        E(
          'div',
          { class: 'dl-more-row' },
          button(`Show ${Math.min(PAGE, evs.length - this.shown)} more of ${evs.length - this.shown}`, () => {
            this.shown += PAGE;
            this.paint();
          }),
        ),
      );
    dom.content(this.list, groups);
  }
}
