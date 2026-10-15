// ⌘K / Ctrl+K command menu: jump to people and devices (also by IP or
// address) and run the common actions without leaving the keyboard.

import type { Person, Status } from '../shared/types';
import { E } from './e';
import { api } from './api';
import { attempt, copyText } from './ui';
import { icon } from '../shared/icons';
import { ACCESS_SHORT, initials } from '../shared/format';

interface Item {
  group: string;
  label: string;
  hint?: string;
  icon?: string;
  avatar?: string;
  kbd?: string;
  run: () => unknown;
}

let cache: { st: Status; at: number } | null = null;
let open = false;

/** A server's People section (Servers page). */
export function peopleUrl(server?: string): string {
  return `${L.url('admin/network/dawnline/server')}?${server ? `server=${encodeURIComponent(server)}&` : ''}section=people`;
}

export function personUrl(id: string, device?: string): string {
  return `${L.url('admin/network/dawnline/person')}?id=${encodeURIComponent(id)}${device ? `&device=${encodeURIComponent(device)}` : ''}`;
}

function go(path: string) {
  location.href = L.url(`admin/network/dawnline/${path}`);
}

function addMonths(iso: string, n: number): string {
  const base = iso ? new Date(`${iso}T12:00:00`) : new Date();
  const from = base.getTime() < Date.now() ? new Date() : base;
  from.setMonth(from.getMonth() + n);
  return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
}

function personActions(p: Person, done: () => void): Item[] {
  const g = `Actions for ${p.name}`;
  const items: Item[] = [];
  if (p.link)
    items.push({ group: g, label: 'Copy personal link', icon: 'link', kbd: 'C', run: () => copyText(p.link!, 'Personal link copied') });
  items.push({ group: g, label: `Add device for ${p.name}`, icon: 'plus', run: () => (location.href = `${personUrl(p.id)}&add=1`) });
  items.push({
    group: g,
    label: p.paused ? `Resume ${p.name}` : `Pause ${p.name}`,
    icon: p.paused ? 'play' : 'pause',
    kbd: 'P',
    run: async () => {
      await attempt(() => api.personPause(p.id, !p.paused), p.paused ? `${p.name} resumed` : `${p.name} paused`);
      done();
    },
  });
  items.push({
    group: g,
    label: 'Extend access by 1 month',
    icon: 'key',
    run: async () => {
      await attempt(() => api.personUpdate(p.id, { expires: addMonths(p.expires, 1) }), 'Access extended');
      done();
    },
  });
  return items;
}

function build(st: Status, q: string, done: () => void): Item[] {
  const query = q.trim().toLowerCase();
  const items: Item[] = [];
  const people = st.people.filter((p) => !query || [p.name, p.id].some((x) => x.toLowerCase().includes(query)));
  for (const p of people.slice(0, 6))
    items.push({
      group: 'People',
      label: p.name,
      hint: `${ACCESS_SHORT[p.access]} · ${p.online ? `${p.online} online` : `${p.devices.length} device${p.devices.length === 1 ? '' : 's'}`}`,
      avatar: initials(p.name),
      run: () => (location.href = personUrl(p.id)),
    });
  for (const p of st.people)
    for (const d of p.devices) {
      const hay = [d.name, d.address, d.endpoint, d.hostname].join(' ').toLowerCase();
      if (query && !hay.includes(query)) continue;
      if (!query && !d.online) continue;
      items.push({
        group: 'Devices',
        label: d.name,
        hint: `${p.name} · ${d.address}${d.online ? ` · ${d.endpoint}` : ''}`,
        icon: d.kind,
        run: () => (location.href = personUrl(p.id, d.id)),
      });
    }
  if (people.length === 1 || (people.length && query)) items.push(...personActions(people[0], done));
  const pages: [string, string, string][] = [
    ['overview', 'Overview', 'globe'],
    ['people', 'People', 'shield'],
    ['activity', 'Activity', 'file'],
    ['server', 'Server', 'key'],
    ['health', 'Health', 'check'],
    ['settings?section=backups', 'Backups', 'archive'],
    ['settings', 'Settings', 'edit'],
  ];
  for (const [path, label, ic] of pages)
    if (!query || label.toLowerCase().includes(query)) items.push({ group: 'Go to', label, icon: ic, run: () => go(path) });
  if (!query || 'add person'.includes(query))
    items.push({
      group: 'Go to',
      label: 'Add person',
      icon: 'plus',
      run: () => (location.href = `${L.url('admin/network/dawnline/server')}?section=people&add=1`),
    });
  return items;
}

