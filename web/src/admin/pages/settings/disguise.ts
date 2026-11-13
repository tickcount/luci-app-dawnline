// Settings › Disguise: the three presets as the portal's kind tiles widened
// with their consequence (what it does, which apps take it; «now» on the one
// in use, a ring on the one picked next). A pick waits for «Apply» with the
// page's other changes (devices fetch their configuration again after it);
// a press on the picked one takes it back. A preset the router cannot run
// says what it needs. Then the quiet ways on: new values for the same preset,
// the current parameters (a sheet, with Copy as configuration). A server on
// the old 1.0-style disguise is told to move on.

import { h } from '../../../portal/dom';
import { head, hint, openSheet, type View } from '../../../portal/ui/sheet';
import { fmt, plural } from '../../../shared/i18n';
import { legacyTitle, methodInfo, presetName, type Method } from '../../disguise';
import { levelTiles } from '../../widgets/disguise-levels';
import { paramCount, paramGroups, paramsConf } from '../../servers/params';
import { ic } from '../../ui/icons';
import { copyText } from '../../ui/files';
import { reMark } from '../../ui/edit-rows';
import { card, note, section } from '../../ui/section';
import { refetchOf } from '../../servers/pending';
import { installSheet } from '../../flows/install';
import type { ServerCtx } from './ctx';
import { stageHead, stageHealth, waits } from './stages';

/** The parameters, grouped, in the sheet; copied as configuration lines. */
function paramsView(c: ServerCtx): View {
  const o = c.srv.obf ?? {};
  const conf = paramsConf(o);
  const el = h(
    'div',
    { class: 'view' },
    head(_('Current parameters')),
    h(
      'div',
      { class: 'prm' },
      ...paramGroups(o, c.srv.hpk).map((g) =>
        h(
          'section',
          { class: 'prm-g' },
          h('b', {}, g.title),
          h('p', {}, g.text),
          h('div', { class: 'prm-v' }, ...g.items.map(([n, v]) => h('span', { class: 'mono' }, h('i', {}, n), ' ', v))),
        ),
      ),
    ),
    conf
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn soft block',
            onclick: () =>
              void copyText(
                conf,
                c.srv.hpk ? _('Parameters copied. The header protection key is in each device’s file.') : _('Parameters copied'),
              ),
          },
          ic('copy'),
          h('span', {}, _('Copy as configuration')),
        )
      : null,
    c.srv.hpk ? hint(_('The header protection key is not shown here: each device’s file has it.')) : null,
  );
  return { el, label: _('Current parameters') };
}

export function disguiseSection(c: ServerCtx): HTMLElement {
  const srv = c.srv;
  const caps = c.st.awg;
  const tools = c.st.awg_state?.tools !== false;
  const current = methodInfo(srv.preset)?.id;
  const n = refetchOf('disguise', srv.id, c.st.people);
  const waiting = c.staged('disguise');
  const next = waiting?.kind === 'disguise' ? ((waiting.preset as Method | undefined) ?? null) : null;
  /** A preset picked (or new values for the one in use): it waits for Apply. */
  const stage = (m: Method, renew: boolean) => {
    const info = methodInfo(m)!;
    c.change({
      kind: renew ? 'renew' : 'disguise',
      value: info.title,
      label: renew ? _('New disguise values') : fmt(_('Disguise: %s'), info.title),
      title: renew ? undefined : info.ask,
      more: [
        m === 'max'
          ? _('They need an app with AmneziaWG 3.1.')
          : m === 'balanced'
            ? _('They need an app with AmneziaWG 2.0 or newer.')
            : '',
        c.st.servers.length === 1 && n ? _('To keep the old disguise for some people, add a second server and move them there.') : '',
      ]
        .filter(Boolean)
        .join(' '),
      preset: m,
    });
  };
  const tiles = levelTiles({
    caps,
    tools,
    now: current,
    next,
    write: c.write,
    // the waiting one pressed again, or the one in use: the waiting choice is taken back
    pick: (m) => (next === m || m === current ? c.unstage('disguise') : stage(m, false)),
  });
  const legacy = legacyTitle(srv.preset);
  return section(
    stageHead(c, 'disguise', reMark(n)),
    card(
      stageHealth(c, 'disguise'),
      legacy
        ? h(
            'p',
            { class: 'desc warn-t' },
            fmt(
              _(
                '%s is AmneziaWG 1.0 junk only, which networks learned to spot; it is not offered any more. Switch to %s or %s: devices import their configuration again.',
              ),
              legacy,
              _('Balanced'),
              _('Maximum'),
            ),
          )
        : null,
      !tools
        ? h('div', { class: 'row-act' }, h('span', { class: 'desc' }, _('AmneziaWG isn’t installed')), c.write ? installBtn(c) : null)
        : tools && !caps.v3
          ? h(
              'p',
              { class: 'desc' },
              fmt(
                _('This router runs an older AmneziaWG. %s becomes available with kmod-amneziawg and amneziawg-tools 3.1.'),
                _('Maximum'),
              ),
            )
          : null,
      tiles,
      waiting
        ? note(
            waiting.kind === 'renew' ? waits(fmt(_('%s with the values in use'), presetName(srv.preset))) : waits(presetName(srv.preset)),
            'warn',
          )
        : null,
      // with no disguise there are no values to renew and no parameters to read (the owner, 2026-11-12: «в Disguise
      // Off не должно быть New values / Current parameters, т.к. там нету защиты»)
      current === 'off'
        ? null
        : h(
            'div',
            { class: 'row-act quiet' },
            c.write && current
              ? waiting?.kind === 'renew'
                ? h(
                    'button',
                    { type: 'button', class: 'pill-link', onclick: () => c.unstage('disguise') },
                    _('Keep the values in use'),
                    ic('chevron'),
                  )
                : renewBtn(() => stage(current, true), n)
              : null,
            paramCount(srv.obf ?? {}, srv.hpk)
              ? h(
                  'button',
                  { type: 'button', class: 'pill-link', onclick: () => openSheet(() => paramsView(c)) },
                  _('Current parameters'),
                  ic('chevron'),
                )
              : null,
          ),
    ),
  );
}

const renewBtn = (run: () => void, n: number) =>
  h(
    'button',
    {
      type: 'button',
      class: 'pill-link',
      title: n ? plural(n, '%s device fetches its configuration again', '%s devices fetch their configuration again') : null,
      onclick: run,
    },
    _('New values'),
    ic('chevron'),
  );

const installBtn = (c: ServerCtx) =>
  h(
    'button',
    { type: 'button', class: 'btn tint sm', onclick: () => installSheet('awg', [], () => void c.reload()) },
    h('span', {}, _('Install')),
  );
