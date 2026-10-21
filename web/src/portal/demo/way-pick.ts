// The demo's set-up state switch: a pill beside the set-up sheet's ×, so a visitor can see each state the way
// shows (waiting, knocks that never finish, no data, connected) without a device. Its popup is a row of segments
// in one pill frame, above the pill with a tail pointing at it and a dark halo behind. Only on the set-up view:
// another view in the same sheet (a question, a device's page) fades it out. Picking holds the device in that
// state on the demo's router and polls at once; Auto is the demo's own timing.

import { h, ic } from '../dom';
import { EASE_IN, EASE_OUT, POP, play } from '../motion';
import { morphText, setText } from '../ui/morph';
import { pollNow } from '../flows/wait';
import type { DemoWay } from './data';
import type { DemoRouter } from './router';

type Pick = DemoWay | 'connected' | 'auto';
type Tone = 'neutral' | 'warn' | 'ok';

const PICKS: [Pick, () => string, Tone][] = [
  ['auto', () => _('Auto'), 'neutral'],
  ['waiting', () => _('Waiting'), 'neutral'],
  ['trying', () => _('Trying'), 'warn'],
  ['nodata', () => _('No data'), 'warn'],
  ['connected', () => _('Online'), 'ok'],
];
const pick = (p: Pick) => PICKS.find((x) => x[0] === p)!;

/** The gap between the pill and the popup above it, and how far the halo reaches out (up, sideways, down). */
const GAP = 18;
const HALO = { x: 64, up: 48, down: 14 };

/** Gone from where it stands, so one leaving while it still comes in turns back from there. */
function leave(el: Element, frames: Keyframe, ms: number) {
  const s = getComputedStyle(el);
  el.getAnimations().forEach((a) => a.cancel());
  const a = play(
    el,
    [
      { opacity: s.opacity, transform: s.transform, filter: s.filter },
      { opacity: 0, ...frames },
    ],
    {
      duration: ms,
      easing: EASE_IN,
      fill: 'forwards',
    },
  );
  a.onfinish = () => el.remove();
}

