// Dawnline personal portal: one person's devices, served by the router on
// its own HTTPS port. No framework; strict CSP (no inline scripts/styles).
//
// Layout: phone = "Your access" on top, devices below; desktop (≥ 960px) =
// devices on the left, access on the right.

import type { ClientConfig, Device, Kind, Person } from '../shared/types';
import {
  ACCESS_LABEL,
  KIND_LABEL,
  STATE_LABEL,
  addDays,
  ago,
  byDeviceState,
  bytes,
  date,
  daysLeft,
  initials,
  isoDay,
  parseDay,
} from '../shared/format';
import { iconSvg } from '../shared/icons';
import { qrSvg } from '../shared/qr';
import { vpnKey } from '../shared/vpnkey';

interface State {
  title: string;
  person: Person;
  /** device_mesh: devices with home access reach each other through the tunnel. */
  server: { name: string; endpoint: string; device_mesh?: boolean };
  /** The device this page was opened from (through the tunnel), if any. */
  here?: string | null;
  can_add: boolean;
  kinds: Kind[];
  version: string;
  /** The router's day (YYYY-MM-DD) when it sends one; the browser's otherwise. */
  today?: string;
}

/** Today on the router, for days left and chart labels. */
const today = () => state?.today ?? isoDay(new Date());

type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;
type Kid = Node | string | null | undefined | false | Kid[];

function h(tag: string, attrs: Attrs = {}, ...kids: Kid[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  const add = (c: Kid) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  };
  kids.forEach(add);
  return el;
}

function ic(name: string): HTMLElement {
  const s = h('span', { class: 'ic' });
  s.innerHTML = iconSvg(name, 'ic-svg');
  return s;
}

const LOGO =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15a9 9 0 0 1 18 0z" fill="currentColor"/><rect x="2" y="17" width="20" height="2" rx="1" fill="currentColor" opacity=".45"/></svg>';

const app = document.getElementById('app')!;
const base = app.dataset.base ?? '';
const pageTitle = app.dataset.title || 'Dawnline';
const isMobile = () => window.matchMedia('(max-width: 959px)').matches || /Android|iPhone|iPad/.test(navigator.userAgent);
let state: State | null = null;
/** The personal link is the key: its path is the code (no sessions). */
const code = /^\/[a-z]{6}-[a-z]{6}-[a-z]{6}$/.test(base) ? base.slice(1) : '';

/* ---------- API ---------- */

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/* ---------- small UI pieces ---------- */

function toast(msg: string, bad = false) {
  const t = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

async function copy(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { class: 'offscreen' }, text) as HTMLTextAreaElement;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) return toast('Copying is blocked here. Select the text and copy it by hand.', true);
  }
  toast(what);
}

function download(name: string, text: string) {
  // Not text/plain: Safari would save "name.conf.txt".
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: name, class: 'offscreen' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

let tipEl: HTMLElement | null = null;
function tip(el: HTMLElement, lines: () => string[]) {
  const show = (ev: MouseEvent) => {
    tipEl ??= document.body.appendChild(h('div', { class: 'tip' }));
    tipEl.replaceChildren(...lines().map((l, i) => h('div', { class: i ? 'muted' : 'tip-title' }, l)));
    tipEl.style.display = '';
    tipEl.style.left = `${ev.clientX}px`;
    tipEl.style.top = `${ev.clientY - 10}px`;
  };
  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', show);
  el.addEventListener('mouseleave', () => tipEl && (tipEl.style.display = 'none'));
}

function spark(values: number[]): HTMLElement {
  const max = Math.max(1, ...values);
  const el = h('div', { class: 'spark' });
  values.forEach((v, i) => {
    const b = h('i', { class: v ? '' : 'zero' });
    b.style.height = `${Math.max(8, (v / max) * 100)}%`;
    const back = values.length - 1 - i;
    tip(b, () => [
      back === 0
        ? 'Today'
        : back === 1
          ? 'Yesterday'
          : parseDay(addDays(today(), -back)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      bytes(v),
    ]);
    el.appendChild(b);
  });
  return el;
}

/** Run a confirmed action once: its button stays disabled until the router answers. */
async function once(btn: HTMLButtonElement, fn: () => Promise<void>) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await fn();
  } finally {
    btn.disabled = false;
  }
}

/* ---------- sheets (bottom sheet on phones, dialog on desktop) ---------- */

