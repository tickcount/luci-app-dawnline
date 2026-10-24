// Adding a device: what it is (four kinds; phones and tablets are one choice,
// the same apps and the same smaller packets), whether the local network it is
// on stays reachable while connected (LAN Bypass, off unless they turn it on;
// it stays as chosen: the admin's drawer shows it, neither page changes it)
// and its name, guessed from the browser when it is this device; then straight
// on to its set-up. Or the page opens on the device itself, from a code, ready
// to add it there.

import type { ClientConfig, Kind } from '../../shared/types';
import { defaultName, fitName, kindLabel, netsLabel } from '../../shared/format';
import { guardDeviceName } from '../../shared/name-guard';
import { shake } from '../../shared/shake';
import { fmt, num, plural } from '../../shared/i18n';
import { ApiError, call } from '../api';
import { h, ic } from '../dom';
import { SMOOTH, play } from '../motion';
import { addLink } from '../setup';
import { pageUrl, repaint, setState, state, type State } from '../state';
import { smoothCaret } from '../ui/caret';
import { linkRow, qrBox } from '../ui/codes';
import { once, toast } from '../ui/feedback';
import { badLine } from '../ui/bad-line';
import { glass } from '../ui/glass';
import { go, head, openSheet, sub, type View } from '../ui/sheet';
import { secureFirst, showSecure } from './secure';
import { continueSetup } from './setup-view';

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
    MODEL = g ? `${g[1]} (${m})` : m.startsWith('SM-') ? `Galaxy ${m}` : m;
  } catch {
    /* not offered */
  }
  return MODEL;
})();

function guessName(kind: Kind): string {
  if (/iPhone/.test(UA)) return 'iPhone';
  if (IPAD) return 'iPad';
  if (/Android/.test(UA)) return MODEL || (kind === 'tablet' ? _('Android tablet') : _('Android phone'));
  if (/CrOS/.test(UA)) return 'Chromebook';
  if (/Mac OS X/.test(UA)) return 'Mac';
  if (/Windows/.test(UA)) return _('Windows PC');
  if (/Linux/.test(UA)) return _('Linux PC');
  return defaultName(kind);
}

/*
 * Phones and tablets are one choice. The device is still kept as a phone or a
 * tablet (the lines say "the tablet"): on the device itself the browser tells
 * which; picked from elsewhere it is a phone.
 */
type Pick = 'computer' | 'mobile' | 'router' | 'other';
const pickLabel = (p: Pick): string => (p === 'mobile' ? _('Mobile') : kindLabel(p));
const pickOf = (k: Kind): Pick => (k === 'phone' || k === 'tablet' ? 'mobile' : k);
const kindOf = (p: Pick): Kind => (p !== 'mobile' ? p : guessKind() === 'tablet' ? 'tablet' : 'phone');

/**
 * What they chose so far, kept outside the view: Back from "Open on the device"
 * builds the view again, and it comes back as they left it. `name`: what they
 * typed (unset while the name is still the guess).
 */
interface Draft {
  pick?: Pick;
  bypass: boolean;
  name?: string;
}

/**
 * A line in a block opens or folds away: height, opacity and blur on SMOOTH, as the set-up steps fold, from
 * where it is on screen (flicking the switch never snaps). The block's 1 px gap goes with it.
 */
function foldLine(el: HTMLElement, open: boolean) {
  const cs = getComputedStyle(el);
  const from = el.hidden
    ? { h: 0, o: 0, b: 4, m: -1 }
    : {
        h: el.getBoundingClientRect().height,
        o: +cs.opacity,
        b: +(cs.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0),
        m: parseFloat(cs.marginTop) || 0,
      };
  el.getAnimations().forEach((a) => a.cancel());
  el.hidden = false;
  el.style.overflow = 'hidden';
  const to = open ? { h: el.scrollHeight, o: 1, b: 0, m: 0 } : { h: 0, o: 0, b: 4, m: -1 };
  const frame = (v: typeof from) => ({ height: `${v.h}px`, opacity: v.o, filter: v.b ? `blur(${v.b}px)` : 'none', marginTop: `${v.m}px` });
  const a = play(el, [frame(from), frame(to)], { duration: SMOOTH.duration, easing: SMOOTH.easing, fill: 'forwards' });
  a.onfinish = () => {
    el.hidden = !open;
    el.style.overflow = '';
    a.cancel();
  };
}

export function startAdd() {
  const st = state();
  if (!st || st.locked) return;
  if (!st.can_add)
    return toast(
      plural(st.person.device_limit, 'You have reached your limit of %s device', 'You have reached your limit of %s devices'),
      true,
    );
  if (secureFirst()) return;
  const draft: Draft = { bypass: false };
  openSheet(() => vAdd(draft));
}

