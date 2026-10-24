// The pieces the set-up sheet is made of: store badges, the step that adds the
// connection (a link, the share sheet, a key or a file, as the app and the
// device allow), the panel that sends the connection to another device, the
// .conf for a router, the Download / Copy keys beside × and the line saying
// where an app scans a code. The rules behind them are setup.ts.

import type { ClientConfig, Device } from '../../shared/types';
import { fill, fmt } from '../../shared/i18n';
import { h, ic, type Kid } from '../dom';
import { EASE_IN, EASE_OUT, POP, SMOOTH, play } from '../motion';
import {
  APP_NAME,
  importPath,
  importSteps,
  keyFileName,
  opensKeyLinks,
  platformLabel,
  routerStore,
  scanPath,
  vpnContinue,
  storeFor,
  type AppId,
  type Platform,
  type Store,
} from '../setup';
import { accordion } from '../ui/accordion';
import { copy, download, sendFile, shareFile } from '../ui/feedback';
import { glass } from '../ui/glass';
import { menuLine, morphText, setText } from '../ui/morph';
import { hint } from '../ui/sheet';

export const APP_ICON: Record<AppId, string> = { vpn: 'amnezia', awg: 'amneziawg', wg: 'wireguard' };

/** The app a device was set up with last time, so the sheet reopens on it. */
const memo = (d: Device) => `dl.app.${d.id}`;
export function recallApp(d: Device): AppId | null {
  try {
    const v = localStorage.getItem(memo(d));
    return v === 'vpn' || v === 'awg' || v === 'wg' ? v : null;
  } catch {
    return null;
  }
}
export function rememberApp(d: Device, app: AppId) {
  try {
    localStorage.setItem(memo(d), app);
  } catch {
    /* private mode */
  }
}

/** What the steps work with: the device, its configuration, the key, and the choices made. */
export interface SetupCtx {
  d: Device;
  cfg: ClientConfig;
  key: string;
  /** The platform this page is open on. */
  pf: Platform;
  /** "the phone": the device in a sentence. */
  there: string;
  app(): AppId;
  /** The page is open on the device being set up. */
  same(): boolean;
}

/**
 * A badge: the mark in a tile, two lines, a chevron (an action) or the open
 * mark (a store page, in a new tab). `primary`: the one thing to tap in step 2.
 */
function badge(
  st: { href?: string; top: string; main: string; mark: string; onclick?: (ev: Event) => void },
  primary = false,
): HTMLElement {
  const inner = [
    h('span', { class: 'b-ic' }, ic(st.mark)),
    h('span', { class: 'b-t' }, h('span', { class: 'b-top' }, st.top), h('span', { class: 'b-main' }, st.main)),
    ic(st.onclick || st.href?.startsWith('vpn:') ? 'chevron' : 'open'),
  ];
  const cls = `badge${primary ? ' primary' : ''}`;
  if (st.onclick) return h('button', { type: 'button', class: cls, onclick: st.onclick }, inner);
  // A vpn:// key opens the app in place: no new tab.
  const app = st.href?.startsWith('vpn:');
  return h('a', { class: cls, href: st.href, target: app ? null : '_blank', rel: 'noopener noreferrer' }, inner);
}

/** Where the app comes from: the store (and, on Android, the APK beside it), or a line to go and get it. */
export function storeBlock(app: AppId, os: Platform, router: boolean): Kid[] {
  const st: Store | null = router ? routerStore(app) : storeFor(app, os);
  if (!st) return [hint(fmt(_('Get %s on the %s and come back here.'), APP_NAME[app], platformLabel(os)))];
  // Android: the store can fail (no Google Play, or it hides the app), so the APK sits beside it.
  if (st.alt) return [h('div', { class: 'badges2' }, badge(st), badge(st.alt)), hint(st.alt.why)];
  return [badge(st)];
}

const howto = (steps: [string, string][]) =>
  h(
    'ol',
    { class: 'howto' },
    steps.map(([text, bold]) => h('li', {}, text.replace(/ → $/, ' ›'), bold ? [' ', h('b', {}, bold)] : null)),
  );

