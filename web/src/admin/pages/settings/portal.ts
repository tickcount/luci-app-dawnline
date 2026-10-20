// Settings → Personal portal: the address in links (picked from what the
// router found), a preview, readiness, and the rest folded away.

import type { PortalInfo } from '../../api';
import { E } from '../../e';
import { button } from '../../ui/button';
import { cancelButton, closeModal, modal } from '../../ui/modal';
import { input, isOn, sw } from '../../ui/controls';
import { firstBad, group, liveRow, needRow, row } from '../../ui/layout';
import { hostHelp, portalPortHelp, urlHelp } from '../../netcheck';
import { icon } from '../../../shared/icons';
import { fmtDay } from '../../../shared/format';
import { fmt, locale, num, plural } from '../../../shared/i18n';
import { installMissing } from '../../pkgs';
import { notify } from '../../ui/toast';
import { section, type SettingsHost } from './common';

/** Summary of the portal checks: those that failed or warn, and the worst state. */
function verdict(checks: PortalInfo['checks']) {
  const shown = checks.filter((x) => x.status !== 'skip');
  const bad = shown.filter((x) => x.status === 'error' || x.status === 'warn');
  const worst = shown.some((x) => x.status === 'error') ? 'error' : bad.length ? 'warn' : 'ok';
  return { bad, worst };
}

