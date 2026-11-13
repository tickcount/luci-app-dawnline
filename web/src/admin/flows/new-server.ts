// A new server in the portal's sheet, in steps (the old setup wizard,
// restyled; every check and default kept): the server (its name, the address
// devices connect to, checked on the router where it points as it is typed,
// with where the suggestion came from; a router behind CGNAT or another router
// says so first, and so does a network restart AmneziaWG needs), AmneziaWG
// (the UDP port, the device addresses, the disguise as a track with the
// picked level's meters), and for the first server the portal (internet like
// a home device, the personal portal and its port). One more server leaves
// the portal alone and asks about the internet on its AmneziaWG step. Without
// AmneziaWG the sheet offers to install it first. The sheet opens on the
// press (the router's defaults come in after), every step keeps the sheet's
// one rhythm, and Create closes the sheet as every sheet closes, then the
// page goes to the new server (after the network restart, when one is
// needed).

import { api, type SetupDefaults } from '../api';
import { h } from '../../portal/dom';
import { closeSheet, glide, go, head, hint, onClosed, openSheet, showing, type View } from '../../portal/ui/sheet';
import { once } from '../../portal/ui/feedback';
import { fmt, locale } from '../../shared/i18n';
import { endpointProbe, hostHelp, nameHelp, portalPortHelp, portHelp, rangeHelp, rangeOf, subnetOf } from '../netcheck';
import { defaultMethod, type Method } from '../disguise';
import { glass } from '../ui/glass';
import { switchRow } from '../ui/edit-rows';
import { errorText, notify } from '../ui/toast';
import { say } from '../shell/toast';
import { settingsUrl } from '../shell/routes';
import { levelPick } from '../widgets/disguise-levels';
import { installSheet } from './install';
import { field } from './form';
import { putChildren } from '../../portal/ui/put';

interface Draft {
  id: string;
  name: string;
  endpoint: string;
  port: number;
  range: string;
  preset: Method;
  portal: boolean;
  portal_port: number;
  lan_like: boolean;
  /** The portal's port follows the server's until it is changed by hand. */
  portalSame: boolean;
}

/** A note in the sheet: the portal's notice, in its tone. */
const note = (tone: 'warn' | 'bad', title: string, text: string, act?: HTMLElement | null) =>
  h(
    'div',
    { class: `notice ${tone} ns-note` },
    glass('pulse', tone === 'bad' ? 'red' : 'orange'),
    h('span', { class: 't' }, h('b', {}, title), h('span', {}, text), act ?? null),
  );

function steps(n: number, at: number): HTMLElement {
  return h(
    'div',
    { class: 'ns-steps', role: 'img', 'aria-label': fmt(_('Step %s of %s'), at + 1, n) },
    ...Array.from({ length: n }, (_x, i) => h('i', { class: i < at ? 'done' : i === at ? 'on' : '' })),
  );
}

/** A step's lead under its progress: one or two lines of what the step is for. */
const lead = (text: string) => h('p', { class: 'ns-lead' }, text);

