// Diagnostics → Log: people's activity and the service log (tunnel and
// service starts, stops, watchdog repairs, errors) in one list, grouped by
// day, with filters, export and clearing.

import type { LogEvent, Status } from '../../shared/types';
import { E } from '../e';
import { api, type LogCategory, type LogsInfo, type ServiceLogEntry } from '../api';
import { button, dropdown } from '../ui';
import { icon } from '../../shared/icons';
import { CATEGORIES, CATEGORY_LABEL, SYSTEM_SOURCE, categoryOf, clearLogDialog, exportEvents } from '../logs';
import { eventRow } from './overview';

export type LogKind = 'all' | LogCategory | 'system';
type Events = Awaited<ReturnType<typeof api.events>>;
/** One line of the list: an activity event or a service log entry. */
export type LogItem = { ts: number; ev?: LogEvent; sys?: ServiceLogEntry };

/** Rows painted at a time; "Show more" adds another page. */
const PAGE = 300;
const KINDS: LogKind[] = ['all', 'connections', 'people', 'system', 'problems'];
/** Colour per service log level (tile, source and row): neutral unless something came up, was repaired or failed. */
// "down" is a tunnel that stopped without Dawnline asking (its own stops are "info").
const SYS_TONE: Record<ServiceLogEntry['level'], string> = { info: '', up: 'ok', down: 'warn', repair: 'warn', error: 'bad' };
const SYS_ICON: Record<ServiceLogEntry['src'], string> = { awg: 'tunnel', dawnline: 'sunrise', portal: 'globe' };

export function dayTitle(ts: number): string {
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

export const isProblem = (x: LogItem) =>
  x.sys ? ['error', 'repair', 'down'].includes(x.sys.level) : categoryOf(x.ev!.type) === 'problems';

/** A service log line: source, message, folded details; click to unfold. */
export function systemRow(e: ServiceLogEntry, open: boolean, toggle: () => void, time: string): HTMLElement {
  const admin = e.by === 'admin';
  const row = E(
    'div',
    {
      class: `dl-row dl-slog-row ${admin ? 'dl-ev-by-admin' : `dl-ev-by-system ${SYS_TONE[e.level] ?? ''}`}${e.detail ? ' has-detail' : ''}`,
    },
    [
      admin
        ? E('span', { class: 'dl-ev-tile', title: 'Done by you in LuCI' }, icon('admin'))
        : E('span', { class: 'dl-ev-tile sys', title: e.level }, icon(SYS_ICON[e.src] ?? 'zap')),
      E(
        'span',
        { class: 'dl-row-main' },
        admin
          ? [
              E('span', { class: 'dl-you' }, 'You'),
              E('span', { class: 'dl-muted' }, ` ${e.msg} `),
              e.kind ? E('span', { class: 'dl-ev-kind' }, `${e.kind} `) : '',
              e.who ? E('b', {}, e.who) : '',
              e.note ? E('span', { class: 'dl-muted' }, ` · ${e.note}`) : '',
              e.detail ? E('span', { class: `dl-slog-more${open ? ' open' : ''}` }, icon('chevron')) : '',
              e.detail && open ? E('pre', { class: 'dl-slog-detail' }, e.detail) : '',
            ]
          : [
              // Servers have names people chose: say it is a server. Services name themselves.
              e.src === 'awg' && e.who && e.who !== 'AmneziaWG' ? E('span', { class: 'dl-ev-kind' }, 'Server ') : '',
              E('b', { class: 'dl-sys-src', title: SYSTEM_SOURCE[e.src] ?? e.src }, e.who ?? SYSTEM_SOURCE[e.src] ?? e.src),
              ' ',
              E('span', { class: 'dl-muted' }, e.msg),
              e.detail ? E('span', { class: `dl-slog-more${open ? ' open' : ''}` }, icon('chevron')) : '',
              e.detail && open ? E('pre', { class: 'dl-slog-detail' }, e.detail) : '',
            ],
      ),
      E('span', { class: 'dl-faint dl-nowrap', title: new Date(e.ts * 1000).toLocaleString() }, time),
    ],
  );
  if (e.detail)
    row.addEventListener('click', (ev) => {
      if (!(ev.target as HTMLElement).closest('pre')) toggle();
    });
  return row;
}

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
        const row = eventRow(this.st, x.ev!);
        row.lastElementChild!.textContent = time;
        panel!.appendChild(row);
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
