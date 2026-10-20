// Settings → Updates: automatic checks and updates of the components (the
// Components tab runs them by hand).

import type { UpdatePolicy } from '../../api';
import { E } from '../../e';
import { button } from '../../ui/button';
import { chipToggle, input, isOn, seg, setChip, sw } from '../../ui/controls';
import { row } from '../../ui/layout';
import { notify } from '../../ui/toast';
import { timeHelp } from '../../netcheck';
import { fmt } from '../../../shared/i18n';
import { section, type SettingsHost } from './common';

/** The components automatic updates may install: id and chip label. */
const targetChoices = (): [string, string][] => [
  ['app', 'Dawnline'],
  ['amneziawg', 'AmneziaWG'],
  ['packages', _('System packages')],
];

export function updatesCard(host: SettingsHost): HTMLElement {
  const u = (host.d.effective as Record<string, any>).updates as UpdatePolicy;
  const check = sw(u.check, _('Check automatically'), (v) => show(v, isOn(auto)));
  const every = seg(
    [
      ['6h', _('Every 6 h')],
      ['12h', _('Every 12 h')],
      ['1d', _('Daily')],
      ['7d', _('Weekly')],
    ],
    u.interval,
    { label: _('How often'), cls: 'sm' },
  );
  const auto = sw(u.auto, _('Install automatically'), (v) => show(isOn(check), v));
  const at = input(u.time, {
    placeholder: '04:00',
    inputmode: 'numeric',
    class: 'cbi-input-text dl-w-port dl-mono',
    'aria-label': _('Time'),
  });
  const mode = seg(
    [
      ['scheduled', _('At a set time')],
      ['immediate', _('As soon as found')],
    ],
    u.mode,
    { label: _('When'), cls: 'sm', onChange: (v) => (at.hidden = v !== 'scheduled') },
  );
  at.hidden = u.mode !== 'scheduled';
  const chosen = new Set<string>(u.targets);
  const targets = E(
    'div',
    { class: 'dl-chips-row' },
    targetChoices().map(([k, t]) => {
      const b = chipToggle(t, chosen.has(k), () => {
        if (!chosen.delete(k)) chosen.add(k);
        setChip(b, chosen.has(k));
      });
      return b;
    }),
  );
  const keep = sw(u.keep, _('Keep the previous version'));
  const mirrors = sw(u.mirrors, _('GitHub mirrors'));
  const everyRow = row(_('How often'), every);
  const autoRows = [
    row(
      _('When'),
      E('div', { class: 'dl-hostport' }, [mode, at]),
      _('A set time keeps tunnel restarts out of the evening; the run happens within an hour of it.'),
    ),
    row(_('Components'), targets, _('AmneziaWG is off by default: a new kernel module restarts every tunnel.')),
  ];
  const show = (c: boolean, a: boolean) => {
    everyRow.hidden = !c;
    for (const r of autoRows) r.hidden = !a;
  };
  show(u.check, u.auto);
  return section(
    'updates',
    _('Updates'),
    [
      E(
        'span',
        { class: 'dl-muted' },
        _('How Dawnline keeps its components current. Every Dawnline update makes a backup of the settings first.'),
      ),
      row(
        _('Check automatically'),
        check,
        _('Looks for new versions in the background; Components shows what it found and the service log names it.'),
      ),
      everyRow,
      row(_('Install automatically'), auto, _('Downloads and installs new versions of the components below.')),
      ...autoRows,
      row(
        _('Keep the previous version'),
        keep,
        _('Saves the replaced Dawnline or AmneziaWG package on flash, so Roll back works without internet. Under 1 MB.'),
      ),
      row(_('GitHub mirrors'), mirrors, _('When GitHub is unreachable, download through mirrors. Checksums are still verified.')),
    ],
    [
      E('span', { class: 'dl-sub' }, _('Run a check or an update by hand in Components.')),
      button(
        _('Save'),
        () => {
          if (mode.dataset.value === 'scheduled') {
            const h = timeHelp(at.value);
            if (h.bad) {
              notify(fmt(_('Time: %s'), h.text), 'warning');
              return;
            }
          }
          return host.save(
            {
              update_check: isOn(check) ? '1' : '0',
              update_interval: every.dataset.value!,
              update_auto: isOn(auto) ? '1' : '0',
              update_mode: mode.dataset.value!,
              update_time: at.value.trim(),
              update_targets: [...chosen],
              update_keep: isOn(keep) ? '1' : '0',
              update_mirrors: isOn(mirrors) ? '1' : '0',
            },
            _('Saved'),
            'updates',
          );
        },
        'positive',
      ),
    ],
  );
}