let sheetEl: HTMLElement | null = null;
let sheetClosed: (() => void) | null = null;

function closeSheet(immediate = false) {
  if (!sheetEl) return;
  const s = sheetEl;
  sheetEl = null;
  document.body.classList.remove('locked');
  sheetClosed?.();
  sheetClosed = null;
  if (immediate) {
    s.remove();
    return;
  }
  s.classList.remove('open');
  setTimeout(() => s.remove(), 250);
}

function sheet(title: string, sub: string | null, ...content: Kid[]) {
  const replacing = !!sheetEl;
  closeSheet(true);
  const panel = h(
    'div',
    { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'grab' }),
    h(
      'div',
      { class: 'sheet-head' },
      h('div', { class: 'stack' }, h('h2', {}, title), sub ? h('span', { class: 'muted s' }, sub) : null),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => closeSheet() }, ic('x')),
    ),
    h('div', { class: 'sheet-body' }, ...content),
  );
  const s = h(
    'div',
    {
      class: 'sheet',
      onclick: (e: Event) => {
        if (e.target === s) closeSheet();
      },
    },
    panel,
  );
  document.body.appendChild(s);
  document.body.classList.add('locked');
  if (replacing) s.classList.add('open');
  else requestAnimationFrame(() => s.classList.add('open'));
  sheetEl = s;
  return panel;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu();
    closeSheet();
  }
});

/* ---------- dropdown menu ---------- */

let menuEl: HTMLElement | null = null;
function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}
document.addEventListener('click', (e) => {
  if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
});

function menu(anchor: HTMLElement, all: ({ label: string; icon: string; danger?: boolean; run: () => unknown } | null)[]) {
  closeMenu();
  // Separators only between items.
  const items = all.filter((it, i) => it || (i > 0 && all[i - 1] && all.slice(i + 1).some(Boolean)));
  const m = h(
    'div',
    { class: 'menu', role: 'menu' },
    items.map((it) =>
      it
        ? h(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              class: `menu-item${it.danger ? ' danger' : ''}`,
              onclick: () => {
                closeMenu();
                it.run();
              },
            },
            ic(it.icon),
            h('span', {}, it.label),
          )
        : h('div', { class: 'menu-sep' }),
    ),
  );
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = 230;
  m.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  m.style.top = `${r.bottom + 6 + window.scrollY}px`;
  menuEl = m;
}

/* ---------- views ---------- */

function shell(...content: Kid[]) {
  app.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h(
        'div',
        { class: 'brand' },
        (() => {
          const l = h('span', { class: 'logo' });
          l.innerHTML = LOGO;
          return l;
        })(),
        h('span', {}, state?.server.name || pageTitle),
        h('span', { class: 'faint' }, '· Dawnline'),
      ),
    ),
    h('main', { class: 'wrap' }, ...content),
  );
}

/** The link stopped working while the page was open (code regenerated, person removed). */
function linkGone() {
  shell(
    h(
      'div',
      { class: 'card signin' },
      h('div', { class: 'hero-ic' }, ic('key')),
      h('h1', {}, 'This link no longer works'),
      h('p', { class: 'muted' }, 'Ask for a new personal link.'),
    ),
  );
}

function stateTone(p: Person) {
  return p.state === 'active' ? 'ok' : p.state === 'quota' || p.state === 'expired' ? 'bad' : 'warn';
}

const ACCESS_TEXT: Record<Person['access'], string> = {
  internet: 'The internet, through the router',
  lan: 'Devices at home',
  both: 'Devices at home and the internet, through the router',
};

