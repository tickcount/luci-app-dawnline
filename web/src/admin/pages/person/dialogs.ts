// Person page dialogs: rename, note, when access ends, move to a server, new link, invite, delete.

import { E } from '../../e';
import { api } from '../../api';
import { button } from '../../ui/button';
import { cancelButton, closeModal, confirmDialog, modal } from '../../ui/modal';
import { copyText } from '../../ui/files';
import { attempt, notify } from '../../ui/toast';
import { liveField } from '../../ui/layout';
import { nameHelp } from '../../netcheck';
import { inviteCard } from '../../invite';
import { peopleUrl } from '../../urls';
import { fmt, plural } from '../../../shared/i18n';
import type { PersonPage } from './index';

const field = (label: string, el: Node) =>
  E('div', { class: 'cbi-value' }, [E('label', { class: 'cbi-value-title' }, label), E('div', { class: 'cbi-value-field' }, el)]);

export function invite(page: PersonPage) {
  const server = page.st.servers.find((s) => s.id === page.p.server)?.name ?? _('Home');
  void inviteCard(page.p, server);
}

/**
 * A new link locks the old one out of the portal, but not what it already
 * got: devices added through it keep their tunnel. They are offered for
 * removal here, ticked, so a leaked link is really contained.
 */
export async function newLink(page: PersonPage) {
  const p = page.p;
  const since = p.code_set ?? 0;
  const suspect = p.devices.filter((d) => d.created_by === 'portal' && d.created >= since);
  const boxes = suspect.map(
    (d) => E('input', { type: 'checkbox', id: `dl-rm-${d.id}`, checked: 'checked', 'data-id': d.id }) as HTMLInputElement,
  );
  const body: Node[] = [E('p', {}, _('The old link stops working right away.'))];
  if (suspect.length)
    body.push(
      E('p', {}, _('Devices added through the old link keep working until they are removed. Remove them too:')),
      E(
        'div',
        { class: 'dl-checklist' },
        suspect.map((d, i) => E('label', { for: `dl-rm-${d.id}` }, [boxes[i], ` ${d.name}`])),
      ),
    );
  const go = async () => {
    const remove = boxes.filter((b) => b.checked).map((b) => b.dataset.id as string);
    const r = await attempt(
      () => api.personRegen(p.id, remove),
      remove.length
        ? plural(remove.length, 'New link created, %s device removed', 'New link created, %s devices removed')
        : _('New link created'),
    );
    if (!r) return;
    closeModal();
    if (remove.length) await page.refresh();
    if (r.link) await copyText(r.link, _('New link copied'));
  };
  modal(_('Create a new link?'), body, [cancelButton(), ' ', button(_('Create new link'), go, 'negative')]);
}

export function editNote(page: PersonPage) {
  const input = E(
    'textarea',
    { class: 'cbi-input-textarea dl-note-input', rows: 3, maxlength: 500, placeholder: _('Only you see this') },
    page.p.note ?? '',
  ) as HTMLTextAreaElement;
  modal(
    _('Note'),
    [input],
    [
      cancelButton(),
      ' ',
      button(
        _('Save'),
        async () => {
          closeModal();
          await page.patch({ note: input.value.trim() }, input.value.trim() ? _('Note saved') : _('Note removed'));
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
    E('option', { value: 'pause', selected: p.expire_action === 'pause' ? 'selected' : null }, _('Pause access')),
    E('option', { value: 'notify', selected: p.expire_action === 'notify' ? 'selected' : null }, _('Keep access')),
    E('option', { value: 'remove', selected: p.expire_action === 'remove' ? 'selected' : null }, _('Remove their devices')),
  ]) as HTMLSelectElement;
  const warn = E(
    'select',
    { class: 'cbi-input-select' },
    [0, 1, 3, 7, 14].map((n) =>
      E(
        'option',
        { value: n, selected: p.expire_warn === n ? 'selected' : null },
        n ? plural(n, '%s day before', '%s days before') : _('Don’t warn'),
      ),
    ),
  ) as HTMLSelectElement;
  modal(
    _('When access ends'),
    [
      field(_('Then'), act),
      E('div', { class: 'cbi-value' }, [
        E('label', { class: 'cbi-value-title' }, _('Warn')),
        E('div', { class: 'cbi-value-field' }, [
          warn,
          E('div', { class: 'cbi-value-description' }, _('Shown in their portal and on the Overview.')),
        ]),
      ]),
    ],
    [
      cancelButton(),
      ' ',
      button(
        _('Save'),
        async () => {
          closeModal();
          await page.patch({ expire_action: act.value, expire_warn: warn.value }, _('Saved'));
        },
        'positive',
      ),
    ],
  );
}

export function rename(page: PersonPage) {
  const input = E('input', { type: 'text', class: 'cbi-input-text', value: page.p.name, maxlength: 48 }) as HTMLInputElement;
  const nameRow = liveField(_('Name', 'person'), input, () => nameHelp(input.value, [], _('Shown in their portal and apps.')));
  modal(
    _('Rename'),
    [nameRow],
    [
      cancelButton(),
      ' ',
      button(
        _('Save'),
        async () => {
          const h = nameRow.help();
          if (h.bad) {
            notify(h.text, 'warning');
            return;
          }
          // The dialog stays open on a refusal, with the name still typed.
          if (await page.patch({ name: input.value.trim() }, _('Renamed'))) closeModal();
        },
        'positive',
      ),
    ],
  );
  setTimeout(() => input.select(), 50);
}

/** Another server: every device gets an address there and needs its configuration again. */
export function moveToServer(page: PersonPage) {
  const p = page.p;
  const others = page.st.servers.filter((s) => s.id !== p.server);
  const sel = E(
    'select',
    { class: 'cbi-input-select' },
    others.map((s) => E('option', { value: s.id }, `${s.name} · ${s.endpoint || _('no address')}:${s.port}`)),
  ) as HTMLSelectElement;
  const n = p.devices.length;
  modal(
    fmt(_('Move %s to another server'), p.name),
    [
      field(_('Server'), sel),
      E(
        'p',
        { class: 'dl-muted' },
        n
          ? plural(
              n,
              '%s device gets a new address and stops connecting until it imports its configuration again (from the personal link or from you). Circles and home networks of the old server are left behind.',
              '%s devices get new addresses and stop connecting until they import their configuration again (from the personal link or from you). Circles and home networks of the old server are left behind.',
            )
          : _('They have no devices yet: nothing else changes.'),
      ),
    ],
    [
      cancelButton(),
      ' ',
      button(
        _('Move'),
        async () => {
          if (
            await page.patch({ server: sel.value }, fmt(_('Moved to %s'), others.find((s) => s.id === sel.value)?.name ?? _('the server')))
          ) {
            closeModal();
            if (n) notify(_('Devices are marked “Update config” until they import again.'), 'info', 6000);
          }
        },
        'positive',
      ),
    ],
  );
}

export async function remove(page: PersonPage) {
  const p = page.p;
  const ok = await confirmDialog(
    fmt(_('Delete %s?'), p.name),
    plural(
      p.devices.length,
      '%s device is disconnected immediately and the personal link stops working.',
      'All %s devices are disconnected immediately and the personal link stops working.',
    ),
    _('Delete'),
    true,
  );
  if (ok && (await attempt(() => api.personDelete(p.id), _('Deleted')))) location.href = peopleUrl(p.server);
}
