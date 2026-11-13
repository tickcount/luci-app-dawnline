// Home services in the portal's sheet (from the old Access page, restyled):
// one service's name, address and ports, saved or removed (asked first: the
// people limited to it lose it); and the devices at home to add them from
// (home_hosts: DHCP leases and static hosts, with what they announce over
// Bonjour), each device's port groups as chips that add, change or remove its
// service at once. Services are shared by all servers.

import type { Status } from '../../shared/types';
import { api, type HomeHost } from '../api';
import { h } from '../../portal/dom';
import { closeSheet, go, head, hint, openSheet, type View } from '../../portal/ui/sheet';
import { once } from '../../portal/ui/feedback';
import { fmt } from '../../shared/i18n';
import { ipv4Help, nameHelp, portsHelp } from '../netcheck';
import { errorText, notify } from '../ui/toast';
import { say } from '../shell/toast';
import { askView } from './ask';
import { field } from './form';
import { putChildren } from '../../portal/ui/put';

type Service = Status['services'][number];

export interface ServiceCtx {
  /** The services as the page has them now. */
  services(): Service[];
  /** After a change: the page reads the router again. */
  changed(): Promise<void>;
}

function serviceView(c: ServiceCtx, sv: Service | null): View {
  const name = field(_('Name', 'circle or service'), sv?.name ?? '', (v) => nameHelp(v, [], _('Shown to people who may reach it.')), {
    placeholder: _('NAS'),
  });
  const addr = field(_('Address'), sv?.address ?? '', (v) => ipv4Help(v), { placeholder: '192.168.1.10', mono: true, plain: true });
  const ports = field(_('Ports'), (sv?.ports ?? []).join(', '), (v) => portsHelp(v), {
    placeholder: _('All ports, or e.g. 445, 5000'),
    mono: true,
    plain: true,
  });
  const save = h('button', { type: 'button', class: 'btn accent block' }, h('span', {}, _('Save'))) as HTMLButtonElement;
  save.addEventListener('click', () =>
    once(save, async () => {
      if (![name, addr, ports].every((f) => f.check())) return;
      try {
        await api.serviceSet(sv?.id ?? '', name.value(), addr.value(), ports.value().split(/[ ,]+/).filter(Boolean));
        closeSheet();
        say(sv ? fmt(_('%s updated'), name.value()) : fmt(_('%s added'), name.value()));
        await c.changed();
      } catch (e) {
        notify(errorText(e), 'error', 10000);
      }
    }),
  );
  const del = sv
    ? h(
        'button',
        {
          type: 'button',
          class: 'btn soft block bad-t',
          onclick: () =>
            go(() =>
              askView({
                icon: 'trash',
                tone: 'red',
                title: fmt(_('Remove %s?'), sv.name),
                text: [_('People limited to this service lose access to it.')],
                action: _('Remove'),
                cls: 'red',
                run: async () => {
                  await api.serviceDelete(sv.id);
                  closeSheet();
                  say(fmt(_('%s removed'), sv.name));
                  await c.changed();
                },
              }),
            ),
        },
        h('span', {}, _('Remove')),
      )
    : null;
  const title = sv ? fmt(_('Edit %s'), sv.name) : _('Add service');
  requestAnimationFrame(() => name.input.focus({ preventScroll: true }));
  const el = h(
    'div',
    { class: 'view' },
    head(title),
    name.el,
    addr.el,
    ports.el,
    h('div', { class: 'fl-acts' }, save, del),
    hint(_('Home-only people can be limited to these instead of whole networks (chosen on their page). Shared by all servers.')),
  );
  return { el, label: title };
}

/** A service: a new one (null), or one to change. */
export const openService = (c: ServiceCtx, sv: Service | null) => openSheet(() => serviceView(c, sv));

/** The port group a Bonjour service type belongs to, by its name. */
function mdnsLabels(): Record<string, string> {
  const web = _('Web');
  const printer = _('Printer');
  return {
    _smb: 'SMB',
    _afpovertcp: 'AFP',
    _http: web,
    _https: web,
    _ssh: 'SSH',
    _sftp: 'SFTP',
    '_sftp-ssh': 'SFTP',
    _ipp: printer,
    _ipps: printer,
    _printer: printer,
    '_pdl-datastream': printer,
    _airplay: 'AirPlay',
    _raop: 'AirPlay',
    _rfb: _('Screen sharing'),
    _googlecast: 'Cast',
    _hap: 'HomeKit',
    _rdp: _('Remote desktop'),
    _ftp: 'FTP',
  };
}

