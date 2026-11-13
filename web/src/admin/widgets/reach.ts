// What a person reaches: two switch rows (the portal's .swrow, as the settings have them), the internet and home,
// each its glass, its name and what it means now («through your router» / «their own connection», «1 network» /
// «no access»). Two independent yes / no of which one is a must: the last one will not turn off (its row shakes,
// goes back, and a line says why). While home is on, what of home sits in the same field block under its row,
// after a hairline: the server's home networks as chips («and new ones» = all, future ones too), and for home-only
// access the home services as chips and whose DNS answers as segments. The circle, where the server uses them, is
// a row of its own under the block. No change is made on the spot: each waits for «Apply» on their page
// (people/draft.ts); the mark beside the block's title says how many devices a change of access makes fetch again.

import type { Person } from '../../shared/types';
import type { PersonPatch } from '../api';
import { h, type Kid } from '../../portal/dom';
import { openMenu } from '../../portal/ui/menu';
import { fmt, plural } from '../../shared/i18n';
import { accessLabel } from '../../shared/format';
import { shake } from '../../shared/shake';
import { ic } from '../ui/icons';
import { glass } from '../ui/glass';
import { tabs } from '../ui/tabs';
import { reMark, switchRow } from '../ui/edit-rows';
import { circleColor } from '../flows/circle';
import { homeAccess } from '../servers/reach';
import { refetchCount } from '../people/refetch';
import type { PersonCtx } from '../people/ctx';

/** A change of what they reach: it waits for «Apply» on their page, which asks once when devices fetch again. */
const put = (c: PersonCtx, what: string, value: string, patch: PersonPatch): Promise<boolean> =>
  c.patch(patch, fmt(_('%s: %s'), what, value));

type Access = Person['access'];
const has = (a: Access, what: 'internet' | 'lan') => a === 'both' || a === what;
const join = (net: boolean, home: boolean): Access | null => (net && home ? 'both' : net ? 'internet' : home ? 'lan' : null);

/** The ⟳N at the end of the block's head: how many devices a change of access would make fetch again. */
export function reachMark(c: PersonCtx): HTMLElement | null {
  const p = c.p;
  const other: Access = p.access === 'lan' ? 'both' : 'lan';
  return c.write ? reMark(refetchCount(p, { access: other })) : null;
}

