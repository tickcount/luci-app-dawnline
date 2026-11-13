// Settings › Personal portal: the page where each person adds and manages
// their devices with their link. Its switch (with the main link) over what
// did not pass of its Health checks, each with its fix (../health.ts); the
// addresses the links use as rows (the first is the main one; each says
// where it points, plain HTTP and Cloudflare in orange; Make main, copy and
// remove in sight; Add an address picks from what the router found or takes
// one typed in); the certificate as a term (cert.ts: its days, its file,
// your own files or automatic, ACME to install); its port and where unknown
// links go. Everything saves at once.

import { h, type Kid } from '../../../../portal/dom';
import { fmt, locale, plural } from '../../../../shared/i18n';
import { glass } from '../../../ui/glass';
import { ic } from '../../../ui/icons';
import { compList, compRow } from '../../../ui/comp-row';
import { switchRow, textRow } from '../../../ui/edit-rows';
import { copyText } from '../../../ui/files';
import { inlineEdit } from '../../../../portal/ui/inline-edit';
import { tabs } from '../../../ui/tabs';
import { cap, card, note, section } from '../../../ui/section';
import { portalPortHelp, urlHelp } from '../../../netcheck';
import { installSheet } from '../../../flows/install';
import { addAddressSheet, addressNote, certFilesSheet, type Candidate } from '../../../flows/portal-sheets';
import { certDays, certSoon, isIp, linkBase, portalHealth, portalState } from '../../../system/model';
import { healthAside, healthBlock } from '../health';
import { certTerm } from './cert';
import type { RouterCtx } from './ctx';
import { put } from './save';
import { putChildren } from '../../../../portal/ui/put';

interface Eff {
  portal_enabled: boolean;
  portal_host: string;
  portal_alt?: string[];
  portal_port: number;
}

/** The addresses the links use, the main one first. */
const pickedOf = (e: Eff): string[] => [e.portal_host, ...(e.portal_alt ?? [])].filter((x, i, a) => x && a.indexOf(x) === i);

const button = (cls: string, icon: string | null, label: string, run: () => void): HTMLElement =>
  h('button', { type: 'button', class: `btn ${cls} sm`, onclick: run }, icon ? ic(icon) : null, h('span', {}, label));

/** A notice with what the portal lacks (`icon`: its picture) and the button that installs it. */
const lacks = (icon: 'lock' | 'cert', tone: 'bad' | 'warn', title: string, text: string, act: Kid): HTMLElement =>
  h(
    'div',
    { class: `srv-note st-pa-note${tone === 'bad' ? ' bad' : ''}` },
    glass(icon, tone === 'bad' ? 'red' : 'orange'),
    h('span', { class: 'sn-t' }, h('b', {}, title), h('span', {}, text)),
    act,
  );

/** The addresses as rows: where each points, and what can be done with it. */
function addresses(y: RouterCtx, e: Eff, picked: string[]): HTMLElement {
  const found = !!y.portal;
  const cands = y.portal?.candidates ?? [];
  const known = (host: string): Candidate =>
    cands.find((x) => x.host === host) ?? { host, kind: isIp(host) ? 'ip' : 'name', ips: [], here: false, cloudflare: false, cert: false };
  const set = (list: string[], said: string) => put(y, { portal_host: list[0] ?? '', portal_alt: list.slice(1) }, said);
  const rows = picked.map((host, i) => {
    const n = addressNote(known(host), found);
    const url = linkBase(host, e.portal_port);
    const knob = (icon: string, label: string, run: () => void) =>
      h('button', { type: 'button', class: 'knob', 'aria-label': fmt(_('%s: %s'), label, host), title: label, onclick: run }, ic(icon));
    return compRow({
      icon: isIp(host) ? 'globe' : 'link',
      tone: n.warn ? 'orange' : i ? 'grey' : 'blue',
      title: [h('span', { class: 'mono st-pa-url' }, url), i ? null : h('span', { class: 'addr-main' }, _('Main'))],
      line: n.text,
      lineTone: n.warn ? 'warn' : '',
      cls: `st-pa${n.warn ? ' warn' : ''}`,
      acts: [
        y.write && i
          ? button(
              'soft',
              null,
              _('Make main'),
              () => void set([host, ...picked.filter((x) => x !== host)], fmt(_('Main address: %s'), host)),
            )
          : null,
        knob('copy', _('Copy'), () => void copyText(url, _('Address copied'))),
        y.write && picked.length > 1
          ? knob(
              'x',
              _('Remove'),
              () =>
                void set(
                  picked.filter((x) => x !== host),
                  fmt(_('Address removed: %s'), host),
                ),
            )
          : null,
      ],
    });
  });
  const add = y.write
    ? button('tint', 'plus', _('Add an address'), () =>
        addAddressSheet(cands, picked, async (host) => {
          await y.save({ portal_host: picked[0] ?? host, portal_alt: [...picked.slice(1), ...(picked.length ? [host] : [])] });
        }),
      )
    : null;
  return card(
    cap([_('Addresses'), picked.length ? ` · ${picked.length}` : null], add),
    picked.length ? compList(...rows) : null,
    picked.length ? note(_('People’s links work on every address; the first is the main one and goes into invitations.')) : null,
  );
}

