// Server → Access pieces: home services (picked from devices at home), circles,
// "Who reaches what" and "Check access".

import type { Circle, Person, Server, Status } from '../shared/types';
import { E } from './e';
import { api, type HomeHost } from './api';
import { button } from './ui/button';
import { cancelButton, closeModal, confirmDialog, modal } from './ui/modal';
import { attempt } from './ui/toast';
import { chipToggle, input } from './ui/controls';
import { icon } from '../shared/icons';

type Service = Status['services'][number];

/** Circle colours; the circle stores an index. */
export const CIRCLE_COLORS = ['#3a83f7', '#a78bfa', '#f472b6', '#f59e0b', '#10b981', '#22d3ee', '#ef4444', '#84cc16'];

export const circleDot = (c: Circle | undefined) =>
  E('i', { class: 'dl-circle-dot', style: `background:${CIRCLE_COLORS[c?.color ?? 0] ?? CIRCLE_COLORS[0]}` });

/** People whose devices can be reached at home (the mesh and home devices). */
export const homeAccess = (p: Person) => p.access === 'both' || (p.access === 'lan' && !p.services?.length);

/* ---------- Home services ---------- */

export function serviceDialog(sv: Service | null, prefill: Partial<Service>, onSaved: () => unknown) {
  const name = input(sv?.name ?? prefill.name ?? '', { placeholder: 'NAS' });
  const addr = input(sv?.address ?? prefill.address ?? '', { placeholder: '192.168.1.10', class: 'cbi-input-text dl-mono' });
  const ports = input((sv?.ports ?? prefill.ports ?? []).join(', '), {
    placeholder: 'All ports, or e.g. 445, 5000',
    class: 'cbi-input-text dl-mono',
  });
  const field = (label: string, el: Node) =>
    E('div', { class: 'cbi-value' }, [E('label', { class: 'cbi-value-title' }, label), E('div', { class: 'cbi-value-field' }, el)]);
  modal(
    sv ? `Edit ${sv.name}` : 'Add service',
    [field('Name', name), field('Address', addr), field('Ports', ports)],
    [
      cancelButton(),
      ' ',
      button(
        'Save',
        async () => {
          const list = ports.value.split(/[ ,]+/).filter(Boolean);
          if (await attempt(() => api.serviceSet(sv?.id ?? '', name.value, addr.value, list), 'Saved')) {
            closeModal();
            onSaved();
          }
        },
        'positive',
      ),
    ],
  );
}

/** Port groups a device at home offers: what it announces over Bonjour, or the usual ones. */
const MDNS_LABEL: Record<string, string> = {
  _smb: 'SMB',
  _afpovertcp: 'AFP',
  _http: 'Web',
  _https: 'Web',
  _ssh: 'SSH',
  _sftp: 'SFTP',
  '_sftp-ssh': 'SFTP',
  _ipp: 'Printer',
  _ipps: 'Printer',
  _printer: 'Printer',
  '_pdl-datastream': 'Printer',
  _airplay: 'AirPlay',
  _raop: 'AirPlay',
  _rfb: 'Screen sharing',
  _googlecast: 'Cast',
  _hap: 'HomeKit',
  _rdp: 'Remote desktop',
  _ftp: 'FTP',
};
const DEFAULT_PORTS: [string, string[]][] = [
  ['Web', ['80', '443']],
  ['SMB', ['445']],
  ['SSH', ['22']],
];

function portGroups(h: HomeHost): [string, string[]][] {
  const by = new Map<string, Set<string>>();
  for (const s of h.services) {
    const label = MDNS_LABEL[s.type.split('.')[0]];
    if (!label || !s.port) continue;
    (by.get(label) ?? by.set(label, new Set()).get(label)!).add(String(s.port));
  }
  return by.size ? [...by].map(([l, p]) => [l, [...p].sort((a, b) => +a - +b)]) : DEFAULT_PORTS;
}

/** Home services as a live part of Server → Access: `update` repaints it from a new status. */
export interface HomeServices {
  el: HTMLElement;
  update(st: Status): void;
}

