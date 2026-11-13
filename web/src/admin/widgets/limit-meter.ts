// A person's traffic as a measure with its limit: the last 30 days a day at a time (the portal's bars, a day read
// by pointer, tap or keys; not the calendar month), what is used of the limit, and the limit changed right there,
// on the end of the measure (the field in the value's own type, Return and Escape, a refusal in red with the
// shake); the 6 px meter (warn from 90 %, bad at the limit) and under it, as a usage page says it, when the limit
// starts again and how much of it is used («Resets in 12 d · 14 Dec» … «44 %»), then the pace (their sums are the
// Traffic card's). The limit's month is the person's own: it begins with their first traffic and ends a month
// later; the next begins only when they connect again, and says so until then. Counting by month or for the whole
// term is the head's segments (limitPeriod); +10 GB until the reset is offered from 80 %, and «Reset usage» starts
// the limit month over (asked first).

import type { Pair } from '../../shared/types';
import { h } from '../../portal/dom';
import { bars, readBars, upDown } from '../../portal/ui/bars';
import { setText } from '../../portal/ui/morph';
import { bytes, until } from '../../shared/format';
import { fill, fmt, num } from '../../shared/i18n';
import { paceOf, paceWords } from '../../shared/pace';
import { shake } from '../../shared/shake';
import { quotaHelp } from '../netcheck';
import { api } from '../api';
import { closeSheet, openSheet } from '../../portal/ui/sheet';
import { askView } from '../flows/ask';
import { say } from '../shell/toast';
import { tabs } from '../ui/tabs';
import { ic } from '../ui/icons';
import { meter } from '../ui/meter';
import { shortDay, share } from '../people/lines';
import type { PersonCtx } from '../people/ctx';
import { composing } from '../../shared/keys';

/** The chart's span: the last 30 days, today included. */
const SPAN_DAYS = 30;

/** When a monthly limit starts again, as a usage page says it; null: not a monthly limit, or none set. */
function resetLine(c: PersonCtx): string | null {
  const p = c.p;
  if (p.quota_period !== 'month' || !p.quota_limit) return null;
  // no limit month runs: the last one ended and they have not connected since (or never did)
  if (!p.quota_resets) return _('The month begins when they next connect');
  return `${fmt(_('Resets in %s'), until(p.quota_resets - c.now()))} · ${shortDay(p.quota_reset_day)}`;
}

/** The limit as a value that is edited where it stands. */
function limitValue(c: PersonCtx): HTMLElement {
  const p = c.p;
  const monthly = p.quota_period === 'month';
  const shown = p.quota_gb ? bytes(p.quota_limit) : _('no limit');
  if (!c.write) return h('b', { class: 'num kt-lim-v' }, shown);
  const btn = h(
    'button',
    { type: 'button', class: 'kt-lim-b', title: _('Change the limit'), 'aria-label': fmt(_('Limit: %s. Change'), shown) },
    h('b', { class: 'num' }, shown),
    ic('edit'),
  );
  const input = h('input', {
    class: 'kt-lim-in num',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    enterkeyhint: 'done',
    placeholder: _('no limit'),
    'aria-label': _('GB, or empty: no limit'),
  }) as HTMLInputElement;
  const bad = h('span', { class: 'kt-lim-bad', role: 'alert' });
  const box = h('span', { class: 'kt-lim-ed', hidden: true }, input, h('span', { class: 'kt-lim-u' }, _('GB')));
  const wrap = h('span', { class: 'kt-lim' }, btn, box, bad);
  let saving = false;
  const shut = () => {
    box.hidden = true;
    btn.hidden = false;
    bad.textContent = '';
  };
  const save = async () => {
    if (saving || box.hidden) return;
    const v = input.value.trim().replace(',', '.');
    if (v === (p.quota_gb ? String(p.quota_gb) : '')) return shut();
    const r = quotaHelp(v, monthly);
    if (r.bad) {
      bad.textContent = r.text;
      shake(input);
      return;
    }
    saving = true;
    wrap.classList.add('busy');
    const said = v && Number(v) > 0 ? fmt(monthly ? _('%s GB a month') : _('%s GB in total'), num(Number(v))) : _('No limit');
    const ok = await c.patch({ quota_gb: v }, fmt(_('%s: %s'), _('Limit'), said));
    saving = false;
    wrap.classList.remove('busy');
    if (ok) shut();
    else {
      bad.textContent = _('The router did not take it.');
      shake(input);
    }
  };
  btn.addEventListener('click', () => {
    btn.hidden = true;
    box.hidden = false;
    input.value = p.quota_gb ? String(p.quota_gb) : '';
    input.focus();
    input.select();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // (an Enter that picks a composed word is the keyboard's: shared/keys.ts)
      if (!composing(e)) void save();
    } else if (e.key === 'Escape') {
      // the keyboard never animates: back at once; the key is the field's, not the panel's
      e.preventDefault();
      e.stopPropagation();
      shut();
      btn.focus();
    }
  });
  input.addEventListener('blur', () => void save());
  return wrap;
}

/** The block's head control: the limit counts by month or for the whole term. */
export function limitPeriod(c: PersonCtx): HTMLElement | null {
  const p = c.p;
  if (!c.write) return null;
  return tabs(
    [
      { id: 'month', label: _('Month', 'limit') },
      { id: 'total', label: _('Whole term') },
    ],
    p.quota_period,
    (v) => void c.patch({ quota_period: v }, fmt(_('%s: %s'), _('Count'), v === 'month' ? _('By month') : _('For the whole term'))),
    { cls: 'in-row kt-segs', label: _('Count') },
  ).el;
}

