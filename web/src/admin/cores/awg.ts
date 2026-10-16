// The AmneziaWG core in the admin: how a device connects (.conf, AmneziaVPN
// key, QR), the disguise and its parameters, and the core's own settings on
// Server → AmneziaWG. Plain WireGuard is AmneziaWG with the disguise off.

import type { AwgConfig, Server, Status } from '../../shared/types';
import { E } from '../e';
import { api } from '../api';
import { button } from '../ui/button';
import { confirmDialog } from '../ui/modal';
import { copyText, downloadFile } from '../ui/files';
import { attempt, notify } from '../ui/toast';
import { input } from '../ui/controls';
import { callout, card, group, row, svg } from '../ui/layout';
import { qrSvg } from '../../shared/qr';
import { vpnKey } from '../../shared/vpnkey';
import { icon } from '../../shared/icons';
import { methodInfo, methodPicker, type Method } from '../disguise';
import { coreHead, type Core, type CoreCtx } from './common';

/** `.conf` names of the disguise parameters, in file order. */
const CONF: [string, string][] = [
  ['jc', 'Jc'],
  ['jmin', 'Jmin'],
  ['jmax', 'Jmax'],
  ['s1', 'S1'],
  ['s2', 'S2'],
  ['s3', 'S3'],
  ['s4', 'S4'],
  ['h1', 'H1'],
  ['h2', 'H2'],
  ['h3', 'H3'],
  ['h4', 'H4'],
  ['i1', 'I1'],
  ['i2', 'I2'],
  ['i3', 'I3'],
  ['i4', 'I4'],
  ['i5', 'I5'],
  ['header_protection_key', 'HeaderProtectionKey'],
  ['content_padding_addition', 'ContentPaddingAddition'],
  ['rekey_after_time', 'RekeyAfterTime'],
  ['rekey_timeout', 'RekeyTimeout'],
  ['reject_after_time', 'RejectAfterTime'],
  ['keepalive_timeout', 'KeepaliveTimeout'],
  ['max_handshake_attempts', 'MaxHandshakeAttempts'],
  ['random_trailers', 'RandomTrailers'],
  ['disable_cookies', 'DisableCookies'],
];

/**
 * The applied parameters, grouped by what they do, with a plain-language
 * line per group. Collapsed by default; copyable as config lines.
 */
function paramsView(o: Record<string, string>): HTMLElement | null {
  const has = (k: string) => o[k] != null && o[k] !== '';
  const keys = CONF.filter(([k]) => has(k));
  if (!keys.length) return null;
  const val = (k: string, name: string) =>
    E('span', { class: 'dl-pv' }, [E('i', {}, name), E('b', {}, k === 'header_protection_key' ? `${o[k].slice(0, 6)}••••` : o[k])]);
  const group = (title: string, ic: string, text: string, ks: string[]) => {
    const present = CONF.filter(([k]) => ks.includes(k) && has(k));
    return present.length
      ? E('div', { class: 'dl-pgroup' }, [
          E('div', { class: 'dl-pgroup-head' }, [icon(ic), E('b', {}, title)]),
          E('p', {}, text),
          E(
            'div',
            { class: 'dl-pvals' },
            present.map(([k, n]) => val(k, n)),
          ),
        ])
      : '';
  };
  const jc = Number(o.jc || 0);
  const signature = (o.i1 ?? '').includes('0x8580')
    ? 'A first packet shaped like a DNS answer.'
    : 'Extra packets sent before the handshake.';
  const conf = keys.map(([k, n]) => `${n} = ${o[k]}`).join('\n');
  const body = E('div', { class: 'dl-pgrid' }, [
    group(
      'Junk packets',
      'zap',
      jc ? `${jc} random packet${jc === 1 ? '' : 's'} of ${o.jmin}–${o.jmax} bytes before each handshake.` : 'No junk packets.',
      ['jc', 'jmin', 'jmax'],
    ),
    group('Padding', 'archive', 'Random bytes in front of handshake, cookie and data packets, so their sizes do not match WireGuard.', [
      's1',
      's2',
      's3',
      's4',
    ]),
    group('Packet types', 'key', 'The values that replace WireGuard’s recognisable message types.', ['h1', 'h2', 'h3', 'h4']),
    group('Signatures', 'globe', signature, ['i1', 'i2', 'i3', 'i4', 'i5']),
    group('Protection', 'lock', 'AmneziaWG 3.1: encrypted headers, random tails and extra padding on data packets.', [
      'header_protection_key',
      'content_padding_addition',
      'random_trailers',
      'disable_cookies',
    ]),
    group('Timing', 'clock', 'Handshake and key timers vary within these ranges instead of WireGuard’s fixed values.', [
      'rekey_after_time',
      'rekey_timeout',
      'reject_after_time',
      'keepalive_timeout',
      'max_handshake_attempts',
    ]),
  ]);
  return E('details', { class: 'dl-params' }, [
    E('summary', {}, [
      icon('chevron'),
      E('span', {}, 'Current parameters'),
      E('span', { class: 'dl-pcount' }, String(keys.length)),
      E('span', { class: 'dl-spacer' }),
      E(
        'button',
        {
          type: 'button',
          class: 'dl-linkbtn',
          click: (ev: Event) => {
            ev.preventDefault();
            copyText(conf, 'Parameters copied');
          },
        },
        'Copy as config',
      ),
    ]),
    body,
  ]);
}

