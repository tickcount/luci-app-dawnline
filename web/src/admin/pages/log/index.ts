// The Log: what happened, people's activity and the service log in one feed. The page's own section row on top;
// the head with the count, how long the log is kept and what it does not record, «Export» (what is shown now, as
// CSV or JSON) and, for a login that may write, ⋯ with clearing (clear.ts); the bar (filters.ts): the kinds with
// their counts, the search, and the filters as chips (a day, a person, a device, a server); then the days as
// groups of rows under heads that stay in sight (days.ts). Names in the rows lead to the person's and the
// device's panel in People.
//
// Every filter is in the address (events/scope.ts reads and writes it; log?person=, ?device=, ?kind=, ?day=,
// ?server=, ?q=) and a change replaces the history entry: Back leaves the Log. The whole log is read once and
// narrowed here, so a filter never asks the router again.
//
// Live: the revision fetches what is new (events after the newest shown) and the service log, with a slow
// fallback; a clear fetches everything again.

import type { LogEvent, Status } from '../../../shared/types';
import { share } from '../../../shared/live/share';
import { api, type LogsInfo, type ServiceLogEntry } from '../../api';
import { h } from '../../../portal/dom';
import { openMenu } from '../../../portal/ui/menu';
import { fmt, plural } from '../../../shared/i18n';
import { CATEGORIES, categoryLabel, retentionText } from '../../events/model';
import { sessions, type FeedItem } from '../../events/sessions';
import { routerDay } from '../../events/clock';
import { haystack, kindCounts, matchesKind, matchesQuery } from '../../events/find';
import { choices, inScope, logQueryParams, parseLogQuery, withFilters, type Clock, type LogQuery } from '../../events/scope';
import { exportEvents } from '../../logs';
import { createPoller, repaint } from '../../state/poller';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { openList } from '../../ui/list-drop';
import { fact, knob, pageHead, setFacts } from '../../ui/page-head';
import { publishScrollPad } from '../../ui/rail';
import { canWrite } from '../../shell/role';
import { deviceUrl, logUrl, personUrl } from '../../shell/routes';
import { navRow } from '../../shell/nav';
import { rowText, type FeedContext } from '../../widgets/feed';
import { dayGroups, moreRow, nothing } from './days';
import { logBar, type LogBar } from './filters';
import { clearLog } from './clear';

/** The newest events fetched (the router keeps up to its log_max, 2,000 by default). */
const LIMIT = 20000;
/** Rows drawn at a time; "Show more" adds another page. */
const PAGE = 300;
/** How long the search rests before the address follows it (ms). */
const TYPED = 300;

type Events = Awaited<ReturnType<typeof api.events>>;
export type LogData = [Status, Events, ServiceLogEntry[]];

export class LogPage {
  private q: LogQuery = parseLogQuery(location.search.replace(/^\?/, ''));
  private st!: Status;
  /** The router's clock minus the browser's (s): "today" stays the router's while the page is open past midnight. */
  private skew = 0;
  private events: LogEvent[] = [];
  private system: ServiceLogEntry[] = [];
  private policy!: LogsInfo['policy'];
  /** The feed's rows for what was read last (null: to be folded again). */
  private feed: FeedItem[] | null = null;
  /** The minute the list was last drawn in. */
  private minute = 0;
  private shown = PAGE;
  private open = new Set<string>();
  /** What each row says, for the search (said anew when the person filter changes: their name leaves the rows). */
  private said = new WeakMap<FeedItem, string>();
  private page = h('div', { class: 'page log' });
  private list = h('div', { class: 'feed lg-feed' });
  private head!: HTMLElement;
  private bar!: LogBar;
  private writing = 0;

  /** The page builds on the router's answer from its first line: it waits for it under its shape (shell/waiting.ts). */
  load(): Promise<LogData> {
    return Promise.all([api.status(1), api.events(LIMIT), api.serviceLog().then((s) => s.log)]);
  }

