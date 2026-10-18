// Person page: Access & limits — what they reach, then the tiles (devices,
// circle, end date, data, hours). Every choice applies at once.

import type { Person } from '../../../shared/types';
import { E } from '../../e';
import { notify } from '../../ui/toast';
import { seg } from '../../ui/controls';
import { attachTip } from '../../ui/tooltip';
import { icon } from '../../../shared/icons';
import { ACCESS_LABEL, bytes, date, daysLeft, endsSoon, shiftDay } from '../../../shared/format';
import { resetUsageDialog } from '../../logs';
import { homeAccess } from '../../access';
import { endSettings } from './dialogs';
import { circleTile, devTile, dnsPicker, netsPicker, servicesPicker } from './pickers';
import type { PersonPage } from './index';

const ACCESS_TEXT: Record<Person['access'], string> = {
  internet: 'Browse the internet through your router. No access to devices at home, and home cannot reach theirs.',
  lan: 'Reach devices at home, and home reaches theirs. Internet stays on their own connection.',
  both: 'Home devices and the internet, all through your router. Home reaches their devices too.',
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function endTile(page: PersonPage): HTMLElement {
  const p = page.p;
  const today = page.today;
  const left = daysLeft(p.expires, today);
  const dateInput = E('input', {
    type: 'date',
    class: 'dl-date-hidden',
    value: p.expires,
    tabindex: '-1',
    'aria-hidden': 'true',
  }) as HTMLInputElement;
  dateInput.addEventListener(
    'change',
    () => dateInput.value && page.patch({ expires: dateInput.value }, `Access until ${date(dateInput.value)}`),
  );
  // Extend from the current end, or from today when there is none or it has passed.
  const extend = (step: 'week' | 'month' | 'year', n: number) => {
    const next = shiftDay(p.expires && (left ?? -1) >= 0 ? p.expires : '', step, n, today);
    void page.patch({ expires: next }, `Access until ${date(next)}`);
  };
  const ext = (
    [
      ['week', 1, '+1 week'],
      ['month', 1, '+1 month'],
      ['month', 3, '+3 months'],
      ['year', 1, '+1 year'],
    ] as const
  ).map(([step, n, label]) => E('button', { type: 'button', class: 'dl-chipbtn', click: () => extend(step, n) }, label));
  // The native date input stays hidden behind the chip and only opens its picker. It takes the
  // focus first, so the page's background refresh leaves this tile (and the open picker) alone.
  const pick = E('span', { class: 'dl-datechip' }, [
    E(
      'button',
      {
        type: 'button',
        class: 'dl-chipbtn',
        click: () => {
          dateInput.focus({ preventScroll: true });
          try {
            dateInput.showPicker();
          } catch {
            /* focused is the best this browser offers */
          }
        },
      },
      [icon('calendar'), p.expires ? date(p.expires) : 'Date'],
    ),
    dateInput,
  ]);
  const action = { pause: 'pause access', notify: 'keep access', remove: 'remove their devices' }[p.expire_action];
  return E('div', { class: 'dl-tile2' }, [
    E('div', { class: 'dl-tile2-label' }, [
      E('span', {}, 'Access ends'),
      p.expires
        ? E(
            'span',
            { class: left != null && left < 0 ? 'dl-bad' : endsSoon(p, left) ? 'dl-warn' : 'dl-ok' },
            left != null && left < 0 ? 'ended' : `${left} day${left === 1 ? '' : 's'} left`,
          )
        : E('span', { class: 'dl-faint' }, 'no end date'),
    ]),
    E('div', { class: 'dl-chips-row' }, [
      ...ext,
      pick,
      p.expires
        ? E('button', { type: 'button', class: 'dl-chipbtn', click: () => page.patch({ expires: '' }, 'No end date') }, 'No end')
        : '',
    ]),
    E('div', { class: 'dl-tile2-foot' }, [
      E(
        'span',
        { class: 'dl-muted' },
        `When it ends: ${action}${p.expire_warn ? `, warn ${p.expire_warn} day${p.expire_warn === 1 ? '' : 's'} before` : ''}`,
      ),
      E(
        'a',
        {
          href: '#',
          click: (ev: Event) => {
            ev.preventDefault();
            endSettings(page);
          },
        },
        'Change',
      ),
    ]),
  ]);
}

function dataTile(page: PersonPage): HTMLElement {
  const p = page.p;
  const used = p.quota_used || p.month[0] + p.month[1];
  const pct = p.quota_limit ? Math.min(100, (p.quota_used / p.quota_limit) * 100) : 0;
  const bar = E('div', { class: `dl-meter${pct >= 100 ? ' bad' : pct >= 90 ? ' warn' : ''}` }, [
    E('i'),
    p.quota_limit ? E('span', { class: 'mark', title: 'Alert at 90%' }) : '',
  ]);
  (bar.firstChild as HTMLElement).style.width = `${pct}%`;
  if (p.quota_limit)
    attachTip(bar, () => [
      E('div', { class: 'dl-tip-title' }, `${pct.toFixed(1)}% used`),
      E(
        'div',
        { class: 'dl-muted' },
        `${bytes(p.quota_used)} of ${bytes(p.quota_limit)} · ${bytes(Math.max(0, p.quota_limit - p.quota_used))} left`,
      ),
      E('div', { class: 'dl-faint' }, 'Alert at 90%'),
    ]);
  const period = seg(
    [
      ['month', 'Monthly'],
      ['total', 'Total'],
    ],
    p.quota_period,
    { label: 'Data limit period', cls: 'sm', optimistic: false, onChange: (v) => page.patch({ quota_period: v }) },
  );
  const presets = [10, 50, 100].map((gb) =>
    E(
      'button',
      {
        type: 'button',
        class: `dl-chipbtn${p.quota_gb === gb ? ' on' : ''}`,
        click: () => page.patch({ quota_gb: String(gb) }, `Data limit ${gb} GB`),
      },
      `${gb} GB`,
    ),
  );
  presets.push(
    E(
      'button',
      { type: 'button', class: `dl-chipbtn${!p.quota_gb ? ' on' : ''}`, click: () => page.patch({ quota_gb: '' }, 'No data limit') },
      'Unlimited',
    ),
  );
  presets.push(
    E(
      'button',
      {
        type: 'button',
        class: 'dl-chipbtn',
        click: () => {
          const v = prompt('Data limit in GB', p.quota_gb ? String(p.quota_gb) : '');
          if (v != null && v.trim() !== '' && Number(v) > 0) void page.patch({ quota_gb: v.trim() }, `Data limit ${v.trim()} GB`);
        },
      },
      'Custom',
    ),
  );
  return E('div', { class: 'dl-tile2' }, [
    E('div', { class: 'dl-tile2-label' }, [E('span', {}, 'Data'), period]),
    E('div', { class: 'dl-tile2-row' }, [
      E('span', { class: 'dl-tile2-value' }, [
        bytes(used),
        p.quota_limit ? E('span', { class: 'dl-faint' }, ` of ${bytes(p.quota_limit)}`) : E('span', { class: 'dl-faint' }, ' · no limit'),
      ]),
      p.quota_period === 'month' ? E('span', { class: 'dl-sub' }, 'resets on the 1st') : '',
    ]),
    p.quota_limit ? bar : '',
    E('div', { class: 'dl-chips-row' }, presets),
    p.quota_gb && p.quota_period === 'month'
      ? E('div', { class: 'dl-tile2-foot' }, [
          E('span', { class: 'dl-muted' }, p.bonus_gb ? `Includes +${p.bonus_gb} GB extra this month` : 'Need a little more this month?'),
          E(
            'a',
            {
              href: '#',
              click: (ev: Event) => {
                ev.preventDefault();
                void page.patch({ bonus_gb: String((p.bonus_gb || 0) + 10) }, '+10 GB this month');
              },
            },
            '+10 GB this month',
          ),
        ])
      : '',
    E('div', { class: 'dl-tile2-foot' }, [
      E('span', { class: 'dl-muted' }, `${bytes(p.total[0] + p.total[1])} in total`),
      E(
        'button',
        {
          type: 'button',
          class: 'dl-linkbtn danger',
          click: () => resetUsageDialog('person', p.id, p.name, () => setTimeout(() => page.refresh(), 300)),
        },
        'Reset usage',
      ),
    ]),
  ]);
}

/**
 * Allowed hours. The times save when the focus leaves them (or on Enter), not
 * on every change: a half-typed time would otherwise be saved and the tile
 * repainted under the cursor. Both are checked first.
 */
function hoursTile(page: PersonPage): HTMLElement {
  const p = page.p;
  const hoursOn = !!p.hours;
  const [h1, h2] = (p.hours || '07:00-23:00').split('-');
  const from = E('input', { type: 'time', class: 'cbi-input-text', value: h1, 'aria-label': 'From' }) as HTMLInputElement;
  const to = E('input', { type: 'time', class: 'cbi-input-text', value: h2, 'aria-label': 'To' }) as HTMLInputElement;
  const times = E('div', { class: 'dl-tile2-row' }, [from, E('span', { class: 'dl-faint' }, 'to'), to]);
  const commit = () => {
    const v = `${from.value}-${to.value}`;
    if (v === p.hours) return;
    if (!TIME.test(from.value) || !TIME.test(to.value)) return notify('Enter both times, like 07:00 and 23:00.', 'warning');
    if (from.value === to.value) return notify('The start and the end must differ.', 'warning');
    void page.patch({ hours: v }, `Allowed ${from.value}–${to.value}`);
  };
  times.addEventListener('focusout', (ev: FocusEvent) => {
    if (!times.contains(ev.relatedTarget as Node | null)) commit();
  });
  for (const t of [from, to])
    t.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit();
      }
    });
  const sw = E(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': hoursOn ? 'true' : 'false',
      class: `dl-switch${hoursOn ? ' on' : ''}`,
      'aria-label': 'Limit hours',
      click: () => page.patch({ hours: hoursOn ? '' : '07:00-23:00' }, hoursOn ? 'Any time' : 'Allowed 07:00–23:00'),
    },
    E('i'),
  );
  return E('div', { class: 'dl-tile2' }, [
    E('div', { class: 'dl-tile2-row' }, [
      E('div', { class: 'dl-stack' }, [
        E('span', { class: 'dl-tile2-label' }, 'Allowed hours'),
        E('span', {}, hoursOn ? `${h1} – ${h2} (router time)` : 'Any time'),
      ]),
      sw,
    ]),
    hoursOn ? times : '',
  ]);
}