/** The certificate: its term, its file, your own files or automatic; while it is self-signed, ACME to install for `host`. */
function certificate(y: RouterCtx, host: string): HTMLElement {
  const s = y.set.settings;
  const cert = y.set.cert;
  const need = y.set.needs ?? { https: [], acme: [], home: [] };
  const custom = !!(s.portal_cert && s.portal_key);
  const days = certDays(cert, y.now());
  const kind = !cert ? _('Portal is off') : custom ? _('Your files') : cert.self_signed ? _('Self-signed') : 'Let’s Encrypt';
  const until =
    cert && !cert.self_signed && cert.expires
      ? fmt(_('until %s'), new Date(cert.expires).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }))
      : '';
  const files = () =>
    certFilesSheet(s.portal_cert ?? '', s.portal_key ?? '', async (pc, pk) => {
      await y.save({ portal_cert: pc, portal_key: pk });
    });
  const acme =
    need.acme.length && (!cert || cert.self_signed)
      ? lacks(
          'cert',
          'warn',
          _('Free certificate from Let’s Encrypt'),
          host
            ? fmt(_('ACME isn’t installed. With it the router gets a certificate for %s and browsers stop warning.'), host)
            : _('ACME isn’t installed. With it the router gets a certificate and browsers stop warning.'),
          y.write ? button('tint', null, _('Install ACME'), () => installSheet('acme', need.acme, () => void y.reload())) : null,
        )
      : null;
  return card(
    cap(_('Certificate')),
    certTerm({
      days,
      title: kind,
      line: !cert
        ? _('Turn the portal on to see its certificate.')
        : cert.self_signed
          ? _('Made by the router: browsers warn until a certificate covers the address.')
          : until,
      file: cert && !cert.self_signed ? (custom ? `${s.portal_cert} · ${s.portal_key}` : cert.path) : undefined,
      warn: !!cert && (cert.self_signed || certSoon(days)),
      none: cert?.self_signed ? '∞' : '—',
      act: y.write
        ? [
            button('soft', 'file', custom ? _('Change files') : _('Use your own files'), files),
            custom ? button('soft', 'reset', _('Pick automatically'), () => void put(y, { portal_cert: '', portal_key: '' })) : null,
          ]
        : null,
    }),
    acme,
  );
}

/**
 * The portal's port as what it is: a part of every link. The main link is drawn with the port in its place, edited
 * there (ui/inline-edit.ts); the line under it says what the port means (HTTPS, open on the WAN, the next one for
 * links on IP addresses), or why a typed one is refused.
 */
function portTile(y: RouterCtx, e: Eff, picked: string[], ipLinks: boolean): HTMLElement {
  const taken = y.set.tcp_taken ?? [];
  const now = String(e.portal_port);
  const host = picked.find((x) => !isIp(x)) ?? '';
  const says = portalPortHelp(e.portal_port, taken, ipLinks).text;
  const line = h('p', { class: 'st-port-say' }, says);
  const say = (text: string | null, bad = false) => {
    line.textContent = text ?? says;
    line.className = `st-port-say${bad ? ' bad-t' : ''}`;
  };
  const value = y.write
    ? h(
        'button',
        { type: 'button', class: 'st-port-v kt-ie-v', title: _('Change'), 'aria-label': fmt('%s: %s. %s', _('Port'), now, _('Change')) },
        now,
      )
    : h('span', { class: 'st-port-v' }, now);
  if (y.write)
    value.addEventListener('click', () =>
      inlineEdit(value, {
        label: _('Port'),
        start: now,
        numeric: true,
        max: 5,
        refuse: (v) => {
          if (!/^\d{1,5}$/.test(v)) return _('Use 1–65535.');
          const r = portalPortHelp(Number(v), taken, ipLinks);
          return r.bad ? r.text : null;
        },
        commit: (v) => void put(y, { portal_port: v }, fmt(_('Port: %s'), v)),
        typing: (v) =>
          /^\d{1,5}$/.test(v) && say(portalPortHelp(Number(v), taken, ipLinks).text, portalPortHelp(Number(v), taken, ipLinks).bad),
        say,
      }),
    );
  return h(
    'div',
    { class: 'st-port' },
    h('span', { class: 'st-port-l' }, _('Port')),
    h(
      'div',
      { class: 'st-port-a mono' },
      // the link the port belongs to, quiet around it; no address yet: the port alone
      host ? h('span', { class: 'st-port-q' }, `https://${host}:`) : null,
      value,
      host ? h('span', { class: 'st-port-q' }, '/…') : null,
    ),
    line,
  );
}