  render([st, ev, sys]: LogData): HTMLElement {
    this.st = st;
    this.skew = st.now - Date.now() / 1000;
    this.take(ev, sys, false);
    // a server the router no longer has filters nothing
    if (this.q.server && !st.servers.some((s) => s.id === this.q.server)) this.q = { ...this.q, server: '' };
    this.bar = logBar({
      page: this.page,
      q: this.q,
      st: () => this.st,
      kept: (what, id) => this.kept(what, id),
      set: (patch, typed) => this.set(patch, typed),
    });
    this.head = pageHead({ icon: glass('log', 'grey'), title: _('Log'), acts: [this.exportButton(), this.clearKnob()] });
    this.page.append(navRow(), this.head, this.bar.el, this.list);
    this.paint();
    publishScrollPad(this.page);
    createPoller({
      fetch: (live) => this.fetch(live),
      every: 30,
      live: true,
      active: () => this.list.isConnected,
      apply: (d, quiet) => {
        const was = [this.events, this.system, this.st, this.policy, this.minute];
        const st = d.st ? share(this.st, d.st) : this.st;
        // names the rows say come from it
        if (st !== this.st) this.feed = null;
        this.st = st;
        this.take(d.ev, d.sys, d.since > 0);
        this.minute = Math.floor(Date.now() / 60_000);
        // the same answer again, in the background: the list stands as it is (what it says of «now» moves with the minute)
        const now = [this.events, this.system, this.st, this.policy, this.minute];
        if (quiet && now.every((v, i) => v === was[i])) return;
        this.paint({ quiet });
      },
    });
    return this.page;
  }

  /* ---------- the head ---------- */

  /** «Export»: what is shown now, in one of two forms. */
  private exportButton(): HTMLElement {
    const b = h(
      'button',
      { type: 'button', class: 'btn soft sm lg-exp', 'aria-haspopup': 'menu', title: _('Download what is shown now') },
      ic('download'),
      h('span', {}, _('Export')),
    );
    b.addEventListener('click', () =>
      openList(
        b,
        [
          { id: 'csv', label: 'CSV', sub: _('A spreadsheet'), icon: 'file' },
          { id: 'json', label: 'JSON', sub: _('For a script'), icon: 'code' },
        ],
        _('Export the log'),
        (f) => this.export(f as 'csv' | 'json'),
        { role: 'menu' },
      ),
    );
    return b;
  }