function accessCard(st: State): HTMLElement {
  const p = st.person;
  const pct = p.quota_limit ? Math.min(100, (p.quota_used / p.quota_limit) * 100) : 0;
  const bar = h('div', { class: `meter${pct >= 100 ? ' bad' : pct >= 90 ? ' warn' : ''}` }, h('i'));
  (bar.firstChild as HTMLElement).style.width = `${pct}%`;
  if (p.quota_limit) tip(bar, () => [`${pct.toFixed(1)}% used`, `${bytes(Math.max(0, p.quota_limit - p.quota_used))} left`]);
  const left = daysLeft(p.expires, today());
  const slots = h('div', { class: 'slots' });
  // Devices the admin added over the limit get their own orange slots after the allowed ones.
  for (let i = 0; i < Math.max(p.device_limit, p.devices.length); i++)
    slots.appendChild(h('i', { class: i >= p.device_limit ? 'over' : i < p.devices.length ? 'used' : '' }));
  const used = p.quota_used || p.month[0] + p.month[1];
  const icon = p.access === 'internet' ? 'globe' : p.access === 'lan' ? 'home' : 'shield';
  // Heading outside the card, like "Your devices", so both columns line up.
  return h(
    'section',
    { class: 'access', 'aria-label': 'Your access' },
    h(
      'div',
      { class: 'card-head' },
      h('div', { class: 'row-baseline' }, h('h2', {}, 'Your access'), h('span', { class: 'faint s' }, 'set by the admin')),
    ),
    h(
      'div',
      { class: 'card access-card' },
      h(
        'div',
        { class: 'reach' },
        h('span', { class: 'reach-ic' }, ic(icon)),
        h(
          'div',
          { class: 'stack' },
          h('span', { class: 'strong' }, ACCESS_LABEL[p.access]),
          h('span', { class: 'muted s' }, ACCESS_TEXT[p.access]),
        ),
      ),
      namesAtHome(p, !!st.server.device_mesh),
      h(
        'div',
        { class: 'tile' },
        h(
          'div',
          { class: 'tile-label' },
          h('span', {}, p.quota_period === 'total' && p.quota_gb ? 'Data used' : 'Data this month'),
          p.quota_period === 'month' ? h('span', {}, 'resets on the 1st') : null,
        ),
        h(
          'span',
          { class: 'tile-value' },
          bytes(used),
          h('span', { class: 'faint' }, p.quota_limit ? ` of ${bytes(p.quota_limit)}` : ' · no limit'),
        ),
        p.quota_limit ? bar : null,
      ),
      h(
        'div',
        { class: 'tiles2' },
        h(
          'div',
          { class: 'tile' },
          h('div', { class: 'tile-label' }, 'Devices'),
          h('span', { class: 'tile-value' }, String(p.devices.length), h('span', { class: 'faint' }, ` / ${p.device_limit}`)),
          slots,
        ),
        h(
          'div',
          { class: 'tile' },
          h('div', { class: 'tile-label' }, 'Access until'),
          h('span', { class: 'tile-value sm' }, p.expires ? date(p.expires) : 'No end date'),
          left != null
            ? h(
                'span',
                { class: `s ${left <= Math.max(p.expire_warn, 3) ? 'warn' : 'ok'}` },
                left >= 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'ended',
              )
            : null,
        ),
      ),
      h(
        'span',
        { class: 'faint s' },
        p.hours ? `Available ${p.hours.replace('-', '–')} (router time). Need a change? Ask the admin.` : 'Need a change? Ask the admin.',
      ),
    ),
  );
}

function deviceStatus(d: Device): HTMLElement {
  // Status as coloured text, no dots (only the avatar carries one).
  if (d.disabled) return h('span', { class: 'dstat' }, 'Disabled by the admin');
  if (d.online) return h('span', { class: 'dstat ok' }, 'Connected');
  if (!d.handshake) return h('span', { class: 'dstat warn' }, 'Not set up yet');
  return h('span', { class: 'dstat' }, `Last connected ${ago(d.handshake)}`);
}

/**
 * How other devices at home reach this person's devices: once, in the access card,
 * instead of an address on every device card. Only with access to the home network.
 */
/**
 * Whether the home network can open connections to this device: the router lets
 * it through only for people with home access who are active, and devices on.
 */
function reachableFromHome(p: Person, d: Device): boolean {
  return p.access !== 'internet' && p.state === 'active' && !d.disabled;
}

function namesAtHome(p: Person, mesh: boolean): HTMLElement | null {
  const named = byDeviceState(p.devices).filter((d) => d.hostname && reachableFromHome(p, d));
  if (!named.length) return null;
  const first = named[0].hostname;
  const domain = first.slice(first.indexOf('.'));
  return h(
    'div',
    { class: 'names' },
    h(
      'div',
      { class: 'names-head' },
      h('span', { class: 'names-ic' }, ic('home')),
      h(
        'div',
        { class: 'stack' },
        h('span', { class: 'strong s' }, 'Names at home'),
        h(
          'span',
          { class: 'faint s' },
          mesh ? 'Devices at home and on this VPN reach yours as ' : 'Other devices at home reach yours as ',
          h('span', { class: 'mono' }, `name${domain}`),
        ),
      ),
    ),
    h(
      'div',
      { class: 'names-list' },
      named.map((d) => {
        const dot = d.hostname.indexOf('.');
        return h(
          'button',
          {
            type: 'button',
            class: 'name-chip',
            title: d.name,
            'aria-label': `Copy ${d.hostname}`,
            onclick: () => copy(d.hostname, 'Address copied'),
          },
          h(
            'span',
            { class: 'mono' },
            dot > 0 ? [d.hostname.slice(0, dot), h('span', { class: 'faint' }, d.hostname.slice(dot))] : d.hostname,
          ),
          ic('copy'),
        );
      }),
    ),
  );
}

