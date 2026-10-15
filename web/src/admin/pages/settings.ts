// Settings: section cards, each with its own Save (applied immediately).

import { E } from '../e';
import { api, type Backup, type SettingsData } from '../api';
import { attempt, button, closeModal, modal } from '../ui';
import { icon } from '../../shared/icons';
import { group, input, isOn, row, sw } from '../kit';
import { CATEGORIES, CATEGORY_HELP, CATEGORY_LABEL, clearLogDialog, exportEvents, resetUsageDialog } from '../logs';
import { retentionText } from './activity';
import { backupsSection } from '../backups';
import { installMissing } from '../pkgs';

type Values = Record<string, string | string[]>;

/** Single-choice pill row; read the choice with `.dataset.value`. */
function seg(options: [string, string][], value: string, label: string): HTMLElement {
  if (!options.some(([v]) => v === value)) options = [...options, [value, value]];
  const el = E('div', { class: 'dl-seg sm', role: 'radiogroup', 'aria-label': label, 'data-value': value });
  const paint = () =>
    dom.content(
      el,
      options.map(([v, t]) =>
        E(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: v === el.dataset.value ? 'on' : '',
            'aria-checked': v === el.dataset.value ? 'true' : 'false',
            click: () => {
              el.dataset.value = v;
              paint();
            },
          },
          t,
        ),
      ),
    );
  paint();
  return el;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}

