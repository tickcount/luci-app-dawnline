// "What's new" in the portal's sheet: a release's notes (Dawnline by tag, or
// the AmneziaWG build's release) as the router fetched them from GitHub,
// without their "What's new" heading and Install section (updater/markdown.ts),
// its date and whether it is a pre-release on one row with two quiet keys (Copy, the page on GitHub).
// The same view is a version's page among Dawnline's other versions
// (flows/versions.ts): a step with the way back and what installs it at its foot.

import { api } from '../api';
import { h, put } from '../../portal/dom';
import { glide, head, openSheet, showing, type View } from '../../portal/ui/sheet';
import { fmtDay } from '../../shared/format';
import { ic } from '../ui/icons';
import { copyText } from '../ui/files';
import { tip } from '../../portal/ui/tip';
import { errorText } from '../ui/toast';
import { forRouter, markdown, safeHref } from '../updater/markdown';
import { putChildren } from '../../portal/ui/put';

export interface Notes {
  component: 'app' | 'amneziawg';
  tag: string;
  title: string;
  /** The AmneziaWG build whose release it is. */
  build?: string;
  /** A step of a flow: the head has the way back. */
  back?: boolean;
  /** What stands under the notes (a version's Install). */
  foot?: HTMLElement | null;
}

/** What stands in a list's place while there is none: why, and the way to ask again. */
export function unread(why: string, again: () => void): HTMLElement {
  return h(
    'div',
    { class: 'rd-none' },
    h('span', {}, why),
    h('button', { type: 'button', class: 'btn soft sm', onclick: again }, h('span', {}, _('Try again'))),
  );
}

export function notesView(o: Notes): View {
  const body = h('div', { class: 'notes' });
  const meta = h('div', { class: 'notes-meta' });
  const el = h(
    'div',
    { class: 'view' },
    head(o.title, { back: o.back }),
    meta,
    body,
    o.foot ? h('div', { class: 'btnrow' }, o.foot) : null,
  );
  const read = () => {
    putChildren(body, [h('p', { class: 'hint' }, _('Loading release notes…'))]);
    void api
      .updatesNotes(o.component, o.tag, o.build ?? '')
      .then((r) => {
        if (!showing(el)) return;
        const text = forRouter(r.body || '');
        const url = safeHref(r.url);
        const copy = h(
          'button',
          { type: 'button', class: 'knob notes-k', 'aria-label': _('Copy'), onclick: () => void copyText(text, _('Release notes copied')) },
          ic('copy'),
        );
        const open = url
          ? h('a', { class: 'knob notes-k', href: url, target: '_blank', rel: 'noopener', 'aria-label': _('On GitHub') }, ic('open'))
          : null;
        tip(copy, () => _('Copy'));
        if (open) tip(open, () => _('On GitHub'));
        glide(() => {
          put(
            meta,
            r.published ? h('span', { class: 'notes-date' }, fmtDay(r.published)) : null,
            r.prerelease ? h('span', { class: 'notes-pre' }, _('Pre-release')) : null,
            h('span', { class: 'sp' }),
            // two quiet keys with their names as tooltips: words here wrapped to a second row on a phone
            text.trim() ? copy : null,
            url ? open : null,
          );
          putChildren(body, text.trim() ? markdown(text) : [h('p', { class: 'hint' }, _('This release has no notes.'))]);
        });
      })
      .catch((e) => showing(el) && glide(() => putChildren(body, [unread(errorText(e), () => glide(read))])));
  };
  read();
  return { el, label: o.title };
}

/** The notes of `tag` in the sheet; `build`: the AmneziaWG build whose release it is. */
export const whatsNew = (component: 'app' | 'amneziawg', tag: string, title: string, build?: string) =>
  openSheet(() => notesView({ component, tag, title, build }));