function deviceCard(d: Device, st: State): HTMLElement {
  const more = h('button', { type: 'button', class: 'icon-btn soft', 'aria-label': `${d.name} options` }, ic('more'));
  more.addEventListener('click', (ev) => {
    ev.stopPropagation();
    menu(more, [
      { label: 'Show QR code', icon: 'qr', run: () => connect(d, 'qr') },
      { label: 'Copy AmneziaVPN key', icon: 'key', run: () => copyKey(d) },
      { label: 'Download .conf', icon: 'download', run: () => downloadConf(d) },
      null,
      // How devices at home reach it: only where the router actually lets them through.
      ...(reachableFromHome(st.person, d)
        ? [
            { label: 'Copy IP address', icon: 'copy', run: () => copy(d.address, 'IP address copied') },
            ...(d.hostname ? [{ label: 'Copy local address', icon: 'home', run: () => copy(d.hostname, 'Address copied') }] : []),
            null,
          ]
        : []),
      // A device the admin turned off can't be renamed, rekeyed or removed here (the router refuses).
      ...(d.disabled
        ? []
        : [
            { label: 'Rename', icon: 'edit', run: () => rename(d) },
            { label: 'New keys', icon: 'reset', run: () => rotateKeys(d, st) },
            { label: 'Remove', icon: 'trash', danger: true, run: () => removeDevice(d) },
          ]),
    ]);
  });
  const week = d.spark.reduce((a, b) => a + b, 0);
  const setUp = !d.handshake && !d.disabled;
  // The device this page was opened from (through the tunnel): blue, and says so.
  const here = st.here === d.id;
  return h(
    'article',
    { class: `dcard${d.online ? ' online' : ''}${d.disabled ? ' off' : ''}${here ? ' here' : ''}` },
    h(
      'div',
      { class: 'dhead' },
      h('span', { class: 'dic' }, ic(d.kind)),
      h(
        'div',
        { class: 'stack grow' },
        h('span', { class: 'dname' }, d.name),
        // Opened through the tunnel, so it is connected: say which one it is instead.
        here ? h('span', { class: 'dstat here' }, 'This device') : deviceStatus(d),
      ),
      more,
    ),
    setUp
      ? [
          h(
            'button',
            { type: 'button', class: 'btn primary block', onclick: () => connect(d) },
            ic(isMobile() ? 'open' : 'qr'),
            h('span', {}, isMobile() ? 'Open in AmneziaVPN' : 'Connect this device'),
          ),
        ]
      : h(
          'div',
          { class: 'duse' },
          h('div', { class: 'stack' }, h('span', { class: 'faint s' }, 'Last 7 days'), h('span', { class: 'mono' }, bytes(week))),
          spark(d.spark),
        ),
    d.config_stale && !setUp
      ? h(
          'div',
          { class: 'notice' },
          ic('alert'),
          h('span', { class: 'grow' }, 'Connection settings changed. Update this device to keep everything working.'),
          h('button', { type: 'button', class: 'btn small', onclick: () => connect(d) }, 'Update'),
        )
      : null,
  );
}

