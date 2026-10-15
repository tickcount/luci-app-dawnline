// Person page dialogs: rename, note, when access ends, new link, invite, delete.

import { E } from '../../e';
import { api } from '../../api';
import { button } from '../../ui/button';
import { cancelButton, closeModal, confirmDialog, modal } from '../../ui/modal';
import { copyText } from '../../ui/files';
import { attempt } from '../../ui/toast';
import { inviteCard } from '../../invite';
import { peopleUrl } from '../../urls';
import type { PersonPage } from './index';

const field = (label: string, el: Node) =>
  E('div', { class: 'cbi-value' }, [E('label', { class: 'cbi-value-title' }, label), E('div', { class: 'cbi-value-field' }, el)]);

export function invite(page: PersonPage) {
  const server = page.st.servers.find((s) => s.id === page.p.server)?.name ?? 'Home';
  void inviteCard(page.p, server);
}

export async function newLink(page: PersonPage) {
  const p = page.p;
  if (!(await confirmDialog('Create a new link?', 'The old link stops working right away.', 'Create new link', true))) return;
  const r = await attempt(() => api.personRegen(p.id), 'New link created');
  if (r?.link) await copyText(r.link, 'New link copied');
}

export function editNote(page: PersonPage) {
  const input = E(
    'textarea',
    { class: 'cbi-input-textarea dl-note-input', rows: 3, maxlength: 500, placeholder: 'Only you see this' },
    page.p.note ?? '',
  ) as HTMLTextAreaElement;
  modal(
    'Note',
    [input],
    [
      cancelButton(),
      ' ',
      button(
        'Save',
        async () => {
          closeModal();
          await page.patch({ note: input.value.trim() }, input.value.trim() ? 'Note saved' : 'Note removed');
        },
        'positive',
      ),
    ],
  );
  setTimeout(() => input.focus(), 50);
}

export function endSettings(page: PersonPage) {
  const p = page.p;
  const act = E('select', { class: 'cbi-input-select' }, [
    E('option', { value: 'pause', selected: p.expire_action === 'pause' ? 'selected' : null }, 'Pause access'),
    E('option', { value: 'notify', selected: p.expire_action === 'notify' ? 'selected' : null }, 'Keep access'),
    E('option', { value: 'remove', selected: p.expire_action === 'remove' ? 'selected' : null }, 'Remove their devices'),
  ]) as HTMLSelectElement;
  const warn = E(
    'select',
    { class: 'cbi-input-select' },
    [0, 1, 3, 7, 14].map((n) =>
      E(
        'option',
        { value: n, selected: p.expire_warn === n ? 'selected' : null },
        n ? `${n} day${n === 1 ? '' : 's'} before` : 'Don’t warn',
      ),
    ),
  ) as HTMLSelectElement;
  modal(
    'When access ends',
    [
      field('Then', act),
      E('div', { class: 'cbi-value' }, [
        E('label', { class: 'cbi-value-title' }, 'Warn'),
        E('div', { class: 'cbi-value-field' }, [
          warn,
          E('div', { class: 'cbi-value-description' }, 'Shown in their portal and on the Overview.'),
        ]),
      ]),
    ],
    [
      cancelButton(),
      ' ',
      button(
        'Save',
        async () => {
          closeModal();
          await page.patch({ expire_action: act.value, expire_warn: warn.value }, 'Saved');
        },
        'positive',
      ),
    ],
  );
}

export function rename(page: PersonPage) {
  const input = E('input', { type: 'text', class: 'cbi-input-text', value: page.p.name, maxlength: 48 }) as HTMLInputElement;
  modal(
    'Rename',
    [field('Name', input)],
    [
      cancelButton(),
      ' ',
      button(
        'Save',
        async () => {
          closeModal();
          await page.patch({ name: input.value }, 'Renamed');
        },
        'positive',
      ),
    ],
  );
  setTimeout(() => input.select(), 50);
}

export async function remove(page: PersonPage) {
  const p = page.p;
  const ok = await confirmDialog(
    `Delete ${p.name}?`,
    `All ${p.devices.length} devices are disconnected immediately and the personal link stops working.`,
    'Delete',
    true,
  );
  if (ok && (await attempt(() => api.personDelete(p.id), 'Deleted'))) location.href = peopleUrl(p.server);
}