/**
 * Services shared by all servers, and the devices at home to add them from.
 * The devices are read once; `reload` refreshes the status after a change
 * (the rest of the Access section, and what is typed there, stays).
 */
export function homeServices(initial: Status, serverId: string, reload: () => Promise<unknown>): HomeServices {
  let st = initial;
  let hosts: { hosts: HomeHost[]; mdns: boolean } | null = null;
  let failed = false;
  /** The "Add from devices at home" fold, once opened or closed by hand. */
  let open: boolean | null = null;
  /** Devices with a change on its way: a second click would add the service twice. */
  const busy = new Set<string>();
  const list = E('div', { class: 'dl-list' });
  const picker = E('div', { class: 'dl-stack gap8' }, E('span', { class: 'dl-sub' }, 'Looking for devices at home…'));

  const paintRows = () => {
    const services = st.services;
    dom.content(
      list,
      services.length
        ? services.map((sv) =>
            E('div', { class: 'dl-row' }, [
              icon('home'),
              E('span', { class: 'dl-row-main dl-stack' }, [
                E('b', {}, sv.name),
                E(
                  'span',
                  { class: 'dl-mono dl-faint' },
                  `${sv.address}${sv.ports.length ? ` · ports ${sv.ports.join(', ')}` : ' · all ports'}`,
                ),
              ]),
              button('Edit', () => serviceDialog(sv, {}, reload)),
              button(
                [icon('trash')],
                async () => {
                  if (
                    (await confirmDialog(`Remove ${sv.name}?`, 'People limited to this service lose access to it.', 'Remove', true)) &&
                    (await attempt(() => api.serviceDelete(sv.id), 'Removed'))
                  )
                    await reload();
                },
                'neutral',
                { title: 'Remove', 'aria-label': `Remove ${sv.name}` },
              ),
            ]),
          )
        : [E('div', { class: 'dl-row dl-muted' }, 'No services yet: pick ports of a device below.')],
    );
  };

  /** Ports chosen for a device: add, change or remove its service at once. */
  async function choose(h: HomeHost, ports: string[] | null) {
    if (busy.has(h.address)) return;
    busy.add(h.address);
    paintPicker();
    try {
      const sv = st.services.find((s) => s.address === h.address);
      const ok =
        ports === null
          ? sv && (await attempt(() => api.serviceDelete(sv.id), `${sv.name} removed`))
          : await attempt(
              () => api.serviceSet(sv?.id ?? '', sv?.name ?? (h.name || h.address), h.address, ports),
              sv ? `${sv.name} updated` : `${h.name || h.address} added`,
            );
      if (ok) await reload();
    } finally {
      busy.delete(h.address);
      paintPicker();
    }
  }

  function hostRow(h: HomeHost): HTMLElement {
    const sv = st.services.find((s) => s.address === h.address);
    const all = !!sv && !sv.ports.length;
    const chosen = new Set(sv?.ports ?? []);
    const wait = busy.has(h.address);
    const chip = (label: string, on: boolean, click: () => void) =>
      chipToggle(label, on, click, { disabled: wait ? 'disabled' : null, 'aria-busy': wait ? 'true' : null });
    return E('div', { class: 'dl-row' }, [
      icon(h.services.some((s) => s.type.startsWith('_ipp') || s.type.startsWith('_printer')) ? 'file' : 'computer'),
      E('span', { class: 'dl-row-main dl-stack' }, [E('b', {}, h.name || h.address), E('span', { class: 'dl-mono dl-faint' }, h.address)]),
      E('div', { class: 'dl-chips-row dl-host-ports' }, [
        chip('All ports', all, () => choose(h, all ? null : [])),
        ...portGroups(h).map(([label, ports]) => {
          const on = !all && ports.every((p) => chosen.has(p));
          return chip(`${label} ${ports.join(', ')}`, on, () => {
            const next = new Set(all ? [] : chosen);
            for (const p of ports) {
              if (on) next.delete(p);
              else next.add(p);
            }
            choose(h, next.size ? [...next] : null);
          });
        }),
      ]),
    ]);
  }

  function paintPicker() {
    if (failed) return dom.content(picker, E('span', { class: 'dl-sub' }, "Couldn't read the devices at home."));
    if (!hosts) return;
    const r = hosts;
    if (!r.hosts.length) return dom.content(picker, E('span', { class: 'dl-sub' }, 'No devices found in the home network right now.'));
    // Open while there are no services yet (that is where they come from), then as left.
    const fold = E('details', { class: 'dl-params', open: (open ?? !st.services.length) ? '' : null }, [
      E('summary', {}, [
        icon('chevron'),
        E('span', {}, 'Add from devices at home'),
        E('span', { class: 'dl-pcount' }, String(r.hosts.length)),
      ]),
      E('div', { class: 'dl-params-body' }, [
        E(
          'span',
          { class: 'dl-sub' },
          r.mdns
            ? 'Ports they announce over Bonjour. Pick what to open, or all ports.'
            : 'Devices that got an address from this router. Pick the ports to open, or all ports.',
        ),
        E('div', { class: 'dl-list' }, r.hosts.map(hostRow)),
      ]),
    ]);
    fold.addEventListener('toggle', () => (open = (fold as HTMLDetailsElement).open));
    dom.content(picker, fold);
  }

  api
    .homeHosts(serverId)
    .then((r) => {
      hosts = r;
      paintPicker();
    })
    .catch(() => {
      failed = true;
      paintPicker();
    });
  paintRows();

  const el = E('div', { class: 'dl-stack gap8' }, [
    E('div', { class: 'dl-iflead' }, [
      E('div', { class: 'dl-iflead-row' }, [
        E('b', {}, 'Home services'),
        button([icon('plus'), ' Add service'], () => serviceDialog(null, {}, reload)),
      ]),
      E(
        'span',
        { class: 'dl-sub' },
        'Home-only people can be limited to these instead of whole networks (chosen on their page). Shared by all servers.',
      ),
    ]),
    list,
    picker,
  ]);
  return {
    el,
    update(n: Status) {
      st = n;
      paintRows();
      paintPicker();
    },
  };
}

