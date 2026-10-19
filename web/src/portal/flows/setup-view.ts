// Setting a device up: one sheet. Its layout follows where the page is open:
// on the device itself, two steps (get the app, add the connection) with a way
// round folded under the wait; a router, its packages and the file; a phone or
// a tablet set up from elsewhere, its link as a code or the connection as a
// code for an app it has; a computer set up from elsewhere, its link or the
// connection to send there. Which app and where it comes from follow the
// server's disguise and the platform (setup.ts). The wait for the first
// connection sits on top the whole time (wait.ts).

import type { ClientConfig, Device } from '../../shared/types';
import { vpnKey, vpnQrText } from '../../shared/vpnkey';
import { ApiError, call } from '../api';
import { h, put } from '../dom';
import { SMOOTH, play } from '../motion';
import { APP_NAME, appsFor, deviceNoun, inWebview, keyFileName, sameDevice, setupLink, type AppId } from '../setup';
import { pageUrl, platform, preset, repaint } from '../state';
import { accordion } from '../ui/accordion';
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
import { arrive, waitWay, watchFirstConnection } from './wait';

async function getConfig(d: Device): Promise<ClientConfig | null> {
  try {
    return await call<ClientConfig>(`devices/${d.id}/config`);
  } catch (e) {
    if (e instanceof ApiError && e.httpsUrl) showSecure(e.httpsUrl);
    else toast((e as Error).message, true);
    return null;
  }
}