const linkBtn = (label: string, run: (ev: Event) => void) => h('button', { type: 'button', onclick: run }, label);

/** Step 2: a link for AmneziaVPN, the file for the others, in the words of where they go. */
export function connectKids(c: SetupCtx): Kid[] {
  const app = c.app();
  const name = APP_NAME[app];
  const hereHandheld = c.pf === 'ios' || c.pf === 'android';
  // On the phone being set up, a link opens AmneziaVPN only on Android; an
  // iPhone takes the key as a .vpn file from the share sheet.
  const inHand = c.same() && hereHandheld;
  const copyKey = (ev: Event) => copy(c.key, _('Key copied'), ev.currentTarget);
  const send = app === 'vpn' && inHand && !opensKeyLinks(c.pf) ? shareFile(keyFileName(c.cfg.filename), c.key) : null;
  if (app === 'vpn' && inHand && (opensKeyLinks(c.pf) || send))
    return [
      send
        ? badge({ top: _('Then come back here and tap'), main: _('Send to AmneziaVPN'), mark: 'amnezia', onclick: () => void send() }, true)
        : badge({ href: c.key, top: _('Then come back here and tap'), main: _('Open in AmneziaVPN'), mark: 'amnezia' }, true),
      hint(
        ...fill(
          send
            ? _('Pick AmneziaVPN in the share sheet. Not there? %s and add it in the app.')
            : _('Nothing opened? %s and add it in the app.'),
          linkBtn(_('Copy the key', 'in a sentence'), copyKey),
        ),
      ),
    ];
  if (app === 'vpn') {
    const path = importPath('vpn');
    return [
      badge({ top: _('The connection as one key'), main: _('Copy the key'), mark: 'copy', onclick: copyKey }, true),
      howto([
        [fmt(_('Open %s', 'step'), name), ''],
        [path.replace(/ → [^→]*$/, ' → '), path.replace(/^.* → /, '')],
        [vpnContinue(), ''],
      ]),
    ];
  }
  const share = hereHandheld ? shareFile(c.cfg.filename, c.cfg.conf) : null;
  return [
    share
      ? badge(
          {
            top: c.same() ? fmt(_('Straight into %s'), name) : fmt(_('Send it to the %s'), c.there),
            main: _('Share the file'),
            mark: 'share',
            onclick: () => void share(),
          },
          true,
        )
      : badge(
          {
            top: _('Then import it in the app'),
            main: _('Download the file'),
            mark: 'download',
            onclick: () => download(c.cfg.filename, c.cfg.conf),
          },
          true,
        ),
    // In the words of the app where the file goes: the phone in hand, or the computer's system.
    howto(importSteps(app, c.pf, c.cfg.filename, !!share && c.same())),
  ];
}

/** A computer set up from elsewhere: the connection to send there, as the key or the file. */
export function sendKids(c: SetupCtx): Kid[] {
  const app = c.app();
  const btn = (icon: string, label: string, run: (ev: Event) => void) =>
    h('button', { type: 'button', class: 'btn soft sm', onclick: run }, ic(icon), h('span', { class: 'lbl' }, label));
  if (app === 'vpn') {
    const file = keyFileName(c.cfg.filename);
    const share = !!shareFile(file, c.key);
    return [
      h(
        'p',
        { class: 'desc' },
        fmt(_('Send it to the %s in a message or a note, then in AmneziaVPN: %s.'), c.there, importPath('vpn').replace(/ → /g, ' › ')),
      ),
      h(
        'div',
        { class: 'btnrow2' },
        btn('copy', _('Copy the key'), (ev) => copy(c.key, _('Key copied'), ev.currentTarget)),
        btn(share ? 'share' : 'download', share ? _('Share as a file') : _('Download the key'), () => sendFile(file, c.key)),
      ),
    ];
  }
  const share = !!shareFile(c.cfg.filename, c.cfg.conf);
  return [
    h(
      'p',
      { class: 'desc' },
      ...fill<Node | string>(_('Send it to the %s, then import %s in %s.'), c.there, h('b', {}, c.cfg.filename), APP_NAME[app]),
    ),
    h(
      'div',
      { class: 'btnrow2' },
      btn(share ? 'share' : 'download', share ? _('Share the file') : _('Download the file'), () => sendFile(c.cfg.filename, c.cfg.conf)),
      btn('copy', _('Copy the configuration'), (ev) => copy(c.cfg.conf, _('Configuration copied'), ev.currentTarget)),
    ),
  ];
}