function main(st: State) {
  const p = st.person;
  const left = daysLeft(p.expires, today());
  const notice =
    p.state !== 'active'
      ? h(
          'div',
          { class: 'notice bad' },
          ic('alert'),
          h(
            'span',
            {},
            p.state === 'quota'
              ? 'You have used all your data for this period. Your devices are paused until it resets.'
              : p.state === 'expired'
                ? 'Your access has ended. Ask the admin to extend it.'
                : p.state === 'hours'
                  ? `Access is available ${p.hours.replace('-', '–')} (router time).`
                  : 'Your access is paused by the admin.',
          ),
        )
      : left != null && left >= 0 && left <= Math.max(p.expire_warn, 1)
        ? h(
            'div',
            { class: 'notice' },
            ic('alert'),
            h('span', {}, `Your access ends ${left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`} (${date(p.expires)}).`),
          )
        : null;

  // The device this page was opened from comes first.
  const order = byDeviceState(p.devices).sort((a, b) => Number(b.id === st.here) - Number(a.id === st.here));
  const cards: HTMLElement[] = order.map((d) => deviceCard(d, st));
  const free = Math.max(0, p.device_limit - p.devices.length);
  if (free)
    cards.push(
      h(
        'button',
        { type: 'button', class: 'slot add', onclick: addDevice },
        h('span', { class: 'slot-ic' }, ic('plus')),
        // How many are left is in "Your devices 3 of 10" and the Devices tile.
        h('span', { class: 'strong' }, 'Add device'),
      ),
    );

  const devices = h(
    'section',
    { class: 'devices', 'aria-label': 'Your devices' },
    h(
      'div',
      { class: 'card-head' },
      h(
        'div',
        { class: 'row-baseline' },
        // How many (the Devices tile) and which are online (the cards) are shown already.
        h('h2', {}, 'Your devices'),
      ),
    ),
    h('div', { class: 'dgrid' }, cards),
    !st.can_add
      ? h('span', { class: 'faint s' }, `You have reached your limit of ${p.device_limit} devices. Remove one or ask the admin for more.`)
      : null,
    h(
      'span',
      { class: 'faint s' },
      'New device? Install ',
      h('a', { href: 'https://amnezia.org/downloads', target: '_blank', rel: 'noopener noreferrer' }, 'AmneziaVPN'),
      ' on it first.',
    ),
  );

  shell(
    h(
      'div',
      { class: 'hello' },
      h('span', { class: `avatar${p.online ? ' online' : ''}` }, initials(p.name)),
      h(
        'div',
        { class: 'stack' },
        // Only when something is wrong: an "Active" pill says nothing.
        h(
          'div',
          { class: 'row' },
          h('h1', {}, `Hi, ${p.name}`),
          p.state === 'active' ? null : h('span', { class: `pill ${stateTone(p)}` }, STATE_LABEL[p.state]),
        ),
      ),
    ),
    notice,
    h('div', { class: 'layout' }, accessCard(st), devices),
  );
}

/* ---------- device flows ---------- */

async function getConfig(d: Device): Promise<ClientConfig | null> {
  try {
    return await call<ClientConfig>(`devices/${d.id}/config`);
  } catch (e) {
    toast((e as Error).message, true);
    return null;
  }
}

async function copyKey(d: Device) {
  const cfg = await getConfig(d);
  if (cfg) copy(await vpnKey(cfg, `${cfg.server} · ${cfg.name}`), 'Key copied');
}

async function downloadConf(d: Device) {
  const cfg = await getConfig(d);
  if (cfg) download(cfg.filename, cfg.conf);
}

/** Connection sheet: open-in-app / QR / key / file, plus live status. */
/** One configuration line, highlighted; private and preshared keys masked unless shown. */
function confLine(line: string, reveal: boolean): Node {
  if (/^\s*\[.+\]\s*$/.test(line)) return h('span', { class: 'conf-sec' }, line);
  const m = /^(\s*[A-Za-z0-9]+\s*=)\s*(.*)$/.exec(line);
  if (!m) return document.createTextNode(line);
  const secret = /^(\s*)(PrivateKey|PresharedKey)\b/.test(line);
  return h(
    'span',
    {},
    h('span', { class: 'conf-k' }, m[1]),
    ' ',
    secret && !reveal ? h('span', { class: 'conf-mask' }, '••••••••••••••••') : m[2],
  );
}

/** The .conf as a file card (download) and a folded, highlighted view with copy and a hidden key. */
function filePane(cfg: ClientConfig): HTMLElement {
  let reveal = false;
  const pre = h('pre', { class: 'conf' });
  const paint = () =>
    pre.replaceChildren(...cfg.conf.split('\n').flatMap((l, i) => (i ? ['\n', confLine(l, reveal)] : [confLine(l, reveal)])));
  const eye = h(
    'button',
    {
      class: 'btn small',
      onclick: (ev: Event) => {
        ev.preventDefault();
        reveal = !reveal;
        eye.replaceChildren(ic(reveal ? 'x' : 'key'), h('span', {}, reveal ? 'Hide key' : 'Show key'));
        paint();
      },
    },
    ic('key'),
    h('span', {}, 'Show key'),
  );
  paint();
  return h(
    'div',
    { class: 'pane' },
    h(
      'div',
      { class: 'filecard' },
      h('span', { class: 'filecard-ic' }, '.conf'),
      h(
        'span',
        { class: 'stack' },
        h('span', { class: 'mono ellipsis' }, cfg.filename),
        h('span', { class: 'faint s' }, 'For computers and routers: import it in AmneziaWG or AmneziaVPN'),
      ),
      h('button', { class: 'btn primary', onclick: () => download(cfg.filename, cfg.conf) }, ic('download'), h('span', {}, 'Download')),
    ),
    h(
      'details',
      { class: 'confbox' },
      h(
        'summary',
        {},
        ic('chevron'),
        h('span', {}, 'Configuration'),
        h('span', { class: 'grow' }),
        eye,
        h(
          'button',
          {
            class: 'btn small',
            onclick: (ev: Event) => {
              ev.preventDefault();
              copy(cfg.conf, 'Configuration copied');
            },
          },
          ic('copy'),
          h('span', {}, 'Copy'),
        ),
      ),
      pre,
    ),
  );
}

async function connect(d: Device, initial?: 'app' | 'qr' | 'key' | 'file', cfgIn?: ClientConfig) {
  const cfg = cfgIn ?? (await getConfig(d));
  if (!cfg) return;
  const key = await vpnKey(cfg, `${cfg.server} · ${cfg.name}`);
  const mobile = isMobile();
  const panes: Record<string, () => HTMLElement> = {
    app: () =>
      h(
        'div',
        { class: 'pane' },
        h('a', { class: 'btn primary block big', href: key }, ic('open'), h('span', {}, 'Open in AmneziaVPN')),
        h(
          'ol',
          { class: 'steps' },
          h(
            'li',
            {},
            'No AmneziaVPN yet? ',
            h('a', { href: 'https://amnezia.org/downloads', target: '_blank', rel: 'noopener noreferrer' }, 'Get it here'),
            '.',
          ),
          h('li', {}, 'Tap ', h('b', {}, 'Open in AmneziaVPN'), ' and confirm the import.'),
          h('li', {}, 'Turn the connection on — this page shows ', h('span', { class: 'ok' }, 'Connected'), ' within a minute.'),
        ),
      ),
    qr: () => {
      const q = h('div', { class: 'qr' });
      q.innerHTML = qrSvg(cfg.conf);
      return h('div', { class: 'pane center' }, q, h('p', { class: 'muted s' }, 'Scan with the phone’s camera or AmneziaVPN / AmneziaWG.'));
    },
    key: () =>
      h(
        'div',
        { class: 'pane' },
        h('p', { class: 'muted s' }, 'In AmneziaVPN choose “Add server → Insert key”.'),
        h(
          'div',
          { class: 'keybox' },
          h('span', { class: 'mono' }, key),
          h('button', { class: 'btn small', onclick: () => copy(key, 'Key copied') }, 'Copy'),
        ),
        h('p', { class: 'faint s' }, 'Keep it private: anyone with the key can use your connection.'),
      ),
    file: () => filePane(cfg),
  };
  const order = mobile ? ['app', 'qr', 'key', 'file'] : ['qr', 'key', 'file'];
  const labels: Record<string, string> = { app: 'Open in app', qr: 'QR code', key: 'Key', file: 'File' };
  const body = h('div', { class: 'tab-body' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const show = (id: string) => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === id));
    body.replaceChildren(panes[id]());
  };
  for (const id of order) tabs.appendChild(h('button', { role: 'tab', 'data-id': id, onclick: () => show(id) }, labels[id]));
  show(initial && order.includes(initial) ? initial : order[0]);

  const live = h('div', { class: 'waiting' });
  const paintLive = (dev: Device | undefined) => {
    if (dev?.online) live.replaceChildren(h('span', { class: 'ok' }, `${d.name} is connected`));
    else if (dev?.handshake) live.replaceChildren(h('span', { class: 'muted' }, `Last connected ${ago(dev.handshake)}`));
    else live.replaceChildren(h('span', { class: 'warn' }, 'Waiting for the first connection…'));
  };
  paintLive(d);
  const watch = window.setInterval(async () => {
    try {
      const st = await call<State>('state');
      state = st;
      paintLive(st.person.devices.find((x) => x.id === d.id));
    } catch {
      /* ignore */
    }
  }, 5000);
  sheet(
    d.handshake ? `Connect ${d.name}` : `${d.name} is ready`,
    mobile ? 'Add it to AmneziaVPN on this phone' : 'Scan with the phone’s camera or AmneziaVPN',
    tabs,
    body,
    live,
  );
  sheetClosed = () => {
    clearInterval(watch);
    if (state) main(state);
  };
}

function rename(d: Device) {
  const name = h('input', { type: 'text', value: d.name, maxlength: 48, 'aria-label': 'Device name' }) as HTMLInputElement;
  const save = h('button', { class: 'btn primary block', type: 'submit' }, 'Save') as HTMLButtonElement;
  sheet(
    `Rename ${d.name}`,
    null,
    h(
      'form',
      {
        class: 'stack gap',
        onsubmit: (e: Event) => {
          e.preventDefault();
          void once(save, async () => {
            try {
              const r = await call<{ state: State }>(`devices/${d.id}`, { action: 'rename', name: name.value });
              state = r.state;
              closeSheet();
              main(state);
              toast('Renamed');
            } catch (er) {
              toast((er as Error).message, true);
            }
          });
        },
      },
      name,
      save,
    ),
  );
  setTimeout(() => name.select(), 50);
}

/** New keys for a device: the old configuration stops working, the new one is shown right away. */
function rotateKeys(d: Device, st: State) {
  const here = st.here === d.id;
  sheet(
    `New keys for ${d.name}?`,
    null,
    h(
      'p',
      { class: 'muted' },
      here
        ? 'This device is connected through the configuration it has now: it disconnects a few seconds after you confirm. Import the new configuration that opens next.'
        : 'Its current configuration stops working. Set the device up again with the new one that opens next.',
    ),
    h(
      'div',
      { class: 'row gap' },
      h('button', { class: 'btn block', onclick: () => closeSheet() }, 'Cancel'),
      h(
        'button',
        {
          class: 'btn primary block',
          onclick: (ev: Event) =>
            once(ev.currentTarget as HTMLButtonElement, async () => {
              try {
                const r = await call<{ config: ClientConfig; state: State }>(`devices/${d.id}`, { action: 'rotate' });
                state = r.state;
                main(state);
                await connect(d, undefined, r.config);
              } catch (er) {
                toast((er as Error).message, true);
              }
            }),
        },
        'New keys',
      ),
    ),
  );
}

function removeDevice(d: Device) {
  sheet(
    `Remove ${d.name}?`,
    null,
    h('p', { class: 'muted' }, 'Its connection stops working immediately. You can add it again later.'),
    h(
      'div',
      { class: 'row gap' },
      h('button', { class: 'btn block', onclick: () => closeSheet() }, 'Cancel'),
      h(
        'button',
        {
          class: 'btn danger-solid block',
          onclick: (ev: Event) =>
            once(ev.currentTarget as HTMLButtonElement, async () => {
              try {
                const r = await call<{ state: State }>(`devices/${d.id}`, { action: 'delete' });
                state = r.state;
                closeSheet();
                main(state);
                toast('Device removed');
              } catch (er) {
                toast((er as Error).message, true);
              }
            }),
        },
        'Remove',
      ),
    ),
  );
}

// Best guess at the device this page is open on (the browser never tells its real name).
const UA = navigator.userAgent;
const IPAD = /iPad/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);

function guessKind(): Kind {
  if (IPAD || /Tablet/i.test(UA) || (/Android/.test(UA) && !/Mobile/.test(UA))) return 'tablet';
  if (/Android|iPhone|Mobile/i.test(UA)) return 'phone';
  return 'computer';
}

/** Samsung model codes → names people know (S and A series; the code stays in brackets). */
const GALAXY: [RegExp, string][] = [
  [/^SM-S93/, 'Galaxy S25'],
  [/^SM-S92/, 'Galaxy S24'],
  [/^SM-S91/, 'Galaxy S23'],
  [/^SM-S90/, 'Galaxy S22'],
  [/^SM-G99/, 'Galaxy S21'],
  [/^SM-F9/, 'Galaxy Z Fold'],
  [/^SM-F7/, 'Galaxy Z Flip'],
  [/^SM-A5/, 'Galaxy A5x'],
  [/^SM-A3/, 'Galaxy A3x'],
  [/^SM-X/, 'Galaxy Tab'],
];

/** Android model from Client Hints (Chrome); filled in shortly after the page loads. */
let MODEL = '';
const modelReady: Promise<string> = (async () => {
  const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ model?: string }> } })
    .userAgentData;
  if (!uad || !/Android/.test(UA)) return '';
  try {
    const m = ((await uad.getHighEntropyValues(['model'])).model ?? '').trim();
    if (!m || m === 'K') return '';
    const g = GALAXY.find(([re]) => re.test(m));
    MODEL = g ? `${g[1]} (${m})` : /^SM-/.test(m) ? `Galaxy ${m}` : m;
  } catch {
    /* not offered */
  }
  return MODEL;
})();

function guessName(kind: Kind): string {
  if (/iPhone/.test(UA)) return 'iPhone';
  if (IPAD) return 'iPad';
  if (/Android/.test(UA)) return MODEL || (kind === 'tablet' ? 'Android tablet' : 'Android phone');
  if (/CrOS/.test(UA)) return 'Chromebook';
  if (/Mac OS X/.test(UA)) return 'Mac';
  if (/Windows/.test(UA)) return 'Windows PC';
  if (/Linux/.test(UA)) return 'Linux PC';
  return KIND_LABEL[kind];
}

function addDevice() {
  if (!state) return;
  let kind: Kind = guessKind();
  const taken = new Set(state.person.devices.map((d) => d.name.toLowerCase()));
  const suggest = (k: Kind) => {
    const n = k === guessKind() ? guessName(k) : KIND_LABEL[k];
    if (!taken.has(n.toLowerCase())) return n;
    for (let i = 2; i < 20; i++) if (!taken.has(`${n} ${i}`.toLowerCase())) return `${n} ${i}`;
    return n;
  };
  const name = h('input', {
    type: 'text',
    value: suggest(kind),
    maxlength: 48,
    'aria-label': 'Device name',
    required: true,
  }) as HTMLInputElement;
  let edited = false;
  name.addEventListener('input', () => (edited = true));
  // The Android model arrives a moment later: use it unless they started typing.
  modelReady.then(() => {
    if (!edited && kind === guessKind()) name.value = suggest(kind);
  });
  const kinds = h(
    'div',
    { class: 'kinds' },
    (state.kinds as Kind[]).map((k) =>
      h(
        'button',
        {
          type: 'button',
          class: `kind${k === kind ? ' on' : ''}`,
          'data-k': k,
          onclick: () => {
            kind = k;
            kinds.querySelectorAll('.kind').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.k === k));
            if (!edited) name.value = suggest(k);
          },
        },
        ic(k),
        h('span', {}, KIND_LABEL[k]),
      ),
    ),
  );
  const err = h('p', { class: 'err' });
  const submit = h('button', { class: 'btn primary block', type: 'submit' }, 'Create connection') as HTMLButtonElement;
  sheet(
    'Add a device',
    `${state.person.device_limit - state.person.devices.length} of ${state.person.device_limit} slots free`,
    h(
      'form',
      {
        class: 'add',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          submit.disabled = true;
          err.textContent = '';
          try {
            const r = await call<{ id: string; config: ClientConfig; state: State }>('devices', { name: name.value.trim(), kind });
            state = r.state;
            const dev = r.state.person.devices.find((d) => d.id === r.id)!;
            await connect(dev, undefined, r.config);
          } catch (er) {
            err.textContent = (er as Error).message;
            submit.disabled = false;
          }
        },
      },
      h('label', { class: 'lbl' }, 'What is it?'),
      kinds,
      h('label', { class: 'lbl' }, 'Name'),
      name,
      err,
      submit,
    ),
  );
}

/* ---------- boot ---------- */

async function refresh() {
  try {
    state = await call<State>('state');
    document.title = `${state.person.name} · ${state.title}`;
    if (!sheetEl && !menuEl) main(state);
  } catch (e) {
    const er = e as ApiError;
    if (er.status === 404 || er.status === 401) {
      state = null;
      linkGone();
    }
    // A network hiccup: keep showing the last state (the page loads fresh data on reload).
    else if (!state) shell(h('div', { class: 'card' }, h('p', {}, er.message)));
  }
}

// No periodic refresh: every portal request runs a CGI process on the router.
// The page reloads its data after the visitor's own changes and while it waits
// for a new device's first connection.
if (!base || !code) linkGone();
else void refresh();
