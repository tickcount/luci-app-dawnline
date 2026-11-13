// Adding a device: what it is (four kinds; phones and tablets are one choice,
// the same apps and the same smaller packets), whether the local network it is
// on stays reachable while connected (LAN Bypass, on unless they turn it off;
// Reconnect and the card's ⋯ menu change it later: device-actions.ts) and its
// name, guessed from the browser when it is this device; then straight on to
// its set-up. Or the page opens on the device itself, from a code, ready to add
// it there. The kinds and the switch are device-form.ts.

import type { ClientConfig, Kind } from '../../shared/types';
import { defaultName, fitName, pickOf, PICKS, type KindPick } from '../../shared/format';
import { guardDeviceName } from '../../shared/name-guard';
import { shake } from '../../shared/shake';
import { fmt, num, plural } from '../../shared/i18n';
import { ApiError, call } from '../api';
import { h, ic } from '../dom';
import { EASE_IN, play } from '../motion';
import { addLink } from '../setup';
import { pageUrl, repaint, setState, state, type State } from '../state';
import { smoothCaret } from '../ui/caret';
import { linkRow, qrBox } from '../ui/codes';
import { once, toast } from '../ui/feedback';
import { badLine } from '../ui/bad-line';
import { fold } from '../ui/fold';
import { morphText } from '../ui/morph';
import { glide, go, head, openSheet, sub, type View } from '../ui/sheet';
import { secureFirst, showSecure } from './secure';
import { IPAD, UA, guessKind, kindOf, kindTiles, lanSwitch } from './device-form';
import { netsMatter, routerNets, sentParts } from './behind';
import { continueSetup } from './setup-view';

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

/**
 * What they chose so far, kept outside the view: Back from "Open on the device"
 * builds the view again, and it comes back as they left it. `name`: what they
 * typed (unset while the name is still the guess).
 */
interface Draft {
  pick?: KindPick;
  bypass: boolean;
  name?: string;
  /** The networks behind it, when it is a router. */
  nets?: string[];
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
  const draft: Draft = { bypass: true };
  openSheet(() => vAdd(draft));
}

function vAdd(draft: Draft): View {
  const st = state()!;
  const p = st.person;
  // The kinds this router takes, as the four choices.
  const picks = PICKS.filter((k) => st.kinds.some((x) => pickOf(x) === k));
  const guess = picks.includes(pickOf(guessKind())) ? pickOf(guessKind()) : picks[0];
  let pick: KindPick = draft.pick && picks.includes(draft.pick) ? draft.pick : guess;
  const taken = new Set(p.devices.map((d) => d.name.toLowerCase()));
  const suggest = (k: KindPick) => {
    const n = k === pickOf(guessKind()) ? guessName(kindOf(k)) : defaultName(k === 'mobile' ? 'phone' : k);
    // Stripped of what the router refuses and cut to its limit, the number after it too ("Galaxy S24+ 2").
    if (!taken.has(fitName(n).toLowerCase())) return fitName(n);
    for (let i = 2; i < 20; i++) if (!taken.has(fitName(n, ` ${i}`).toLowerCase())) return fitName(n, ` ${i}`);
    return fitName(n);
  };

  // A router: by the server's rule it is asked of the admin (the form then sends a request, and says so) or added as
  // any device; the networks behind it are typed with it either way.
  const asks = st.server.routers !== 'free';
  const nets = (draft.nets ??= []);
  // The block opens and folds away as a line of this form does: height, opacity and blur on SMOOTH from where it is
  // on screen, the fields under it travelling with its edge. Not the sheet's glide: that holds what is under it
  // where it stood and lets it go later, so the block would come up from under the field.
  const behindFold = h('div', { class: 'pb-fold', hidden: true }, routerNets(nets));
  let shown = false;
  const kinds = kindTiles(picks, (k) => choose(k));
  const lan = lanSwitch(draft.bypass, st.server.home ?? [], (on) => (draft.bypass = on));
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
  // The line under the title says how many slots are free or, for a router that is asked for, who takes it: the
  // words change where they stand (ui/morph.ts), no line of its own in the form.
  const freeWords = fmt(
    N_(p.device_limit, '%s of %s slot free', '%s of %s slots free'),
    num(p.device_limit - p.devices.length),
    num(p.device_limit),
  );
  const said = sub(freeWords);
  function choose(k: KindPick) {
    pick = draft.pick = k;
    kinds.set(k);
    const router = k === 'router';
    // with the internet alone nothing at home reaches their devices, so their router's networks are not asked about
    const withNets = router && netsMatter(st);
    if (shown !== withNets) fold(behindFold, (shown = withNets));
    goBtn.setAttribute('aria-label', router && asks ? _('Ask the admin') : _('Create connection'));
    const next = router && asks ? _('A router is confirmed by the admin') : freeWords;
    if (said.textContent !== next) {
      if (said.isConnected) morphText(said, next, undefined, { whole: true });
      else said.textContent = next;
    }
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
        const r = await call<{ id: string; config?: ClientConfig; waiting?: boolean; state: State }>('devices', {
          name,
          kind: kindOf(pick),
          lan_bypass: draft.bypass,
          ...(pick === 'router' && netsMatter(st) && nets.length ? { networks: nets } : {}),
        });
        setState(r.state);
        repaint({ pop: r.id });
        // A router that waits for the admin has no set-up to open: the request is said instead, and the form turns
        // into that state where it stands. What it held goes out (160 ms), then the sheet glides to its new height
        // with the new parts coming into focus and the title's words morphing. Not another view (ui/sheet.ts go):
        // that swap is made for views of a like height, and from a form this tall to three lines it falls shut.
        if (r.waiting || !r.config) {
          const view = form.closest<HTMLElement>('.view')!;
          const gone = ([...view.children] as HTMLElement[]).filter((x) => !x.classList.contains('vhead'));
          await Promise.all(
            gone.map(
              (x) =>
                play(
                  x,
                  [
                    { opacity: 1, filter: 'blur(0px)' },
                    { opacity: 0, filter: 'blur(4px)' },
                  ],
                  { duration: 160, easing: EASE_IN, fill: 'forwards' },
                ).finished,
            ),
          );
          const parts = sentParts();
          glide(() => {
            gone.forEach((x) => x.remove());
            view.classList.add('pb-sent');
            view.append(...parts);
          }, parts);
          const title = view.querySelector<HTMLElement>('.vhead h2');
          if (title) morphText(title, _('Asked the admin'), undefined, { whole: true });
          return;
        }
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
  const el = h(
    'div',
    { class: 'view' },
    head(_('Add a device')),
    said,
    kinds.el,
    lan,
    behindFold,
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