/* ---------- Circles ---------- */

export function circleDialog(st: Status, serverId: string, ci: Circle | null, onDone: () => unknown) {
  const used = new Set(st.circles.filter((c) => c.server === serverId).map((c) => c.color));
  let color = ci?.color ?? CIRCLE_COLORS.findIndex((_, i) => !used.has(i));
  if (color < 0) color = 0;
  const name = input(ci?.name ?? '', { placeholder: 'Family' });
  const people = st.people.filter((p) => p.server === serverId).sort((a, b) => a.name.localeCompare(b.name));
  const members = new Set(people.filter((p) => ci && p.circle === ci.id).map((p) => p.id));

  const swatches = E('div', { class: 'dl-swatches', role: 'radiogroup', 'aria-label': 'Colour' });
  const paintSwatches = () =>
    dom.content(
      swatches,
      CIRCLE_COLORS.map((c, i) =>
        E('button', {
          type: 'button',
          role: 'radio',
          class: `dl-swatch${i === color ? ' on' : ''}`,
          style: `--sw:${c}`,
          'aria-checked': i === color ? 'true' : 'false',
          'aria-label': `Colour ${i + 1}`,
          click: () => {
            color = i;
            paintSwatches();
          },
        }),
      ),
    );
  paintSwatches();

  const chips = E(
    'div',
    { class: 'dl-chips-row' },
    people.map((p) => {
      const other = p.circle && p.circle !== ci?.id ? st.circles.find((c) => c.id === p.circle) : undefined;
      return E(
        'button',
        {
          type: 'button',
          class: `dl-chipbtn${members.has(p.id) ? ' on' : ''}`,
          title: !homeAccess(p)
            ? `${p.name} has no home access: their devices aren't reachable anyway`
            : other
              ? `Now in ${other.name}`
              : '',
          click: (ev: Event) => {
            if (!members.delete(p.id)) members.add(p.id);
            (ev.currentTarget as HTMLElement).classList.toggle('on', members.has(p.id));
          },
        },
        [p.name, !homeAccess(p) ? E('b', {}, 'internet') : other ? E('b', {}, other.name) : ''],
      );
    }),
  );
  const field = (label: string, el: Node) =>
    E('div', { class: 'cbi-value' }, [E('label', { class: 'cbi-value-title' }, label), E('div', { class: 'cbi-value-field' }, el)]);

  modal(
    ci ? `Edit ${ci.name}` : 'New circle',
    [
      field('Name', name),
      field('Colour', swatches),
      field('People', chips),
      E('p', { class: 'dl-sub' }, 'Devices of people in one circle reach each other. A person is in one circle at a time.'),
    ],
    [
      ci
        ? button(
            'Delete',
            async () => {
              if (await attempt(() => api.circleDelete(ci.id), `${ci.name} deleted`)) {
                closeModal();
                onDone();
              }
            },
            'negative',
          )
        : '',
      E('span', { class: 'dl-spacer' }),
      cancelButton(),
      ' ',
      button(
        'Save',
        async () => {
          if (await attempt(() => api.circleSet(ci?.id ?? '', serverId, name.value, color, [...members]), 'Saved')) {
            closeModal();
            onDone();
          }
        },
        'positive',
      ),
    ],
    'dl-circle-modal',
  );
}