export async function openPalette() {
  if (open) return;
  open = true;
  const input = E('input', {
    type: 'text',
    class: 'dl-pal-input',
    placeholder: 'Search people, devices, IPs or actions…',
    'aria-label': 'Search',
  }) as HTMLInputElement;
  const list = E('div', { class: 'dl-pal-list', role: 'listbox' });
  const box = E('div', { class: 'dl-pal', role: 'dialog', 'aria-label': 'Command menu' }, [
    E('label', { class: 'dl-pal-search' }, [icon('search'), input, E('kbd', {}, 'Esc')]),
    list,
    E('div', { class: 'dl-pal-foot' }, [
      E('span', {}, [E('kbd', {}, '↑↓'), ' navigate']),
      E('span', {}, [E('kbd', {}, '↵'), ' open']),
      E('span', {}, [E('kbd', {}, '⌘K'), ' toggle']),
    ]),
  ]);
  const overlay = E('div', { class: 'dl-pal-overlay dl-root' }, box);
  let items: Item[] = [];
  let sel = 0;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    open = false;
  };
  const render = () => {
    const st = cache?.st;
    if (!st) {
      list.replaceChildren(E('div', { class: 'dl-pal-empty' }, 'Loading…'));
      return;
    }
    items = build(st, input.value, () => {
      cache = null;
      close();
      location.reload();
    });
    sel = Math.min(sel, Math.max(0, items.length - 1));
    const nodes: Node[] = [];
    let group = '';
    items.forEach((it, i) => {
      if (it.group !== group) {
        group = it.group;
        nodes.push(E('div', { class: 'dl-pal-group' }, group));
      }
      const row = E(
        'div',
        {
          class: `dl-pal-item${i === sel ? ' sel' : ''}`,
          role: 'option',
          'aria-selected': i === sel ? 'true' : 'false',
          click: () => {
            close();
            it.run();
          },
          mousemove: () => {
            if (sel !== i) {
              sel = i;
              render();
            }
          },
        },
        [
          it.avatar ? E('span', { class: 'dl-avatar sm' }, it.avatar) : it.icon ? icon(it.icon) : E('span', { class: 'dl-pal-ic' }),
          E('span', { class: 'dl-pal-label' }, [it.label, it.hint ? E('span', { class: 'dl-faint' }, ` · ${it.hint}`) : '']),
          it.kbd ? E('kbd', {}, it.kbd) : '',
        ],
      );
      nodes.push(row);
    });
    if (!items.length) nodes.push(E('div', { class: 'dl-pal-empty' }, 'Nothing found.'));
    list.replaceChildren(...nodes);
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      sel = Math.min(items.length - 1, sel + 1);
      render();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      sel = Math.max(0, sel - 1);
      render();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const it = items[sel];
      if (it) {
        close();
        it.run();
      }
    }
  };
  input.addEventListener('input', () => {
    sel = 0;
    render();
  });
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  input.focus();
  render();
  if (!cache || Date.now() - cache.at > 10000) {
    const st = await api.status(1).catch(() => null);
    if (st) cache = { st, at: Date.now() };
    if (open) render();
  }
}

/** Install the global shortcut once per page load. */
export function installPalette(seed?: Status) {
  if (seed) cache = { st: seed, at: Date.now() };
  const w = window as any;
  if (w.__dlPalette) return;
  w.__dlPalette = true;
  // Capture phase on window, so Outline's own ⌘K search does not open too.
  window.addEventListener(
    'keydown',
    (ev) => {
      if (!location.pathname.includes('/admin/network/dawnline')) return;
      const typing =
        /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target as HTMLElement)?.tagName ?? '') || (ev.target as HTMLElement)?.isContentEditable;
      const cmdK = (ev.key === 'k' || ev.key === 'K') && (ev.metaKey || ev.ctrlKey);
      const slash = ev.key === '/' && !typing && !document.body.classList.contains('modal-overlay-active');
      if (!cmdK && !slash) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      openPalette();
    },
    true,
  );
}