/** One configuration line, highlighted; private and preshared keys masked unless shown. */
function confLine(line: string, reveal: boolean): Node {
  if (/^\s*\[.+\]\s*$/.test(line)) return E('span', { class: 'dl-conf-sec' }, line);
  const m = /^(\s*[A-Za-z0-9]+\s*=)\s*(.*)$/.exec(line);
  if (!m) return document.createTextNode(line);
  const secret = /^(\s*)(PrivateKey|PresharedKey)\b/.test(line);
  return E('span', {}, [
    E('span', { class: 'dl-conf-k' }, m[1]),
    ' ',
    secret && !reveal ? E('span', { class: 'dl-conf-mask' }, '••••••••••••••••') : m[2],
  ]);
}

/** The .conf as a file card (download) and a folded, highlighted view with copy and a hidden key. */
function fileCard(cfg: AwgConfig): HTMLElement {
  let reveal = false;
  const pre = E('pre', { class: 'dl-conf' });
  const paint = () =>
    dom.content(
      pre,
      cfg.conf.split('\n').flatMap((l, i) => (i ? ['\n', confLine(l, reveal)] : [confLine(l, reveal)])),
    );
  const eye = E(
    'button',
    {
      type: 'button',
      class: 'dl-chipbtn',
      click: (ev: Event) => {
        ev.preventDefault();
        reveal = !reveal;
        dom.content(eye, [icon(reveal ? 'x' : 'key'), reveal ? 'Hide key' : 'Show key']);
        paint();
      },
    },
    [icon('key'), 'Show key'],
  );
  paint();
  const size = new Blob([cfg.conf]).size;
  return E('div', { class: 'dl-stack gap8' }, [
    E('div', { class: 'dl-filecard' }, [
      E('span', { class: 'dl-filecard-ic' }, '.conf'),
      E('span', { class: 'dl-stack' }, [
        E('span', { class: 'dl-mono dl-ellipsis' }, cfg.filename),
        E('span', { class: 'dl-sub' }, `AmneziaWG · ${size} bytes · import it in the app`),
      ]),
      button([icon('download'), ' Download'], () => downloadFile(cfg.filename, cfg.conf, 'application/octet-stream'), 'positive'),
    ]),
    E('details', { class: 'dl-params' }, [
      E('summary', {}, [
        icon('chevron'),
        E('span', {}, 'Configuration'),
        E('span', { class: 'dl-spacer' }),
        eye,
        E(
          'button',
          {
            type: 'button',
            class: 'dl-chipbtn',
            click: (ev: Event) => {
              ev.preventDefault();
              copyText(cfg.conf, 'Configuration copied');
            },
          },
          [icon('copy'), 'Copy'],
        ),
      ]),
      pre,
    ]),
  ]);
}