/** At rest out of sight: it keeps its place, with nothing to see, select or read out. */
function rest(el: HTMLElement | SVGElement) {
  el.style.opacity = '0';
  el.style.visibility = 'hidden';
}

/**
 * Both looks in one place (a key and its mask, two icons): the one showing and
 * the other at rest under it, so a press cross-fades them and nothing is
 * rebuilt. The cell is as wide as the wider of the two.
 */
function stack(shown: HTMLElement | SVGElement, other: HTMLElement | SVGElement): HTMLElement {
  const cell = h('span', {}, shown, other);
  cell.style.display = 'inline-grid';
  for (const x of [shown, other]) x.style.gridArea = '1 / 1';
  rest(other);
  return cell;
}

/**
 * Shown or not: it comes into focus out of a blur, or blurs away and rests out
 * of sight, from where it stands now (pressed again half-way, it turns back).
 */
function turn(el: HTMLElement | SVGElement, on: boolean, off: Keyframe) {
  const s = getComputedStyle(el);
  const from = { opacity: s.opacity, filter: s.filter === 'none' ? 'blur(0px)' : s.filter, transform: s.transform };
  const old = el.getAnimations();
  el.style.opacity = on ? '' : '0';
  el.style.visibility = '';
  const a = on
    ? play(el, [from, { opacity: 1, filter: 'blur(0px)', transform: 'none' }], { duration: 320, easing: EASE_OUT })
    : play(el, [from, off], { duration: 200, easing: EASE_IN });
  if (!on) a.onfinish = () => (el.style.visibility = 'hidden');
  old.forEach((x) => x.cancel());
}

/** A key masked, or a mask lifted: they blur through each other. */
const SECRET_OFF: Keyframe = { opacity: 0, filter: 'blur(4px)', transform: 'none' };
/** The button's icon (a key, or × to hide it again) turns the way a copy's check comes in (ui/feedback.ts). */
const ICON_OFF: Keyframe = { opacity: 0, filter: 'blur(3px)', transform: 'scale(.6)' };

/** One configuration line, highlighted; private and preshared keys masked until shown. */
function confLine(line: string): Node {
  if (/^\s*\[.+\]\s*$/.test(line)) return h('span', { class: 'sec' }, line);
  const m = /^(\s*[A-Za-z0-9]+\s*=)\s*(.*)$/.exec(line);
  if (!m) return document.createTextNode(line);
  const secret = /^(\s*)(PrivateKey|PresharedKey)\b/.test(line);
  const value = secret ? stack(h('span', { class: 'mask' }, '••••••••••••••••'), h('span', { class: 'secret' }, m[2])) : m[2];
  return h('span', {}, h('span', { class: 'k' }, m[1]), ' ', value);
}

