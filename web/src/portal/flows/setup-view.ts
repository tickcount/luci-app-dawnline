// Setting a device up: one sheet. Its layout follows where the page is open:
// on the device itself, two steps (get the app, add the connection) with a way
// round folded under the wait; a router, its packages and the file; a phone or
// a tablet set up from elsewhere, its link as a code or the connection as a
// code for an app it has (the link again where the key is too long for one); a
// computer, or another device added from a phone, its link or the connection
// to send there. Which app and where it comes from follow the
// server's disguise and the platform (setup.ts). The wait for the first
// connection sits on top the whole time (wait.ts); on the device itself and for
// a router the steps regroup under it as it goes (can't finish, no data).

import type { ClientConfig, Device } from '../../shared/types';
import { fmt } from '../../shared/i18n';
import { vpnKey, vpnQrText } from '../../shared/vpnkey';
import { ApiError, call } from '../api';
import { h, put } from '../dom';
import { SMOOTH, play } from '../motion';
import { APP_NAME, appsFor, deviceNoun, inWebview, keyFileName, sameDevice, setupLink, type AppId } from '../setup';
import { pageUrl, platform, preset, repaint } from '../state';
import { accordion, regrow, type Accordion } from '../ui/accordion';
import { codeRow, linkRow, type CodeRow } from '../ui/codes';
import { once, toast } from '../ui/feedback';
import { glass } from '../ui/glass';
import { morphInto, morphText } from '../ui/morph';
import { iconSeg, type IconSeg } from '../ui/seg';
import { glide, go, head, onClosed, onLeave, openSheet, sub, type View } from '../ui/sheet';
import { notice } from '../page/notices';
import { secureFirst, showSecure } from './secure';
import {
  APP_ICON,
  connPill,
  connectKids,
  filePane,
  recallApp,
  rememberApp,
  scanLine,
  type ScanLine,
  sendKids,
  storeBlock,
  type SetupCtx,
} from './setup-parts';
import type { WayState } from '../way';
import { follow, waitWay, watchFirstConnection } from './wait';

async function getConfig(d: Device): Promise<ClientConfig | null> {
  try {
    return await call<ClientConfig>(`devices/${d.id}/config`);
  } catch (e) {
    if (e instanceof ApiError && e.httpsUrl) showSecure(e.httpsUrl);
    else toast((e as Error).message, true);
    return null;
  }
}

/**
 * Set up a device from its card: the configuration first (the button waits for it), then the sheet. `here`: the
 * page came from the device's own set-up link, so it is open on that device (setup.ts sameDevice).
 */
export async function openSetup(d: Device, from?: EventTarget | null, here = false) {
  if (secureFirst()) return;
  const run = async () => {
    const cfg = await getConfig(d);
    if (!cfg) return;
    const key = await vpnKey(cfg, cfg.server);
    openSheet(() => setupView(d, cfg, key, here));
  };
  if (from instanceof HTMLButtonElement) await once(from, run);
  else await run();
}

/** Further in a flow (Add, Reconnect): the configuration the router just sent, in the open sheet. */
export async function continueSetup(d: Device, cfg: ClientConfig) {
  const key = await vpnKey(cfg, cfg.server);
  go(() => setupView(d, cfg, key));
}

/** A numbered step: its number, a title, what to do. */
function step(n: string, title: Node | string, kids: (Node | null)[]): HTMLElement {
  return h(
    'div',
    { class: 'step' },
    h('span', { class: 'step-n' }, n),
    h('div', { class: 'step-b' }, typeof title === 'string' ? h('span', { class: 'step-t' }, title) : title, kids),
  );
}

/** A block folded away: no height, blurred out. */
const FOLDED: Keyframe = { height: '0px', opacity: 0, filter: 'blur(4px)' };

/**
 * Fold a block away (height, then gone) or bring it back, from where it stands
 * now: a fold turned round half-way (a double click) never jumps. What holds it
 * (a row still opening) glides on to its new height with it.
 * `instant` without motion.
 */
function foldBlock(el: HTMLElement, fold: boolean, instant: boolean) {
  const cs = getComputedStyle(el);
  const cur: Keyframe = el.hidden
    ? FOLDED
    : { height: `${el.getBoundingClientRect().height}px`, opacity: cs.opacity, filter: cs.filter === 'none' ? 'blur(0px)' : cs.filter };
  el.getAnimations().forEach((a) => a.cancel());
  el.hidden = fold;
  regrow(el.parentElement);
  if (instant) {
    el.style.overflow = '';
    return;
  }
  el.style.overflow = 'hidden';
  el.hidden = false;
  const to = fold ? FOLDED : { height: `${el.getBoundingClientRect().height}px`, opacity: 1, filter: 'blur(0px)' };
  play(el, [cur, to], { duration: SMOOTH.duration, easing: SMOOTH.easing }).onfinish = () => {
    el.style.overflow = '';
    el.hidden = fold;
  };
}

/** The first control in `el` that can take focus now (shown, not disabled). */
const firstControl = (el: Element | null | undefined) =>
  [...(el?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])') ?? [])].find(
    (x) => x.getClientRects().length > 0,
  );