/** The server's circles as chips (click to edit) and a round "+" to add one. */
export function circleChips(st: Status, serverId: string, onDone: () => unknown): HTMLElement {
  const list = st.circles.filter((c) => c.server === serverId);
  return E('div', { class: 'dl-chips-row dl-circles' }, [
    ...list.map((c) => {
      const who = st.people.filter((p) => p.circle === c.id).map((p) => p.name);
      return E(
        'button',
        { type: 'button', class: 'dl-chip', title: `Edit ${c.name}`, click: () => circleDialog(st, serverId, c, onDone) },
        [circleDot(c), E('b', {}, c.name), E('span', { class: 'dl-faint' }, who.length ? who.join(', ') : 'nobody yet')],
      );
    }),
    E(
      'button',
      {
        type: 'button',
        class: 'dl-chip add',
        title: 'New circle',
        'aria-label': 'New circle',
        click: () => circleDialog(st, serverId, null, onDone),
      },
      icon('plus'),
    ),
  ]);
}

/* ---------- Who reaches what ---------- */

export function whoReaches(st: Status, srv: Server): HTMLElement {
  const people = st.people.filter((p) => p.server === srv.id);
  const yes = (t = '') => E('span', { class: 'dl-yes' }, [icon('check'), t]);
  const no = () => E('span', { class: 'dl-faint' }, '—');
  const home = (list: Person[]) => {
    const kinds = new Set(list.map((p) => (p.access === 'lan' && p.services?.length ? 'services' : p.home_nets?.length ? 'some' : 'all')));
    if (!kinds.size) kinds.add('all');
    return yes([...kinds].map((k) => ({ all: 'all networks', some: 'their networks', services: 'services' })[k]).join(' / '));
  };
  const each = () => (srv.mesh === 'off' ? no() : srv.mesh === 'circles' ? yes('circle') : yes());
  const net = srv.lan_like ? 'like home' : 'direct';
  const row = (label: string, list: Person[], cells: Node[]) =>
    E('tr', {}, [
      E('td', {}, [E('b', {}, label), E('div', { class: 'dl-sub' }, `${list.length} ${list.length === 1 ? 'person' : 'people'}`)]),
      ...cells.map((c) => E('td', {}, c)),
    ]);
  const by = (a: string) => people.filter((p) => p.access === a);
  return E('section', { class: 'dl-setsec' }, [
    E('div', { class: 'dl-setsec-body' }, [
      E('div', { class: 'dl-panel-head' }, [
        E('h3', {}, 'Who reaches what'),
        E('span', { class: 'dl-spacer' }),
        E('span', { class: 'dl-sub' }, 'From the rules on this server'),
      ]),
      E(
        'div',
        { class: 'dl-reach-wrap' },
        E('table', { class: 'dl-table dl-reach' }, [
          E(
            'tr',
            {},
            ['', 'Internet', 'Home', 'This router', 'Each other'].map((t) => E('th', {}, t)),
          ),
          row('Internet', by('internet'), [yes(net), no(), E('span', { class: 'dl-faint' }, 'DNS'), no()]),
          row('Home', by('lan'), [E('span', { class: 'dl-faint' }, 'their own'), home(by('lan')), yes(), each()]),
          row('Both', by('both'), [yes(net), home(by('both')), yes(), each()]),
        ]),
      ),
      E(
        'p',
        { class: 'dl-sub' },
        'Home devices reach the devices of people with home access, on the networks those people reach. Paused, ended and over-the-limit people reach nothing.',
      ),
    ]),
  ]);
}