/**
 * What a link nobody was given opens: a bare «Not found», or another address it is sent to. A choice of two with
 * the address under the second; one line says what the picked one does.
 */
function unknownTile(y: RouterCtx): HTMLElement {
  const url = y.set.settings.portal_redirect ?? '';
  const box = h('div', { class: 'st-unk' });
  let own = !!url;
  const draw = () => {
    const track = tabs<'none' | 'url'>(
      [
        { id: 'none', label: _('“Not found”') },
        { id: 'url', label: _('Another address') },
      ],
      own ? 'url' : 'none',
      (id) => {
        own = id === 'url';
        // back to «Not found» with an address saved: it is let go; to an address: its field first
        if (!own && url) return void put(y, { portal_redirect: '' }, _('Unknown links: “Not found”'));
        draw();
        if (own) box.querySelector<HTMLElement>('.editrow')?.click();
      },
      { cls: 'st-unk-track', label: _('Unknown links'), keep: 'unknown-links' },
    );
    if (!y.write) track.el.setAttribute('aria-disabled', 'true');
    const kids: (HTMLElement | null)[] = [
      h('b', { class: 'st-unk-t' }, _('Unknown links')),
      track.el,
      own
        ? textRow(
            {
              label: _('Address'),
              value: url || 'https://…',
              start: url,
              mono: true,
              plain: true,
              refuse: (v) => (!v ? _('Must start with http:// or https://.') : urlHelp(v).bad ? urlHelp(v).text : null),
              save: async (v) => {
                await y.save({ portal_redirect: v });
                return v;
              },
            },
            y.write,
          )
        : null,
      h(
        'p',
        { class: 'st-port-say' },
        own
          ? _('A link nobody was given is sent to this address, so the portal does not show itself to a stranger.')
          : _('A link nobody was given opens a bare “Not found” page.'),
      ),
    ];
    putChildren(
      box,
      kids.filter((k): k is HTMLElement => !!k),
    );
  };
  draw();
  return box;
}

/** After the title: off, cannot start, what did not pass, the certificate's days, else how many checks passed. */
function aside(o: { state: ReturnType<typeof portalState>; days: number | null; failed: ReturnType<typeof portalHealth> }): Kid {
  const st = (text: string, tone = '') => h('span', { class: 'kt-sx-st val' }, h('span', { class: tone || null }, text));
  switch (o.state.state) {
    case 'off':
      return st(_('Off', 'portal'));
    case 'blocked':
      return st(_('Can’t start'), 'bad-t');
    case 'cert':
      return st(fmt(_('Certificate: %s'), plural(Math.max(0, o.days ?? 0), '%s day', '%s days')), 'warn-t');
    default:
      return healthAside(o.failed);
  }
}

export function portalSection(y: RouterCtx): HTMLElement {
  const e = y.set.effective as unknown as Eff;
  const need = y.set.needs ?? { https: [], acme: [], home: [] };
  const picked = pickedOf(e);
  const main = picked[0] ? linkBase(picked[0], e.portal_port) : '';
  const ipLinks = picked.some(isIp);
  const days = certDays(y.set.cert, y.now());
  // the Health checks once they are in; until then the portal's own, which arrive with its addresses
  const health = e.portal_enabled ? portalHealth(y.checks ?? y.portal?.checks ?? []) : { failed: [], passed: 0 };
  const state = portalState({ enabled: e.portal_enabled, host: e.portal_host, blocked: !!need.https.length, days, failed: health.failed });
  // a failed check that installs the HTTPS packages says the same with the same button
  const https =
    need.https.length && !health.failed.some((k) => k.fix === 'install:https')
      ? lacks(
          'lock',
          'bad',
          _('HTTPS isn’t available on this router'),
          fmt(
            _('The portal needs %s. It can’t start without them.'),
            new Intl.ListFormat(locale(), { type: 'conjunction' }).format(need.https),
          ),
          y.write ? button('tint', null, _('Install'), () => installSheet('https', need.https, () => void y.reload())) : null,
        )
      : null;
  return section(
    {
      id: 'portal',
      icon: 'portal',
      title: _('Personal portal'),
      tone: state.tone === 'bad' ? 'red' : state.tone === 'warn' ? 'orange' : 'grey',
      aside: aside({ state, days, failed: health }),
    },
    card(
      healthBlock(health.failed, { write: y.write, fix: (f) => y.fix(f) }),
      switchRow(
        {
          title: _('Personal portal'),
          sub: e.portal_enabled
            ? main || _('A page where each person adds and manages their devices with their personal link.')
            : _('Off: personal links do not open.'),
          on: e.portal_enabled,
          icon: 'portal',
          flip: (on) => put(y, { portal_enabled: on ? '1' : '0' }),
        },
        y.write,
      ),
      https,
    ),
    addresses(y, e, picked),
    card(portTile(y, e, picked, ipLinks), unknownTile(y)),
    // the certificate last: it follows from the address and the port over it
    certificate(y, e.portal_host),
  );
}