export function mountWayPick(router: DemoRouter) {
  /** What each device's pill says: what was picked here, else what the router holds it in. */
  const shown = new Map<string, Pick>();
  let pop: HTMLElement | null = null;
  let halo: HTMLElement | null = null;
  let anchor: HTMLElement | null = null;

  function closePop() {
    if (!pop) return;
    leave(pop, { transform: 'scale(.96)', filter: 'blur(3px)' }, 120);
    if (halo) leave(halo, {}, 160);
    anchor?.setAttribute('aria-expanded', 'false');
    pop = halo = anchor = null;
  }

  function openPop(pill: HTMLElement, id: string, paint: () => void) {
    const now = shown.get(id) ?? router.wayOf(id);
    const m = h(
      'div',
      { class: 'dm-way-pop', role: 'menu' },
      ...PICKS.map(([p, label, tone]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'menuitemradio',
            'aria-checked': String(p === now),
            onclick: () => {
              closePop();
              shown.set(id, p);
              router.holdWay(id, p);
              paint();
              pollNow();
            },
          },
          h('span', { class: `dot ${tone}` }),
          label(),
        ),
      ),
    );
    document.body.append(m);
    // Centred over the pill, inside the sheet where it fits (else the screen), the tail on the pill's middle.
    const r = pill.getBoundingClientRect();
    const box = pill.closest('.sheet')?.getBoundingClientRect() ?? { left: 0, right: innerWidth };
    const w = m.offsetWidth;
    const mid = r.left + r.width / 2;
    const lo = Math.max(12, box.left + 10);
    const hi = Math.min(innerWidth - 12, box.right - 10);
    const left = Math.max(lo, Math.min(mid - w / 2, hi - w));
    const top = r.top - GAP - m.offsetHeight;
    Object.assign(m.style, { left: `${left}px`, top: `${top}px`, transformOrigin: `${mid - left}px bottom` });
    m.style.setProperty('--tail', `${mid - left}px`);
    // The halo reaches up and out but stops short of the pill, which stays sharp.
    const sc = h('div', { class: 'dm-way-halo' });
    Object.assign(sc.style, {
      left: `${left - HALO.x}px`,
      top: `${top - HALO.up}px`,
      width: `${w + HALO.x * 2}px`,
      height: `${m.offsetHeight + HALO.up + HALO.down}px`,
    });
    m.before(sc);
    play(sc, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE_OUT });
    play(
      m,
      [
        { opacity: 0, transform: 'scale(.9)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'none', filter: 'none' },
      ],
      { duration: POP.duration, easing: POP.easing },
    );
    pop = m;
    halo = sc;
    anchor = pill;
    pill.setAttribute('aria-expanded', 'true');
  }

  function makePill(id: string): HTMLElement {
    const dot = h('span', { class: 'dot' });
    const lbl = h('span', {});
    const pill = h(
      'button',
      { type: 'button', class: 'dm-way', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': _('Set-up state') },
      dot,
      lbl,
      ic('chevron', 'i'),
    );
    const paint = (morph = true) => {
      const [, label, tone] = pick(shown.get(id) ?? router.wayOf(id));
      dot.className = `dot ${tone}`;
      if (morph) morphText(lbl, label());
      else setText(lbl, label());
    };
    paint(false);
    pill.addEventListener('click', () => (anchor === pill ? closePop() : (closePop(), openPop(pill, id, () => paint()))));
    return pill;
  }

  function place() {
    if (anchor && !anchor.isConnected) closePop();
    const sheet = document.querySelector<HTMLElement>('.sheet-root.open .sheet');
    const id = router.settingUp();
    const setup = !!sheet && !!id && !!sheet.querySelector('.way') && !sheet.classList.contains('asks');
    document.querySelectorAll<HTMLElement>('.dm-way:not(.gone)').forEach((el) => {
      if (setup && el.parentElement === sheet && el.dataset.id === id) return;
      el.classList.add('gone');
      el.parentElement?.querySelectorAll<HTMLElement>('.vhead').forEach((hd) => (hd.style.paddingRight = ''));
      if (anchor === el) closePop();
      leave(el, { transform: 'scale(.9)', filter: 'blur(3px)' }, 160);
    });
    if (!sheet || !setup || !id) return;
    let pill = sheet.querySelector<HTMLElement>('.dm-way:not(.gone)');
    if (!pill) {
      pill = makePill(id);
      pill.dataset.id = id;
      sheet.append(pill);
    }
    // Left of × and of the view's own buttons, whatever they are; into their place once the sheet hides them
    // (the device arrived), gliding there as they fade.
    const acts = sheet.querySelector<HTMLElement>('.sheet-acts');
    const arrived = sheet.classList.contains('arrived');
    const right = (arrived ? 22 : 58) + (!arrived && acts?.offsetWidth ? acts.offsetWidth + 6 : 0);
    if (pill.style.right !== `${right}px`) pill.style.right = `${right}px`;
    // The title keeps clear of the pill as it does of ×: a long device name ends in an ellipsis before it. Worked
    // out from where the pill goes, not where it is gliding through.
    const sr = sheet.getBoundingClientRect();
    const scale = sr.width / sheet.offsetWidth || 1;
    for (const head of sheet.querySelectorAll<HTMLElement>('.vhead')) {
      const inset = (sr.right - head.getBoundingClientRect().right) / scale;
      const pad = `${Math.max(0, right + pill.offsetWidth + 8 - inset)}px`;
      if (head.style.paddingRight !== pad) head.style.paddingRight = pad;
    }
  }

  new MutationObserver(place).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Element;
    if (pop && !pop.contains(t) && !anchor?.contains(t)) closePop();
  });
  // Escape takes the popup only, not the sheet under it.
  document.addEventListener(
    'keydown',
    (e) => {
      if (!pop || e.key !== 'Escape') return;
      e.stopPropagation();
      closePop();
    },
    true,
  );
  // A wheel or a swipe closes it; the sheet's own scroll as it settles does not.
  for (const ev of ['wheel', 'touchmove'])
    addEventListener(ev, (e) => pop && !pop.contains(e.target as Node) && closePop(), { passive: true, capture: true });
}
