// The Log's bar (ui/filter-bar.ts): the kinds of entries as a track with each kind's count; under it the search
// (text, a person, an address; «/» reaches it) and the filters as chips: a day in one press (Today, Yesterday,
// 7 days), then a person, a device and, with more than one, a server, each picked from a list that says how many
// entries the choice would leave (ui/list-drop.ts). An active chip names its value and opens its list again; its ×
// takes it off, «Reset» takes off everything, and the count says «4 of 63». The bar holds nothing itself: the page
// keeps what is asked (events/scope.ts, in the address) and draws the bar again when it changes.

import type { Status } from '../../../shared/types';
import { fmt, num, plural } from '../../../shared/i18n';
import { kindLabel as deviceKind } from '../../../shared/format';
import { categoryLabel } from '../../events/model';
import { KINDS, type LogKind } from '../../events/find';
import { DAYS, WHOLE, narrowed, type Choices, type LogDay, type LogQuery } from '../../events/scope';
import { focusInside } from '../../state/poller';
import { filterBar, filterChip, searchField } from '../../ui/filter-bar';
import { openList, type ListItem } from '../../ui/list-drop';
import { tabs } from '../../ui/tabs';

export const KIND_ICON: Record<LogKind, string> = {
  all: 'log',
  connections: 'plug',
  people: 'people',
  system: 'sunrise',
  problems: 'alert',
};

export const kindLabel = (k: LogKind): string => (k === 'all' ? _('All') : k === 'system' ? _('System') : categoryLabel(k));

const dayLabel = (d: LogDay): string => ({ today: _('Today'), yesterday: _('Yesterday'), '7d': _('7 days') })[d];

/** A device's line icon by its kind (a phone for the rest). */
const kindIcon = (k: string | undefined): string => (k === 'computer' || k === 'tablet' || k === 'router' ? k : 'phone');

export interface LogBar {
  el: HTMLElement;
  /** The counts beside each kind. */
  counts(n: Record<LogKind, number>): void;
  /**
   * The chips for what is asked now and the count «4 of 63». A quiet repaint (the router's news) leaves chips
   * that hold the focus or an open list as they are.
   */
  paint(q: LogQuery, v: { choices: Choices; shown: number; of: number }, quiet?: boolean): void;
  /** Everything off: the search emptied, the track back on «All», the page told once. */
  reset(): void;
}

interface BarHost {
  page: HTMLElement;
  /** What the address asked for. */
  q: LogQuery;
  st(): Pick<Status, 'people' | 'servers'>;
  /** The name the log kept of a person or a device the router no longer has. */
  kept(what: 'person' | 'device', id: string): string | undefined;
  /** Filters changed (`typed`: by the search, a key at a time). */
  set(patch: Partial<LogQuery>, typed?: boolean): void;
}

/** A chip that picks one of a list: offered by its name, active with its value; its × takes the filter off. */
function pickChip(o: {
  key: string;
  title: string;
  /** The chip's words while it is on («Person: Lena»). */
  value: string | null;
  items: () => ListItem[];
  pick: (id: string) => void;
  off: () => void;
}): HTMLElement {
  const el = filterChip({
    label: o.value ?? o.title,
    on: o.value != null,
    menu: 'list',
    cls: 'lg-pick',
    press: (from) => openList(from, o.items(), o.title, o.pick),
    off: o.off,
  });
  el.dataset.f = o.key;
  return el;
}