export function limitsPart(page: PersonPage): HTMLElement {
  const p = page.p;
  const access = seg(
    (['internet', 'lan', 'both'] as const).map((a) => [
      a,
      [icon(a === 'internet' ? 'globe' : a === 'lan' ? 'home' : 'shield'), a === 'internet' ? 'Internet' : a === 'lan' ? 'Home' : 'Both'],
    ]),
    p.access,
    { label: 'Access', cls: 'wide', optimistic: false, onChange: (a) => page.patch({ access: a }, `Access: ${ACCESS_LABEL[a]}`) },
  );
  // Heading above the card, like "Devices", so both columns line up (as on the portal).
  return E('section', { class: 'dl-devsec', 'aria-label': 'Access and limits' }, [
    E('div', { class: 'dl-panel-head' }, [E('h3', {}, 'Access & limits')]),
    E('div', { class: 'dl-panel' }, [
      E('div', { class: 'dl-stack gap8' }, [
        E('span', { class: 'dl-tile2-label' }, 'Can reach'),
        access,
        E('span', { class: 'dl-sub' }, ACCESS_TEXT[p.access]),
        p.access === 'lan' && page.st.services.length ? servicesPicker(page) : '',
        homeAccess(p) ? netsPicker(page) : '',
        p.access === 'lan' ? dnsPicker(page) : '',
      ]),
      E('div', { class: 'dl-tiles2' }, [devTile(page), circleTile(page), endTile(page), dataTile(page), hoursTile(page)]),
    ]),
  ]);
}
