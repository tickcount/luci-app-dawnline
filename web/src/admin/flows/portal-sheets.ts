// The personal portal's sheets on the System page: another address for the
// links (what the router found and is not picked yet, each with where it
// points; or one typed in, checked as the router would), and the
// certificate's own files (two paths on the router; both empty: picked
// automatically). Each saves through `save` and closes once it took.

import type { PortalInfo } from '../api';
import { h } from '../../portal/dom';
import { closeSheet, head, openSheet, sub, type View } from '../../portal/ui/sheet';
import { once } from '../../portal/ui/feedback';
import { badLine } from '../../portal/ui/bad-line';
import { shake } from '../../shared/shake';
import { fmt } from '../../shared/i18n';
import { glass } from '../ui/glass';
import { ic } from '../ui/icons';
import { errorText } from '../ui/toast';
import { hostHelp, type Help } from '../netcheck';
import { field } from './form';

export type Candidate = PortalInfo['candidates'][number];

const isIp = (x: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x);

/** Where an address points, in words, and whether that is a warning (plain HTTP, Cloudflare, elsewhere). */
export function addressNote(x: Candidate, found: boolean): { text: string; warn: boolean } {
  if (x.kind === 'ip' || isIp(x.host)) return { text: _('Plain HTTP: the link and VPN keys travel unencrypted'), warn: true };
  if (x.cloudflare) return { text: _('Behind Cloudflare · often stalls in Russia'), warn: true };
  if (!x.ips.length) return { text: found ? _('Your address') : _('Checking where it points…'), warn: false };
  if (x.here)
    return {
      text: x.cert ? _('Points at this router · Let’s Encrypt certificate') : _('Points at this router · no certificate yet'),
      warn: false,
    };
  return { text: fmt(_('Points at %s, not this router'), x.ips.join(', ')), warn: true };
}

function addView(cands: Candidate[], picked: string[], save: (host: string) => Promise<void>): View {
  const free = cands.filter((x) => !picked.includes(x.host));
  const { el: bad, say, unsay } = badLine();
  const take = async (host: string) => {
    await save(host);
    closeSheet();
  };
  const opts = free.map((x) => {
    const n = addressNote(x, true);
    const b = h(
      'button',
      { type: 'button', class: 'opt', role: 'listitem' },
      glass(isIp(x.host) ? 'globe' : 'link', n.warn ? 'orange' : x.here ? 'blue' : 'grey'),
      h('span', { class: 'opt-t' }, h('b', { class: 'mono' }, x.host), h('span', { class: n.warn ? 'warn-t' : '' }, n.text)),
      ic('plus', 'i opt-chev'),
    ) as HTMLButtonElement;
    b.addEventListener('click', () =>
      once(b, async () => {
        try {
          await take(x.host);
        } catch (e) {
          say(errorText(e));
        }
      }),
    );
    return b;
  });
  const input = h('input', {
    type: 'text',
    placeholder: _('vpn.example.com or an IP'),
    'aria-label': _('Other address'),
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    class: 'mono',
    'data-1p-ignore': true,
  }) as HTMLInputElement;
  const goBtn = h('button', { class: 'go ready', type: 'submit', 'aria-label': _('Add') }, ic('arrow')) as HTMLButtonElement;
  const form = h('form', { class: 'field', autocomplete: 'off' }, input, goBtn);
  input.addEventListener('input', () => unsay());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim().toLowerCase();
    const check = hostHelp(v);
    if (check.bad) {
      say(check.text);
      return shake(form);
    }
    if (picked.includes(v)) return closeSheet();
    void once(goBtn, async () => {
      try {
        await take(v);
      } catch (err) {
        say(errorText(err));
        shake(form);
      }
    });
  });
  requestAnimationFrame(() => (free.length ? null : input.focus({ preventScroll: true })));
  const el = h(
    'div',
    { class: 'view' },
    head(_('Add an address')),
    sub(_('Links work on every picked address; the first is the main one.')),
    free.length ? h('div', { class: 'opts', role: 'list' }, ...opts) : null,
    free.length ? h('p', { class: 'hint pa-or' }, _('Or another one:')) : null,
    form,
    bad,
  );
  return { el, label: _('Add an address') };
}

/** Pick another address for the links; `save` adds it (rejects with the router's reason). */
export const addAddressSheet = (cands: Candidate[], picked: string[], save: (host: string) => Promise<void>) =>
  openSheet(() => addView(cands, picked, save));

const pathHelp = (v: string): Help =>
  !v.trim() || v.trim().startsWith('/') ? { text: '', bad: false } : { text: _('A full path on the router, starting with /.'), bad: true };

function certView(cert: string, key: string, save: (cert: string, key: string) => Promise<void>): View {
  const c = field(_('Certificate file'), cert, pathHelp, { placeholder: '/etc/ssl/…/fullchain.crt', mono: true, plain: true });
  const k = field(_('Key file'), key, pathHelp, { placeholder: '/etc/ssl/…/key', mono: true, plain: true });
  const { el: bad, say } = badLine();
  const ok = h('button', { type: 'button', class: 'btn accent' }, h('span', {}, _('Save'))) as HTMLButtonElement;
  ok.addEventListener('click', () =>
    once(ok, async () => {
      if (!c.check() || !k.check()) return;
      try {
        await save(c.value(), k.value());
        closeSheet();
      } catch (e) {
        say(errorText(e));
        shake(ok);
      }
    }),
  );
  const el = h(
    'div',
    { class: 'view' },
    head(_('Use your own certificate')),
    sub(_('Paths on the router. Leave both empty to pick a certificate automatically.')),
    c.el,
    k.el,
    bad,
    h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'btn soft', onclick: () => closeSheet() }, _('Cancel')), ok),
  );
  return { el, label: _('Use your own certificate') };
}

/** The certificate's own files; `save` stores both paths. */
export const certFilesSheet = (cert: string, key: string, save: (cert: string, key: string) => Promise<void>) =>
  openSheet(() => certView(cert, key, save));
