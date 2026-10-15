// Settings → Personal portal: the address in links (picked from what the
// router found), a preview, readiness, and the rest folded away.

import type { PortalInfo } from '../../api';
import { E } from '../../e';
import { button } from '../../ui/button';
import { cancelButton, closeModal, modal } from '../../ui/modal';
import { input, isOn, sw } from '../../ui/controls';
import { group, needRow, row } from '../../ui/layout';
import { icon } from '../../../shared/icons';
import { fmtDay } from '../../../shared/format';
import { installMissing } from '../../pkgs';
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
  const pOn = sw(eff.portal_enabled, 'Enable portal');
  const port = input(s.portal_port, { placeholder: '8443', inputmode: 'numeric', class: 'cbi-input-text dl-w-port' });
  const title = input(s.portal_title, { placeholder: 'Dawnline' });
  const redirect = input(s.portal_redirect, { placeholder: 'Show “Not found”', class: 'cbi-input-text dl-mono' });
  const other = input('', { placeholder: 'vpn.example.com or an IP', 'aria-label': 'Other address' });
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
      ? E('span', { class: 'dl-addr-warn' }, [icon('alert'), 'Plain HTTP: the link and VPN keys travel unencrypted'])
      : E(
          'span',
          { class: 'dl-sub' },
          x.cloudflare
            ? 'Behind Cloudflare · often stalls in Russia'
            : !x.ips.length
              ? found
                ? 'Your address'
                : 'Checking where it points…'
              : x.here
                ? `Points at this router${x.cert ? ' · Let’s Encrypt certificate' : ' · no certificate yet'}`
                : `Points at ${x.ips.join(', ')}, not this router`,
        );
  const opts = E('div', { class: 'dl-addr-opts', role: 'group', 'aria-label': 'Portal addresses' });
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
              ? E('span', { class: 'dl-pill info' }, 'Main')
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
                    'Make main',
                  )
                : x.cloudflare
                  ? E('span', { class: 'dl-pill warn' }, 'Cloudflare')
                  : x.kind === 'ip'
                    ? E('span', { class: 'dl-pill' }, 'IP')
                    : x.here && x.cert
                      ? E('span', { class: 'dl-pill ok' }, 'Recommended')
                      : '',
          ],
        );
      }),
      E('div', { class: 'dl-addr-opt other' }, [
        E('i', { class: 'dl-addr-check' }, icon('plus')),
        other,
        button('Add', () => {
          const h = other.value.trim().toLowerCase();
          if (!h) return;
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
  const paintLinks = () => {
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
          i === 0 ? E('span', { class: 'dl-pill info' }, 'Main') : ip ? E('span', { class: 'dl-pill warn' }, 'HTTP') : '',
        ]);
      }),
    );
  };
  paintOpts();
  paintLinks();
  port.addEventListener('input', () => paintLinks());

  // Readiness: one summary line, the checks as chips, details on demand.
  const SHORT: Record<string, string> = {
    portal: 'Portal running',
    portal_dns: 'Points here',
    portal_reply: 'Answers reach visitors',
    portal_http: 'Plain HTTP',
    cert: 'Certificate',
  };
  const need = host.d.needs ?? { https: [], acme: [], home: [] };
  const readyGroup = (checks: PortalInfo['checks'] | null): HTMLElement => {
    if (!eff.portal_enabled) return E('div', { hidden: true });
    if (!checks)
      return group('check', 'Ready to share', 'The portal’s checks from Health', [
        E('p', { class: 'dl-muted dl-loading' }, 'Running checks…'),
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
            worst === 'ok' ? `All ${shown.length} checks passed` : `${shown.length - bad.length} of ${shown.length} checks passed`,
          ),
          bad.length
            ? E('span', { class: 'dl-sub' }, bad.map((x) => x.detail).join(' '))
            : E('span', { class: 'dl-sub' }, 'Links will open for the people you send them to.'),
        ]),
        E(
          'button',
          {
            type: 'button',
            class: 'dl-linkbtn',
            click: (ev: Event) => {
              details.hidden = !details.hidden;
              (ev.currentTarget as HTMLElement).textContent = details.hidden ? 'Details' : 'Hide';
            },
          },
          'Details',
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
    return group('check', 'Ready to share', 'The portal’s checks from Health', [ready]);
  };
  // The state pill next to the switch: none until the checks are in.
  const readyPill = (checks: PortalInfo['checks'] | null): HTMLElement => {
    if (!eff.portal_enabled || (!checks && !need.https.length)) return E('span', { hidden: true });
    if (need.https.length) return E('span', { class: 'dl-pill bad' }, 'Can’t start');
    const { worst } = verdict(checks!);
    return E(
      'span',
      { class: `dl-pill ${worst === 'ok' ? 'ok' : worst === 'error' ? 'bad' : 'warn'}` },
      worst === 'error' ? 'Needs attention' : 'Ready',
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
  const listenRow = row(
    'Listening port',
    port,
    host.d.port_owners.length
      ? `Port ${eff.portal_port} is used by ${host.d.port_owners.join(', ')}.`
      : `Where the portal runs on the router: HTTPS here, plain HTTP for IP addresses on ${eff.portal_port + 1}.`,
  );
  const custom = !!(s.portal_cert && s.portal_key);
  const kind = !c ? 'Portal is off' : custom ? 'Your files' : c.self_signed ? 'Self-signed' : 'Let’s Encrypt';
  const certFiles = () => {
    const fc = input(s.portal_cert, { placeholder: '/etc/ssl/…/fullchain.crt' });
    const fk = input(s.portal_key, { placeholder: '/etc/ssl/…/key' });
    modal(
      'Use your own certificate',
      [
        E('p', { class: 'dl-muted' }, 'Paths on the router. Leave both empty to pick a certificate automatically.'),
        row('Certificate file', fc),
        row('Key file', fk),
      ],
      [
        cancelButton(),
        ' ',
        button(
          'Save',
          () => {
            closeModal();
            void host.save({ portal_cert: fc.value.trim(), portal_key: fk.value.trim() }, 'Certificate saved', 'portal');
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
        'HTTPS isn’t available on this router',
        `The portal needs ${need.https.join(' and ')}. It can’t start without them.`,
        'https',
        'Install',
      )
    : '';
  const acmeRow =
    need.acme.length && (!c || c.self_signed)
      ? missingRow(
          'lock',
          '',
          'Free certificate from Let’s Encrypt',
          `ACME isn’t installed. With it the router gets a certificate${s.portal_host ? ` for ${s.portal_host}` : ''} and browsers stop warning.`,
          'acme',
          'Install ACME',
        )
      : '';
  const certRows = [
    E('div', { class: 'dl-row' }, [
      icon('lock'),
      E('span', { class: 'dl-row-main dl-stack' }, [
        E('b', {}, [kind, until ? E('span', { class: 'dl-faint' }, ` · until ${until}`) : '']),
        E(
          'span',
          { class: 'dl-sub dl-ellipsis', title: c?.path ?? '' },
          !c
            ? 'Turn the portal on to see its certificate.'
            : c.self_signed
              ? 'Made by the router: browsers warn until a certificate covers the address.'
              : `${custom ? 'Your files' : 'Found automatically'} · ${c.path}`,
        ),
      ]),
    ]),
    E('div', { class: 'dl-row' }, [
      icon('file'),
      E('span', { class: 'dl-row-main dl-stack' }, [
        E('b', {}, 'Your own files'),
        E('span', { class: 'dl-sub' }, custom ? `${s.portal_cert} · ${s.portal_key}` : 'Not set: the certificate is picked automatically.'),
      ]),
      custom ? button('Reset', () => host.save({ portal_cert: '', portal_key: '' }, 'Automatic certificate', 'portal'), 'negative') : '',
      button(custom ? 'Change' : 'Use files', certFiles),
    ]),
    acmeRow,
  ];

  return section(
    'portal',
    'Personal portal',
    [
      E('span', { class: 'dl-muted' }, 'A page where each person adds and manages their devices with their personal link.'),
      httpsRow ? E('div', { class: 'dl-list' }, [httpsRow]) : '',
      group('network', 'Port', 'How the portal listens (80 and 443 stay free)', [listenRow]),
      group('edit', 'Appearance', 'What people see', [
        row('Title', title, 'Shown at the top of the portal.'),
        row('Unknown links', redirect, 'Where a wrong or old link goes, for example your website. Empty shows a plain “Not found”.'),
      ]),
      group('link', 'Addresses', 'Pick one or more; the first is the main link', [
        opts,
        E('div', { class: 'dl-stack gap8' }, [
          links,
          E('span', { class: 'dl-sub' }, 'Example code; each person gets their own three words.'),
        ]),
      ]),
      group('lock', 'Certificate', 'Used for HTTPS links', certRows),
      readyEl,
    ],
    [
      E('span'),
      button(
        'Save',
        () =>
          host.save(
            {
              portal_enabled: isOn(pOn) ? '1' : '0',
              portal_host: picked[0] ?? '',
              portal_alt: picked.slice(1),
              portal_port: port.value,
              portal_title: title.value,
              portal_redirect: redirect.value.trim(),
            },
            'Saved',
            'portal',
          ),
        'positive',
      ),
    ],
    '',
    [pillEl, pOn],
  );
}