/** Set up a device from its card: the configuration first (the button waits for it), then the sheet. */
export async function openSetup(d: Device, from?: EventTarget | null) {
  if (secureFirst()) return;
  const run = async () => {
    const cfg = await getConfig(d);
    if (!cfg) return;
    const key = await vpnKey(cfg, cfg.server);
    openSheet(() => setupView(d, cfg, key));
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

/** Fold a block away (height, then gone) or bring it back; `instant` without motion. */
function foldBlock(el: HTMLElement, fold: boolean, instant: boolean) {
  const cur = el.hidden ? 0 : el.getBoundingClientRect().height;
  el.getAnimations().forEach((a) => a.cancel());
  if (instant) {
    el.hidden = fold;
    return;
  }
  el.style.overflow = 'hidden';
  el.hidden = false;
  const to = fold ? 0 : el.getBoundingClientRect().height;
  const [a, b] = fold ? [1, 0] : [0, 1];
  play(
    el,
    [
      { height: `${cur}px`, opacity: a, filter: `blur(${4 - a * 4}px)` },
      { height: `${to}px`, opacity: b, filter: `blur(${4 - b * 4}px)` },
    ],
    {
      duration: SMOOTH.duration,
      easing: SMOOTH.easing,
    },
  ).onfinish = () => {
    el.style.overflow = '';
    el.hidden = fold;
  };
}

type Layout = 'same' | 'router' | 'away' | 'pc-away';

export function setupView(d: Device, cfg: ClientConfig, key: string): View {
  const pf = platform();
  const apps = appsFor(preset());
  const handheld = d.kind === 'phone' || d.kind === 'tablet';
  const router = d.kind === 'router';
  const same = sameDevice(d.kind, pf);
  const layout: Layout = same ? 'same' : router ? 'router' : handheld ? 'away' : 'pc-away';
  const there = deviceNoun(d.kind);
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
        // The sheet glides to its new height; inside, what changed morphs (morphInto).
        glide(fill);
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
  let code: CodeRow | null = null;
  let scan: ScanLine | null = null;
  let codeApp: AppId | null = null;
  const pill =
    layout === 'away'
      ? connPill(() => ({
          ...(app === 'vpn'
            ? { text: key, msg: 'Key copied', file: keyFileName(cfg.filename) }
            : { text: cfg.conf, msg: 'Configuration copied', file: cfg.filename }),
          app: APP_NAME[app],
        }))
      : null;

  /** Everything a pick changes, refilled in place. */
  function fill() {
    morphText(title1, router ? `Get ${APP_NAME[app]} on the router` : `Get ${APP_NAME[app]}`, undefined, { whole: true });
    morphInto(getBox, storeBlock(app, pf, router));
    // The router's file is the same for either app: it stays as it is (a folded configuration stays folded).
    if (!router) morphInto(addBox, connectKids(c));
    else if (!addBox.firstChild) put(addBox, filePane(cfg));
    const text = app === 'vpn' ? vpnQrText(key) : cfg.conf;
    // Another app: its words morph in place, the code changes only when it holds something else (codes.ts).
    if (code && scan && code.el.isConnected) {
      if (codeApp !== app) {
        code.swap(text);
        scan.set(app);
      }
    } else {
      scan = scanLine(app);
      code = codeRow(text, [scan.el]);
      codeBox.replaceChildren(code.el);
    }
    codeApp = app;
    morphInto(sendBox, sendKids(c));
    pill?.sync();
  }
  fill();

  // Not on the device: the link goes there (as a code for a phone's camera); the page there does the rest.
  const linkThere = setupLink(pageUrl(), d.id);
  const linkBody = () => [
    handheld
      ? codeRow(linkThere, [h('span', {}, 'Point its camera at the code: the link opens there.')]).el
      : h('p', { class: 'desc' }, `Open this link on the ${there} to set it up there.`),
    linkRow(linkThere),
  ];
  const step1 = () => step('1', title1, [picker(), getBox]);
  const step2 = () => step('2', router ? 'Import the configuration' : 'Add the connection', [addBox]);

  const body = h('div', { class: 'setup' });
  if (inWebview(navigator.userAgent))
    body.appendChild(
      notice('warn', 'shield', null, 'Open this page in Safari or Chrome: the store opens from here, but the app handoff does not.'),
    );
  if (layout === 'same') {
    // Opened, the way round folds the steps away: the device is not in hand.
    const steps = h('div', { class: 'steps-wrap' }, h('div', { class: 'steps-gap' }), step1(), step2());
    const round = accordion([{ icon: glass('link'), title: `Not on the ${there} right now?`, body: linkBody() }], {
      inset: true,
      onToggle: (_i, open, instant) => foldBlock(steps, open, instant),
    });
    body.append(round.el, steps);
  } else if (layout === 'router') body.append(step1(), step2());
  // A phone or a tablet set up from here: its link as a code, or the connection as a code for an app it has.
  else if (layout === 'away')
    body.appendChild(
      accordion(
        [
          { icon: glass('link'), title: `Open your link on the ${there}`, body: linkBody() },
          { icon: glass('app'), title: 'Already has the app', body: [picker(), codeBox] },
        ],
        { inset: true, open: 1 },
      ).el,
    );
  // A computer set up from somewhere else: its system is not known here, so the link goes there and the page there does both steps.
  else
    body.appendChild(
      accordion(
        [
          { icon: glass('link'), title: `Open your link on the ${there}`, body: linkBody() },
          { icon: glass('key'), title: 'Copy or save the connection', body: [picker(), sendBox] },
        ],
        { inset: true, open: 0 },
      ).el,
    );

  const way = waitWay(d);
  let finished = false;
  onLeave(
    watchFirstConnection(
      d,
      () => {
        if (finished) return;
        finished = true;
        void arrive(way, body, d);
      },
      way.gaveUp,
    ),
  );
  // Closed before the device connected: the page shows what the polls brought.
  onClosed(() => repaint());

  const subline =
    layout === 'same' ? 'Two steps, about a minute' : router ? 'The packages and the file for OpenWrt' : `The app goes on the ${there}.`;
  const el = h('div', { class: 'view' }, head(`Set up ${d.name}`, { acts: !!pill }), sub(subline), way.el, body);
  return { el, label: `Set up ${d.name}`, acts: pill?.el ?? null };
}