/**
 * The steps on the device itself or for a router, as the way goes (way.ts); the
 * layouts set up from elsewhere have rows, no steps. Waiting: the steps as
 * built (connected is never asked: what shows folds shut as it is, wait.ts
 * follow). Can't finish: the network is the likely cause, so they fold
 * into one closed row, "Set it up again". No data: only what fixes it, open in
 * one row, "Add the connection again" ("Import the configuration again" for a
 * router): the connection step without its number and title. A router that
 * knocks has AmneziaWG on it already, so its row holds that step alone in both.
 * What sits on field inside the row steps up one (accordion.css). "Not on the X
 * right now?" (`round`, on the device itself) goes in both: the device is in
 * hand. Focus inside what moves (a badge just used) stays in the sheet: on that
 * control where it still shows, else on the first one of what holds the steps
 * now. Returns whether anything changed.
 */
function regroup(body: HTMLElement, steps: HTMLElement, round: Accordion | null, router: boolean): (st: WayState) => boolean {
  const [s1, s2] = [...steps.children].slice(-2) as HTMLElement[];
  const gap = steps.querySelector<HTMLElement>(':scope > .steps-gap');
  const head2 = [...s2.querySelectorAll<HTMLElement>(':scope > .step-n, :scope > .step-b > .step-t')];
  let look: 'steps' | 'again' | 'conn' = 'steps';
  let row: HTMLElement | null = null;
  return (st) => {
    const next = st === 'trying' ? 'again' : st === 'nodata' ? 'conn' : 'steps';
    if (next === look) return false;
    look = next;
    // Moving a focused control out of the page and back drops its focus (to the page under the sheet).
    const had = document.activeElement;
    const inside = had instanceof HTMLElement && (steps.contains(had) || !!round?.el.contains(had) || !!row?.contains(had));
    row?.remove();
    row = null;
    // The steps show whole wherever they go: opened, the way round folds them away.
    round?.setOpen(-1);
    if (round) round.el.hidden = next !== 'steps';
    const alone = next === 'conn' || (next === 'again' && router);
    for (const e of [gap, s1, ...head2]) if (e) e.hidden = alone;
    if (next === 'steps') body.append(steps);
    else {
      const title = next === 'again' ? _('Set it up again') : router ? _('Import the configuration again') : _('Add the connection again');
      row = accordion([{ icon: glass('refresh', 'blue'), title, body: [steps] }], { inset: true, open: next === 'conn' ? 0 : -1 }).el;
      body.append(row);
    }
    if (inside) {
      const to =
        had.isConnected && had.getClientRects().length
          ? had
          : next === 'again'
            ? row?.querySelector<HTMLElement>('.acc-head')
            : firstControl(alone ? s2 : steps);
      to?.focus({ preventScroll: true });
    }
    return true;
  };
}

type Layout = 'same' | 'router' | 'away' | 'pc-away';