function chips(q: LogQuery, c: Choices, o: BarHost): HTMLElement[] {
  const st = o.st();
  const entries = (n: number) => plural(n, '%s entry', '%s entries');
  const owned = st.people.flatMap((p) => p.devices.map((d) => ({ d, p })));
  const personName = (id: string) => st.people.find((p) => p.id === id)?.name ?? o.kept('person', id) ?? _('Removed person');
  const deviceName = (id: string) => owned.find((x) => x.d.id === id)?.d.name ?? o.kept('device', id) ?? _('Removed device');
  const server = st.servers.find((s) => s.id === q.server);
  const kids: (HTMLElement | null)[] = DAYS.map((d) => {
    // a day is one of three, not one more filter: its chip is the word alone
    const el = filterChip({ label: dayLabel(d), on: q.day === d, cls: 'lg-daychip', press: () => o.set({ day: q.day === d ? '' : d }) });
    el.dataset.f = d;
    return el;
  });
  kids.push(
    c.people.length
      ? pickChip({
          key: 'person',
          title: _('Person'),
          value: q.person ? fmt(_('Person: %s'), personName(q.person)) : null,
          items: () =>
            c.people.map((x) => ({ id: x.id, label: personName(x.id), sub: entries(x.n), icon: 'person', on: x.id === q.person })),
          pick: (id) => o.set({ person: id }),
          off: () => o.set({ person: '' }),
        })
      : null,
    c.devices.length
      ? pickChip({
          key: 'device',
          title: _('Device'),
          value: q.device ? fmt(_('Device: %s'), deviceName(q.device)) : null,
          items: () =>
            c.devices.map((x) => {
              const own = owned.find((y) => y.d.id === x.id);
              return {
                id: x.id,
                label: deviceName(x.id),
                // whose it is, what it is, how many entries
                sub: [own?.p.name, own ? deviceKind(own.d.kind) : null, entries(x.n)].filter(Boolean).join(' · '),
                icon: kindIcon(own?.d.kind),
                on: x.id === q.device,
              };
            }),
          pick: (id) => o.set({ device: id }),
          off: () => o.set({ device: '' }),
        })
      : null,
    st.servers.length > 1 || server
      ? pickChip({
          key: 'server',
          title: _('Server'),
          value: server ? fmt(_('Server: %s'), server.name) : null,
          items: () =>
            c.servers.map((x) => {
              const s = st.servers.find((y) => y.id === x.id)!;
              return {
                id: s.id,
                label: s.name,
                sub: [s.enabled ? null : _('Turned off'), entries(x.n)].filter(Boolean).join(' · '),
                icon: 'terminal',
                on: s.id === q.server,
              };
            }),
          pick: (id) => o.set({ server: id }),
          off: () => o.set({ server: '' }),
        })
      : null,
  );
  return kids.filter((k): k is HTMLElement => !!k);
}

export function logBar(o: BarHost): LogBar {
  // «Reset» moves the track itself: the page then hears of everything at once, not of the kind first
  let silent = false;
  const track = tabs(
    KINDS.map((k) => ({ id: k, label: kindLabel(k), icon: KIND_ICON[k], sub: '' })),
    o.q.kind,
    (k) => {
      if (!silent) o.set({ kind: k });
    },
    { cls: 'icons log-kind', label: _('Which entries'), keep: 'log-kind' },
  );
  const search = searchField({
    placeholder: _('Text, person, IP'),
    label: _('Find in the log'),
    page: o.page,
    value: o.q.q,
    typed: (v) => o.set({ q: v.trim() }, true),
  });
  const bar = filterBar({ top: [track.el], lead: search.el });
  bar.el.classList.add('lg-bar');
  const row = bar.el.querySelector<HTMLElement>('.kt-chips')!;
  const reset = () => {
    search.clear();
    silent = true;
    // the track's own press: its pill glides back to «All»
    track.el.querySelector<HTMLElement>('.tab[data-id="all"]')?.click();
    silent = false;
    o.set(WHOLE);
  };
  return {
    el: bar.el,
    reset,
    counts: (n) => track.subs((k) => num(n[k])),
    paint(q, v, quiet = false) {
      bar.count(v.shown, v.of, v.shown === v.of);
      const held = focusInside(row);
      if (quiet && (held || row.querySelector('[aria-expanded="true"]'))) return;
      // the chip that was pressed from the keyboard keeps the focus when the row is drawn again
      const at = held ? (row.getRootNode() as Document | ShadowRoot).activeElement?.closest<HTMLElement>('[data-f]')?.dataset.f : null;
      // an empty log has nothing to filter
      bar.chips(v.of ? chips(q, v.choices, o) : [], narrowed(q) ? reset : null);
      if (at) row.querySelector<HTMLElement>(`[data-f="${at}"] .kt-fb`)?.focus({ preventScroll: true });
    },
  };
}