export function limitMeter(c: PersonCtx): HTMLElement {
  const p = c.p;
  const monthly = p.quota_period === 'month';
  const days = c.days.filter((d) => d.day <= c.today).slice(-SPAN_DAYS);
  const series: Pair[] = days.map((d) => [d.rx, d.tx]);
  // of the limit: their limit month, or all time
  const used = p.quota_used;
  const read = upDown(`lm-${p.id}`);
  read.set(p.month);
  const whole = _('30 days');
  const label = h('span', { class: 'num' }, whole);
  const chart = series.length ? bars(series, 'bars-month', 64) : null;
  if (chart)
    readBars(chart, fmt(_('%s, last 30 days'), p.name), (i) => {
      read.set(i >= 0 ? series[i] : p.month);
      setText(label, i >= 0 ? shortDay(days[i].day) : whole);
    });
  const pace = paceOf(
    Array.from({ length: 7 }, (_x, k) => p.devices.reduce((a, d) => a + (d.spark[k]?.[0] ?? 0) + (d.spark[k]?.[1] ?? 0), 0)),
  );
  const words =
    p.quota_limit && used < p.quota_limit ? paceWords(used, p.quota_limit, pace, monthly ? p.quota_reset_day || null : null, c.today) : '';
  const resets = resetLine(c);
  const soon = pace > 0 && p.quota_limit > 0 && (p.quota_limit - used) / pace <= 7;
  const sh = share(p);
  const extra = c.write && p.quota_gb && monthly && sh >= 0.8;
  // while a limit month runs and has counted something
  const canReset = c.write && monthly && !!p.quota_limit && !!p.quota_resets && used > 0;
  const usedEl = h('b', { class: `num kt-lim-used${p.state === 'quota' ? ' bad-t' : ''}` }, bytes(used));
  const limitEl = limitValue(c);
  // «44 GB of 100 GB» with a limit; without one the limit alone (the sums are the Traffic card's)
  const line: (string | HTMLElement)[] = p.quota_limit
    ? fill<HTMLElement>(_('%s of %s'), usedEl, limitEl)
        .filter((x) => typeof x !== 'string' || x.trim())
        .map((x) => (typeof x === 'string' ? h('span', { class: 'kt-lim-of' }, x.trim()) : x))
    : [limitEl];
  return h(
    'div',
    { class: 'card kt-limit' },
    h(
      'div',
      { class: 'kt-lim-card', role: 'group', 'aria-label': _('Traffic') },
      chart ? h('div', { class: 'kt-lim-chart' }, chart.el, h('div', { class: 'kt-lim-read' }, label, read.el)) : null,
      h(
        'div',
        { class: 'kt-lim-nums' },
        h('div', { class: 'kt-lim-line' }, ...line),
        p.quota_limit ? meter(sh) : null,
        // under the bar, as a usage page: when it starts again at one end, how much is used at the other
        p.quota_limit
          ? h(
              'div',
              { class: 'kt-lim-reset num' },
              h('span', {}, resets ?? _('For the whole term: it does not reset')),
              // the share alone: the bar and «50.3 of 50 GB» over it say what it is of
              h(
                'span',
                {
                  class: p.state === 'quota' ? 'bad-t' : sh >= 0.9 ? 'warn-t' : null,
                  title: fmt(_('%s%% used'), num(Math.round(sh * 100))),
                },
                `${num(Math.round(sh * 100))}%`,
              ),
            )
          : null,
        words ? h('div', { class: `month-pace${soon ? ' warn-t' : ''}` }, words) : null,
        p.bonus_gb && monthly ? h('div', { class: 'month-pace' }, fmt(_('Includes +%s GB extra until the reset.'), num(p.bonus_gb))) : null,
      ),
    ),
    extra || canReset
      ? h(
          'div',
          { class: 'kt-lim-acts' },
          extra
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'chipb act kt-bonus',
                  onclick: () =>
                    void c.patch({ bonus_gb: String((p.bonus_gb || 0) + 10) }, fmt(_('%s: +%s GB until the reset'), p.name, num(10))),
                },
                ic('plus'),
                fmt(_('+%s GB until the reset'), num(10)),
              )
            : null,
          canReset
            ? h('button', { type: 'button', class: 'chipb act kt-bonus', onclick: () => resetUsage(c) }, ic('reset'), _('Reset usage'))
            : null,
        )
      : null,
  );
}

/**
 * Start their limit month over now, after a question: what it counted is let go (access comes back if the limit
 * had stopped it) and the next month begins with their next traffic. Their traffic history stays.
 */
function resetUsage(c: PersonCtx) {
  const p = c.p;
  openSheet(() =>
    askView({
      icon: 'chart',
      tone: 'orange',
      title: fmt(_('Reset usage for %s?'), p.name),
      text: [
        fmt(_('%s used of the limit are let go, and a new month begins when they next connect.'), bytes(p.quota_used)),
        _('Their traffic history is not changed.'),
      ],
      action: _('Reset usage'),
      cls: 'warn',
      run: async () => {
        await api.usageClear('limit', p.id);
        closeSheet();
        say(fmt(_('%s: usage reset'), p.name));
        await c.acts.reload();
      },
    }),
  );
}