/** Personal portal: the address in links (picked from what the router found), a preview, readiness, and the rest folded away. */
export function portalCard(host: SettingsHost): HTMLElement {
  const s = host.d.settings;
  const eff = host.d.effective as Record<string, any>;
  const c = host.d.cert;
  const pOn = sw(eff.portal_enabled, _('Enable portal'));
  const port = input(s.portal_port, { placeholder: '8443', inputmode: 'numeric', class: 'cbi-input-text dl-w-port' });
  const redirect = input(s.portal_redirect, { placeholder: _('Show “Not found”'), class: 'cbi-input-text dl-mono' });
  const other = input('', { placeholder: _('vpn.example.com or an IP'), 'aria-label': _('Other address') });
  const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
  // Chosen addresses, the main one first; custom ones join the list of options.
  let picked: string[] = [eff.portal_host, ...(eff.portal_alt ?? [])].filter(
    (h: string, i: number, a: string[]) => h && a.indexOf(h) === i,
  );
  // Until the router has looked the addresses up, only the chosen ones are listed.
  let found = !!host.portal;
  let rows: PortalInfo['candidates'] = [];
  const addRow = (h: string) => {
    if (h && !rows.some((x) => x.host === h))
      rows.push({ host: h, kind: isIp(h) ? 'ip' : 'name', ips: [], here: false, cloudflare: false, cert: false });
  };
  const takeCands = (cands: PortalInfo['candidates']) => {
    // Found addresses first (best first), then the chosen and added ones the router doesn't know.
    rows = [...cands, ...rows.filter((x) => !cands.some((y) => y.host === x.host))];
    if (!picked.length && cands[0]) picked = [cands[0].host];
  };
  if (host.portal) takeCands(host.portal.candidates);
  picked.forEach(addRow);

  const note = (x: PortalInfo['candidates'][number]): Node =>
    x.kind === 'ip'
      ? E('span', { class: 'dl-addr-warn' }, [icon('alert'), _('Plain HTTP: the link and VPN keys travel unencrypted')])
      : E(
          'span',
          { class: 'dl-sub' },
          x.cloudflare
            ? _('Behind Cloudflare · often stalls in Russia')
            : !x.ips.length
              ? found
                ? _('Your address')
                : _('Checking where it points…')
              : x.here
                ? x.cert
                  ? _('Points at this router · Let’s Encrypt certificate')
                  : _('Points at this router · no certificate yet')
                : fmt(_('Points at %s, not this router'), x.ips.join(', ')),
        );
  const opts = E('div', { class: 'dl-addr-opts', role: 'group', 'aria-label': _('Portal addresses') });
  const toggle = (h: string) => {
    if (picked.includes(h)) {
      if (picked.length > 1) picked = picked.filter((x) => x !== h);
    } else picked = [...picked, h];
    paintOpts();
    paintLinks();
  };
  const paintOpts = () =>
    dom.content(opts, [
      ...rows.map((x) => {
        const on = picked.includes(x.host),
          main = picked[0] === x.host;
        return E(
          'div',
          {
            class: `dl-addr-opt${on ? ' on' : ''}`,
            role: 'checkbox',
            'aria-checked': on ? 'true' : 'false',
            tabindex: '0',
            click: () => toggle(x.host),
            keydown: (ev: KeyboardEvent) => {
              if (ev.key === ' ' || ev.key === 'Enter') {
                ev.preventDefault();
                toggle(x.host);
              }
            },
          },
          [
            E('i', { class: 'dl-addr-check' }, on ? icon('check') : ''),
            E('span', { class: 'dl-stack' }, [E('span', { class: 'dl-mono' }, x.host), note(x)]),
            main
              ? E('span', { class: 'dl-pill info' }, _('Main'))
              : on
                ? E(
                    'button',
                    {
                      type: 'button',
                      class: 'dl-linkbtn',
                      click: (ev: Event) => {
                        ev.stopPropagation();
                        picked = [x.host, ...picked.filter((h) => h !== x.host)];
                        paintOpts();
                        paintLinks();
                      },
                    },
                    _('Make main'),
                  )
                : x.cloudflare
                  ? E('span', { class: 'dl-pill warn' }, 'Cloudflare')
                  : x.kind === 'ip'
                    ? E('span', { class: 'dl-pill' }, 'IP')
                    : x.here && x.cert
                      ? E('span', { class: 'dl-pill ok' }, _('Recommended'))
                      : '',
          ],
        );
      }),
      E('div', { class: 'dl-addr-opt other' }, [
        E('i', { class: 'dl-addr-check' }, icon('plus')),
        other,
        button(_('Add'), () => {
          const h = other.value.trim().toLowerCase();
          if (!h) return;
          // The router would refuse it on Save: say so here.
          const check = hostHelp(h);
          if (check.bad) {
            notify(check.text, 'warning');
            return;
          }
          addRow(h);
          if (!picked.includes(h)) picked = [...picked, h];
          other.value = '';
          paintOpts();
          paintLinks();
        }),
      ]),
    ]);
  other.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      (other.nextElementSibling as HTMLElement)?.click();
    }
  });

  // One row per link, as people will see it (example code).
  const links = E('div', { class: 'dl-links' });
  // The port's help depends on the links too (IP addresses use the next port); set below.
  let refreshPort = () => {};
  const paintLinks = () => {
    refreshPort();
    const lport = Number(port.value) || eff.portal_port;
    dom.content(
      links,
      picked.map((h, i) => {
        const ip = isIp(h);
        // The portal keeps its own port (80 and 443 stay free for others).
        const p = ip ? lport + 1 : lport;
        const base = `${ip ? 'http' : 'https'}://${h}${p === (ip ? 80 : 443) ? '' : `:${p}`}/`;
        return E('div', { class: 'dl-link-row' }, [
          E('span', { class: `dl-link-ic ${ip ? 'warn' : 'ok'}` }, icon(ip ? 'alert' : 'lock')),
          E('span', { class: 'dl-mono dl-link-url' }, [base, E('b', {}, 'kamiro-telosu-bavine')]),
          i === 0 ? E('span', { class: 'dl-pill info' }, _('Main')) : ip ? E('span', { class: 'dl-pill warn' }, 'HTTP') : '',
        ]);
      }),
    );
  };
  paintOpts();
  paintLinks();
  port.addEventListener('input', () => paintLinks());

  // Readiness: one summary line, the checks as chips, details on demand.
  const SHORT: Record<string, string> = {
    portal: _('Portal running'),
    portal_dns: _('Points here'),
    portal_reply: _('Answers reach visitors'),
    portal_http: _('Plain HTTP'),
    cert: _('Certificate'),
  };
  const need = host.d.needs ?? { https: [], acme: [], home: [] };
  const readyGroup = (checks: PortalInfo['checks'] | null): HTMLElement => {
    if (!eff.portal_enabled) return E('div', { hidden: true });
    if (!checks)
      return group('check', _('Ready to share'), _('The portal’s checks from Health'), [
        E('p', { class: 'dl-muted dl-loading' }, _('Running checks…')),
      ]);
    const shown = checks.filter((x) => x.status !== 'skip');
    if (!shown.length) return E('div', { hidden: true });
    const { bad, worst } = verdict(checks);
    const details = E(
      'div',
      { class: 'dl-ready-details', hidden: true },
      shown.map((x) =>
        E('div', { class: `dl-ready-item ${x.status}` }, [
          icon(x.status === 'ok' ? 'check' : 'alert'),
          E('span', { class: 'dl-stack' }, [E('span', {}, x.title), E('span', { class: 'dl-sub' }, x.detail)]),
        ]),
      ),
    );
    const ready = E('div', { class: 'dl-stack gap8' }, [
      E('div', { class: `dl-ready-sum ${worst}` }, [
        icon(worst === 'ok' ? 'check' : 'alert'),
        E('span', { class: 'dl-stack' }, [
          E(
            'b',
            {},
            worst === 'ok'
              ? plural(shown.length, 'All %s check passed', 'All %s checks passed')
              : fmt(N_(shown.length, '%s of %s check passed', '%s of %s checks passed'), num(shown.length - bad.length), num(shown.length)),
          ),
          bad.length
            ? E('span', { class: 'dl-sub' }, bad.map((x) => x.detail).join(' '))
            : E('span', { class: 'dl-sub' }, _('Links will open for the people you send them to.')),
        ]),
        E(
          'button',
          {
            type: 'button',
            class: 'dl-linkbtn',
            click: (ev: Event) => {
              details.hidden = !details.hidden;
              (ev.currentTarget as HTMLElement).textContent = details.hidden ? _('Details') : _('Hide');
            },
          },
          _('Details'),
        ),
      ]),
      E(
        'div',
        { class: 'dl-chips-row' },
        shown.map((x) =>
          E('span', { class: `dl-check-chip ${x.status}`, title: x.detail }, [
            icon(x.status === 'ok' ? 'check' : 'alert'),
            SHORT[x.id] ?? x.title,
          ]),
        ),
      ),
      details,
    ]);
    return group('check', _('Ready to share'), _('The portal’s checks from Health'), [ready]);
  };
  // The state pill next to the switch: none until the checks are in.
  const readyPill = (checks: PortalInfo['checks'] | null): HTMLElement => {
    if (!eff.portal_enabled || (!checks && !need.https.length)) return E('span', { hidden: true });
    if (need.https.length) return E('span', { class: 'dl-pill bad' }, _('Can’t start'));
    const { worst } = verdict(checks!);
    return E(
      'span',
      { class: `dl-pill ${worst === 'ok' ? 'ok' : worst === 'error' ? 'bad' : 'warn'}` },
      worst === 'error' ? _('Needs attention') : _('Ready'),
    );
  };
  let readyEl = readyGroup(host.portal?.checks ?? null);
  let pillEl = readyPill(host.portal?.checks ?? null);
  host.portalFill = (p) => {
    found = true;
    takeCands(p.candidates);
    paintOpts();
    paintLinks();
    const g = readyGroup(p.checks);
    readyEl.replaceWith(g);
    readyEl = g;
    const pl = readyPill(p.checks);
    pillEl.replaceWith(pl);
    pillEl = pl;
  };

  const until = c && !c.self_signed && c.expires ? fmtDay(c.expires) : '';
  // Who holds the port (our own portal doesn't count), and the next one while links use an IP address.
  const listenRow = liveRow(_('Listening port'), port, () =>
    portalPortHelp(port.value.trim() === '' ? eff.portal_port : Number(port.value), host.d.tcp_taken ?? [], picked.some(isIp)),
  );
  refreshPort = listenRow.refresh;
  const redirectRow = liveRow(_('Unknown links'), redirect, () => urlHelp(redirect.value));
  const custom = !!(s.portal_cert && s.portal_key);
  const kind = !c ? _('Portal is off') : custom ? _('Your files') : c.self_signed ? _('Self-signed') : 'Let’s Encrypt';
  const certFiles = () => {
    const fc = input(s.portal_cert, { placeholder: '/etc/ssl/…/fullchain.crt' });
    const fk = input(s.portal_key, { placeholder: '/etc/ssl/…/key' });
    modal(
      _('Use your own certificate'),
      [
        E('p', { class: 'dl-muted' }, _('Paths on the router. Leave both empty to pick a certificate automatically.')),
        row(_('Certificate file'), fc),
        row(_('Key file'), fk),
      ],
      [
        cancelButton(),
        ' ',
        button(
          _('Save'),
          () => {
            closeModal();
            void host.save({ portal_cert: fc.value.trim(), portal_key: fk.value.trim() }, _('Certificate saved'), 'portal');
          },
          'positive',
        ),
      ],
    );
  };
  const missingRow = (ic: string, tone: '' | 'bad', title: string, sub: string, feature: 'https' | 'acme', label: string) =>
    needRow(
      ic,
      tone,
      title,
      sub,
      button(label, () => installMissing(feature, need[feature], () => host.reload('portal')), 'positive'),
    );
  const httpsRow = need.https.length
    ? missingRow(
        'lock',
        'bad',
        _('HTTPS isn’t available on this router'),
        fmt(
          _('The portal needs %s. It can’t start without them.'),
          new Intl.ListFormat(locale(), { type: 'conjunction' }).format(need.https),
        ),
        'https',
        _('Install'),
      )
    : '';
  const acmeRow =
    need.acme.length && (!c || c.self_signed)
      ? missingRow(
          'lock',
          '',
          _('Free certificate from Let’s Encrypt'),
          s.portal_host
            ? fmt(_('ACME isn’t installed. With it the router gets a certificate for %s and browsers stop warning.'), s.portal_host)
            : _('ACME isn’t installed. With it the router gets a certificate and browsers stop warning.'),
          'acme',
          _('Install ACME'),
        )
      : '';
  const certRows = [
    E('div', { class: 'dl-row' }, [
      icon('lock'),
      E('span', { class: 'dl-row-main dl-stack' }, [
        E('b', {}, [kind, until ? E('span', { class: 'dl-faint' }, ` · ${fmt(_('until %s'), until)}`) : '']),
        E(
          'span',
          { class: 'dl-sub dl-ellipsis', title: c?.path ?? '' },
          !c
            ? _('Turn the portal on to see its certificate.')
            : c.self_signed
              ? _('Made by the router: browsers warn until a certificate covers the address.')
              : `${custom ? _('Your files') : _('Found automatically')} · ${c.path}`,
        ),
      ]),
    ]),
    E('div', { class: 'dl-row' }, [
      icon('file'),
      E('span', { class: 'dl-row-main dl-stack' }, [
        E('b', {}, _('Your own files')),
        E(
          'span',
          { class: 'dl-sub' },
          custom ? `${s.portal_cert} · ${s.portal_key}` : _('Not set: the certificate is picked automatically.'),
        ),
      ]),
      custom
        ? button(_('Reset'), () => host.save({ portal_cert: '', portal_key: '' }, _('Automatic certificate'), 'portal'), 'negative')
        : '',
      button(custom ? _('Change') : _('Use files'), certFiles),
    ]),
    acmeRow,
  ];

  return section(
    'portal',
    _('Personal portal'),
    [
      E('span', { class: 'dl-muted' }, _('A page where each person adds and manages their devices with their personal link.')),
      httpsRow ? E('div', { class: 'dl-list' }, [httpsRow]) : '',
      group('network', _('Port'), _('How the portal listens (80 and 443 stay free)'), [listenRow]),
      group('edit', _('Appearance'), _('What people see'), [redirectRow]),
      group('link', _('Addresses'), _('Pick one or more; the first is the main link'), [
        opts,
        E('div', { class: 'dl-stack gap8' }, [
          links,
          E('span', { class: 'dl-sub' }, _('Example code; each person gets their own three words.')),
        ]),
      ]),
      group('lock', _('Certificate'), _('Used for HTTPS links'), certRows),
      readyEl,
    ],
    [
      E('span'),
      button(
        _('Save'),
        () => {
          // The help lines already say what is wrong: do not send it anyway.
          const bad = firstBad([listenRow, redirectRow]);
          if (bad) {
            notify(bad, 'warning');
            return;
          }
          return host.save(
            {
              portal_enabled: isOn(pOn) ? '1' : '0',
              portal_host: picked[0] ?? '',
              portal_alt: picked.slice(1),
              portal_port: port.value,
              portal_redirect: redirect.value.trim(),
            },
            _('Saved'),
            'portal',
          );
        },
        'positive',
      ),
    ],
    '',
    [pillEl, pOn],
  );
}
