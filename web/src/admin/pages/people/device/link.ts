// The device page's Connection card: the portal's way between the device and
// the router (setup.css .way: its dots green from the device when it holds,
// the knock while it cannot finish, grey when it is stopped), with the line
// under it in the words of the first break; the link timeline
// (widgets/timeline.ts); and the brief diagnosis (people/diagnosis.ts) with
// the break's fix as a button. A way that holds is drawn filled and at rest:
// its fill belongs to the moment it connects, not to every visit.

import { h } from '../../../../portal/dom';
import { ago } from '../../../../shared/format';
import { fmt } from '../../../../shared/i18n';
import { plainOrg } from '../../../../shared/org';
import { ic } from '../../../ui/icons';
import { linkWords, type Fix, type Step } from '../../../people/diagnosis';
import type { DeviceCtx } from '../../../people/ctx';

/** A fix as its button says it. */
const fixLabel = (f: Fix, c: DeviceCtx): string =>
  ({
    show: _('Show set-up'),
    resume: _('Resume access'),
    person: fmt(_('Open %s'), c.p.name),
    server: _('Open the server'),
    'device-on': _('Turn it on'),
    tell: _('Copy the advice'),
    'add-device': _('Add a second device'),
  })[f];

const FIX_ICON: Record<Fix, string> = {
  show: 'qr',
  resume: 'play',
  person: 'person',
  server: 'terminal',
  'device-on': 'play',
  tell: 'copy',
  'add-device': 'plus',
};

/** The look of the way: holding, not holding, knocking, or connected without data. */
type Look = 'done' | 'stopped' | 'trying' | 'nodata';

/** The way and its two lines, for the device as the router has it and its chain. */
export function wayEl(c: DeviceCtx, steps: Step[]): HTMLElement {
  const { d } = c;
  const now = c.now();
  const broke = steps.find((s) => s.state === 'bad');
  const linkBad = broke?.id === 'connection' && !!d.link;
  const look: Look = !broke ? (d.online ? 'done' : 'stopped') : broke.id === 'traffic' ? 'nodata' : linkBad ? 'trying' : 'stopped';
  const since = d.handshake ? fmt(_('Last time %s'), ago(d.handshake, now)) : _('It has never connected');
  const handshake = fmt(_('handshake %s'), ago(d.handshake, now));
  const pt = c.st.geo.points.filter((x) => x.device === d.id).sort((a, b) => b.ts - a.ts)[0];
  let say: [string, string];
  if (broke && d.link?.state === 'trying' && linkBad) say = [linkWords(d).title, fmt(_('Last handshake %s'), ago(d.handshake, now))];
  else if (broke) say = [broke.line, ['access', 'server', 'device'].includes(broke.id) ? since : d.online ? handshake : since];
  else if (d.online)
    say = [
      _('Online'),
      [pt ? [pt.city, pt.org ? plainOrg(pt.org) : ''].filter(Boolean).join(', ') : '', handshake].filter(Boolean).join(' · '),
    ];
  else say = [_('Not connected'), since];
  const way = h(
    'div',
    { class: `way dway${look === 'done' ? ' done still' : ` ${look}`}`, role: 'status' },
    h(
      'div',
      { class: 'way-row' },
      h('span', { class: 'way-end' }, ic(d.kind)),
      h(
        'span',
        { class: 'way-track' },
        h('span', { class: 'way-glow' }, h('span', { class: 'run' }, h('i')), h('span', { class: 'knock' }, h('i'))),
        h('span', { class: 'way-fill' }),
        h('span', { class: 'way-break' }, h('i')),
      ),
      h('span', { class: 'way-end home' }, ic('terminal')),
    ),
    h('div', { class: 'way-text' }, h('span', { class: 't' }, h('b', {}, say[0]), h('span', { class: 'ws' }, say[1]))),
  );
  return way;
}

/** The diagnosis: steps on a track, filled green as far as it holds; the first break with its fix (when this login may). */
export function diagnosisEl(c: DeviceCtx, steps: Step[], act: (f: Fix, from: HTMLButtonElement) => void): HTMLElement {
  return h(
    'ol',
    { class: 'dg' },
    ...steps.map((s) =>
      h(
        'li',
        { class: `dg-s ${s.state}` },
        h(
          'span',
          { class: 'dg-m' },
          s.state === 'ok' ? ic('check') : s.state === 'bad' ? ic('x') : s.state === 'warn' ? ic('clock') : null,
        ),
        h(
          'div',
          { class: 'dg-t' },
          h('b', {}, s.title),
          h('span', {}, s.line),
          s.hint ? h('span', { class: 'dg-h' }, s.hint) : null,
          c.write && s.fix?.length
            ? h(
                'div',
                { class: 'dg-fix' },
                ...s.fix.map((f, i) => {
                  const b = h(
                    'button',
                    { type: 'button', class: `btn ${i ? 'soft' : 'tint'} sm`, title: fixLabel(f, c) },
                    ic(FIX_ICON[f]),
                    h('span', {}, fixLabel(f, c)),
                  ) as HTMLButtonElement;
                  b.addEventListener('click', () => act(f, b));
                  return b;
                }),
              )
            : null,
        ),
      ),
    ),
  );
}
