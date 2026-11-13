// A person's invite in the portal's sheet (the concept's inviteView, on the
// old admin's invite card): their personal link as a big QR code with its
// three words and the server's name, Copy link, Share (the card as a file, or
// the link, as the browser can) and Card (the picture saved), the link's other
// addresses folded under one row (an HTTP one marked), and the three steps
// the person takes. Its ⋯ makes a new link: the old one stops at once, and
// the devices added through it may go with it (ticked; asked in the same
// sheet). Also the step after adding someone: the same view, "is ready".
// The link is never in the status: it is asked for (person_links, write only).

import type { Person } from '../../shared/types';
import { api } from '../api';
import { h } from '../../portal/dom';
import { go, head, openSheet, sub, type View } from '../../portal/ui/sheet';
import { openMenu } from '../../portal/ui/menu';
import { once } from '../../portal/ui/feedback';
import { fmt, plural } from '../../shared/i18n';
import { ic } from '../ui/icons';
import { knob } from '../ui/page-head';
import { copyText, downloadFile } from '../ui/files';
import { attempt, errorText, notify } from '../ui/toast';
import { qrBox } from '../shell/qr';
import { choiceRow } from '../ui/choice-row';
import { askView } from './ask';
import { inviteCardFile } from './invite-card';

export interface InviteCtx {
  person: Pick<Person, 'id' | 'name' | 'devices' | 'code_set'>;
  /** The server's name (on the card). */
  server: string;
  /** Its title and line when it is the step after adding them. */
  ready?: boolean;
  /** Devices were removed with an old link: the page reads the router again. */
  changed?: () => void;
}

interface Links {
  link: string;
  links: string[];
}

/** The personal link and its other addresses; null (said in a toast) while the portal is off. */
async function linksOf(id: string): Promise<Links | null> {
  const r = await attempt(() => api.personLinks(id));
  if (!r) return null;
  if (!r.link) {
    notify(_('The personal portal is off. Turn it on in Settings.'), 'warning');
    return null;
  }
  return { link: r.link, links: r.links ?? [] };
}

const bare = (l: string) => l.replace(/^https?:\/\//, '');

/** Share what the browser can: the card as a file, else the link; null where it can share neither. */
function shareOf(c: InviteCtx, file: () => Promise<File>, link: string): (() => Promise<void>) | null {
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (typeof nav.share !== 'function') return null;
  const title = fmt(_('Invite %s'), c.person.name);
  return async () => {
    try {
      const f = await file();
      if (nav.canShare?.({ files: [f] })) await nav.share({ files: [f], title });
      else await nav.share({ url: link, title, text: _('Your personal VPN link') });
    } catch (e) {
      // Closing the share sheet is no error.
      if ((e as Error)?.name !== 'AbortError') notify(errorText(e), 'error');
    }
  };
}

function inviteView(c: InviteCtx, l: Links): View {
  const p = c.person;
  const word = new URL(l.link).pathname.slice(1);
  let card: Promise<File> | null = null;
  const file = () => (card ??= inviteCardFile(p, c.server, l.link));
  const share = shareOf(c, file, l.link);
  const others = l.links.filter((x) => x !== l.link);
  const http = others.filter((x) => x.startsWith('http:')).length;
  const more = knob('more', _('New link'));
  more.addEventListener('click', () =>
    openMenu(more, [{ label: _('New link'), icon: 'link', tone: 'warn', run: () => go(() => newLinkView(c)) }], p.name),
  );
  const el = h(
    'div',
    { class: 'view inv-v' },
    head(c.ready ? fmt(_('%s is ready'), p.name) : fmt(_('Invite · %s'), p.name), { acts: true }),
    sub(fmt(_('With this link %s adds their devices and takes their set-up. No account needed.'), p.name)),
    h(
      'div',
      { class: 'inv-card' },
      qrBox(l.link),
      h('div', { class: 'inv-code' }, h('b', { class: 'mono' }, word), h('span', {}, c.server)),
    ),
    h(
      'button',
      { type: 'button', class: 'btn accent block', onclick: () => void copyText(l.link, _('Personal link copied')) },
      ic('copy'),
      h('span', {}, _('Copy link')),
    ),
    h(
      'div',
      { class: 'btnrow' },
      share
        ? h(
            'button',
            { type: 'button', class: 'btn soft', onclick: (e: Event) => void once(e.currentTarget as HTMLButtonElement, share) },
            ic('share'),
            h('span', {}, _('Share')),
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'btn soft',
          onclick: (e: Event) =>
            void once(e.currentTarget as HTMLButtonElement, async () => {
              try {
                const f = await file();
                downloadFile(f.name, f);
              } catch (err) {
                notify(errorText(err), 'error');
              }
            }),
        },
        ic('download'),
        h('span', {}, _('Card')),
      ),
    ),
    others.length
      ? h(
          'div',
          { class: 'inv-more' },
          choiceRow({
            title: _('Other addresses'),
            value: http
              ? fmt(_('%s, %s over HTTP'), String(others.length), String(http))
              : plural(others.length, '%s address', '%s addresses'),
            options: others.map((x) => ({ id: x, label: bare(x), title: x.startsWith('http:') ? _('HTTP: not encrypted') : x })),
            on: [],
            multi: true,
            // A chip copies its address (nothing is picked).
            pick: async (on) => {
              const x = on[0];
              if (x) await copyText(x, _('Link copied'));
              return null;
            },
          }),
        )
      : null,
  );
  return { el, label: fmt(_('Invite %s'), p.name), acts: more };
}

