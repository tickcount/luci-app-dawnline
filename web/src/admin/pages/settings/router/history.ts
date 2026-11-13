// Settings › History and storage: what Dawnline keeps and for how long, as
// measures with their limits. The log: how many events of how many and how
// far back of how far, each limit changed where it stands; which kinds are
// recorded, as chips; its download and clearing. The traffic history: days
// of days kept, the months as a value with a list, its reset. Where people
// connect from (city and operator by IP, its provider, the cache). How
// often the log goes to flash and what goes to the router's system log.
// Choices save at once.

import { api } from '../../../api';
import { h, type Kid } from '../../../../portal/dom';
import { closeSheet, openSheet } from '../../../../portal/ui/sheet';
import { fmtDay, kb } from '../../../../shared/format';
import { fmt, num, plural } from '../../../../shared/i18n';
import { ic } from '../../../ui/icons';
import { compList, compRow } from '../../../ui/comp-row';
import { switchRow } from '../../../ui/edit-rows';
import { openList } from '../../../ui/list-drop';
import { measure, valuePick } from '../../../ui/measure';
import { cap, card, note, section } from '../../../ui/section';
import { errorText, notify } from '../../../ui/toast';
import { say } from '../../../shell/toast';
import { CATEGORIES, categoryHelp, categoryLabel } from '../../../events/model';
import { exportEvents } from '../../../logs';
import { askView } from '../../../flows/ask';
import { storage, type Storage } from '../../../system/model';
import { clearLog } from '../../log/clear';
import type { RouterCtx } from './ctx';
import { put } from './save';

const days = (n: number) => plural(n, '%s day', '%s days');
const months = (n: number) => plural(n, '%s month', '%s months');
const years = (n: number) => plural(n, '%s year', '%s years');
const events = (n: number) => plural(n, '%s event', '%s events');

const button = (label: string, run: () => void, icon?: string): HTMLButtonElement =>
  h('button', { type: 'button', class: 'btn soft sm', onclick: run }, icon ? ic(icon) : null, h('span', {}, label)) as HTMLButtonElement;

/** A setting that takes one of a few values: its value where it stands (`pill`: as a pill), its choices in a list. */
function pickOf(
  y: RouterCtx,
  o: { label: string; key: string; on: string; labels: Record<string, string>; pill?: boolean; shown?: string },
): HTMLElement {
  return valuePick<string>({
    label: o.label,
    value: o.shown ?? o.labels[o.on] ?? o.on,
    on: o.on,
    pill: o.pill,
    write: y.write,
    options: Object.keys(o.labels).map((id) => ({ id, label: o.labels[id] })),
    pick: (v) => void put(y, { [o.key]: v }, fmt(_('%s: %s'), o.label, o.labels[v])),
  });
}

/** A setting as a row: its name, and its value as a pill with the list. */
const row = (label: string, control: Kid): HTMLElement => h('div', { class: 'editrow static st-hs-pick' }, h('span', {}, label), control);