  /** ⋯: clearing, for a login that may. */
  private clearKnob(): HTMLElement | null {
    if (!canWrite()) return null;
    const more = knob('more', _('Clear the log'));
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () =>
      openMenu(
        more,
        [
          {
            label: _('Clear the log'),
            icon: 'trash',
            tone: 'bad',
            run: () =>
              clearLog({ person: this.q.person || undefined, device: this.q.device || undefined }, this.q.kind, () => void this.reload()),
          },
        ],
        _('Log'),
      ),
    );
    return more;
  }

  /** The head's facts: how many entries, how long they are kept, what is not recorded, a read-only login. */
  private paintFacts(all: number) {
    const p = this.policy;
    const off = CATEGORIES.filter((c) => !p.categories.includes(c));
    setFacts(this.head, [
      fact(plural(all, '%s entry', '%s entries')),
      fact(p.keep_days > 0 ? fmt(_('kept %s'), plural(p.keep_days, '%s day', '%s days')) : _('kept with no age limit'), {
        title: retentionText(p),
      }),
      off.length
        ? fact(fmt(_('not recorded: %s'), off.map((c) => categoryLabel(c).toLocaleLowerCase()).join(', ')), { cls: 'warn-t' })
        : null,
      canWrite() ? null : fact([ic('eye'), _('View only')]),
    ]);
  }

  /* ---------- what the router said ---------- */

  /**
   * New rows: on the live revision, events after the newest shown (a second back, de-duplicated: two in one
   * second), with the status again when one names someone this page does not know yet; else everything.
   */
  private async fetch(live: boolean) {
    const newest = this.events.length ? this.events[this.events.length - 1].ts : 0;
    const since = live && newest ? newest - 1 : 0;
    const [ev, sys] = await Promise.all([api.events(LIMIT, undefined, since || undefined), api.serviceLog().then((s) => s.log)]);
    const known = new Set(this.st.people.flatMap((p) => [p.id, ...p.devices.map((d) => d.id)]));
    const stranger = ev.events.some((e) => (e.person && !known.has(e.person)) || (e.device && !known.has(e.device)));
    return { ev, sys, since, st: stranger ? await api.status(1).catch(() => null) : null };
  }

  /** Take an answer: `add`: events after the newest (merged), else all of them. */
  private take(r: Events, sys: ServiceLogEntry[], add: boolean) {
    // each answer laid over the last (shared/live/share.ts): what did not change is the object it was, so
    // «nothing new» is seen as that
    const before = [this.events, this.system];
    if (add) {
      const key = (e: LogEvent) => `${e.ts}|${e.type}|${e.device ?? ''}|${e.person ?? ''}|${e.detail ?? ''}`;
      const have = new Set(this.events.slice(-50).map(key));
      const fresh = r.events.filter((e) => !have.has(key(e)));
      if (fresh.length) this.events = [...this.events, ...fresh].slice(-LIMIT);
    } else this.events = share(this.events, r.events);
    this.system = share(this.system, sys);
    this.policy = share(this.policy, r.policy);
    if (this.events !== before[0] || this.system !== before[1]) this.feed = null;
  }

  /** Everything again (after a clear). */
  private async reload() {
    const d = await this.fetch(false).catch(() => null);
    if (!d) return;
    if (d.st) this.st = d.st;
    this.take(d.ev, d.sys, false);
    this.paint();
  }

  /** The name the log kept of someone or something removed since (the newest entry's). */
  private kept(what: 'person' | 'device', id: string): string | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (what === 'person' ? e.person === id && e.pname : e.device === id && e.dname) return what === 'person' ? e.pname : e.dname;
    }
    return undefined;
  }

  /* ---------- the filters ---------- */

  /** A filter changed: the address follows (the same history entry), the rows are drawn again from the top. */
  private set(patch: Partial<LogQuery>, typed = false) {
    const own = this.q.person;
    this.q = withFilters(this.q, patch, this.st.people);
    if (this.q.person !== own) this.said = new WeakMap();
    clearTimeout(this.writing);
    const write = () => {
      if (this.page.isConnected) history.replaceState(history.state, '', logUrl(logQueryParams(this.q)));
    };
    // typing: the address follows once it rests (a browser refuses an address rewritten a hundred times in a row)
    if (typed) this.writing = window.setTimeout(write, TYPED);
    else write();
    this.shown = PAGE;
    this.paint({ still: typed });
  }

  private clock(): Clock {
    return { now: Date.now() / 1000 + this.skew, tz: this.st.tz };
  }

  private context(): FeedContext {
    return {
      st: this.st,
      tz: this.st.tz,
      own: this.q.person || undefined,
      links: { person: (id) => personUrl(id), device: (_p, d) => deviceUrl(d) },
      open: this.open,
      toggled: () => this.paint(),
    };
  }

  /** Every row of the log, newest first. */
  private items(): FeedItem[] {
    if (!this.feed) {
      const online = new Set(this.st.people.flatMap((p) => p.devices.filter((d) => d.online).map((d) => d.id)));
      this.feed = sessions(this.events, this.system, (d) => online.has(d));
    }
    return this.feed;
  }

  /** The rows that show: of the scope (who, where, when), of the kind picked, with the words searched. */
  private matching(scoped: FeedItem[]): FeedItem[] {
    const { kind, q } = this.q;
    const c = this.context();
    const said = (x: FeedItem) => {
      let s = this.said.get(x);
      if (s == null) this.said.set(x, (s = rowText(c, x)));
      return s;
    };
    return scoped.filter((x) => matchesKind(x, kind) && (!q || matchesQuery(haystack(x, this.st, said(x)), q)));
  }

  /**
   * Draw the bar and the rows that match. `quiet`: the router's news, which leaves a list that holds the focus
   * alone; `still`: a search being typed, the rows follow at once.
   */
  private paint(o: { quiet?: boolean; still?: boolean } = {}) {
    const all = this.items();
    const clock = this.clock();
    const scoped = all.filter(inScope(this.q, this.st, clock));
    const items = this.matching(scoped);
    this.paintFacts(all.length);
    this.bar.counts(kindCounts(scoped));
    this.bar.paint(this.q, { choices: choices(all, this.q, this.st, clock), shown: items.length, of: all.length }, o.quiet);
    const rest = items.length - this.shown;
    const more = () => {
      this.shown += PAGE;
      this.paint();
    };
    const content = items.length
      ? [
          ...dayGroups(this.context(), items.slice(0, this.shown), routerDay(clock.now, clock.tz)),
          // no «Show more» when all of them show (a null would be put in as the word «null»)
          ...(rest > 0 ? [moreRow(rest, PAGE, more)] : []),
        ]
      : nothing({ any: all.length > 0, text: this.q.q, reset: () => this.bar.reset() });
    // rows that stay glide to their places, new ones blur in, those filtered away fade where they stood
    repaint(this.list, content, o.quiet, o.still);
  }

  /** Download what shows now: the events behind the rows (a session with its disconnect) and the service lines. */
  private export(format: 'csv' | 'json') {
    const q = this.q;
    const items = this.matching(this.items().filter(inScope(q, this.st, this.clock())));
    exportEvents(
      this.st,
      items.flatMap((x) => (x.ev ? [x.ev, ...(x.end ? [x.end] : [])] : [])),
      format,
      [q.device || q.person, q.kind === 'all' ? '' : q.kind, q.day].filter(Boolean).join('-'),
      items.flatMap((x) => (x.sys ? [x.sys] : [])),
    );
  }
}