/** File / key / QR switcher for a client configuration; opens on the file unless asked otherwise. */
export async function connectBlock(cfg: AwgConfig, initial: 'file' | 'key' | 'qr' = 'file'): Promise<HTMLElement> {
  if (!cfg.has_private_key)
    return E(
      'div',
      { class: 'dl-hint' },
      'This device generated its own keys in the browser, so its full configuration only exists on that device.',
    );
  const key = await vpnKey(cfg, `${cfg.server} · ${cfg.person} · ${cfg.name}`);
  const panes: Record<string, () => Node> = {
    qr: () =>
      E('div', { class: 'dl-qr-pane' }, [
        svg(qrSvg(cfg.conf), 'dl-qr'),
        E('span', { class: 'dl-sub' }, 'Scan with AmneziaVPN or AmneziaWG on the device.'),
      ]),
    key: () =>
      E('div', { class: 'dl-stack gap8' }, [
        E('div', { class: 'dl-linkbox' }, [E('span', { class: 'dl-mono' }, key), button('Copy', () => copyText(key, 'Key copied'))]),
        E('span', { class: 'dl-sub' }, 'AmneziaVPN → Add server → Insert key. Keep it private.'),
      ]),
    file: () => fileCard(cfg),
  };
  const body = E('div', { class: 'dl-connect-body' });
  const seg = E('div', { class: 'dl-seg' });
  const show = (id: string) => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    dom.content(body, panes[id]());
  };
  for (const [id, label] of [
    ['file', 'File'],
    ['key', 'Key'],
    ['qr', 'QR code'],
  ])
    seg.appendChild(E('button', { type: 'button', 'data-id': id, click: () => show(id) }, label));
  show(initial);
  return E('div', { class: 'dl-stack gap12' }, [seg, body]);
}

/** Switch the disguise (every device imports its configuration again). */
async function applyDisguise(ctx: CoreCtx, srv: Server, m: Method, same: boolean) {
  const info = methodInfo(m)!;
  const people = ctx.st.people.filter((p) => p.server === srv.id);
  const devices = people.reduce((n, p) => n + p.devices.length, 0);
  const ok = await confirmDialog(
    same ? 'Generate new disguise values?' : `Switch to ${info.title}?`,
    `${devices} AmneziaWG device${devices === 1 ? '' : 's'} stop connecting until they import their configuration again (from their personal link or from you).${m === 'max' ? ' They need an app with AmneziaWG 3.1.' : ''}`,
    same ? 'Generate and apply' : 'Switch and apply',
    true,
  );
  if (!ok) return;
  if (await attempt(() => api.serverObfuscation(srv.id, m), same ? 'New values applied' : `${info.title} applied`)) {
    notify('Devices are marked “Update config” until they import again.', 'info', 6000);
    await ctx.refresh();
  }
}

/** Server → AmneziaWG: listening port, what goes into every configuration, disguise, tunnel. */
export function settingsCard(ctx: CoreCtx, srv: Server): HTMLElement {
  const st: Status = ctx.st;
  const port = input(String(srv.port), { inputmode: 'numeric', class: 'cbi-input-text dl-w-port dl-mono' });
  const mtu = input(srv.mtu ? String(srv.mtu) : '', {
    placeholder: 'Auto',
    inputmode: 'numeric',
    class: 'cbi-input-text dl-w-port dl-mono',
  });
  const now = `${srv.mtus.computer} for computers and routers, ${srv.mtus.phone} for phones and tablets`;
  const mtuHint = srv.mtu
    ? `Now ${now}. Empty = automatic.`
    : `Automatic by device type and disguise: now ${now}. Lower it if some sites hang.`;
  const ka = input(String(srv.keepalive ?? ''), { placeholder: '25', inputmode: 'numeric', class: 'cbi-input-text dl-w-port dl-mono' });
  const current = methodInfo(srv.preset) ? (srv.preset as Method) : undefined;
  let selected: Method = current ?? 'standard';
  const apply = button('', () => applyDisguise(ctx, srv, selected, selected === current), 'neutral');
  const label = () =>
    dom.content(apply, selected === current ? [icon('reset'), ' Generate new values'] : [`Switch to ${methodInfo(selected)!.title}`]);
  label();
  const tools = st.awg_state?.tools !== false;
  return card(
    '',
    [
      coreHead('AmneziaWG', srv.ifname),
      group('globe', 'Listening', 'Where devices reach this core from the internet', [
        row('UDP port', port, 'Opened on the WAN firewall automatically.'),
      ]),
      group('file', 'In every device configuration', 'Changing these marks devices “Update config” until they import again', [
        row('MTU', mtu, mtuHint),
        row('Keep-alive', ka, 'Seconds between packets devices send to keep NAT open. 0 = off.'),
      ]),
      group('shield', 'Disguise', 'So networks that block VPNs do not recognise the tunnel. Off = plain WireGuard', [
        methodPicker(
          st.awg,
          selected,
          (m) => {
            selected = m;
            label();
          },
          current,
          tools,
        ),
        // Only about an installed AmneziaWG: without one the server page says what to install.
        tools && !st.awg.v3
          ? callout('info', [
              'This router runs an older AmneziaWG. ',
              E('b', {}, 'Maximum'),
              ' becomes available with kmod-amneziawg and amneziawg-tools 3.1.',
            ])
          : '',
        paramsView(srv.obf ?? {}) ?? '',
        E('div', { class: 'dl-row-end' }, [
          E('span', { class: 'dl-sub' }, 'Applies at once: every AmneziaWG device imports its configuration again.'),
          apply,
        ]),
      ]),
      E('details', { class: 'dl-params' }, [
        E('summary', {}, [icon('chevron'), E('span', {}, 'Tunnel'), E('span', { class: 'dl-pcount' }, '3')]),
        E('div', { class: 'dl-params-body' }, [
          row('Interface', E('span', { class: 'dl-mono' }, `${srv.ifname} · router ${srv.address}`)),
          row('Tunnel subnet', E('span', { class: 'dl-mono' }, srv.subnet), 'Device addresses come from it.'),
          row(
            'Server public key',
            E('span', { class: 'dl-keyrow' }, [
              E('code', { class: 'dl-mono' }, srv.public_key),
              button([icon('copy')], () => copyText(srv.public_key, 'Public key copied'), 'neutral', {
                title: 'Copy',
                class: 'cbi-button cbi-button-neutral dl-icon-only sm',
              }),
            ]),
          ),
        ]),
      ]),
    ],
    [
      E('span', { class: 'dl-sub' }, 'Port, MTU and keep-alive apply at once.'),
      button('Save', () => ctx.save({ port: port.value, mtu: mtu.value, keepalive: ka.value }, 'AmneziaWG saved'), 'positive'),
    ],
  );
}

