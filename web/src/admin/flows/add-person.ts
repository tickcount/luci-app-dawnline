// Adding a person in the portal's sheet (the concept's addPersonView): their
// name in the portal's field with its arrow; the networks they reach (a
// track); their server (only with more than one), device limit, end date and
// data limit as choice rows, each with its default. The networks and the data
// limit come back as last time in this browser (most people are alike).
// Create makes them and the same sheet turns to their invite (flows/invite.ts,
// "is ready"); without the portal there is no link: it says so and offers
// their page.

import type { Person, Status } from '../../shared/types';
import { api } from '../api';
import { h } from '../../portal/dom';
import { go, head, hint, openSheet, type View } from '../../portal/ui/sheet';
import { badLine } from '../../portal/ui/bad-line';
import { once } from '../../portal/ui/feedback';
import { addMonthsClamped } from '../../shared/format';
import { fmt, num, plural } from '../../shared/i18n';
import { shake } from '../../shared/shake';
import { nameHelp } from '../netcheck';
import { ic } from '../ui/icons';
import { tabs } from '../ui/tabs';
import { choiceRow } from '../ui/choice-row';
import { errorText } from '../ui/toast';
import { personUrl } from '../shell/routes';
import { inviteNext } from './invite';

export interface AddPersonCtx {
  st: Status;
  today: string;
  /** The server People is filtered to: picked first. */
  server?: string;
  /** Once they exist: the page reads the router again. */
  added(id: string): void;
}

const LAST = 'dl.person.last';

/** What the last person got (access, data limit), as this browser remembers it. */
function last(): { access?: Person['access']; quota?: string } {
  try {
    return JSON.parse(localStorage.getItem(LAST) ?? '{}') as { access?: Person['access']; quota?: string };
  } catch {
    return {};
  }
}
function remember(v: { access: Person['access']; quota: string }) {
  try {
    localStorage.setItem(LAST, JSON.stringify(v));
  } catch {
    /* no storage: nothing to remember */
  }
}

/** A network choice's words on the track. */
const accessTab = (a: Person['access']): string => ({ internet: _('Internet'), lan: _('Home', 'access'), both: _('Both', 'access') })[a];

const TERMS = ['', '1', '3', '12'] as const;
const termLabel = (t: string): string => (t ? plural(Number(t), '%s month', '%s months') : _('No end date'));
const QUOTAS = ['', '10', '50', '100'] as const;
const quotaLabel = (q: string): string => (q ? fmt(_('%s GB a month'), num(Number(q))) : _('No limit'));

function vAdd(c: AddPersonCtx): View {
  const was = last();
  let access: Person['access'] = was.access ?? 'internet';
  let server = c.server && c.st.servers.some((s) => s.id === c.server) ? c.server : (c.st.servers[0]?.id ?? '');
  let limit = c.st.settings.default_device_limit || 3;
  let term = '';
  let quota = (QUOTAS as readonly string[]).includes(was.quota ?? '') ? (was.quota ?? '') : '';
  const input = h('input', {
    type: 'text',
    placeholder: _('Name'),
    'aria-label': _('Name'),
    autocomplete: 'off',
    maxlength: 48,
    'data-1p-ignore': true,
  }) as HTMLInputElement;
  const goBtn = h('button', { class: 'go ready', type: 'submit', 'aria-label': _('Create') }, ic('arrow')) as HTMLButtonElement;
  const form = h('form', { class: 'field', autocomplete: 'off' }, input, goBtn);
  const { el: err, say, unsay } = badLine();
  input.addEventListener('input', () => unsay());
  const nets = tabs(
    (['internet', 'lan', 'both'] as const).map((a) => ({ id: a, label: accessTab(a) })),
    access,
    (a) => (access = a),
    { cls: 'in-row', label: _('Networks') },
  );
  const rows = h(
    'div',
    { class: 'add-rows' },
    c.st.servers.length > 1
      ? choiceRow({
          title: _('Server'),
          value: c.st.servers.find((s) => s.id === server)?.name ?? '',
          options: c.st.servers.map((s) => ({ id: s.id, label: s.name })),
          on: [server],
          pick: async ([id]) => {
            server = id;
            return c.st.servers.find((s) => s.id === id)?.name ?? '';
          },
        })
      : null,
    choiceRow({
      title: _('Devices'),
      value: fmt(_('up to %s'), num(limit)),
      options: ['1', '2', '3', '5', '10'].map((n) => ({ id: n, label: n })),
      on: [String(limit)],
      pick: async ([n]) => {
        limit = Number(n);
        return fmt(_('up to %s'), num(limit));
      },
    }),
    choiceRow({
      title: _('Term'),
      value: termLabel(term),
      options: TERMS.map((t) => ({ id: t, label: termLabel(t) })),
      on: [term],
      pick: async ([t]) => {
        term = t;
        return termLabel(t);
      },
    }),
    choiceRow({
      title: _('Traffic'),
      value: quotaLabel(quota),
      options: QUOTAS.map((q) => ({ id: q, label: q ? fmt(_('%s GB'), num(Number(q))) : _('No limit') })),
      on: [quota],
      pick: async ([q]) => {
        quota = q;
        return quotaLabel(q);
      },
    }),
  );
  const create = async () => {
    const name = input.value.trim();
    const help = nameHelp(
      name,
      c.st.people.map((p) => p.name),
    );
    if (help.bad) {
      say(help.text);
      shake(form);
      input.focus();
      return;
    }
    try {
      const expires = term ? addMonthsClamped(c.today, Number(term)) : '';
      const r = await api.personCreate(name, '', server, access, String(limit), expires, quota, 'month');
      remember({ access, quota });
      c.added(r.id);
      const p = { id: r.id, name, devices: [], code_set: Date.now() / 1000 };
      const srv = c.st.servers.find((s) => s.id === server)?.name ?? '';
      if (r.link) await inviteNext({ person: p, server: srv, ready: true }, r.link);
      else go(() => noLinkView(r.id, name));
    } catch (e) {
      say(errorText(e));
      shake(form);
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void once(goBtn, create);
  });
  requestAnimationFrame(() => input.focus({ preventScroll: true }));
  const el = h(
    'div',
    { class: 'view add-v' },
    head(_('New person')),
    form,
    err,
    h('div', { class: 'choice' }, h('div', { class: 'choice-h' }, h('span', {}, _('Networks'))), nets.el),
    rows,
    hint(_('All of it can be changed later on their page. Their invite comes next, in this sheet.')),
  );
  return { el, label: _('New person') };
}

/** Created, but the portal is off: no link to give. Their page is where devices are added for them. */
function noLinkView(id: string, name: string): View {
  const el = h(
    'div',
    { class: 'view' },
    head(fmt(_('%s is ready'), name)),
    hint(_('Turn on the personal portal in System to get their link, or add their devices yourself on their page.')),
    h('a', { class: 'btn accent block', href: personUrl(id) }, h('span', {}, _('Open their page'))),
  );
  return { el, label: fmt(_('%s is ready'), name) };
}

export const addPerson = (c: AddPersonCtx) => openSheet(() => vAdd(c));