/**
 * A new link: the old one stops working at once (the portal checks the code on every request). Devices added
 * through it keep their tunnel unless removed with it: those added on the portal since it was made are offered,
 * ticked, so a leaked link is really contained.
 */
function newLinkView(c: InviteCtx): View {
  const p = c.person;
  const since = p.code_set ?? 0;
  const suspect = p.devices.filter((d) => d.created_by === 'portal' && d.created >= since);
  let remove = suspect.map((d) => d.id);
  const pickRow = suspect.length
    ? choiceRow({
        title: _('Remove with it'),
        value: plural(remove.length, '%s device', '%s devices'),
        options: suspect.map((d) => ({ id: d.id, label: d.name })),
        on: remove,
        multi: true,
        open: true,
        note: _('Added on the portal through the old link: they keep working until they are removed.'),
        pick: async (on) => {
          remove = on;
          return plural(on.length, '%s device', '%s devices');
        },
      })
    : null;
  const v = askView({
    icon: 'link',
    tone: 'orange',
    title: fmt(_('A new link for %s?'), p.name),
    text: [_('The old link stops working right away. Send them the new one.')],
    action: _('Make a new link'),
    cls: 'warn',
    run: async () => {
      const r = await api.personRegen(p.id, remove);
      if (r.removed) c.changed?.();
      notify(
        r.removed ? plural(r.removed, 'New link made, %s device removed', 'New link made, %s devices removed') : _('New link made'),
        'success',
        3000,
      );
      const link = r.link;
      if (!link) return;
      const links = await api.personLinks(p.id).then(
        (x) => x.links,
        () => [link],
      );
      const kept = { ...c, person: { ...p, devices: p.devices.filter((d) => !remove.includes(d.id)), code_set: Date.now() / 1000 } };
      go(() => inviteView(kept, { link, links: links.length ? links : [link] }));
    },
  });
  if (pickRow) v.el.querySelector('.ask > p')?.after(pickRow);
  return v;
}

/** The invite in the sheet (its link asked for first). */
export async function openInvite(c: InviteCtx) {
  const l = await linksOf(c.person.id);
  if (l) openSheet(() => inviteView(c, l));
}

/** The invite as the next view of a sheet already open (after adding someone), with the link the router gave. */
export async function inviteNext(c: InviteCtx, link: string) {
  const r = await api.personLinks(c.person.id).catch(() => null);
  go(() => inviteView(c, { link, links: r?.links?.length ? r.links : [link] }));
}
