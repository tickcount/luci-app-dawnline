// A circle in the portal's sheet: its name, its colour, and its people as a list to tick. A row a person: their
// face, their name, where they are now when that matters (another circle: a person is in one at a time, so ticking
// them moves them), and a round mark as the option tiles have. The rows stand in the order the choice is made in:
// who is in the circle, who can be (home access, no circle), who is in another circle, and last, under one line
// that says why, the people with internet only (in a circle they still reach nobody). A search over the list from
// nine people; the head counts the ticked. Save, or Delete for one that exists. The colours are the old page's
// eight: a circle stores the index.

import type { Circle, Person, Status } from '../../shared/types';
import { api } from '../api';
import { h } from '../../portal/dom';
import { closeSheet, head, hint, openSheet, type View } from '../../portal/ui/sheet';
import { once } from '../../portal/ui/feedback';
import { fmt, plural } from '../../shared/i18n';
import { circleNameHelp } from '../netcheck';
import { errorText, notify } from '../ui/toast';
import { say } from '../shell/toast';
import { homeAccess } from '../servers/reach';
import { face } from '../ui/face';
import { ic } from '../ui/icons';
import { field } from './form';
import { putChildren } from '../../portal/ui/put';

/** Circle colours; the circle stores an index. */
const CIRCLE_COLORS = ['#3a83f7', '#a78bfa', '#f472b6', '#f59e0b', '#10b981', '#22d3ee', '#ef4444', '#84cc16'];

export const circleColor = (c: Circle | undefined): string => CIRCLE_COLORS[c?.color ?? 0] ?? CIRCLE_COLORS[0];

export interface CircleCtx {
  st: Status;
  srv: string;
  changed(): Promise<void>;
}

const COLORS = CIRCLE_COLORS.length;
const colorOf = (i: number) => CIRCLE_COLORS[i];

