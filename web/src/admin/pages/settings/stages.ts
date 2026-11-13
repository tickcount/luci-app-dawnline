// The first stages of a server's path as sections of Settings, every field
// in sight and changed in place: Devices (MTU and keep-alive), Way in (the
// address row with the router's verdict) and Tunnel (its network as a
// measure of addresses, the DNS, what the router is in it). Each wears its
// Health checks' state and shows what did not pass with its fix (health.ts).
// A change after which devices fetch their configuration again (⟳N on its
// field) waits for «Apply» at the page's foot: its field shows the new value
// as not applied yet.

import { api } from '../../api';
import { h, type Kid } from '../../../portal/dom';
import { fmt } from '../../../shared/i18n';
import { dnsHelp, rangeHelp, rangeOf, subnetOf, type Help, type Network } from '../../netcheck';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { reMark, textRow } from '../../ui/edit-rows';
import { copyText } from '../../ui/files';
import { inlineEdit } from '../../../portal/ui/inline-edit';
import { measure } from '../../ui/measure';
import { cap, card, note, section, type SectionOpts } from '../../ui/section';
import { entryBlock } from '../../widgets/entry';
import { linkValues } from '../../widgets/link-values';
import { stageOf, wanMoved, type StageId } from '../../servers/path';
import { refetchOf } from '../../servers/pending';
import type { ServerCtx } from './ctx';
import { healthAside, healthBlock } from './health';

const refuse = (help: Help) => (help.bad ? help.text : null);

/** A stage's name: on the rail, and as its section's title. */
const stageTitle = (s: StageId): string =>
  ({
    devices: _('Devices'),
    disguise: _('Disguise'),
    entry: _('Way in'),
    tunnel: _('Tunnel'),
    internet: _('Internet'),
    home: _('Home network'),
  })[s];

const ICON: Record<StageId, string> = {
  devices: 'phone',
  disguise: 'mask',
  entry: 'entry',
  tunnel: 'tunnel',
  internet: 'globe',
  home: 'home',
};

/** A stage's section head: its glass in the state's tone, its health after the title (`extra` before it). */
export function stageHead(c: ServerCtx, s: StageId, extra?: Kid): SectionOpts {
  const state = c.states[s];
  const passed = (c.checks ?? []).filter((k) => k.status === 'ok' && stageOf(k.id, c.srv.id) === s).length;
  // what the status says on its own, with every check passed (or none read yet)
  const own =
    state === 'bad'
      ? { tone: 'bad' as const, text: c.srv.blocked ? _('can’t start') : _('the tunnel is down') }
      : state === 'warn'
        ? { tone: 'warn' as const, text: _('needs attention') }
        : null;
  return {
    id: s,
    icon: ICON[s],
    title: stageTitle(s),
    tone: state === 'bad' ? 'red' : state === 'warn' ? 'orange' : 'grey',
    aside: healthAside({ failed: c.failed[s], passed, off: !c.srv.enabled, state: own }),
    // ⟳N of the whole section: at the head's right end
    end: extra ?? undefined,
  };
}

/** What did not pass on a stage, with its fix, for the top of the stage's first card. */
export const stageHealth = (c: ServerCtx, s: StageId): HTMLElement | null =>
  c.srv.enabled ? healthBlock(c.failed[s], { write: c.write, fix: (f) => c.fix(f) }) : null;

/** The line under a field whose change waits: what the server has until it is applied. */
export const waits = (now: string): string => fmt(_('Not applied yet. Now: %s'), now);

/** A value with its name as a chip; `copy`: what a press copies (null: it only says). */
const chip = (label: string, value: string, copy: string | null) =>
  copy
    ? h(
        'button',
        {
          type: 'button',
          class: 'namechip tn-chip',
          title: fmt(_('Copy: %s'), label),
          onclick: () => void copyText(copy, fmt(_('%s copied'), label)),
        },
        h('span', { class: 'faint' }, `${label} `),
        h('span', {}, value),
        ic('copy'),
      )
    : h('span', { class: 'namechip tn-chip still' }, h('span', { class: 'faint' }, `${label} `), h('span', {}, value));

/** What identifies the server to its devices: its interface and its public key (the core's own). */
export function keysSection(c: ServerCtx): HTMLElement {
  const key = c.srv.public_key;
  return section(
    { id: 'keys', icon: 'key', title: _('Interface and key') },
    card(
      cap(_('What identifies the server to its devices')),
      h('div', { class: 'tn-chips' }, chip(_('interface'), c.srv.ifname, null), chip(_('key'), `${key.slice(0, 10)}…`, key)),
    ),
  );
}

// ── Devices ──────────────────────────────────────────────────────────────────────────────────────────────────

export function devicesSection(c: ServerCtx): HTMLElement {
  // MTU on a scale and keep-alive from a few (widgets/link-values.ts), each staged as it is set
  return section(
    stageHead(c, 'devices'),
    card(stageHealth(c, 'devices'), linkValues(c), note(_('A device’s own value is set on its page and is not changed here.'))),
  );
}

// ── Way in: the address row with the router's verdict ─────────────────────────────────────────────────────────

/** A new address: where it points is asked of the router first and said in the question. */
async function changeAddress(c: ServerCtx, v: string) {
  if (v === c.srv.endpoint) return c.unstage('address');
  const host = v || c.st.settings.portal_host;
  const r = host ? await api.endpointProbe(host, c.srv.id, c.srv.port).catch(() => null) : null;
  const shown = v || _('the portal’s address');
  c.change({ kind: 'address', value: shown, label: fmt(_('Address: %s'), shown), more: r?.text, values: { endpoint: v } });
}