/** Overview: the disguise in use, its stealth and speed, and the values devices carry in words. */
function overviewTile(srv: Server): HTMLElement {
  const m = methodInfo(srv.preset);
  const o = srv.obf ?? {};
  const segs = (n: number, cls: string) =>
    E(
      'span',
      { class: `dl-segs ${cls}` },
      [0, 1, 2, 3].map((i) => E('i', { class: i < n ? 'on' : '' })),
    );
  const chips: string[] = [];
  if (+o.jc) chips.push(`${o.jc} junk · ${o.jmin}–${o.jmax} B`);
  const pad = ['s1', 's2', 's3', 's4'].filter((k) => +o[k]).map((k) => `${k.toUpperCase()} ${o[k]}`);
  if (pad.length) chips.push(pad.slice(0, 2).join(' · ') + (pad.length > 2 ? ` +${pad.length - 2}` : ''));
  if (['h1', 'h2', 'h3', 'h4'].some((k) => o[k] && o[k] !== String(['h1', 'h2', 'h3', 'h4'].indexOf(k) + 1))) chips.push('H1–H4 random');
  if (o.i1) chips.push(o.i1.includes('0x8580') ? 'DNS-like first packet' : 'Signature packets');
  if (o.header_protection_key) chips.push('Encrypted headers');
  if (!chips.length) chips.push(m?.id === 'off' ? 'Plain WireGuard' : 'No values yet');
  return E('div', { class: 'dl-bento-tile dl-disg' }, [
    E('div', { class: 'dl-bento-head' }, [
      E('span', { class: 'dl-metric-label' }, 'Disguise'),
      E('a', { href: `${L.url('admin/network/dawnline/server')}?server=${encodeURIComponent(srv.id)}&section=awg` }, 'Change'),
    ]),
    E('div', { class: 'dl-disg-id' }, [
      E('span', { class: 'dl-disg-ic' }, icon(m?.ic ?? 'shield')),
      E('span', { class: 'dl-stack' }, [E('b', {}, m ? m.title : 'Custom'), E('span', { class: 'dl-sub' }, m ? m.short : 'Set by hand')]),
    ]),
    m
      ? E('div', { class: 'dl-disg-meters' }, [
          E('span', {}, 'Stealth'),
          segs(m.stealth, 'acc'),
          E('span', {}, 'Speed'),
          segs(m.speed, 'ok'),
        ])
      : '',
    E(
      'div',
      { class: 'dl-disg-chips' },
      chips.map((c) => E('span', {}, c)),
    ),
  ]);
}

export const awg: Core = {
  id: 'awg',
  label: 'AmneziaWG',
  settingsCard,
  overviewTile,
  connectBlock,
  qrText: (cfg) => cfg.conf,
  appKey: { label: 'Copy AmneziaVPN key', make: (cfg) => vpnKey(cfg, `${cfg.server} · ${cfg.person} · ${cfg.name}`) },
  file: { label: 'Download .conf', make: (cfg) => ({ name: cfg.filename, text: cfg.conf }) },
};