/* ---------- Check access ---------- */

export function checkAccess(st: Status, srv: Server): HTMLElement {
  const devs = st.people
    .filter((p) => p.server === srv.id)
    .flatMap((p) => p.devices.map((d) => ({ id: d.id, label: `${p.name} · ${d.name}` })))
    .sort((a, b) => a.label.localeCompare(b.label));
  const ADDR = '@addr';
  /** A device, or an address typed in. */
  const end = (placeholder: string, initial: string) => {
    const sel = E('select', { class: 'cbi-input-select', 'aria-label': placeholder }, [
      ...devs.map((d) => E('option', { value: d.id, selected: d.id === initial ? 'selected' : null }, d.label)),
      E('option', { value: ADDR, selected: initial === ADDR ? 'selected' : null }, 'Address'),
    ]) as HTMLSelectElement;
    const addr = input('', { placeholder, class: 'cbi-input-text dl-mono' });
    const wrap = E('div', { class: 'dl-check-end' }, [sel, addr]);
    const sync = () => (addr.hidden = sel.value !== ADDR);
    sel.addEventListener('change', sync);
    sync();
    return { el: wrap, value: () => (sel.value === ADDR ? addr.value.trim() : sel.value) };
  };
  const from = end('10.0.1.11', devs[0]?.id ?? ADDR);
  const to = end('10.0.1.20:445', ADDR);
  const out = E('div', { class: 'dl-stack gap8' });
  const run = async () => {
    const r = await attempt(() => api.accessCheck(from.value(), to.value()));
    if (!r) return;
    const stop = r.steps.findIndex((s) => !s.ok);
    dom.content(out, [
      E('div', { class: `dl-verdict ${r.ok ? 'ok' : 'bad'}` }, [
        E('b', {}, r.ok ? 'Allowed' : 'Blocked'),
        E('span', { class: 'dl-sub' }, r.ok ? 'Every step lets it through' : `Stops at step ${stop + 1} of ${r.steps.length}`),
      ]),
      E(
        'ul',
        { class: 'dl-checks' },
        r.steps.map((s) =>
          E('li', {}, [
            E('span', { class: `dl-check-icon ${s.ok ? 'ok' : 'error'}` }, icon(s.ok ? 'check' : 'x')),
            E('div', { class: 'dl-check-body' }, [
              E('div', { class: 'dl-check-title' }, s.title),
              s.detail ? E('div', { class: 'dl-check-detail' }, s.detail) : '',
            ]),
          ]),
        ),
      ),
    ]);
  };
  return E('section', { class: 'dl-setsec' }, [
    E('div', { class: 'dl-setsec-body' }, [
      E('div', { class: 'dl-panel-head' }, [
        E('h3', {}, 'Check access'),
        E('span', { class: 'dl-spacer' }),
        E('span', { class: 'dl-sub' }, 'Why something does or does not connect'),
      ]),
      E('div', { class: 'dl-check-form' }, [from.el, E('span', { class: 'dl-faint' }, '→'), to.el, button('Check', run)]),
      out,
    ]),
  ]);
}