function vAdd(draft: Draft): View {
  const st = state()!;
  const p = st.person;
  // The kinds this router takes, as the four choices.
  const picks = (['computer', 'mobile', 'router', 'other'] as Pick[]).filter((k) => st.kinds.some((x) => pickOf(x) === k));
  const guess = picks.includes(pickOf(guessKind())) ? pickOf(guessKind()) : picks[0];
  let pick: Pick = draft.pick && picks.includes(draft.pick) ? draft.pick : guess;
  const taken = new Set(p.devices.map((d) => d.name.toLowerCase()));
  const suggest = (k: Pick) => {
    const n = k === pickOf(guessKind()) ? guessName(kindOf(k)) : defaultName(k === 'mobile' ? 'phone' : k);
    // Stripped of what the router refuses and cut to its limit, the number after it too ("Galaxy S24+ 2").
    if (!taken.has(fitName(n).toLowerCase())) return fitName(n);
    for (let i = 2; i < 20; i++) if (!taken.has(fitName(n, ` ${i}`).toLowerCase())) return fitName(n, ` ${i}`);
    return fitName(n);
  };

  const kinds = h('div', { class: 'kinds', role: 'radiogroup', 'aria-label': _('What is it?') });
  kinds.style.setProperty('--n', String(picks.length));
  const tiles = picks.map((k) => {
    const t = h(
      'button',
      { type: 'button', class: 'kind', role: 'radio', 'aria-label': pickLabel(k), onclick: () => choose(k) },
      h('span', { class: 'kind-tile' }, glass(k, 'blue')),
      h('span', { class: 'kind-lbl' }, pickLabel(k)),
    );
    kinds.appendChild(t);
    return t;
  });
  // With home access, the home networks still go into the tunnel: a local network on the same addresses is out
  // of reach, and the row says so while LAN Bypass is on.
  const home = st.server.home ?? [];
  const except = home.length
    ? h(
        'span',
        { class: 'sw-sub sw-note', hidden: !draft.bypass },
        fmt(_('Except %s: those addresses lead to the home network.'), netsLabel(home)),
      )
    : null;
  // The whole row is the switch. Built as they left it, before it is on the page: nothing slides.
  const lan = h(
    'button',
    {
      type: 'button',
      class: draft.bypass ? 'swrow on' : 'swrow',
      role: 'switch',
      'aria-checked': String(draft.bypass),
      onclick: () => {
        draft.bypass = !draft.bypass;
        lan.classList.toggle('on', draft.bypass);
        lan.setAttribute('aria-checked', String(draft.bypass));
        if (except) foldLine(except, draft.bypass);
      },
    },
    glass('lan', 'blue'),
    h(
      'span',
      { class: 'sw-t' },
      h('b', {}, _('LAN Bypass')),
      h('span', { class: 'sw-sub' }, _('Your local network stays reachable while connected.')),
      except,
    ),
    h('span', { class: 'sw', 'aria-hidden': 'true' }),
  );
  const input = h('input', {
    type: 'text',
    // Not `required`: the browser's own check would stop an empty submit before the field can shake.
    'aria-label': _('Name'),
    autocomplete: 'off',
    // Not a login: no password manager offering itself here.
    'data-1p-ignore': true,
  }) as HTMLInputElement;
  const goBtn = h('button', { class: 'go ready', type: 'submit', 'aria-label': _('Create connection') }, ic('arrow')) as HTMLButtonElement;
  // The red line under the field: why a name is refused (the router's word, or the field's own as it is typed).
  const { el: err, say, unsay } = badLine();
  // What the router won't take never gets in: the field shakes instead (shared/name-guard.ts).
  guardDeviceName(
    input,
    () => form,
    (w) => (w ? say(w) : unsay()),
  );
  input.value = draft.name ?? suggest(pick);
  goBtn.classList.toggle('ready', !!input.value.trim());
  input.addEventListener('input', () => {
    draft.name = input.value;
    goBtn.classList.toggle('ready', !!input.value.trim());
    unsay();
  });
  // The Android model arrives a moment later: use it unless they started typing.
  void modelReady.then(() => {
    if (draft.name === undefined && pick === pickOf(guessKind())) input.value = suggest(pick);
  });
  // The picked tile rings itself where it stands (the ring does not travel between tiles).
  function choose(k: Pick) {
    pick = draft.pick = k;
    tiles.forEach((t, i) => {
      const on = picks[i] === k;
      t.classList.toggle('on', on);
      t.setAttribute('aria-checked', String(on));
    });
    if (draft.name === undefined) {
      input.value = suggest(k);
      goBtn.classList.add('ready');
    }
  }
  choose(pick);

  const form = h('form', { class: 'field', autocomplete: 'off' }, input, goBtn);
  smoothCaret(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    // Nothing to name it: the field shakes (only now, not as it empties).
    if (!name) return shake(form);
    if (taken.has(name.toLowerCase())) {
      shake(form);
      return say(_('You already have a device with this name.'));
    }
    void once(goBtn, async () => {
      try {
        const r = await call<{ id: string; config: ClientConfig; state: State }>('devices', {
          name,
          kind: kindOf(pick),
          lan_bypass: draft.bypass,
        });
        setState(r.state);
        repaint({ pop: r.id });
        const dev = r.state.person.devices.find((d) => d.id === r.id)!;
        await continueSetup(dev, r.config);
      } catch (er) {
        if (er instanceof ApiError && er.httpsUrl) return showSecure(er.httpsUrl);
        shake(form);
        say((er as Error).message);
      }
    });
  });
  const viaLink = h(
    'button',
    { type: 'button', class: 'btn soft block', onclick: () => go(vLink) },
    ic('qr'),
    h('span', {}, _('Add it from the device')),
  );
  const free = p.device_limit - p.devices.length;
  const el = h(
    'div',
    { class: 'view' },
    head(_('Add a device')),
    sub(fmt(N_(p.device_limit, '%s of %s slot free', '%s of %s slots free'), num(free), num(p.device_limit))),
    kinds,
    lan,
    form,
    err,
    h('div', { class: 'or' }, _('OR')),
    viaLink,
  );
  return { el, label: _('Add a device') };
}

/** The page on the device itself, ready to add it: the link as a code for its camera, and as text. */
function vLink(): View {
  const link = addLink(pageUrl());
  const el = h(
    'div',
    { class: 'view' },
    head(_('Open on the device'), { back: true }),
    sub(_('Point its camera at the code: your page opens there with this device ready to add.')),
    qrBox(link, true),
    linkRow(link),
  );
  return { el, label: _('Open on the device') };
}