/** Port groups a device at home offers: what it announces over Bonjour, or the usual ones. */
function portGroups(x: HomeHost): [string, string[]][] {
  const labels = mdnsLabels();
  const by = new Map<string, Set<string>>();
  for (const s of x.services) {
    const label = labels[s.type.split('.')[0]];
    if (!label || !s.port) continue;
    (by.get(label) ?? by.set(label, new Set()).get(label)!).add(String(s.port));
  }
  return by.size
    ? [...by].map(([l, p]) => [l, [...p].sort((a, b) => +a - +b)])
    : [
        [_('Web'), ['80', '443']],
        ['SMB', ['445']],
        ['SSH', ['22']],
      ];
}

function hostsView(c: ServiceCtx, srv: string): View {
  const list = h('div', { class: 'hosts' }, h('p', { class: 'hint' }, _('Looking for devices at home…')));
  const note = hint('');
  const busy = new Set<string>();
  let hosts: HomeHost[] = [];

  /** Ports chosen for a device: add, change or remove its service at once. */
  const choose = async (x: HomeHost, ports: string[] | null) => {
    if (busy.has(x.address)) return;
    busy.add(x.address);
    paint();
    try {
      const sv = c.services().find((s) => s.address === x.address);
      if (ports === null) {
        if (sv) {
          await api.serviceDelete(sv.id);
          say(fmt(_('%s removed'), sv.name));
        }
      } else {
        await api.serviceSet(sv?.id ?? '', sv?.name ?? (x.name || x.address), x.address, ports);
        say(sv ? fmt(_('%s updated'), sv.name) : fmt(_('%s added'), x.name || x.address));
      }
      await c.changed();
    } catch (e) {
      notify(errorText(e), 'error', 10000);
    } finally {
      busy.delete(x.address);
      paint();
    }
  };
  const row = (x: HomeHost) => {
    const sv = c.services().find((s) => s.address === x.address);
    const all = !!sv && !sv.ports.length;
    const chosen = new Set(sv?.ports ?? []);
    const wait = busy.has(x.address);
    const chip = (label: string, on: boolean, run: () => void) =>
      h(
        'button',
        {
          type: 'button',
          class: `chipb${on ? ' on' : ''}${wait ? ' busy' : ''}`,
          'aria-pressed': String(on),
          disabled: wait,
          onclick: run,
        },
        label,
      );
    return h(
      'div',
      { class: 'host' },
      h('div', { class: 'host-t' }, h('b', {}, x.name || x.address), h('span', { class: 'mono' }, x.address)),
      h(
        'div',
        { class: 'chips' },
        chip(_('All ports'), all, () => void choose(x, all ? null : [])),
        ...portGroups(x).map(([label, ports]) => {
          const on = !all && ports.every((p) => chosen.has(p));
          return chip(`${label} ${ports.join(', ')}`, on, () => {
            const next = new Set(all ? [] : chosen);
            for (const p of ports) {
              if (on) next.delete(p);
              else next.add(p);
            }
            void choose(x, next.size ? [...next] : null);
          });
        }),
      ),
    );
  };
  const paint = () =>
    putChildren(list, hosts.length ? hosts.map(row) : [h('p', { class: 'hint' }, _('No devices found in the home network right now.'))]);
  void api
    .homeHosts(srv)
    .then((r) => {
      hosts = r.hosts;
      note.textContent = r.mdns
        ? _('Ports they announce over Bonjour. Pick what to open, or all ports.')
        : _('Devices that got an address from this router. Pick the ports to open, or all ports.');
      paint();
    })
    .catch(() => putChildren(list, [h('p', { class: 'hint bad-t' }, _("Couldn't read the devices at home."))]));
  const el = h('div', { class: 'view' }, head(_('Add from devices at home')), note, list);
  return { el, label: _('Add from devices at home') };
}

/** The devices at home, each a way to a service of its ports (home_hosts reads this server's home networks). */
export const findAtHome = (c: ServiceCtx, srv: string) => openSheet(() => hostsView(c, srv));