export function setupView(d: Device, cfg: ClientConfig, key: string, here = false): View {
  const pf = platform();
  const apps = appsFor(preset());
  const handheld = d.kind === 'phone' || d.kind === 'tablet';
  const router = d.kind === 'router';
  const same = sameDevice(d.kind, pf, here);
  const layout: Layout = same ? 'same' : router ? 'router' : handheld ? 'away' : 'pc-away';
  const there = deviceNoun(d.kind);
  const thereOn = deviceNoun(d.kind, true);
  // A router takes AmneziaWG (or WireGuard), never AmneziaVPN.
  const choices = apps.filter((a) => !router || a.id !== 'vpn');
  let app: AppId = recallApp(d) ?? (router ? 'awg' : 'vpn');
  if (!choices.some((a) => a.id === app)) app = choices[0].id;
  const c: SetupCtx = { d, cfg, key, pf, there, app: () => app, same: () => same };

  // The pickers and the boxes a pick changes live across repaints: a pick only
  // refills what it changes, so the pills glide and nothing else in the sheet moves.
  const segs: IconSeg<AppId>[] = [];
  const picker = () => {
    if (choices.length < 2) return null;
    const s = iconSeg(
      choices.map((a) => ({ value: a.id, label: a.name, icon: APP_ICON[a.id] })),
      app,
      (v) => {
        app = v;
        rememberApp(d, v);
        segs.forEach((x) => x.sync(v));
        // The sheet glides to its new height; inside, what changed morphs (morphInto). A row still opening
        // around what changed glides on to its new height, and the sheet with it.
        glide(fill);
        regrow(title1, getBox, addBox, codeBox, sendBox);
      },
    );
    segs.push(s);
    return s.el;
  };
  const title1 = h('span', { class: 'step-t' });
  const getBox = h('div', { class: 'step-box' });
  const addBox = h('div', { class: 'step-box' });
  const codeBox = h('div', { class: 'step-box' });
  const sendBox = h('div', { class: 'step-box' });
  // Not on the device: the link goes there (as a code for a phone's camera); the page there does the rest.
  const linkThere = setupLink(pageUrl(), d.id);
  // A connection too long for a camera (a key this browser cannot compress, a configuration with a long list of
  // networks): the code is the link instead; the page there hands it over. The words follow the app picked.
  const tooLong = {
    text: linkThere,
    words: () => [
      h(
        'span',
        {},
        app === 'vpn'
          ? fmt(_('The key is too long for a code. Scan this one to open your link on the %s instead.'), thereOn)
          : fmt(_('The configuration is too long for a code. Scan this one to open your link on the %s instead.'), thereOn),
      ),
    ],
  };
  let code: CodeRow | null = null;
  let scan: ScanLine | null = null;
  let codeApp: AppId | null = null;
  const pill =
    layout === 'away'
      ? connPill(() => ({
          ...(app === 'vpn'
            ? { text: key, msg: _('Key copied'), file: keyFileName(cfg.filename) }
            : { text: cfg.conf, msg: _('Configuration copied'), file: cfg.filename }),
          app: APP_NAME[app],
        }))
      : null;

  /** Everything a pick changes, refilled in place. */
  function fill() {
    morphText(title1, router ? fmt(_('Get %s on the router'), APP_NAME[app]) : fmt(_('Get %s'), APP_NAME[app]), undefined, { whole: true });
    morphInto(getBox, storeBlock(app, pf, router));
    // The router's file is the same for either app: it stays as it is (a folded configuration stays folded).
    if (!router) morphInto(addBox, connectKids(c));
    else if (!addBox.firstChild) put(addBox, filePane(cfg));
    // The connection as a code: only a phone or a tablet set up from here shows one.
    if (layout === 'away') {
      const text = app === 'vpn' ? vpnQrText(key) : cfg.conf;
      // Another app: its words morph in place, the code changes only when it holds something else (codes.ts).
      if (code && scan && code.el.isConnected) {
        if (codeApp !== app) {
          code.swap(text);
          scan.set(app);
        }
      } else {
        scan = scanLine(app);
        code = codeRow(text, [scan.el], tooLong);
        codeBox.replaceChildren(code.el);
      }
      codeApp = app;
    }
    morphInto(sendBox, sendKids(c));
    pill?.sync();
  }
  fill();

  const linkBody = () => [
    handheld
      ? codeRow(linkThere, [h('span', {}, _('Point its camera at the code: the link opens there.'))]).el
      : h('p', { class: 'desc' }, fmt(_('Open this link on the %s to set it up there.'), thereOn)),
    linkRow(linkThere),
  ];
  const step1 = () => step('1', title1, [picker(), getBox]);
  const step2 = () => step('2', router ? _('Import the configuration') : _('Add the connection'), [addBox]);

  const body = h('div', { class: 'setup' });
  if (inWebview(navigator.userAgent))
    body.appendChild(
      notice('warn', 'shield', null, _('Open this page in Safari or Chrome: the store opens from here, but the app handoff does not.')),
    );
  let shape: (st: WayState) => boolean = () => false;
  if (layout === 'same') {
    // Opened, the way round folds the steps away: the device is not in hand.
    const steps = h('div', { class: 'steps-wrap' }, h('div', { class: 'steps-gap' }), step1(), step2());
    const round = accordion([{ icon: glass('link'), title: fmt(_('Not on the %s right now?'), thereOn), body: linkBody() }], {
      inset: true,
      onToggle: (_i, open, instant) => foldBlock(steps, open, instant),
    });
    body.append(round.el, steps);
    shape = regroup(body, steps, round, false);
  } else if (layout === 'router') {
    const steps = h('div', { class: 'steps-wrap' }, step1(), step2());
    body.append(steps);
    shape = regroup(body, steps, null, true);
  }
  // A phone or a tablet set up from here: its link as a code, or the connection as a code for an app it has.
  else if (layout === 'away')
    body.appendChild(
      accordion(
        [
          { icon: glass('link'), title: fmt(_('Open your link on the %s'), thereOn), body: linkBody() },
          { icon: glass('app'), title: _('Already has the app'), body: [picker(), codeBox] },
        ],
        { inset: true, open: 1 },
      ).el,
    );
  // A computer set up from somewhere else, or something else (a TV, a box, a NAS) set up from a phone: its system is
  // not known here, so the link goes there and the page there does both steps.
  else
    body.appendChild(
      accordion(
        [
          { icon: glass('link'), title: fmt(_('Open your link on the %s'), thereOn), body: linkBody() },
          { icon: glass('key'), title: _('Copy or save the connection'), body: [picker(), sendBox] },
        ],
        { inset: true, open: 0 },
      ).el,
    );

  const subline = sub(
    layout === 'same'
      ? _('Two steps, about a minute')
      : router
        ? _('The packages and the file for OpenWrt')
        : fmt(_('The app goes on the %s.'), there),
  );
  const way = waitWay(d);
  const wait = follow(d, way, { sub: subline, rest: body, shape });
  onLeave(watchFirstConnection(d, wait.seen, wait.gaveUp));
  // Closed before the device connected: the page shows what the polls brought.
  onClosed(() => repaint());

  const title = fmt(_('Set up %s'), d.name);
  const el = h('div', { class: 'view' }, head(title, { acts: !!pill }), subline, way.el, body);
  return { el, label: title, acts: pill?.el ?? null };
}