function vServer(d: SetupDefaults, s: Draft, extra: boolean, done: () => void): View {
  const FROM: Record<string, string> = {
    ddns: _('From your DDNS name.'),
    cert: _('From your Let’s Encrypt certificate.'),
    wan: _('Your WAN address now - it may change; a DDNS name is better.'),
    portal: _('The portal’s address.'),
  };
  const name = field(_('Name'), s.name, (v) => nameHelp(v, [], _('Shown to people in their portal and apps.')), { placeholder: _('Home') });
  // the address as typed, for the probe (the field asks for its line before it exists)
  let host = s.endpoint;
  const probe = endpointProbe(
    () => ({ host, port: s.port }),
    (x, _id, port) => api.endpointProbe(x, '', port),
    () => addr.refresh(),
    { idle: () => (host.trim() === d.endpoint && d.endpoint_from ? (FROM[d.endpoint_from] ?? '') : '') },
  );
  const addr = field(
    _('Public address'),
    s.endpoint,
    (v) => {
      host = v;
      return probe.help();
    },
    { placeholder: 'vpn.example.com', mono: true, plain: true },
  );
  addr.input.addEventListener('input', probe.schedule);
  probe.schedule();
  const aw = d.awg_state;
  const missing = aw?.missing ?? [];
  const awgNote = missing.length
    ? note(
        'bad',
        _('AmneziaWG isn’t installed'),
        fmt(
          _('The tunnel needs %s. Install the build made for this firmware, then create the server.'),
          new Intl.ListFormat(locale(), { type: 'conjunction' }).format(missing),
        ),
        h(
          'button',
          { type: 'button', class: 'btn tint sm', onclick: () => installSheet('awg', [], () => location.reload()) },
          h('span', {}, _('Install')),
        ),
      )
    : aw && !aw.loaded
      ? note(
          'warn',
          _('AmneziaWG’s kernel module doesn’t load on this firmware'),
          _('Try another build in System, under Updates, or update OpenWrt. The server can’t start until it loads.'),
          h('a', { class: 'btn soft sm', href: settingsUrl('updates') }, h('span', {}, _('Open Updates'))),
        )
      : null;
  const wanNote =
    d.wan_kind === 'cgnat'
      ? note(
          'warn',
          _('Your router has no public address (CGNAT)'),
          _(
            'The ISP shares one address: devices can only connect if the ISP gives you a public address or IPv6. Ask them, or use a DDNS name that points at an IPv6 address.',
          ),
        )
      : d.wan_kind === 'private'
        ? note(
            'warn',
            fmt(_('Your router is behind another router (WAN %s)'), d.wan_ip),
            _('Forward the UDP port on the upstream router to this one and use a DDNS name or that router’s public address here.'),
          )
        : null;
  const next = h('button', { type: 'button', class: 'btn accent block' }, h('span', {}, _('Next'))) as HTMLButtonElement;
  next.addEventListener('click', () => {
    if (!name.check() || !addr.check()) return;
    if (hostHelp(addr.value(), s.port).bad) return;
    s.name = name.value();
    s.endpoint = addr.value();
    go(() => vAwg(d, s, extra, done));
  });
  const title = extra ? _('Add a server') : _('Set up Dawnline');
  const el = h(
    'div',
    { class: 'view ns-v' },
    head(title),
    steps(extra ? 2 : 3, 0),
    lead(
      extra
        ? _('One more server: another port or disguise for networks the first does not get through, or its own home access rules.')
        : _('Where devices connect to. A name that always points at your router (DDNS) keeps links working when your IP changes.'),
    ),
    awgNote,
    wanNote,
    name.el,
    // one line under the address: the router's verdict on what is typed (it says «through Cloudflare» itself)
    addr.el,
    next,
  );
  return { el, label: title };
}

function likeHome(s: Draft): HTMLElement {
  return switchRow({
    title: _('Internet like a home device'),
    sub: _('Through this router’s proxies and filters. Slower: up to a third on two cores.'),
    on: s.lan_like,
    icon: 'home',
    flip: async (on) => ((s.lan_like = on), true),
  });
}

function vAwg(d: SetupDefaults, s: Draft, extra: boolean, done: () => void): View {
  const port = field(
    _('UDP port'),
    String(s.port),
    (v) =>
      portHelp(
        Number(v) || 0,
        d.udp_taken ?? [],
        Number(v) === 4500
          ? `${_('Opened on the WAN firewall automatically.')} ${_('4500 is IPsec’s port: most networks let it through.')}`
          : _('Opened on the WAN firewall automatically.'),
      ),
    { numeric: true, mono: true },
  );
  const range = field(_('Device addresses'), s.range, (v) => rangeHelp(v, d.networks ?? [], rangeOf(d.subnet)), {
    mono: true,
    plain: true,
  });
  range.el.querySelector('.fl-f')?.append(h('span', { class: 'mono fl-suffix' }, '.x'));
  const keep = () => {
    s.port = Number(port.value()) || 0;
    s.range = range.value();
    if (s.portalSame) s.portal_port = s.port;
  };
  const missing = (d.awg_state?.missing ?? []).length > 0;
  const nextBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn accent block',
      disabled: extra && missing,
      title: extra && missing ? _('Install AmneziaWG first') : null,
    },
    h('span', {}, extra ? _('Create server') : _('Next')),
  ) as HTMLButtonElement;
  nextBtn.addEventListener('click', () => {
    if (!port.check() || !range.check()) return;
    keep();
    if (extra) void once(nextBtn, () => create(d, s, extra, done));
    else go(() => vPortal(d, s, done));
  });
  const el = h(
    'div',
    { class: 'view ns-v' },
    head('AmneziaWG', { back: true }),
    steps(extra ? 2 : 3, 1),
    port.el,
    range.el,
    // the levels on a track with the picked one's meters under it: three tiles do not fit a sheet
    h(
      'div',
      { class: 'choice' },
      h('div', { class: 'choice-h' }, h('span', {}, _('Disguise'))),
      levelPick({ caps: d.awg, tools: d.awg_state?.tools !== false, picked: s.preset, pick: (m) => (s.preset = m) }),
    ),
    // one more server has no portal step: the internet choice comes last here
    extra ? likeHome(s) : null,
    d.awg_state?.tools && d.awg_state.handler === false
      ? hint(_('Creating the server restarts the network for a few seconds: AmneziaWG was installed after the network started.'))
      : null,
    nextBtn,
  );
  return { el, label: 'AmneziaWG' };
}

