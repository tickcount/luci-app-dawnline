// Dawnline's other versions in the portal's sheet: every release from GitHub
// as rows of one list, newest first (the one installed and a pre-release
// marked), five more at a press. A row opens the version's own page in the
// same sheet: its notes (flows/whats-new.ts) and Install at their foot; going
// back to an older version asks first. Under the list, a tag typed by hand.
// The install itself is the page's (Dawnline's update job in its sheet), so a
// pick closes this sheet and hands the tag over.

import { api, type Release } from '../api';
import { h } from '../../portal/dom';
import { closeSheet, glide, go, head, openSheet, showing, sub, type View } from '../../portal/ui/sheet';
import { badLine } from '../../portal/ui/bad-line';
import { shake } from '../../shared/shake';
import { fmtDay } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import { ic } from '../ui/icons';
import { errorText } from '../ui/toast';
import { askView } from './ask';
import { notesView, unread } from './whats-new';
import { putChildren } from '../../portal/ui/put';

/** A release tag as the router takes it (updates_run app@<tag>). */
const TAG = /^v?[0-9][0-9A-Za-z.+~-]{0,40}$/;
/** A page of releases, as the router reads them. */
const PAGE = 5;

/** Whether a version may be installed now: yes, not while a job runs, never by a login that only views. */
export type Can = 'yes' | 'busy' | 'view';

const older = (v: string, cur: string) => v.localeCompare(cur, undefined, { numeric: true }) < 0;

/** Pages already read (a failed one is not kept: opening it again asks once more). */
const pages = new Map<number, Release[]>();

function view(cur: string, install: (tag: string) => void, can: Can): View {
  const busy = can !== 'yes';
  let shown = 0;
  let more = true;
  const rows: HTMLElement[] = [];
  const list = h('div', { class: 'vers' });
  const pick = (tag: string) => {
    const v = tag.replace(/^v/, '');
    if (!older(v, cur)) {
      closeSheet();
      return install(tag);
    }
    go(() =>
      askView({
        icon: 'dawnline',
        tone: 'orange',
        title: fmt(_('Install Dawnline %s?'), v),
        text: [
          fmt(_('It is older than %s. A backup of the settings is made first; restore it from Backups if something looks wrong.'), cur),
        ],
        action: _('Install'),
        cls: 'warn',
        run: async () => {
          closeSheet();
          install(tag);
        },
      }),
    );
  };
  /** A version's own page: its notes, and what installs it (none for the one installed, or while a job runs). */
  const open = (r: Release) => {
    const v = r.tag.replace(/^v/, '');
    const foot =
      busy || v === cur
        ? null
        : h(
            'button',
            { type: 'button', class: `btn ${older(v, cur) ? 'warn' : 'accent'}`, onclick: () => pick(r.tag) },
            h('span', {}, fmt(_('Install %s'), v)),
          );
    go(() => notesView({ component: 'app', tag: r.tag, title: `Dawnline ${v}`, back: true, foot }));
  };
  const row = (r: Release) => {
    const v = r.tag.replace(/^v/, '');
    return h(
      'button',
      { type: 'button', class: 'chk ver', onclick: () => open(r) },
      h(
        'span',
        { class: 'chk-t' },
        h(
          'b',
          {},
          h('span', { class: 'mono' }, v),
          v === cur ? h('span', { class: 'ver-tag now' }, _('Installed')) : null,
          r.prerelease ? h('span', { class: 'ver-tag pre' }, _('Pre-release')) : null,
        ),
        r.published ? h('span', {}, fmtDay(r.published)) : null,
      ),
      ic('chevron', 'i ver-chev'),
    );
  };
  /** The list as it stands, and under it what there is to say or do: more of them, why there are none. */
  const draw = (tail: HTMLElement | null) =>
    glide(() =>
      putChildren(
        list,
        [rows.length ? h('div', { class: 'checks' }, ...rows) : null, tail].filter((x): x is HTMLElement => !!x),
      ),
    );
  const moreBtn = () =>
    h('button', { type: 'button', class: 'btn soft sm ver-more', onclick: () => void read() }, h('span', {}, _('Show older')));
  const read = async () => {
    const at = shown + 1;
    let got = pages.get(at);
    if (!got) {
      draw(h('p', { class: 'hint' }, _('Loading versions…')));
      try {
        got = (await api.updatesReleases(at)).releases;
        pages.set(at, got);
      } catch (e) {
        if (showing(el)) draw(unread(fmt(_('Failed to load versions: %s'), errorText(e)), () => void read()));
        return;
      }
      if (!showing(el)) return;
    }
    shown = at;
    more = got.length >= PAGE;
    rows.push(...got.map(row));
    draw(more ? moreBtn() : rows.length ? null : h('p', { class: 'hint' }, _('No versions found.')));
  };

  const field = h('input', {
    type: 'text',
    placeholder: _('Tag, e.g. 0.3.1'),
    'aria-label': _('Release tag'),
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    class: 'mono',
    'data-1p-ignore': true,
  }) as HTMLInputElement;
  const goBtn = h('button', { class: 'go', type: 'submit', 'aria-label': _('Install') }, ic('arrow'));
  const form = h('form', { class: 'field', autocomplete: 'off' }, field, goBtn);
  const { el: bad, say, unsay } = badLine();
  field.addEventListener('input', () => {
    unsay();
    goBtn.classList.toggle('ready', !!field.value.trim());
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = field.value.trim();
    if (!t) return;
    if (!TAG.test(t)) {
      say(_('Enter a release tag like 0.3.1'));
      return shake(form);
    }
    pick(t);
  });
  const el = h(
    'div',
    { class: 'view' },
    head(_('Other versions')),
    sub(
      can === 'busy'
        ? fmt(_('Installed: %s. Another version can be installed once the job under way is over.'), cur)
        : fmt(_('Installed: %s. Every release on GitHub, newest first.'), cur),
    ),
    list,
    busy ? null : h('p', { class: 'hint ver-name' }, _('A version by its tag')),
    busy ? null : form,
    busy ? null : bad,
  );
  void read();
  return { el, label: _('Other versions') };
}

/** Dawnline's releases; `install` runs a picked tag on the page (`can`: whether one may start now). */
export const versionsSheet = (cur: string, install: (tag: string) => void, can: Can) => openSheet(() => view(cur, install, can));
