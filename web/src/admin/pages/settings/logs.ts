// Settings → Logs & history: retention, what is recorded, and the stored data.

import { E } from '../../e';
import { api } from '../../api';
import { button } from '../../ui/button';
import { attempt } from '../../ui/toast';
import { chipToggle, seg, setChip } from '../../ui/controls';
import { row } from '../../ui/layout';
import { icon } from '../../../shared/icons';
import { fmtDay, kb } from '../../../shared/format';
import { fmt, num, plural } from '../../../shared/i18n';
import { CATEGORIES, categoryHelp, categoryLabel, retentionText } from '../../events/model';
import { clearLogDialog, exportEvents, resetUsageDialog } from '../../logs';
import { section, type SettingsHost } from './common';

export function logsCard(host: SettingsHost): HTMLElement {
  const L = host.d.logs;
  const p = L.policy;
  const keep = seg(
    [
      ['7', plural(7, '%s day', '%s days')],
      ['30', plural(30, '%s day', '%s days')],
      ['90', plural(90, '%s day', '%s days')],
      ['365', plural(1, '%s year', '%s years')],
      ['0', _('No limit', 'retention')],
    ],
    String(p.keep_days),
    { label: _('Keep activity'), cls: 'sm' },
  );
  const size = seg(
    [
      ['500', num(500)],
      ['2000', num(2000)],
      ['5000', num(5000)],
      ['20000', num(20000)],
    ],
    String(p.max),
    { label: _('Maximum events'), cls: 'sm' },
  );
  const persist = seg(
    [
      ['10min', _('Every 10 min')],
      ['hourly', _('Hourly')],
      ['off', _('Memory only')],
    ],
    p.persist,
    { label: _('Save to flash'), cls: 'sm' },
  );
  const days = seg(
    [
      ['31', plural(1, '%s month', '%s months')],
      ['62', plural(2, '%s month', '%s months')],
      ['180', plural(6, '%s month', '%s months')],
      ['365', plural(1, '%s year', '%s years')],
      ['730', plural(2, '%s year', '%s years')],
    ],
    String(p.usage_days),
    { label: _('Daily traffic'), cls: 'sm' },
  );
  const months = seg(
    [
      ['12', plural(1, '%s year', '%s years')],
      ['24', plural(2, '%s year', '%s years')],
      ['60', plural(5, '%s year', '%s years')],
      ['120', plural(10, '%s year', '%s years')],
    ],
    String(p.usage_months),
    { label: _('Monthly traffic'), cls: 'sm' },
  );
  const chosen = new Set(p.categories);
  const cats = E(
    'div',
    { class: 'dl-chips-row' },
    CATEGORIES.map((c) => {
      const b = chipToggle(
        [categoryLabel(c), E('b', {}, num(L.by_category[c] ?? 0))],
        chosen.has(c),
        () => {
          if (!chosen.delete(c)) chosen.add(c);
          setChip(b, chosen.has(c));
        },
        { title: categoryHelp(c) },
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
  const exportBtn = (kind: 'csv' | 'json') =>
    button(
      kind.toUpperCase(),
      async () => {
        const [st, ev] = await Promise.all([api.status(1), api.events(20000)]);
        exportEvents(st, ev.events, kind);
      },
      'neutral',
      { title: fmt(_('Download the log as %s'), kind.toUpperCase()) },
    );

  return section(
    'logs',
    _('Logs & history'),
    [
      E('p', { class: 'dl-muted' }, retentionText(p)),
      row(_('Keep activity'), keep, _('Older events are removed automatically.')),
      row(_('Maximum size'), size, _('Newest events are kept when the log is full.')),
      row(_('Record'), cats, _('Switched-off categories are not logged from now on.')),
      row(
        _('Save to flash'),
        persist,
        _('The log lives in memory and is copied to flash. Memory only saves flash writes but is lost on reboot.'),
      ),
      row(_('Daily traffic'), days, _('Per-day history behind the charts.')),
      row(_('Monthly traffic'), months, _('Per-month totals; data limits use the current month.')),
      E('h4', { class: 'dl-setsub' }, _('Stored data')),
      E('div', { class: 'dl-list' }, [
        stored(
          'activity',
          _('Activity log'),
          L.events
            ? `${fmt(_('%s since %s'), plural(L.events, '%s event', '%s events'), since)} · ${
                p.persist === 'off'
                  ? fmt(_('%s in memory'), kb(L.log_ram))
                  : fmt(_('%s in memory, %s on flash'), kb(L.log_ram), kb(L.log_flash))
              }`
            : _('Empty'),
          [
            exportBtn('csv'),
            exportBtn('json'),
            button(
              _('Clear'),
              () => clearLogDialog(_('Clear activity'), _('Removes events from the log on the router.'), {}, () => host.reload('logs')),
              'negative',
            ),
          ],
        ),
        stored(
          'chart',
          _('Traffic history'),
          // usage_since is a router day (YYYY-MM-DD): shown as that day in any time zone.
          L.usage_days
            ? `${fmt(_('%s since %s'), plural(L.usage_days, '%s day', '%s days'), fmtDay(L.usage_since))} · ${fmt(_('%s on flash'), kb(L.usage_flash))}`
            : _('Empty'),
          [button(_('Reset'), () => resetUsageDialog('all', '', '', () => setTimeout(() => host.reload('logs'), 300)), 'negative')],
        ),
        stored(
          'pin',
          _('Location cache'),
          `${plural(host.d.geo_cached, '%s address', '%s addresses')} · ${fmt(_('%s on flash'), kb(L.geo_flash))}`,
          [
            button(
              _('Clear'),
              async () => {
                if (await attempt(() => api.geoClear(), _('Location cache cleared'))) await host.reload('logs');
              },
              'negative',
            ),
          ],
        ),
      ]),
    ],
    [
      E('span', { class: 'dl-sub' }, _('Clear one person or device from their own page.')),
      button(
        _('Save'),
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
            _('Saved'),
            'logs',
          ),
        'positive',
      ),
    ],
  );
}