/** The log: events of the most kept, days of the longest kept, the kinds recorded; downloaded and cleared from its head. */
function logCard(y: RouterCtx, m: Storage): HTMLElement {
  const L = y.set.logs;
  const p = L.policy;
  const dl = h(
    'button',
    { type: 'button', class: 'btn soft sm', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' },
    ic('download'),
    h('span', {}, _('Download')),
  );
  dl.addEventListener('click', () =>
    openList(
      dl,
      [
        { id: 'csv', label: 'CSV', sub: _('A spreadsheet'), icon: 'file' },
        { id: 'json', label: 'JSON', icon: 'code' },
      ],
      _('Download the log'),
      async (kind) => {
        try {
          const [st, ev] = await Promise.all([api.status(1), api.events(20000)]);
          exportEvents(st, ev.events, kind as 'csv' | 'json');
        } catch (e) {
          notify(errorText(e), 'error', 10000);
        }
      },
    ),
  );
  // what is recorded: a kind a tile with its own switch and how much of it the log holds now (three independent
  // yes / no, so three switches: chips with a ring or a fill said «picked», not «on»)
  const cats = h(
    'div',
    { class: 'st-rec', role: 'group', 'aria-label': _('Record') },
    ...CATEGORIES.map((id) => {
      const on = p.categories.includes(id);
      const body = h(
        'span',
        { class: 'sw-t' },
        h('b', {}, categoryLabel(id)),
        h('span', { class: 'sw-sub num' }, events(L.by_category[id] ?? 0)),
      );
      // a read-only login reads which kinds are recorded
      if (!y.write)
        return h(
          'div',
          { class: `swrow st-rec-t${on ? ' on' : ''}`, title: categoryHelp(id) },
          body,
          h('span', { class: 'st-rec-s' }, on ? _('On') : _('Off')),
        );
      return h(
        'button',
        {
          type: 'button',
          class: `swrow st-rec-t${on ? ' on' : ''}`,
          role: 'switch',
          'aria-checked': String(on),
          title: categoryHelp(id),
          onclick: () => void put(y, { log_category: on ? p.categories.filter((x) => x !== id) : [...p.categories, id] }),
        },
        body,
        h('span', { class: 'sw' }),
      );
    }),
  );
  return card(
    cap(_('Activity log'), dl, y.write ? button(_('Clear'), () => clearLog({}, 'all', () => void y.reload())) : null),
    h(
      'div',
      { class: 'kt-lm-pair' },
      measure({
        label: _('Events', 'measure'),
        used: num(L.events),
        of: pickOf(y, {
          label: _('At most'),
          key: 'log_max',
          on: String(p.max),
          labels: { '500': events(500), '2000': events(2000), '5000': events(5000), '20000': events(20000) },
          shown: num(p.max),
        }),
        part: m.events,
        says: fmt(_('%s of %s'), num(L.events), events(p.max)),
        sub: [
          L.events
            ? p.persist === 'off'
              ? fmt(_('%s in memory'), kb(L.log_ram))
              : fmt(_('%s in memory, %s on flash'), kb(L.log_ram), kb(L.log_flash))
            : '',
          _('Newest events are kept when the log is full.'),
        ]
          .filter(Boolean)
          .join(' · '),
      }),
      measure({
        label: _('Depth'),
        used: days(m.age),
        ofWord: _('limit', 'measure'),
        of: pickOf(y, {
          label: _('Keep the log'),
          key: 'log_keep_days',
          on: String(p.keep_days),
          labels: { '7': days(7), '30': days(30), '90': days(90), '365': years(1), '0': _('No limit', 'retention') },
        }),
        part: m.depth,
        says: fmt(_('%s of %s'), days(m.age), days(p.keep_days)),
        sub: L.oldest
          ? [fmt(_('since %s'), fmtDay(new Date(L.oldest * 1000))), p.keep_days > 0 ? _('older ones are removed on their own') : '']
              .filter(Boolean)
              .join(' · ')
          : _('Empty'),
      }),
    ),
    cap(_('Record')),
    cats,
    note(_('Switched-off categories are not logged from now on.')),
  );
}

/** The traffic history: days of days kept, the months, and its reset for everyone. */
function trafficCard(y: RouterCtx, m: Storage): HTMLElement {
  const L = y.set.logs;
  const p = L.policy;
  const reset = y.write
    ? button(_('Reset'), () =>
        openSheet(() =>
          askView({
            icon: 'chart',
            tone: 'red',
            title: _('Reset all traffic history?'),
            text: [_('Clears traffic history for everyone. Data limits start again from zero.')],
            action: _('Reset'),
            cls: 'red',
            run: async () => {
              await api.usageClear('all', '');
              closeSheet();
              say(_('Traffic history reset'));
              setTimeout(() => void y.reload(), 300);
            },
          }),
        ),
      )
    : null;
  return card(
    cap(_('Traffic history'), reset),
    measure({
      label: _('By day'),
      used: days(L.usage_days),
      ofWord: _('limit', 'measure'),
      of: pickOf(y, {
        label: _('Daily traffic'),
        key: 'usage_keep_days',
        on: String(p.usage_days),
        labels: { '31': months(1), '62': months(2), '180': months(6), '365': years(1), '730': years(2) },
      }),
      part: m.usage,
      says: fmt(_('%s of %s'), days(L.usage_days), days(p.usage_days)),
      // usage_since is a router day (YYYY-MM-DD): shown as that day in any time zone
      sub: [
        L.usage_since ? fmt(_('since %s'), fmtDay(L.usage_since)) : '',
        fmt(_('%s on flash'), kb(L.usage_flash)),
        _('Per-day history behind the charts.'),
      ]
        .filter(Boolean)
        .join(' · '),
    }),
    row(
      _('Monthly traffic'),
      pickOf(y, {
        label: _('Monthly traffic'),
        key: 'usage_keep_months',
        on: String(p.usage_months),
        labels: { '12': years(1), '24': years(2), '60': years(5), '120': years(10) },
        pill: true,
      }),
    ),
    note(_('Per-month totals; data limits use the current month.')),
  );
}

/** Where people connect from: the switch, the provider it asks, and what it has cached. */
function placesCard(y: RouterCtx): HTMLElement {
  const eff = y.set.effective as { geo_enabled?: boolean; geo_provider?: string };
  const provider = eff.geo_provider === 'ipapi.co' ? 'ipapi.co' : 'ipwho.is';
  const clear = y.write
    ? button(_('Clear'), async () => {
        try {
          await api.geoClear();
          say(_('Location cache cleared'));
          void y.reload();
        } catch (e) {
          notify(errorText(e), 'error', 10000);
        }
      })
    : null;
  return card(
    switchRow(
      {
        title: _('Where people connect from'),
        sub: fmt(_('City and operator by IP, through %s. Map tiles load in your browser from CARTO.'), provider),
        on: !!eff.geo_enabled,
        icon: 'pin',
        flip: (on) => put(y, { geo_enabled: on ? '1' : '0' }),
      },
      y.write,
    ),
    eff.geo_enabled
      ? row(
          _('Provider'),
          pickOf(y, {
            label: _('Provider'),
            key: 'geo_provider',
            on: provider,
            labels: { 'ipwho.is': 'ipwho.is', 'ipapi.co': 'ipapi.co' },
            pill: true,
          }),
        )
      : null,
    compList(
      compRow({
        icon: 'pin',
        title: _('Location cache'),
        cls: 'st-hs-cache',
        line: `${plural(y.set.geo_cached, '%s address', '%s addresses')} · ${fmt(_('%s on flash'), kb(y.set.logs.geo_flash))}`,
        acts: [clear],
      }),
    ),
    eff.geo_enabled
      ? note(_('The router sends each new client IP to the provider once and caches the city; the other one is the fallback.'))
      : null,
  );
}

/** How often the log goes to flash, and what Dawnline writes to the router's system log. */
function writingCard(y: RouterCtx): HTMLElement {
  const p = y.set.logs.policy;
  const level = String((y.set.effective as { log_level?: string }).log_level ?? 'info');
  return card(
    row(
      _('Save to flash'),
      pickOf(y, {
        label: _('Save to flash'),
        key: 'log_persist',
        on: p.persist,
        labels: { '10min': _('Every 10 min'), hourly: _('Hourly'), off: _('Memory only') },
        pill: true,
      }),
    ),
    note(_('The log lives in memory and is copied to flash. Memory only saves flash writes but is lost on reboot.')),
    row(
      _('System log'),
      pickOf(y, {
        label: _('System log'),
        key: 'log_level',
        on: level,
        labels: { error: _('Errors only'), warn: _('Warnings and errors'), info: _('Normal'), debug: _('Verbose (debug)') },
        pill: true,
      }),
    ),
    note(
      _(
        'What Dawnline writes to the router’s system log (logread -e dawnline). Verbose adds each step of a start and of applying settings.',
      ),
    ),
  );
}

export function historySection(y: RouterCtx): HTMLElement {
  const m = storage(y.set.logs, y.now());
  return section(
    {
      id: 'history',
      icon: 'storage',
      title: _('History and storage'),
      aside: h('span', { class: 'kt-sx-st' }, h('span', {}, fmt(_('%s on flash'), kb(m.flash)))),
    },
    logCard(y, m),
    trafficCard(y, m),
    placesCard(y),
    writingCard(y),
  );
}
