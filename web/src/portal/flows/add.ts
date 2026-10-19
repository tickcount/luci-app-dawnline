// Adding a device: what it is (four kinds; phones and tablets are one choice,
// the same apps and the same smaller packets) and its name, guessed from the
// browser when it is this device; then straight on to its set-up. Or the page
// opens on the device itself, from a code, ready to add it there.

import type { ClientConfig, Kind } from '../../shared/types';
import { KIND_LABEL } from '../../shared/format';
import { ApiError, call } from '../api';
import { h, ic } from '../dom';
import { EASE_OUT, play } from '../motion';
import { addLink } from '../setup';
import { pageUrl, repaint, setState, state, type State } from '../state';
import { linkRow, qrBox } from '../ui/codes';
import { once, toast } from '../ui/feedback';
import { glass } from '../ui/glass';
import { morphText } from '../ui/morph';
import { go, head, hint, openSheet, sub, type View } from '../ui/sheet';
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

/*
 * Phones and tablets are one choice. The device is still kept as a phone or a
 * tablet (the lines say "the tablet"): on the device itself the browser tells
 * which; picked from elsewhere it is a phone.
 */
type Pick = 'computer' | 'mobile' | 'router' | 'other';
const PICK_LABEL: Record<Pick, string> = { computer: 'PC', mobile: 'Mobile', router: 'Router', other: 'Other' };
const pickOf = (k: Kind): Pick => (k === 'phone' || k === 'tablet' ? 'mobile' : k);
const kindOf = (p: Pick): Kind => (p !== 'mobile' ? p : guessKind() === 'tablet' ? 'tablet' : 'phone');

export function startAdd() {
  const st = state();
  if (!st || st.locked) return;
  if (!st.can_add) return toast(`You have reached your limit of ${st.person.device_limit} devices`, true);
  if (secureFirst()) return;
  openSheet(vAdd);
}

function vAdd(): View {
  const st = state()!;
  const p = st.person;
  // The kinds this router takes, as the four choices.
  const picks = (['computer', 'mobile', 'router', 'other'] as Pick[]).filter((k) => st.kinds.some((x) => pickOf(x) === k));
  let pick: Pick = picks.includes(pickOf(guessKind())) ? pickOf(guessKind()) : picks[0];
  let edited = false;
  const taken = new Set(p.devices.map((d) => d.name.toLowerCase()));
  const suggest = (k: Pick) => {
    const n = k === pickOf(guessKind()) ? guessName(kindOf(k)) : k === 'mobile' ? 'Phone' : KIND_LABEL[k];
    if (!taken.has(n.toLowerCase())) return n;
    for (let i = 2; i < 20; i++) if (!taken.has(`${n} ${i}`.toLowerCase())) return `${n} ${i}`;
    return n;
  };

  const kinds = h('div', { class: 'kinds', role: 'radiogroup', 'aria-label': 'What is it?' });
  kinds.style.setProperty('--n', String(picks.length));
  const tiles = picks.map((k) => {
    const t = h(
      'button',
      { type: 'button', class: 'kind', role: 'radio', 'aria-label': PICK_LABEL[k], onclick: () => choose(k) },
      h('span', { class: 'kind-tile' }, glass(k, 'blue')),
      h('span', { class: 'kind-lbl' }, PICK_LABEL[k]),
    );
    kinds.appendChild(t);
    return t;
  });
  const input = h('input', { type: 'text', maxlength: 48, required: true, 'aria-label': 'Name', autocomplete: 'off' }) as HTMLInputElement;
  const goBtn = h('button', { class: 'go ready', type: 'submit', 'aria-label': 'Create connection' }, ic('arrow')) as HTMLButtonElement;
  const err = h('p', { class: 'hint bad-t', hidden: true });
  const say = (msg: string) => {
    // Already showing: its words change in place.
    if (!err.hidden) return morphText(err, msg);
    err.textContent = msg;
    err.hidden = false;
    play(
      err,
      [
        { opacity: 0, transform: 'translateY(-4px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 220, easing: EASE_OUT },
    );
  };
  input.value = suggest(pick);
  input.addEventListener('input', () => {
    edited = true;
    goBtn.classList.toggle('ready', !!input.value.trim());
    err.hidden = true;
  });
  // The Android model arrives a moment later: use it unless they started typing.
  void modelReady.then(() => {
    if (!edited && pick === pickOf(guessKind())) input.value = suggest(pick);
  });
  // The picked tile rings itself where it stands (the ring does not travel between tiles).
  function choose(k: Pick) {
    pick = k;
    tiles.forEach((t, i) => {
      const on = picks[i] === k;
      t.classList.toggle('on', on);
      t.setAttribute('aria-checked', String(on));
    });
    if (!edited) {
      input.value = suggest(k);
      goBtn.classList.add('ready');
    }
  }
  choose(pick);

  const form = h('form', { class: 'field', autocomplete: 'off' }, input, goBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    if (taken.has(name.toLowerCase())) return say('You already have a device with this name.');
    void once(goBtn, async () => {
      try {
        const r = await call<{ id: string; config: ClientConfig; state: State }>('devices', { name, kind: kindOf(pick) });
        setState(r.state);
        repaint({ pop: r.id });
        const dev = r.state.person.devices.find((d) => d.id === r.id)!;
        await continueSetup(dev, r.config);
      } catch (er) {
        if (er instanceof ApiError && er.httpsUrl) return showSecure(er.httpsUrl);
        say((er as Error).message);
      }
    });
  });
  const viaLink = h(
    'button',
    { type: 'button', class: 'btn soft block', onclick: () => go(vLink) },
    ic('qr'),
    h('span', {}, 'Add it from the device'),
  );
  const free = p.device_limit - p.devices.length;
  const el = h(
    'div',
    { class: 'view' },
    head('Add a device'),
    sub(`${free} of ${p.device_limit} slots free`),
    kinds,
    hint('Phones and tablets get a smaller packet size that suits mobile networks.'),
    form,
    err,
    h('div', { class: 'or' }, 'OR'),
    viaLink,
  );
  el.querySelector('.hint')!.classList.add('kinds-note');
  return { el, label: 'Add a device' };
}

/** The page on the device itself, ready to add it: the link as a code for its camera, and as text. */
function vLink(): View {
  const link = addLink(pageUrl());
  const el = h(
    'div',
    { class: 'view' },
    head('Open on the device', { back: true }),
    sub('Point its camera at the code: your page opens there with this device ready to add.'),
    qrBox(link, true),
    linkRow(link),
  );
  return { el, label: 'Open on the device' };
}