export function reachFork(c: PersonCtx): HTMLElement {
  const p = c.p;
  const srv = c.srv;
  const nets = srv?.home ?? [];
  const svc = c.st.services;
  const net = has(p.access, 'internet');
  const home = has(p.access, 'lan');
  const bad = h('div', { class: 'kt-reach-bad', role: 'alert' });

  const flip = (what: 'internet' | 'lan', row: () => HTMLElement) => async (on: boolean) => {
    const next = join(what === 'internet' ? on : net, what === 'lan' ? on : home);
    if (!next) {
      bad.textContent = _('One of the two must stay: otherwise their devices reach nothing.');
      shake(row(), { ring: false });
      return false;
    }
    bad.textContent = '';
    return put(c, _('Networks'), accessLabel(next), { access: next });
  };
  const nNets = p.home_nets?.length ? p.home_nets.filter((n) => nets.some((x) => x.dev === n)).length : nets.length;
  const homeSub = !home
    ? _('no access')
    : [
        nets.length ? plural(nNets, '%s network', '%s networks') : _('the home network'),
        p.access === 'lan' && p.services?.length ? plural(p.services.length, '%s service', '%s services') : '',
      ]
        .filter(Boolean)
        .join(' · ');
  const netRow: HTMLElement = switchRow(
    {
      title: _('Internet'),
      sub: net ? (srv?.lan_like ? _('through your router, as a home device') : _('through your router')) : _('their own connection'),
      on: net,
      icon: 'globe',
      flip: flip('internet', () => netRow),
    },
    c.write,
  );
  const homeRow: HTMLElement = switchRow(
    { title: _('Home network'), sub: homeSub, on: home, icon: 'home', flip: flip('lan', () => homeRow) },
    c.write,
  );

  /* what of home */
  const rows: Kid[] = [];
  const row = (label: string, ...kids: Kid[]) =>
    h('div', { class: 'kt-rrow' }, h('span', { class: 'kt-rlab' }, label), h('div', { class: 'kt-rv' }, ...kids));
  // a segmented track needs the row's width: in a narrow column its label stands over it
  const wideRow = (label: string, kid: Kid) => {
    const r = row(label, kid);
    r.classList.add('wide');
    return r;
  };
  const chip = (label: string, on: boolean, title: string, run: () => void, mono = true) =>
    c.write
      ? h(
          'button',
          { type: 'button', class: `kt-tchip${on ? ' on' : ''}${mono ? ' mono' : ''}`, 'aria-pressed': String(on), title, onclick: run },
          ic(on ? 'check' : 'plus'),
          h('span', {}, label),
        )
      : h('span', { class: `kt-tchip${on ? ' on' : ''}${mono ? ' mono' : ''}`, title }, ic(on ? 'check' : 'minus'), h('span', {}, label));

  if (home && homeAccess(p) && nets.length > 1) {
    const all = !p.home_nets?.length;
    const on = (dev: string) => all || p.home_nets!.includes(dev);
    const setNets = (list: string[]) => {
      if (!list.length) return void (bad.textContent = _('At least one home network must stay.'));
      const next = list.length === nets.length ? [] : list;
      void put(c, _('Home networks'), next.join(', ') || _('All'), { home_nets: next });
    };
    rows.push(
      row(
        _('Networks'),
        ...nets.map((x) =>
          chip(x.dev, on(x.dev), x.nets.join(', '), () => {
            const cur = nets.map((n) => n.dev).filter(on);
            setNets(on(x.dev) ? cur.filter((d) => d !== x.dev) : [...cur, x.dev]);
          }),
        ),
        chip(
          _('and new ones'),
          all,
          _('All of them includes networks added to the server later; a choice keeps them out.'),
          () => all || setNets(nets.map((n) => n.dev)),
          false,
        ),
      ),
    );
  }
  if (p.access === 'lan' && svc.length) {
    const picked = p.services ?? [];
    rows.push(
      row(
        _('Services'),
        ...svc.map((s) =>
          chip(
            s.name,
            picked.includes(s.id),
            `${s.address}${s.ports.length ? ` · ${s.ports.join(', ')}` : ''}`,
            () => {
              const next = picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id];
              const v = next.length
                ? svc
                    .filter((x) => next.includes(x.id))
                    .map((x) => x.name)
                    .join(', ')
                : _('Whole home network');
              void c.patch({ services: next }, fmt(_('%s: %s'), _('Home services'), v));
            },
            false,
          ),
        ),
        picked.length ? null : h('span', { class: 'kt-rnote' }, _('none picked: the whole home network')),
      ),
    );
    rows.push(
      wideRow(
        _('Names'),
        c.write
          ? tabs(
              [
                { id: 'device', label: _('Device’s own DNS') },
                { id: 'home', label: _('Home names') },
              ],
              p.dns_mode,
              (m) =>
                void put(c, 'DNS', m === 'home' ? _('Home names') : _('Device’s own DNS'), {
                  dns_mode: m,
                }),
              { cls: 'in-row kt-segs', label: 'DNS' },
            ).el
          : h('span', {}, p.dns_mode === 'home' ? _('Home names') : _('Device’s own DNS')),
      ),
    );
  }
  // the circle: a row of its own under home's block (it is not part of home)
  let circleRow: HTMLElement | null = null;
  const circles = c.st.circles.filter((x) => x.server === p.server);
  if (srv?.mesh === 'circles' && homeAccess(p) && circles.length) {
    const cur = circles.find((x) => x.id === p.circle);
    const pill = h(
      'button',
      { type: 'button', class: 'pill-link kt-circle', 'aria-haspopup': 'menu' },
      // the circle's own colour, as the settings' circles show it; none: grey
      h('i', { class: 'kt-cdot', style: cur ? `background:${circleColor(cur)}` : null }),
      cur?.name ?? _('No circle'),
      ic('chevron'),
    );
    pill.addEventListener('click', () =>
      openMenu(
        pill,
        [{ id: '', name: _('No circle') }, ...circles].map((x) => ({
          label: x.name,
          icon: x.id === (p.circle ?? '') ? 'check' : 'people',
          run: () => void c.patch({ circle: x.id }, fmt(_('%s: %s'), _('Circle'), x.name)),
        })),
        _('Circle'),
      ),
    );
    // a row as the switch rows above are: its glass, its name, its value at the end
    circleRow = h(
      'div',
      { class: 'kt-rcircle' },
      glass('people', cur ? 'blue' : 'grey'),
      h('b', {}, _('Circle')),
      c.write ? pill : h('span', { class: 'kt-rc-v' }, cur?.name ?? _('No circle')),
    );
  }
  return h(
    'div',
    { class: 'card kt-reach', role: 'group', 'aria-label': _('What they reach') },
    netRow,
    // home and what of it: one field block, the details after a hairline
    h('div', { class: `kt-rhome${rows.length ? ' more' : ''}` }, homeRow, rows.length ? h('div', { class: 'kt-rrows' }, ...rows) : null),
    bad,
    circleRow,
  );
}
