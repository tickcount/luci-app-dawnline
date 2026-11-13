// A person's head, on their page: their glass and name; under it one line —
// their phrase in its state's colour (the only place it is said), their server
// (a link to it) only when there is more than one; under that the admin's note as a
// quiet line of its own, edited where it stands (a press: the note sheet). On the
// right the phrase's one action (people/lines.ts, done at once with Undo),
// their invite (Link once they have devices, Invite before), and ⋯: move to
// another server, rename, the note, pause or resume, remove (asked first). Their name is also changed where it
// stands: a click on it turns it into its own field (ui/rename-title.ts), as a device's is in its dialog.
// A read-only login sees the facts and «View only».

import { h } from '../../../../portal/dom';
import { openMenu, type MenuItem } from '../../../../portal/ui/menu';
import { openSheet } from '../../../../portal/ui/sheet';
import { once } from '../../../../portal/ui/feedback';
import { api } from '../../../api';
import { fmt, plural } from '../../../../shared/i18n';
import { nameHelp } from '../../../netcheck';
import { glass } from '../../../ui/glass';
import { ic } from '../../../ui/icons';
import { fact, knob, pageHead } from '../../../ui/page-head';
import { notify } from '../../../ui/toast';
import { href, settingsUrl } from '../../../shell/routes';
import { leaveTo } from '../../../shell/sheets';
import { personLine } from '../../../people/lines';
import { askView } from '../../../flows/ask';
import { openInvite } from '../../../flows/invite';
import { movePerson } from '../../../flows/move-person';
import { textSheet } from '../../../flows/text-sheet';
import { editableTitle, renameTitle, type RenameTitle } from '../../../ui/rename-title';
import { actButton, pause, runAct } from '../../../flows/person-acts';
import type { PersonCtx } from '../../../people/ctx';

function editNote(c: PersonCtx) {
  textSheet({
    title: _('Note'),
    value: c.p.note ?? '',
    placeholder: _('Only you see this'),
    long: true,
    max: 500,
    refuse: () => null,
    save: async (v) => {
      if (!(await c.patch({ note: v }, v ? _('Note saved') : _('Note removed')))) throw new Error(_('The router did not take it.'));
    },
  });
}

/** Their name is changed where it stands, as a device's is (ui/rename-title.ts): a click on it, or Rename in ⋯. */
const renaming = (c: PersonCtx, head: HTMLElement): RenameTitle => ({
  head,
  name: c.p.name,
  label: fmt(_('Rename %s'), c.p.name),
  free: { max: 48 },
  refuse: (v) => {
    const r = nameHelp(
      v,
      c.st.people.filter((x) => x.id !== c.p.id).map((x) => x.name),
    );
    return r.bad ? r.text : null;
  },
  save: async (v) => {
    if (!(await c.patch({ name: v }, fmt(_('Renamed: %s'), v)))) throw new Error(_('The router did not take it.'));
  },
});

function remove(c: PersonCtx) {
  const p = c.p;
  openSheet(() =>
    askView({
      icon: 'trash',
      tone: 'red',
      title: fmt(_('Remove %s?'), p.name),
      text: [
        p.devices.length
          ? fmt(
              _('Their link and %s stop working at once: %s.'),
              plural(p.devices.length, '%s device', '%s devices'),
              p.devices.map((d) => d.name).join(', '),
            )
          : _('Their link stops working at once.'),
        ' ',
        _('Only a backup brings them back.'),
      ],
      action: _('Remove'),
      cls: 'red',
      run: async () => {
        await api.personDelete(p.id);
        notify(fmt(_('%s removed'), p.name), 'success', 3000);
        // the list without them: their panel shuts once the question has gone
        void c.acts.reload();
        leaveTo(href({ view: 'people' }));
      },
    }),
  );
}

function menu(c: PersonCtx, anchor: HTMLElement) {
  const p = c.p;
  // calm to grave: what is theirs alone (the name, the note), what moves them (their devices fetch a new
  // configuration), what stops them: Pause in warn, then Remove, last
  const items: (MenuItem | null)[] = [
    {
      label: _('Rename'),
      icon: 'edit',
      run: () => {
        const head = anchor.closest<HTMLElement>('.ph');
        if (head) renameTitle(renaming(c, head));
      },
    },
    { label: p.note ? _('Edit note') : _('Add note'), icon: 'file', run: () => editNote(c) },
    null,
    c.st.servers.length > 1
      ? {
          label: _('Move to another server'),
          icon: 'terminal',
          run: () => movePerson({ person: p, st: c.st, moved: () => void c.acts.reload() }),
        }
      : null,
    null,
    p.paused
      ? { label: _('Resume'), icon: 'play', run: () => void pause(c.acts, p, false) }
      : { label: _('Pause'), icon: 'pause', tone: 'warn', run: () => void pause(c.acts, p, true) },
    { label: _('Remove'), icon: 'trash', tone: 'bad', run: () => remove(c) },
  ];
  openMenu(anchor, items, p.name);
}

/** The head: their name, their state in a line (its one action beside), the note under it. */
export function personHead(c: PersonCtx): HTMLElement {
  const p = c.p;
  const line = personLine(p, { today: c.today, now: c.now() });
  const acts: HTMLElement[] = [];
  if (c.write) {
    if (line.act && line.act.id !== 'invite') {
      const a = line.act;
      const b = actButton(a, 'tint');
      b.addEventListener('click', () => void once(b, () => runAct(a, p, c.acts)));
      acts.push(b);
    }
    if (p.has_link)
      acts.push(
        h(
          'button',
          {
            type: 'button',
            class: 'btn soft',
            onclick: () => void openInvite({ person: p, server: c.srv?.name ?? '', changed: () => void c.acts.reload() }),
          },
          ic('link'),
          h('span', {}, p.devices.length ? _('Link') : _('Invite')),
        ),
      );
    const more = knob('more', _('Move, rename, note, pause, remove'));
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => menu(c, more));
    acts.push(more);
  }
  const head = pageHead({ icon: glass('person', 'grey'), title: p.name, acts });
  if (c.write) editableTitle(() => renaming(c, head));
  // the state; their speed now is the Traffic card's «Now»
  const facts = [
    fact(h('span', { class: `ph-state ${line.tone ? `${line.tone}-t` : ''}`, title: line.why ?? null }, line.text)),
    // with one server its name says nothing
    c.srv && c.st.servers.length > 1 ? fact(h('a', { class: 'ph-link', href: settingsUrl(undefined, c.srv.id) }, c.srv.name)) : null,
    c.write ? null : fact([ic('eye'), _('View only')]),
  ];
  head.querySelector('.ph-sub')?.replaceChildren(...facts.filter((f): f is HTMLElement => !!f));
  // the note: a line of its own under the head's row, in the words' colour, no frame; a press edits it
  if (p.note) {
    const note = c.write
      ? h(
          'button',
          { type: 'button', class: 'ph-note', 'aria-label': fmt(_('Note: %s. Edit'), p.note), onclick: () => editNote(c) },
          h('span', {}, p.note),
          ic('edit', 'i ph-note-ed'),
        )
      : h('p', { class: 'ph-note' }, h('span', {}, p.note));
    // under the name and its state, in their own column: it stays with them wherever the actions go (a narrow
    // head puts them on a line of their own, and the note stood under the buttons then)
    head.querySelector('.ph-t')?.append(h('div', { class: 'ph-noterow' }, note));
  }
  return head;
}