export function entrySection(c: ServerCtx): HTMLElement {
  const srv = c.srv;
  const addr = c.staged('address');
  // The router's public IPv4 moved away from the one devices are given: one press puts the new one in.
  const moved =
    wanMoved(c.st, srv) && c.st.wan && !addr
      ? h(
          'div',
          { class: 'srv-note warn' },
          glass('globe', 'orange'),
          h(
            'span',
            { class: 'sn-t' },
            h('b', {}, _('The router’s public address changed')),
            h(
              'span',
              {},
              fmt(_('Devices are given %s, the router is %s now. A DDNS name would follow it by itself.'), srv.endpoint, c.st.wan),
            ),
          ),
          c.write
            ? h(
                'button',
                { type: 'button', class: 'btn tint sm', onclick: () => void changeAddress(c, c.st.wan!) },
                h('span', {}, _('Use the new address')),
              )
            : null,
        )
      : null;
  return section(
    stageHead(c, 'entry'),
    card(
      stageHealth(c, 'entry'),
      moved,
      cap(_('The address and UDP port devices connect to')),
      // two named cells and the router's verdicts as rows (widgets/entry.ts)
      entryBlock(c, (v) => changeAddress(c, v)),
    ),
  );
}

// ── Tunnel: its network as a measure of addresses, the DNS, what the router is in it ───────────────────────────

/** A tunnel network's /24 holds this many device addresses beside the router's. */
const ROOM = 253;

export function tunnelSection(c: ServerCtx): HTMLElement {
  const srv = c.srv;
  const sub = c.staged('subnet');
  const dns = c.staged('dns');
  const subnet = sub ? sub.value : srv.subnet;
  let nets: Network[] = [];
  if (c.write)
    void api
      .serverPorts(srv.id)
      .then((r) => (nets = r.networks ?? []))
      .catch(() => undefined);
  const range = (v: string) =>
    /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? v : /^\d{1,3}\.\d{1,3}\.\d{1,3}\.0\/24$/.test(v) ? rangeOf(v) : null;
  const here = _('This router');
  const used = c.st.people.filter((p) => p.server === srv.id).reduce((n, p) => n + p.devices.length, 0) + 1;
  const subHint = sub
    ? waits(srv.subnet)
    : _('Device addresses come from it. Change it when it clashes with a network a device connects from.');
  const subLine = h('span', {}, subHint);
  const net = c.write
    ? h(
        'button',
        {
          type: 'button',
          class: `kt-vpk kt-ie-v mono kt-lm-net${sub ? ' st-wait-v' : ''}`,
          title: _('Change'),
          'aria-label': fmt('%s: %s. %s', _('Network'), subnet, _('Change')),
        },
        subnet,
      )
    : h('span', { class: 'mono kt-lm-net' }, subnet);
  if (c.write)
    net.addEventListener('click', () =>
      inlineEdit(net, {
        label: _('Network'),
        start: subnet,
        plain: true,
        refuse: (v) => {
          const r = range(v);
          return r ? refuse(rangeHelp(r, nets, '')) : _('Subnet must look like 10.77.0.0/24.');
        },
        commit: (v) => {
          const to = subnetOf(range(v)!);
          if (to === srv.subnet) return c.unstage('subnet');
          if (to !== subnet) c.change({ kind: 'subnet', value: to, label: fmt(_('Tunnel network: %s'), to), values: { subnet: to } });
        },
        say: (t, bad) => {
          subLine.textContent = t ?? subHint;
          subLine.className = bad ? 'bad-t' : '';
        },
      }),
    );
  const dnsNow = srv.dns.join(', ');
  const dnsStart = dns ? String(dns.values?.dns ?? '') : dnsNow;
  const dnsRow = textRow(
    {
      label: _('DNS for devices'),
      value: dns ? dns.value : srv.dns.length ? dnsNow : here,
      start: dnsStart,
      mono: dns ? !!dnsStart : !!srv.dns.length,
      plain: true,
      re: refetchOf('dns', srv.id, c.st.people),
      mode: { empty: here, placeholder: _('this router'), says: _('IP addresses, separated by commas; empty: this router'), on: !dnsStart },
      hint: dns ? waits(srv.dns.length ? dnsNow : here) : dnsHelp(dnsNow, srv.address).text,
      refuse: (v) => refuse(dnsHelp(v, srv.address)),
      ask: (v) => {
        const list = v.split(/[ ,]+/).filter(Boolean).join(', ');
        if (list === dnsNow) return c.unstage('dns');
        const shown = list || here;
        c.change({ kind: 'dns', value: shown, label: fmt(_('DNS: %s'), shown), values: { dns: v } });
      },
    },
    c.write,
  );
  dnsRow.classList.toggle('st-waits', !!dns);
  return section(
    stageHead(c, 'tunnel'),
    card(
      stageHealth(c, 'tunnel'),
      measure({
        label: _('Tunnel network'),
        mark: [
          net,
          c.write ? ic('edit', 'i kt-vpk-ic kt-lm-pen') : null,
          h('span', { class: 'kt-lm-re' }, reMark(refetchOf('subnet', srv.id, c.st.people))),
        ],
        used: String(used),
        of: h('b', { class: 'num' }, String(ROOM)),
        unit: _('addresses taken'),
        part: used / ROOM,
        says: fmt(_('%s of %s addresses taken'), used, ROOM),
        sub: subLine,
      }),
      dnsRow,
      // the router's own address in the tunnel; the interface and the key are the core's (keysSection)
      h('div', { class: 'tn-chips' }, chip(_('router', 'in the tunnel'), srv.address, srv.address)),
    ),
  );
}