function vPortal(d: SetupDefaults, s: Draft, done: () => void): View {
  const ipLinks = () => /^\d{1,3}(\.\d{1,3}){3}$/.test(s.endpoint);
  const port = field(_('Listening port'), String(s.portal_port), (v) => portalPortHelp(Number(v) || 0, d.tcp_taken ?? [], ipLinks()), {
    numeric: true,
    mono: true,
  });
  port.el.hidden = !s.portal;
  port.input.addEventListener('input', () => (s.portalSame = Number(port.value()) === s.port));
  const portal = switchRow({
    title: _('Personal portal'),
    sub: _('Off: only you add devices, from LuCI. On: people manage their devices within the limits you set.'),
    on: s.portal,
    icon: 'portal',
    flip: async (on) => {
      s.portal = on;
      // the port's field comes and goes with the switch: the sheet glides to its new height
      glide(() => (port.el.hidden = !on));
      return true;
    },
  });
  const missing = (d.awg_state?.missing ?? []).length > 0;
  const btn = h(
    'button',
    { type: 'button', class: 'btn accent block', disabled: missing, title: missing ? _('Install AmneziaWG first') : null },
    h('span', {}, _('Create server')),
  ) as HTMLButtonElement;
  btn.addEventListener('click', () =>
    once(btn, async () => {
      if (s.portal && !port.check()) return;
      s.portal_port = Number(port.value()) || 0;
      await create(d, s, false, done);
    }),
  );
  const el = h('div', { class: 'view ns-v' }, head(_('Portal'), { back: true }), steps(3, 2), likeHome(s), portal, port.el, btn);
  return { el, label: _('Portal') };
}

async function create(d: SetupDefaults, s: Draft, extra: boolean, done: () => void) {
  try {
    // one more server leaves the portal's settings alone (undefined is not sent)
    const r = await api.serverCreate(
      s.id,
      s.name,
      d.ifname,
      s.port,
      subnetOf(s.range),
      s.endpoint,
      d.mtu,
      s.preset,
      d.lan_zone,
      d.wan_zone,
      s.lan_like,
      extra ? undefined : s.portal,
      extra ? undefined : s.portal_port,
    );
    done();
    const to = settingsUrl(undefined, r.id);
    // The sheet closes as every sheet does, and the page goes to the new server once it is gone (it used to stand
    // open with a busy button until the page was loaded again under it). A network restart drops the connection
    // to LuCI for a few seconds: the page waits them out first.
    onClosed(() => {
      say(r.network_restart ? _('Restarting the network so it knows AmneziaWG: back in a few seconds') : _('Server created'));
      setTimeout(() => (location.href = to), r.network_restart ? 10000 : 700);
    });
    closeSheet();
  } catch (e) {
    notify(errorText(e), 'error', 10000);
  }
}

/** The wizard's values as it opens. */
const draftOf = (d: SetupDefaults, extra: boolean): Draft => ({
  id: d.id,
  name: d.name,
  endpoint: d.endpoint,
  port: d.port,
  // the tunnel's first three numbers ("10.77.0"): it is that /24
  range: rangeOf(d.subnet),
  preset: defaultMethod(d.awg),
  // off by default: the portal opens a port on WAN, so it is a choice
  portal: false,
  portal_port: d.portal_port || 8443,
  // off by default: the loop through the LAN costs up to a third of the speed
  lan_like: false,
  portalSame: !extra && (d.portal_port || 8443) === d.port,
});

/**
 * The wizard; `extra`: one more beside those there are (no portal step). `from`: the router's defaults, or the way
 * to ask for them: the sheet opens at once on the press and its first step comes in when the router has answered
 * (it used to open only then, with nothing on screen meanwhile).
 */
export function newServer(from: SetupDefaults | (() => Promise<SetupDefaults>), extra: boolean, done: () => void = () => undefined) {
  let d: SetupDefaults | null = typeof from === 'function' ? null : from;
  let s: Draft | null = d ? draftOf(d, extra) : null;
  const title = extra ? _('Add a server') : _('Set up Dawnline');
  openSheet(() => {
    // back from a later step: the first one as it was left
    if (d && s) return vServer(d, s, extra, done);
    const el = h('div', { class: 'view ns-v' }, head(title), steps(extra ? 2 : 3, 0), lead(_('Asking the router what it has…')));
    void (from as () => Promise<SetupDefaults>)().then(
      (got) => {
        d = got;
        s = draftOf(got, extra);
        if (!showing(el)) return;
        const first = vServer(got, s, extra, done).el;
        glide(() => putChildren(el, Array.from(first.childNodes)));
      },
      (e) => showing(el) && glide(() => el.append(h('p', { class: 'hint bad-t' }, errorText(e)))),
    );
    return { el, label: title };
  });
}
