// Who sees whom on a server (kit: «visibility groups»). The rule is one of three and reads as a segmented track with
// the picked rule's meaning in one line under it; under that the rule drawn with the server's own people: every
// group whose devices reach each other is a tile with its people as faces. In circles a tile is a circle (its
// colour, its name, its people, the way to change it) and the last tile makes a new one; people in no circle and
// people with internet only are quiet lines, since they see nobody. So the page shows who a change would touch
// before it is made, not three paragraphs to compare.

import type { Circle, MeshMode, Person } from '../../shared/types';
import { h } from '../../portal/dom';
import { fmt, num, plural } from '../../shared/i18n';
import { face } from '../ui/face';
import { ic } from '../ui/icons';
import { tabs } from '../ui/tabs';
import { tip } from '../../portal/ui/tip';

export interface Visibility {
  mode: MeshMode;
  /** Picked and waiting for «Apply» (null: nothing waits). */
  next: MeshMode | null;
  people: Person[];
  circles: Circle[];
  color(c: Circle): string;
  write: boolean;
  pick(m: MeshMode): void;
  /** Change a circle (null: make one). */
  circle(c: Circle | null): void;
}

const FACES = 7;
const label = (m: MeshMode) => ({ off: _('Nobody'), all: _('Everyone'), circles: _('In circles') })[m];
const meaning = (m: MeshMode) =>
  ({
    off: _('Devices never reach each other: neither other people’s, nor a person’s own.'),
    all: _('Devices of everyone with home access reach each other, as devices at home do.'),
    circles: _('Devices reach each other inside a circle. Everyone reaches their own devices.'),
  })[m];

/** People as overlapping faces, «+N» past seven; each face names its person. */
function faces(people: Person[]): HTMLElement {
  const shown = people.slice(0, FACES);
  const el = h(
    'span',
    { class: 'kt-vis-faces' },
    ...shown.map((p) => {
      const f = face(p.name, p.online > 0 ? 'ok' : '');
      f.removeAttribute('aria-hidden');
      f.setAttribute('aria-label', p.name);
      tip(f, () => p.name);
      return f;
    }),
    people.length > FACES ? h('span', { class: 'pav kt-face more num' }, `+${people.length - FACES}`) : null,
  );
  return el;
}

const count = (n: number) => plural(n, '%s person', '%s people');

export function visibility(o: Visibility): HTMLElement {
  const shown = o.next ?? o.mode;
  const home = o.people.filter((p) => p.access !== 'internet');
  const net = o.people.filter((p) => p.access === 'internet');
  const track = tabs<MeshMode>(
    (['off', 'all', 'circles'] as const).map((m) => ({ id: m, label: label(m) })),
    shown,
    (m) => o.pick(m),
    { cls: 'kt-vis-track', label: _('Devices see each other'), keep: 'visibility' },
  );
  if (!o.write) track.el.setAttribute('aria-disabled', 'true');
  const group = (head: (Node | string | null)[], who: Person[], empty: string, end: Node | null = null) =>
    h(
      'div',
      { class: 'kt-vis-g' },
      h('div', { class: 'kt-vis-h' }, ...head, h('span', { class: 'kt-vis-n num' }, num(who.length)), end),
      who.length ? faces(who) : h('span', { class: 'kt-vis-none' }, empty),
    );
  let body: (HTMLElement | null)[];
  if (shown === 'off') body = [];
  else if (shown === 'all') body = [group([h('b', {}, _('See each other'))], home, _('nobody has home access yet'))];
  else {
    const free = home.filter((p) => !o.circles.some((c) => c.id === p.circle));
    body = [
      ...o.circles.map((c) => {
        const dot = h('i', { class: 'kt-vis-dot' });
        dot.style.background = o.color(c);
        const edit = o.write
          ? h(
              'button',
              { type: 'button', class: 'knob kt-vis-edit', 'aria-label': fmt('%s: %s', _('Change'), c.name), onclick: () => o.circle(c) },
              ic('edit'),
            )
          : null;
        return group(
          [dot, h('b', { title: c.name }, c.name)],
          o.people.filter((p) => p.circle === c.id),
          _('nobody yet'),
          edit,
        );
      }),
      o.write
        ? h(
            'button',
            { type: 'button', class: 'kt-vis-g kt-vis-new', onclick: () => o.circle(null) },
            ic('plus'),
            h('span', {}, _('New circle')),
          )
        : null,
      free.length
        ? h(
            'div',
            { class: 'kt-vis-q' },
            h('span', {}, fmt(_('In no circle: %s. They reach only their own devices.'), count(free.length))),
            faces(free),
          )
        : null,
    ];
  }
  return h(
    'div',
    { class: 'kt-vis' },
    track.el,
    h(
      'p',
      { class: `kt-vis-say${o.next ? ' warn-t' : ''}` },
      o.next ? `${fmt(_('Not applied yet. Now: %s'), label(o.mode))} ` : null,
      meaning(shown),
    ),
    body.some(Boolean) ? h('div', { class: 'kt-vis-grid' }, ...body.filter((x) => x && !x.classList.contains('kt-vis-q'))) : null,
    ...body.filter((x) => x?.classList.contains('kt-vis-q')),
    net.length && shown !== 'off'
      ? h('p', { class: 'kt-vis-foot' }, fmt(_('%s with internet only see nobody under any rule.'), count(net.length)))
      : null,
  );
}
