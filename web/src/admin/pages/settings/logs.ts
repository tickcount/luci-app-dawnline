// Settings → Logs & history: retention, what is recorded, and the stored data.

import { E } from '../../e';
import { api } from '../../api';
import { button } from '../../ui/button';
import { attempt } from '../../ui/toast';
import { chipToggle, seg, setChip } from '../../ui/controls';
import { row } from '../../ui/layout';
import { icon } from '../../../shared/icons';
import { fmtDay, kb, plural } from '../../../shared/format';
import { CATEGORIES, CATEGORY_HELP, CATEGORY_LABEL, retentionText } from '../../events/model';
import { clearLogDialog, exportEvents, resetUsageDialog } from '../../logs';
import { section, type SettingsHost } from './common';

export function logsCard(host: SettingsHost): HTMLElement {
  const L = host.d.logs;
  const p = L.policy;
  const keep = seg(
    [
      ['7', '7 days'],
      ['30', '30 days'],
      ['90', '90 days'],
      ['365', '1 year'],
      ['0', 'No limit'],
    ],
    String(p.keep_days),
    { label: 'Keep activity', cls: 'sm' },
  );
  const size = seg(
    [
      ['500', '500'],
      ['2000', '2,000'],
      ['5000', '5,000'],
      ['20000', '20,000'],
    ],
    String(p.max),
    { label: 'Maximum events', cls: 'sm' },
  );
  const persist = seg(
    [
      ['10min', 'Every 10 min'],
      ['hourly', 'Hourly'],
      ['off', 'Memory only'],
    ],
    p.persist,
    { label: 'Save to flash', cls: 'sm' },
  );
  const days = seg(
    [
      ['31', '1 month'],
      ['62', '2 months'],
      ['180', '6 months'],
      ['365', '1 year'],
      ['730', '2 years'],
    ],
    String(p.usage_days),
    { label: 'Daily traffic', cls: 'sm' },
  );
  const months = seg(
    [
      ['12', '1 year'],
      ['24', '2 years'],
      ['60', '5 years'],
      ['120', '10 years'],
    ],
    String(p.usage_months),
    { label: 'Monthly traffic', cls: 'sm' },
  );
  const chosen = new Set(p.categories);
  const cats = E(
    'div',
    { class: 'dl-chips-row' },
    CATEGORIES.map((c) => {
      const b = chipToggle(
        [CATEGORY_LABEL[c], E('b', {}, String(L.by_category[c] ?? 0))],
        chosen.has(c),
        () => {
          if (!chosen.delete(c)) chosen.add(c);
          setChip(b, chosen.has(c));
        },
        { title: CATEGORY_HELP[c] },
      );
      return b;
    }),
  );

  const since = L.oldest ? fmtDay(new Date(L.oldest * 1000)) : '';
  const stored = (ic: string, title: string, detail: string, actions: Node[]) =>
    E('div', { class: 'dl-row' }, [
      icon(ic),
      E('span', { class: 'dl-row-main dl-stack' }, [E('b', {}, title), E('span', { class: 'dl-sub' }, detail)]),
      ...actions,
    ]);
  const exportBtn = (fmt: 'csv' | 'json') =>
    button(
      fmt.toUpperCase(),
      async () => {
        const [st, ev] = await Promise.all([api.status(1), api.events(20000)]);
        exportEvents(st, ev.events, fmt);
      },
      'neutral',
      { title: `Download the log as ${fmt.toUpperCase()}` },
    );

  return section(
    'logs',
    'Logs & history',
    [
      E('p', { class: 'dl-muted' }, retentionText(p)),
      row('Keep activity', keep, 'Older events are removed automatically.'),
      row('Maximum size', size, 'Newest events are kept when the log is full.'),
      row('Record', cats, 'Switched-off categories are not logged from now on.'),
      row(
        'Save to flash',
        persist,
        'The log lives in memory and is copied to flash. Memory only saves flash writes but is lost on reboot.',
      ),
      row('Daily traffic', days, 'Per-day history behind the charts.'),
      row('Monthly traffic', months, 'Per-month totals; data limits use the current month.'),
      E('h4', { class: 'dl-setsub' }, 'Stored data'),
      E('div', { class: 'dl-list' }, [
        stored(
          'activity',
          'Activity log',
          L.events
            ? `${plural(L.events, 'event')} since ${since} · ${kb(L.log_ram)} in memory${p.persist === 'off' ? '' : `, ${kb(L.log_flash)} on flash`}`
            : 'Empty',
          [
            exportBtn('csv'),
            exportBtn('json'),
            button(
              'Clear',
              () => clearLogDialog('Clear activity', 'Removes events from the log on the router.', {}, () => host.reload('logs')),
              'negative',
            ),
          ],
        ),
        stored(
          'chart',
          'Traffic history',
          // usage_since is a router day (YYYY-MM-DD): shown as that day in any time zone.
          L.usage_days ? `${plural(L.usage_days, 'day')} since ${fmtDay(L.usage_since)} · ${kb(L.usage_flash)} on flash` : 'Empty',
          [button('Reset', () => resetUsageDialog('all', '', '', () => setTimeout(() => host.reload('logs'), 300)), 'negative')],
        ),
        stored('pin', 'Location cache', `${plural(host.d.geo_cached, 'address', 'addresses')} · ${kb(L.geo_flash)} on flash`, [
          button(
            'Clear',
            async () => {
              if (await attempt(() => api.geoClear(), 'Location cache cleared')) await host.reload('logs');
            },
            'negative',
          ),
        ]),
      ]),
    ],
    [
      E('span', { class: 'dl-sub' }, 'Clear one person or device from their own page.'),
      button(
        'Save',
        () =>
          host.save(
            {
              log_keep_days: keep.dataset.value!,
              log_max: size.dataset.value!,
              log_persist: persist.dataset.value!,
              usage_keep_days: days.dataset.value!,
              usage_keep_months: months.dataset.value!,
              log_category: [...chosen],
            },
            'Saved',
            'logs',
          ),
        'positive',
      ),
    ],
  );
}