function circleView(c: CircleCtx, ci: Circle | null): View {
  const mine = c.st.circles.filter((x) => x.server === c.srv);
  const used = new Set(mine.map((x) => x.color));
  let color = ci?.color ?? [...Array(COLORS).keys()].find((i) => !used.has(i)) ?? 0;
  const name = field(
    _('Name', 'circle or service'),
    ci?.name ?? '',
    (v) =>
      circleNameHelp(
        v,
        mine.filter((x) => x.id !== ci?.id).map((x) => x.name),
      ),
    { placeholder: _('Family') },
  );
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': _('Colour') });
  const paintSwatches = () =>
    putChildren(
      swatches,
      [...Array(COLORS).keys()].map((i) =>
        h('button', {
          type: 'button',
          role: 'radio',
          class: `swatch${i === color ? ' on' : ''}`,
          style: `--sw:${colorOf(i)}`,
          'aria-checked': String(i === color),
          'aria-label': fmt(_('Colour %s'), i + 1),
          onclick: () => {
            color = i;
            paintSwatches();
          },
        }),
      ),
    );
  paintSwatches();

  const people = c.st.people.filter((p) => p.server === c.srv).sort((a, b) => a.name.localeCompare(b.name));
  const members = new Set(people.filter((p) => ci && p.circle === ci.id).map((p) => p.id));
  const was = new Set(members);
  const other = (p: Person) => (p.circle && p.circle !== ci?.id ? mine.find((x) => x.id === p.circle) : undefined);
  // the order the choice is made in; it stays as the sheet opened, so a tick never makes its row jump away
  const rank = (p: Person) => (was.has(p.id) ? 0 : !homeAccess(p) ? 3 : other(p) ? 2 : 1);
  const order = [...people].sort((a, b) => rank(a) - rank(b));
  const count = h('span', { class: 'kt-pk-n num' });
  const counted = () => (count.textContent = members.size ? plural(members.size, '%s picked', '%s picked') : _('nobody yet'));
  const row = (p: Person, quiet = false) => {
    const o = other(p);
    const dot = o ? h('i', { class: 'kt-pk-dot' }) : null;
    if (dot) dot.style.background = circleColor(o);
    const sub = h('span', { class: 'kt-pk-s' });
    const b = h(
      'button',
      { type: 'button', role: 'checkbox', class: `kt-pk-r${quiet ? ' quiet' : ''}`, 'data-name': p.name.toLocaleLowerCase() },
      face(p.name, p.online > 0 ? 'ok' : ''),
      h('span', { class: 'kt-pk-t' }, h('b', {}, p.name), sub),
      h('span', { class: 'kt-op-m', 'aria-hidden': 'true' }, ic('check')),
    );
    const draw = () => {
      const on = members.has(p.id);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      // another circle: where they are, or, once ticked, that they leave it
      // …or, for someone already in this circle with internet only, that it does nothing for them yet
      putChildren(
        sub,
        o
          ? [dot!, on ? fmt(_('moves from %s'), o.name) : o.name]
          : !homeAccess(p) && !quiet
            ? [_('internet only: reaches nobody yet')]
            : [],
      );
      sub.hidden = !sub.childNodes.length;
    };
    draw();
    b.addEventListener('click', () => {
      if (!members.delete(p.id)) members.add(p.id);
      draw();
      counted();
    });
    return b;
  };
  // who a circle does nothing for, unless they are in this one already (those stay on top, said on their row)
  const netOnly = order.filter((p) => !homeAccess(p) && !was.has(p.id));
  const rows = h(
    'div',
    { class: 'kt-pk-l', role: 'group', 'aria-label': _('People') },
    ...order.filter((p) => !netOnly.includes(p)).map((p) => row(p)),
    netOnly.length
      ? h(
          'p',
          { class: 'kt-pk-g' },
          fmt(_('Internet only · %s'), netOnly.length),
          h('span', {}, _('in a circle they still reach nobody, until they get home access')),
        )
      : null,
    ...netOnly.map((p) => row(p, true)),
  );
  const none = h('p', { class: 'kt-pk-none', hidden: '' }, _('Nobody by that name.'));
  const q = h('input', {
    type: 'search',
    class: 'kt-pk-q',
    placeholder: _('Find a person'),
    'aria-label': _('Find a person'),
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  q.addEventListener('input', () => {
    const t = q.value.trim().toLocaleLowerCase();
    let any = false;
    rows.querySelectorAll<HTMLElement>('.kt-pk-r').forEach((r) => {
      const show = !t || (r.dataset.name ?? '').includes(t);
      r.hidden = !show;
      any ||= show;
    });
    rows.querySelectorAll<HTMLElement>('.kt-pk-g').forEach((g) => (g.hidden = !!t));
    none.hidden = any;
  });
  counted();

  const save = h('button', { type: 'button', class: 'btn accent block' }, h('span', {}, _('Save'))) as HTMLButtonElement;
  save.addEventListener('click', () =>
    once(save, async () => {
      if (!name.check()) return;
      try {
        await api.circleSet(ci?.id ?? '', c.srv, name.value(), color, [...members]);
        closeSheet();
        say(ci ? fmt(_('%s updated'), name.value()) : fmt(_('%s added'), name.value()));
        await c.changed();
      } catch (e) {
        notify(errorText(e), 'error', 10000);
      }
    }),
  );
  const del = ci ? (h('button', { type: 'button', class: 'btn soft block bad-t' }, h('span', {}, _('Delete'))) as HTMLButtonElement) : null;
  del?.addEventListener('click', () =>
    once(del, async () => {
      try {
        await api.circleDelete(ci!.id);
        closeSheet();
        say(fmt(_('%s deleted'), ci!.name));
        await c.changed();
      } catch (e) {
        notify(errorText(e), 'error', 10000);
      }
    }),
  );
  const title = ci ? fmt(_('Edit %s'), ci.name) : _('New circle');
  requestAnimationFrame(() => !ci && name.input.focus({ preventScroll: true }));
  const el = h(
    'div',
    { class: 'view kt-circle' },
    head(title),
    name.el,
    h('div', { class: 'choice' }, h('div', { class: 'choice-h' }, h('span', {}, _('Colour'))), swatches),
    h(
      'div',
      { class: 'choice kt-pk' },
      h('div', { class: 'choice-h kt-pk-h' }, h('span', {}, _('People')), count),
      people.length > 8 ? h('label', { class: 'kt-pk-find' }, ic('search'), q) : null,
      people.length ? h('div', { class: 'kt-pk-box' }, rows, none) : hint(_('Nobody on this server yet.')),
    ),
    hint(_('Devices of people in one circle reach each other. A person is in one circle at a time.')),
    h('div', { class: 'fl-acts' }, save, del),
  );
  return { el, label: title };
}

/** A circle on this server: a new one (null), or one to change. */
export const openCircle = (c: CircleCtx, ci: Circle | null) => openSheet(() => circleView(c, ci));
