// Settings → Updates: automatic checks and updates of the components (the
// Components tab runs them by hand).

import type { UpdatePolicy } from '../../api';
import { E } from '../../e';
import { button } from '../../ui/button';
import { chipToggle, input, isOn, seg, setChip, sw } from '../../ui/controls';
import { row } from '../../ui/layout';
import { notify } from '../../ui/toast';
import { timeHelp } from '../../netcheck';
import { section, type SettingsHost } from './common';

const TARGET: [string, string][] = [
  ['app', 'Dawnline'],
  ['amneziawg', 'AmneziaWG'],
  ['packages', 'System packages'],
];

export function updatesCard(host: SettingsHost): HTMLElement {
  const u = (host.d.effective as Record<string, any>).updates as UpdatePolicy;
  const check = sw(u.check, 'Check automatically', (v) => show(v, isOn(auto)));
  const every = seg(
    [
      ['6h', 'Every 6 h'],
      ['12h', 'Every 12 h'],
      ['1d', 'Daily'],
      ['7d', 'Weekly'],
    ],
    u.interval,
    { label: 'How often', cls: 'sm' },
  );
  const auto = sw(u.auto, 'Install automatically', (v) => show(isOn(check), v));
  const at = input(u.time, {
    placeholder: '04:00',
    inputmode: 'numeric',
    class: 'cbi-input-text dl-w-port dl-mono',
    'aria-label': 'Time',
  });
  const mode = seg(
    [
      ['scheduled', 'At a set time'],
      ['immediate', 'As soon as found'],
    ],
    u.mode,
    { label: 'When', cls: 'sm', onChange: (v) => (at.hidden = v !== 'scheduled') },
  );
  at.hidden = u.mode !== 'scheduled';
  const chosen = new Set<string>(u.targets);
  const targets = E(
    'div',
    { class: 'dl-chips-row' },
    TARGET.map(([k, t]) => {
      const b = chipToggle(t, chosen.has(k), () => {
        if (!chosen.delete(k)) chosen.add(k);
        setChip(b, chosen.has(k));
      });
      return b;
    }),
  );
  const keep = sw(u.keep, 'Keep the previous version');
  const mirrors = sw(u.mirrors, 'GitHub mirrors');
  const everyRow = row('How often', every);
  const autoRows = [
    row(
      'When',
      E('div', { class: 'dl-hostport' }, [mode, at]),
      'A set time keeps tunnel restarts out of the evening; the run happens within an hour of it.',
    ),
    row('Components', targets, 'AmneziaWG is off by default: a new kernel module restarts every tunnel.'),
  ];
  const show = (c: boolean, a: boolean) => {
    everyRow.hidden = !c;
    for (const r of autoRows) r.hidden = !a;
  };
  show(u.check, u.auto);
  return section(
    'updates',
    'Updates',
    [
      E(
        'span',
        { class: 'dl-muted' },
        'How Dawnline keeps its components current. Every Dawnline update makes a backup of the settings first.',
      ),
      row(
        'Check automatically',
        check,
        'Looks for new versions in the background; Components shows what it found and the service log names it.',
      ),
      everyRow,
      row('Install automatically', auto, 'Downloads and installs new versions of the components below.'),
      ...autoRows,
      row(
        'Keep the previous version',
        keep,
        'Saves the replaced Dawnline or AmneziaWG package on flash, so Roll back works without internet. Under 1 MB.',
      ),
      row('GitHub mirrors', mirrors, 'When GitHub is unreachable, download through mirrors. Checksums are still verified.'),
    ],
    [
      E('span', { class: 'dl-sub' }, 'Run a check or an update by hand in Components.'),
      button(
        'Save',
        () => {
          if (mode.dataset.value === 'scheduled') {
            const h = timeHelp(at.value);
            if (h.bad) {
              notify(`Time: ${h.text}`, 'warning');
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
            'Saved',
            'updates',
          );
        },
        'positive',
      ),
    ],
  );
}