/** The .conf for a router: a file card to download (or share), and the configuration folded, its keys hidden. */
export function filePane(cfg: ClientConfig): HTMLElement {
  let reveal = false;
  const pre = h(
    'pre',
    { class: 'conf' },
    cfg.conf.split('\n').flatMap((l, i) => (i ? ['\n', confLine(l)] : [confLine(l)])),
  );
  const share = !!shareFile(cfg.filename, cfg.conf);
  const key = ic('key') as SVGElement;
  const hide = ic('x') as SVGElement;
  const label = h('span', {}, _('Show key'));
  const eye = h(
    'button',
    {
      type: 'button',
      class: 'btn soft sm',
      onclick: () => {
        reveal = !reveal;
        morphText(label, reveal ? _('Hide key') : _('Show key'));
        // A key shown comes into focus out of a blur as its mask blurs away; hidden again, the other way round.
        pre.querySelectorAll<HTMLElement>('.secret').forEach((x) => turn(x, reveal, SECRET_OFF));
        pre.querySelectorAll<HTMLElement>('.mask').forEach((x) => turn(x, !reveal, SECRET_OFF));
        turn(key, !reveal, ICON_OFF);
        turn(hide, reveal, ICON_OFF);
      },
    },
    stack(key, hide),
    label,
  );
  const cp = h(
    'button',
    { type: 'button', class: 'btn soft sm', onclick: (ev: Event) => copy(cfg.conf, _('Configuration copied'), ev.currentTarget) },
    ic('copy'),
    h('span', { class: 'lbl' }, _('Copy')),
  );
  const card = h(
    'div',
    { class: 'filecard' },
    h(
      'div',
      { class: 'fc-row' },
      h('span', { class: 'filecard-ic' }, '.conf'),
      h('span', { class: 't' }, h('span', { class: 'mono' }, cfg.filename), h('span', {}, _('For computers and routers'))),
    ),
    h(
      'button',
      { type: 'button', class: 'btn accent sm block', onclick: () => sendFile(cfg.filename, cfg.conf) },
      ic(share ? 'open' : 'download'),
      h('span', {}, share ? _('Share file') : _('Download')),
    ),
  );
  const conf = accordion([{ icon: glass('file'), title: _('Configuration'), body: [h('div', { class: 'confbar' }, eye, cp), pre] }], {
    inset: true,
  });
  return h('div', { class: 'step-box' }, card, conf.el);
}

export interface ScanLine {
  el: HTMLElement;
  /** Another app picked: its name and its path morph in place. */
  set(app: AppId): void;
}

/** "In AmneziaWG: + › Create from QR code", with both phone systems' wording where they differ. */
export function scanLine(app: AppId): ScanLine {
  const name = h('span', { class: 'osm-p' }, APP_NAME[app]);
  const path = menuLine(scanPath(app, 'ios'), scanPath(app, 'android'));
  return {
    el: h('span', { class: 'scanline' }, h('span', {}, ...fill(_('In %s:'), name)), path.el),
    set(a) {
      morphText(name, APP_NAME[a], undefined, { whole: true });
      path.set(scanPath(a, 'ios'), scanPath(a, 'android'));
    },
  };
}

export interface ConnPill {
  el: HTMLElement;
  /** The labels follow the app picked. */
  sync(): void;
}

/**
 * On its row, beside the chevron: the connection itself, to download or copy, where the sheet offers
 * neither (a phone or a tablet set up from elsewhere). One tooltip for both
 * keys, under them: the first waits a beat; once one is up the next comes at
 * once and the tooltip glides across (by Tab too, and back to a key while it
 * still fades out), each move from where it stands. Copied: a check, and the
 * tooltip says so.
 */