function kb(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

export class SettingsPage {
  d!: SettingsData;
  root = E('div', { class: 'dl-settings-main' });
  backups: Backup[] = [];

  load() {
    return api.settingsGet();
  }

  render(d: SettingsData): HTMLElement {
    this.d = d;
    this.paint();
    this.loadBackups().then(() => {
      if (new URLSearchParams(location.search).get('section') === 'backups')
        document.getElementById('dl-set-backups')?.scrollIntoView({ block: 'start' });
    });
    return E('div', {}, [E('div', { class: 'dl-pagehead' }, [E('h2', { class: 'dl-h1' }, 'Settings')]), this.root]);
  }

  async save(values: Values, ok = 'Saved') {
    const r = await attempt(() => api.settingsUpdate(values), ok);
    if (r) {
      this.d = r;
      this.paint();
    }
  }

  section(id: string, title: string, body: (Node | string)[], foot: Node[], extra = '', head: (Node | string)[] = []): HTMLElement {
    return E('section', { class: `dl-setsec ${extra}`, id: `dl-set-${id}` }, [
      E('div', { class: 'dl-setsec-body' }, [
        head.length
          ? E('div', { class: 'dl-setsec-head' }, [E('h3', {}, title), E('span', { class: 'dl-spacer' }), ...head])
          : E('h3', {}, title),
        ...body,
      ]),
      foot.length ? E('div', { class: 'dl-setsec-foot' }, foot) : '',
    ]);
  }

  /** Personal portal: the address in links (picked from what the router found), a preview, readiness, and the rest folded away. */
  portalSection(): HTMLElement {
    const s = this.d.settings;
    const eff = this.d.effective as Record<string, any>;
    const c = this.d.cert;
    const cands = this.d.portal_candidates ?? [];
    const checks = this.d.portal_checks ?? [];
    const pOn = sw(eff.portal_enabled, 'Enable portal');
    const port = input(s.portal_port, { placeholder: '8443', inputmode: 'numeric', class: 'cbi-input-text dl-w-port' });
    const on443 = sw(eff.portal_443, 'Standard ports', () => paintLinks());
    const title = input(s.portal_title, { placeholder: 'Dawnline' });
    const redirect = input(s.portal_redirect, { placeholder: 'Show “Not found”', class: 'cbi-input-text dl-mono' });
    const other = input('', { placeholder: 'vpn.example.com or an IP', 'aria-label': 'Other address' });
    const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
    // Chosen addresses, the main one first; custom ones join the list of options.
    let picked: string[] = [eff.portal_host, ...(eff.portal_alt ?? [])].filter(
      (h: string, i: number, a: string[]) => h && a.indexOf(h) === i,
    );
    if (!picked.length && cands[0]) picked = [cands[0].host];
    const rows = [...cands];
    const addRow = (h: string) => {
      if (h && !rows.some((x) => x.host === h))
        rows.push({ host: h, kind: isIp(h) ? 'ip' : 'name', ips: [], here: false, cloudflare: false, cert: false });
    };
    picked.forEach(addRow);

    const note = (x: (typeof cands)[number]): Node =>
      x.kind === 'ip'
        ? E('span', { class: 'dl-addr-warn' }, [icon('alert'), 'Plain HTTP: the link and VPN keys travel unencrypted'])
        : E(
            'span',
            { class: 'dl-sub' },
            x.cloudflare
              ? 'Behind Cloudflare · often stalls in Russia'
              : !x.ips.length
                ? 'Your address'
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
      const std = isOn(on443);
      const lport = Number(port.value) || eff.portal_port;
      dom.content(
        links,
        picked.map((h, i) => {
          const ip = isIp(h);
          const p = ip ? (std ? 80 : lport + 1) : std && !this.d.wan443_taken ? 443 : lport;
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
      portal_443: 'Port 443',
      portal_lan: 'Works at home',
      portal_http: 'Plain HTTP',
      cert: 'Certificate',
    };
    const shown = checks.filter((x) => x.status !== 'skip');
    const bad = shown.filter((x) => x.status === 'error' || x.status === 'warn');
    const worst = shown.some((x) => x.status === 'error') ? 'error' : bad.length ? 'warn' : 'ok';
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

    const until =
      c && !c.self_signed && c.expires
        ? new Date(c.expires).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
    const portsRow = row(
      'Standard ports',
      on443,
      this.d.wan443_taken
        ? 'Port 443 is already forwarded to another device, so HTTPS links keep the listening port.'
        : 'Links without a port: 443 for names, 80 for IP addresses. Mobile networks often drop other ports. From the internet these reach only the portal; LuCI stays closed.',
    );
    const listenRow = row(
      'Listening port',
      port,
      this.d.port_owners.length
        ? `Port ${eff.portal_port} is used by ${this.d.port_owners.join(', ')}.`
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
          E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
          ' ',
          button(
            'Save',
            () => {
              closeModal();
              this.save({ portal_cert: fc.value.trim(), portal_key: fk.value.trim() }, 'Certificate saved');
            },
            'positive',
          ),
        ],
      );
    };
    const need = this.d.needs ?? { https: [], acme: [], home: [] };
    const needRow = (ic: string, tone: string, title: string, sub: string, feature: 'https' | 'acme', label: string) =>
      E('div', { class: `dl-row dl-need-row ${tone}` }, [
        tone ? E('span', { class: 'dl-need-ic' }, icon(ic)) : icon(ic),
        E('span', { class: 'dl-row-main dl-stack' }, [E('b', {}, title), E('span', { class: 'dl-sub' }, sub)]),
        button(label, () => installMissing(feature, need[feature], () => this.reload()), 'positive'),
      ]);
    const httpsRow = need.https.length
      ? needRow(
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
        ? needRow(
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
          E(
            'span',
            { class: 'dl-sub' },
            custom ? `${s.portal_cert} · ${s.portal_key}` : 'Not set: the certificate is picked automatically.',
          ),
        ]),
        custom ? button('Reset', () => this.save({ portal_cert: '', portal_key: '' }, 'Automatic certificate'), 'negative') : '',
        button(custom ? 'Change' : 'Use files', certFiles),
      ]),
      acmeRow,
    ];

    return this.section(
      'portal',
      'Personal portal',
      [
        E('span', { class: 'dl-muted' }, 'A page where each person adds and manages their devices with their personal link.'),
        httpsRow ? E('div', { class: 'dl-list' }, [httpsRow]) : '',
        group('network', 'Ports', 'How the portal listens', [portsRow, listenRow]),
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
        eff.portal_enabled && shown.length ? group('check', 'Ready to share', 'The portal’s checks from Health', [ready]) : '',
      ],
      [
        E('span'),
        button(
          'Save',
          () =>
            this.save({
              portal_enabled: isOn(pOn) ? '1' : '0',
              portal_443: isOn(on443) ? '1' : '0',
              portal_host: picked[0] ?? '',
              portal_alt: picked.slice(1),
              portal_port: port.value,
              portal_title: title.value,
              portal_redirect: redirect.value.trim(),
            }),
          'positive',
        ),
      ],
      '',
      [
        eff.portal_enabled
          ? need.https.length
            ? E('span', { class: 'dl-pill bad' }, 'Can’t start')
            : E(
                'span',
                { class: `dl-pill ${worst === 'ok' ? 'ok' : worst === 'error' ? 'bad' : 'warn'}` },
                worst === 'error' ? 'Needs attention' : 'Ready',
              )
          : '',
        pOn,
      ],
    );
  }

  paint() {
    const s = this.d.settings;
    const eff = this.d.effective as Record<string, any>;

    // Personal portal
    const portal = this.portalSection();

    // Defaults
    const limit = input(s.default_device_limit, { placeholder: '3', inputmode: 'numeric', class: 'cbi-input-text dl-w-port' });
    const hn = sw(eff.hostnames, 'Device hostnames');
    const domain = input(s.domain, { placeholder: 'lan', class: 'cbi-input-text dl-w-port' });
    const fallback = input(s.home_dns_fallback === 'none' ? '' : s.home_dns_fallback || eff.home_dns_fallback || '', {
      placeholder: 'None',
      inputmode: 'decimal',
      class: 'cbi-input-text dl-w-ip dl-mono',
    });
    const defaults = this.section(
      'defaults',
      'Defaults',
      [
        row('Devices per person', limit, 'Pre-filled when you add someone.'),
        row(
          'Device hostnames',
          E('div', { class: 'dl-hostport' }, [hn, E('span', { class: 'dl-faint dl-mono' }, 'phone.myata.'), domain]),
          'Name devices in your home DNS.',
        ),
        row(
          'Fallback DNS',
          fallback,
          'For Home-only devices using home names: the second DNS server, used by the device when the tunnel is down. Empty = none.',
        ),
      ],
      [
        E('span'),
        button(
          'Save',
          () =>
            this.save({
              default_device_limit: limit.value,
              hostnames: isOn(hn) ? '1' : '0',
              domain: domain.value,
              home_dns_fallback: fallback.value,
            }),
          'positive',
        ),
      ],
    );

    // Map
    const gOn = sw(eff.geo_enabled, 'Locations');
    const prov = E('select', { class: 'cbi-input-select' }, [
      E('option', { value: 'ipwho.is', selected: eff.geo_provider !== 'ipapi.co' ? 'selected' : null }, 'ipwho.is (fallback: ipapi.co)'),
      E('option', { value: 'ipapi.co', selected: eff.geo_provider === 'ipapi.co' ? 'selected' : null }, 'ipapi.co (fallback: ipwho.is)'),
    ]) as HTMLSelectElement;
    const map = this.section(
      'map',
      'Map & locations',
      [
        E('div', { class: 'dl-setrow head' }, [
          E('span', { class: 'dl-muted' }, 'Show where people connect from on the Overview and person pages, at city level.'),
          gOn,
        ]),
        row('Provider', prov),
      ],
      [
        E(
          'span',
          { class: 'dl-sub' },
          'The router sends each new client IP to the provider once and caches the city. Map tiles load in your browser from CARTO; people never see the map.',
        ),
        button('Save', () => this.save({ geo_enabled: isOn(gOn) ? '1' : '0', geo_provider: prov.value }), 'positive'),
      ],
    );

    const logs = this.logsSection();

    const danger = this.section(
      'danger',
      'Remove Dawnline from this router',
      [
        E(
          'p',
          { class: 'dl-muted' },
          'Deletes the tunnel, firewall rules, access table and hostnames Dawnline created, and stops the service. People and keys are kept in a backup.',
        ),
      ],
      [E('span'), button('Remove', () => this.uninstall(), 'negative')],
      'danger',
    );

    const backups = backupsSection(this.backups, () => {
      this.reload();
      this.loadBackups();
    });
    dom.content(this.root, [portal, defaults, map, logs, backups, danger]);
  }

  logsSection(): HTMLElement {
    const L = this.d.logs;
    const p = L.policy;
    const keep = seg(
      [
        ['7', '7 days'],
        ['30', '30 days'],
        ['90', '90 days'],
        ['365', '1 year'],
        ['0', 'No limit'],
      ],
      String(p.keep_days),
      'Keep activity',
    );
    const size = seg(
      [
        ['500', '500'],
        ['2000', '2,000'],
        ['5000', '5,000'],
        ['20000', '20,000'],
      ],
      String(p.max),
      'Maximum events',
    );
    const persist = seg(
      [
        ['10min', 'Every 10 min'],
        ['hourly', 'Hourly'],
        ['off', 'Memory only'],
      ],
      p.persist,
      'Save to flash',
    );
    const days = seg(
      [
        ['31', '1 month'],
        ['62', '2 months'],
        ['180', '6 months'],
        ['365', '1 year'],
        ['730', '2 years'],
      ],
      String(p.usage_days),
      'Daily traffic',
    );
    const months = seg(
      [
        ['12', '1 year'],
        ['24', '2 years'],
        ['60', '5 years'],
        ['120', '10 years'],
      ],
      String(p.usage_months),
      'Monthly traffic',
    );
    const chosen = new Set(p.categories);
    const cats = E(
      'div',
      { class: 'dl-chips-row' },
      CATEGORIES.map((c) => {
        const b = E(
          'button',
          {
            type: 'button',
            class: `dl-chipbtn${chosen.has(c) ? ' on' : ''}`,
            title: CATEGORY_HELP[c],
            click: () => {
              if (chosen.has(c)) chosen.delete(c);
              else chosen.add(c);
              b.classList.toggle('on', chosen.has(c));
            },
          },
          [CATEGORY_LABEL[c], E('b', {}, String(L.by_category[c] ?? 0))],
        );
        return b;
      }),
    );

    const fmtDay = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const since = L.oldest ? fmtDay(new Date(L.oldest * 1000)) : '';
    const stored = (ic: string, title: string, detail: string, actions: Node[]) =>
      E('div', { class: 'dl-row' }, [
        icon(ic),
        E('span', { class: 'dl-row-main dl-stack' }, [E('b', {}, title), E('span', { class: 'dl-sub' }, detail)]),
        ...actions,
      ]);
    const exportBtn = (fmt: 'csv' | 'json') =>
      button(
        fmt.toUpperCase(),
        async () => {
          const [st, ev] = await Promise.all([api.status(1), api.events(20000)]);
          exportEvents(st, ev.events, fmt);
        },
        'neutral',
        { title: `Download the log as ${fmt.toUpperCase()}` },
      );

    return this.section(
      'logs',
      'Logs & history',
      [
        E('p', { class: 'dl-muted' }, retentionText(p)),
        row('Keep activity', keep, 'Older events are removed automatically.'),
        row('Maximum size', size, 'Newest events are kept when the log is full.'),
        row('Record', cats, 'Switched-off categories are not logged from now on.'),
        row(
          'Save to flash',
          persist,
          'The log lives in memory and is copied to flash. Memory only saves flash writes but is lost on reboot.',
        ),
        row('Daily traffic', days, 'Per-day history behind the charts.'),
        row('Monthly traffic', months, 'Per-month totals; data limits use the current month.'),
        E('h4', { class: 'dl-setsub' }, 'Stored data'),
        E('div', { class: 'dl-list' }, [
          stored(
            'activity',
            'Activity log',
            L.events
              ? `${plural(L.events, 'event')} since ${since} · ${kb(L.log_ram)} in memory${p.persist === 'off' ? '' : `, ${kb(L.log_flash)} on flash`}`
              : 'Empty',
            [
              exportBtn('csv'),
              exportBtn('json'),
              button(
                'Clear',
                () => clearLogDialog('Clear activity', 'Removes events from the log on the router.', {}, () => this.reload()),
                'negative',
              ),
            ],
          ),
          stored(
            'chart',
            'Traffic history',
            L.usage_days ? `${plural(L.usage_days, 'day')} since ${fmtDay(L.usage_since)} · ${kb(L.usage_flash)} on flash` : 'Empty',
            [button('Reset', () => resetUsageDialog('all', '', '', () => setTimeout(() => this.reload(), 300)), 'negative')],
          ),
          stored('pin', 'Location cache', `${plural(this.d.geo_cached, 'address', 'addresses')} · ${kb(L.geo_flash)} on flash`, [
            button(
              'Clear',
              async () => {
                if (await attempt(() => api.geoClear(), 'Location cache cleared')) this.reload();
              },
              'negative',
            ),
          ]),
        ]),
      ],
      [
        E('span', { class: 'dl-sub' }, 'Clear one person or device from their own page.'),
        button(
          'Save',
          () =>
            this.save({
              log_keep_days: keep.dataset.value!,
              log_max: size.dataset.value!,
              log_persist: persist.dataset.value!,
              usage_keep_days: days.dataset.value!,
              usage_keep_months: months.dataset.value!,
              log_category: [...chosen],
            }),
          'positive',
        ),
      ],
    );
  }

  async loadBackups() {
    const r = await api.backupList().catch(() => null);
    if (r) {
      this.backups = r.backups;
      const old = document.getElementById('dl-set-backups');
      if (old)
        old.replaceWith(
          backupsSection(this.backups, () => {
            this.reload();
            this.loadBackups();
          }),
        );
    }
  }

  async reload() {
    const d = await api.settingsGet().catch(() => null);
    if (d) {
      this.d = d;
      this.paint();
    }
  }

  uninstall() {
    const confirmInput = input('', { placeholder: 'remove' });
    modal(
      'Remove Dawnline?',
      [
        E(
          'p',
          {},
          'Everyone is disconnected and the tunnel, firewall rules and portal are removed. A backup is made first. Type “remove” to confirm.',
        ),
        confirmInput,
      ],
      [
        E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
        ' ',
        button(
          'Remove Dawnline',
          async () => {
            if (await attempt(() => api.uninstall(confirmInput.value.trim()), 'Dawnline removed')) {
              closeModal();
              setTimeout(() => location.reload(), 800);
            }
          },
          'negative',
        ),
      ],
    );
  }
}