export function connPill(get: () => { text: string; msg: string; file: string; app: string }): ConnPill {
  const tt = h('span', { class: 'tt' });
  const tm = h('span', { class: 'tt-m' });
  const tip = h('span', { class: 'hp-tip', 'aria-hidden': 'true' }, tt, tm);
  const dl = h('button', { type: 'button', class: 'hp-b', onclick: () => sendFile(get().file, get().text) }, ic('download'));
  const cp = h('button', { type: 'button', class: 'hp-b' }, ic('copy'));
  const el = h('div', { class: 'hpill', role: 'group', 'aria-label': _('The connection'), 'data-key': 'conn' }, dl, cp, tip);

  let tipFor: HTMLElement | null = null;
  let tipT = 0;
  let warmUntil = 0;
  const words = (b: HTMLElement) => (b === cp && cp.classList.contains('done') ? _('Copied') : (b.getAttribute('aria-label') ?? ''));
  // Centred under its key, but never past its row's edge (the chevron and the row's inset to the right).
  const centre = (b: HTMLElement, t: string) => {
    tm.textContent = t;
    const w = tm.offsetWidth + 20;
    return Math.min(b.offsetLeft + b.offsetWidth / 2, el.offsetWidth + 30 - w / 2);
  };
  const at = (x: number) => `translateX(${x}px) translateX(-50%)`;
  /** Where the tooltip stands now: mid-fade and mid-glide included. */
  const now = (): Keyframe => {
    const s = getComputedStyle(tip);
    return { opacity: s.opacity, filter: s.filter === 'none' ? 'blur(0px)' : s.filter, transform: s.transform };
  };
  /** Its next motion takes over from where the last one stands; the last one stops once it is in place. */
  const move = (frames: Keyframe[], o: KeyframeAnimationOptions) => {
    const old = tip.getAnimations();
    play(tip, frames, o);
    old.forEach((a) => a.cancel());
  };
  // To another key, or back while it fades out: it glides there and comes up whole on the way.
  const glideTo = (x: number) => {
    const from = now();
    tip.style.transform = at(x);
    move([from, { opacity: 1, filter: 'blur(0px)', transform: at(x) }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
  };
  // Another key's words, or "Copied": what the two share slides, the rest morphs; the pill glides with it.
  const reword = (t: string) => morphText(tt, t);
  const show = (b: HTMLElement) => {
    clearTimeout(tipT);
    if (tipFor === b && tip.classList.contains('on')) return;
    tipFor = b;
    if (tip.classList.contains('on') || +getComputedStyle(tip).opacity > 0) {
      const t = words(b);
      tip.classList.add('on');
      glideTo(centre(b, t));
      return reword(t);
    }
    // Out of sight: it comes up under the key out of a blur.
    const up = () => {
      const t = words(b);
      setText(tt, t);
      const x = centre(b, t);
      tip.style.transform = at(x);
      tip.classList.add('on');
      move(
        [
          { opacity: 0, transform: `${at(x)} translateY(-3px) scale(.96)`, filter: 'blur(3px)' },
          { opacity: 1, transform: at(x), filter: 'blur(0px)' },
        ],
        {
          duration: 220,
          easing: EASE_OUT,
        },
      );
    };
    if (performance.now() < warmUntil) up();
    else tipT = window.setTimeout(up, 420);
  };
  const hide = () => {
    clearTimeout(tipT);
    tipFor = null;
    if (!tip.classList.contains('on')) return;
    warmUntil = performance.now() + 500;
    // It fades where it stands, mid-glide or still coming up.
    const from = now();
    tip.classList.remove('on');
    move([from, { ...from, opacity: 0 }], { duration: 120, easing: 'ease-out' });
  };
  for (const b of [dl, cp]) {
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') show(b);
    });
    b.addEventListener('focus', () => {
      if (b.matches(':focus-visible')) show(b);
    });
    // Tab from one key to the other: the focus that follows glides the tooltip across instead.
    b.addEventListener('blur', (e) => {
      if (!el.contains(e.relatedTarget as Node | null)) hide();
    });
  }
  el.addEventListener('pointerleave', hide);

  const icon = (name: string) => {
    const n = ic(name);
    cp.querySelector('svg')!.replaceWith(n);
    play(
      n,
      [
        { opacity: 0, transform: 'scale(.6)', filter: 'blur(3px)' },
        { opacity: 1, transform: 'none', filter: 'none' },
      ],
      { duration: POP.duration, easing: POP.easing },
    );
  };
  // Copied: the key shows a check and the tooltip says so, then both go back.
  const sayCopy = () => {
    if (tipFor !== cp || !tip.classList.contains('on')) return;
    const t = words(cp);
    glideTo(centre(cp, t));
    reword(t);
  };
  let back = 0;
  cp.addEventListener('click', () => {
    const c = get();
    void copy(c.text, c.msg);
    clearTimeout(back);
    if (!cp.classList.contains('done')) {
      cp.classList.add('done');
      icon('check');
      sayCopy();
    }
    back = window.setTimeout(() => {
      cp.classList.remove('done');
      icon('copy');
      sayCopy();
    }, 1600);
  });
  return {
    el,
    sync() {
      const app = get().app;
      dl.setAttribute('aria-label', fmt(_('Download %s config'), app));
      cp.setAttribute('aria-label', fmt(_('Copy %s config'), app));
    },
  };
}
