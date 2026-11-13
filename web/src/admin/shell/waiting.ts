// A page waits for the router before it can be drawn: every page builds on the real answer from its first line, and
// asks for it when it is opened, and only then (nothing of an earlier visit or another page is shown as if it were
// now). It is not left under LuCI's spinner: the view stands at once as the section row, which is known without the
// router, and the page comes in under it when its answer lands, its blocks rising as the portal's do
// (ui/entrance.ts; DESIGN.md › Motion › 16).
//
// An answer that is quick comes with nothing shown before it. One that keeps the page waiting (the backend was just
// restarted, by an update or a deploy) is said under the section row as the portal's one card is (DESIGN.md › Single
// card mode): Dawnline's mark, what it waits for, what the start is doing, and its three steps as a track. The steps
// are what the page really sees (state/stream.ts startPhase): the backend has not answered yet, it has and reads the
// router, the router's state is in hand and the page asks the rest. The track is one progress drawn over the three
// parts: within a step it goes on slower and slower (how long a step takes nobody knows), never full; a step done
// moves it to the next part; what is drawn follows that softly, so nothing jumps. The line under the title changes by
// rolling: the old words go up into a blur, the new come up out of one; the title changes in place. The card rises in, and when the answer comes the track
// runs full, the card fades where it stood and the page comes in. A page whose question failed asks again on its own,
// and says so in its own words: a refusal of the bus (an object not there while the backend restarts) is no sentence
// for a person, so it never stands on the card (the owner: «в лоадере в тексте появилась RPC ошибка»).

import { h, markup } from '../../portal/dom';
import { EASE_IN, EASE_OUT, play } from '../../portal/motion';
import { rise } from '../../portal/ui/rise';
import { MARK } from '../../shared/mark';
import { backendSilent, startPhase } from '../state/stream';
import { enter } from '../ui/entrance';
import { navRow } from './nav';

/** Waits this long before it says it waits (ms): a quicker answer comes in with nothing flashed before it. */
const SAY_AFTER = 600;
/** What it says is looked at again this often (ms), and a failed question asked again after this long. */
const LOOK = 200;
const AGAIN = 3000;
const STEPS = 3;
/** Within a step the progress goes toward this much of its part, a third of the rest every this long (ms). */
const CRAWL_TO = 0.86;
const CRAWL = 3000;
/** What is drawn follows the progress with this lag (ms): a step done glides on, never jumps; faster at the end. */
const FOLLOW = 420;
const FOLLOW_END = 140;
/** The card goes this fast when the answer comes (ms): an exit, quick. */
const OUT = 180;

/** What the start is doing, as the page sees it. */
const doing = (): string[] => [_('Waiting for the backend'), _('Reading the router'), _('Opening the page')];

interface Said {
  warn: boolean;
  title: string;
  line: string;
}

/** Questions failed in a row before the card says the router does not answer (about ten seconds). */
const GIVE_UP = 3;

/** What the wait says: what it waits for, and what the start is doing (or that it asks again, after `fails` refusals). */
function said(fails: number): Said {
  if (fails >= GIVE_UP) return { warn: true, title: _('The router is not answering yet'), line: _('Trying again in a moment') };
  // a refusal while the page waits is almost always the backend starting over (an update, a deploy)
  if (fails) return { warn: false, title: _('Dawnline is starting'), line: _('Trying again in a moment') };
  return {
    warn: false,
    title: backendSilent() ? _('Dawnline is starting') : _('Waiting for the router'),
    line: doing()[startPhase()],
  };
}

/** Words that change by rolling: the old go up into a blur, the new come up out of one, in the same place. */
function roll(cls: string) {
  const box = h('span', { class: `dl-roll ${cls}` });
  let now: HTMLElement | null = null;
  const to = (text: string, first: boolean) => {
    if (now?.textContent === text) return;
    const next = h('span', {}, text);
    box.append(next);
    if (now) {
      const old = now;
      // from where it stands (it may still be coming up)
      const cs = getComputedStyle(old);
      old.getAnimations().forEach((a) => a.cancel());
      play(
        old,
        [
          { opacity: cs.opacity, transform: cs.transform, filter: cs.filter },
          { opacity: 0, transform: 'translateY(-0.6em)', filter: 'blur(4px)' },
        ],
        {
          duration: OUT,
          easing: EASE_IN,
          fill: 'forwards',
        },
      ).finished.then(
        () => old.remove(),
        () => old.remove(),
      );
    }
    now = next;
    if (!first)
      play(
        next,
        [
          { opacity: 0, transform: 'translateY(0.6em)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'none', filter: 'none' },
        ],
        {
          duration: 280,
          delay: 60,
          easing: EASE_OUT,
          fill: 'backwards',
        },
      );
  };
  return { el: box, to };
}

/** The card that says the wait, and the way to say it again. */
function waitCard() {
  const mark = markup(MARK);
  const title = h('h2', { class: 'dl-wait-t' });
  const line = roll('dl-wait-l');
  const parts = Array.from({ length: STEPS }, () => h('i', {}, h('b')));
  const el = h(
    'div',
    { class: 'dl-wait', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'dl-wait-mark' }, mark),
    title,
    line.el,
    h('span', { class: 'dl-steps', 'aria-hidden': 'true' }, ...parts),
  );

  // the progress over the three parts (0–1), and what is drawn of it
  let goal = 0;
  let drawn = 0;
  let step = -1;
  let since = 0;
  let last = 0;
  let ending: (() => void) | null = null;
  const frame = (t: number) => {
    if (!el.isConnected && !ending) return;
    const p = startPhase();
    if (p !== step) {
      step = p;
      since = t;
    }
    // never back: a step only moves it on
    const crawl = CRAWL_TO * (1 - Math.exp(-(t - since) / CRAWL));
    goal = ending ? 1 : Math.max(goal, (p + crawl) / STEPS);
    const dt = last ? t - last : 16;
    last = t;
    drawn += (goal - drawn) * (1 - Math.exp(-dt / (ending ? FOLLOW_END : FOLLOW)));
    // the track says how far the start has come, it does not travel: it goes on with less motion asked for too
    parts.forEach((x, i) => {
      (x.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.min(1, Math.max(0, drawn * STEPS - i))})`;
    });
    if (ending && drawn > 0.995) {
      const end = ending;
      ending = null;
      return end();
    }
    requestAnimationFrame(frame);
  };

  const say = (s: Said, first: boolean) => {
    // the title stands: it changes in place (the owner: «заголовок не анимировать»)
    if (title.textContent !== s.title) title.textContent = s.title;
    line.to(s.line, first);
    el.classList.toggle('warn', s.warn);
  };

  /** It comes in: the card rises, the sun rises from behind its line, the track starts. */
  const show = () => {
    rise([el]);
    const sun = mark.querySelector('.sun');
    if (sun)
      play(sun, [{ transform: 'translateY(7px)' }, { transform: 'none' }], {
        duration: 900,
        delay: 150,
        easing: EASE_OUT,
        fill: 'backwards',
      });
    requestAnimationFrame(frame);
  };

  /** Every step done: the track runs full, then the card goes. */
  const done = (): Promise<unknown> =>
    new Promise<void>((full) => (ending = full)).then(
      () => play(el, [{ opacity: 1 }, { opacity: 0, filter: 'blur(4px)' }], { duration: OUT, easing: EASE_IN, fill: 'forwards' }).finished,
    );

  return { el, say, show, done };
}

/** The page that stands in `root` (a shadow root has no `:scope` to ask by). */
export const pageIn = (root: ShadowRoot): Element | null => Array.from(root.children).find((c) => c.classList.contains('page')) ?? null;

/**
 * Draw the section row into `root` now, and the page itself (`render` of the answer) under it when `pending` lands.
 * `again`: the same question asked anew, when this one failed.
 */
export function waitFor<D>(
  root: ShadowRoot,
  pending: Promise<D>,
  render: (data: D) => HTMLElement,
  again: () => Promise<D>,
  nav?: HTMLElement,
): void {
  const card = waitCard();
  // the row that stands already (a move from another page of Dawnline's, shell/pages.ts) stays the node it is
  const row = nav ?? navRow();
  const was = pageIn(root);
  const holder = h('div', { class: 'page' }, row);
  if (was) was.replaceWith(holder);
  else root.append(holder);
  let fails = 0;
  let landed = false;
  let showing = false;
  const shown = setTimeout(() => {
    if (landed) return;
    card.say(said(fails), true);
    holder.append(card.el);
    showing = true;
    // it comes in as the portal's one card does
    card.show();
  }, SAY_AFTER);
  const looking = setInterval(() => showing && card.say(said(fails), false), LOOK);
  const wait = (p: Promise<D>) =>
    p.then(
      (data) => {
        landed = true;
        clearTimeout(shown);
        clearInterval(looking);
        // the page was left meanwhile (the view, or for another page in it): nothing of it is drawn (its pollers
        // would outlive it)
        const here = () => root.host.isConnected && holder.parentNode === root;
        if (!here()) return;
        const land = () => {
          if (!here()) return;
          const page = render(data);
          // the row that stands takes the place of the page's own (they are the same): it is never drawn again, so
          // it does not blink; what stands under it comes in
          page.querySelector(':scope > .dl-nav')?.replaceWith(row);
          holder.replaceWith(page);
          enter(page);
        };
        if (!showing) return land();
        void card.done().then(land, land);
      },
      (e) => {
        if (!root.host.isConnected || holder.parentNode !== root) return void clearInterval(looking);
        fails++;
        // the reason is for whoever debugs it, not for the card
        console.warn('dawnline: the page’s question failed, asking again', e);
        if (showing) card.say(said(fails), false);
        setTimeout(() => root.host.isConnected && holder.parentNode === root && void wait(again()), AGAIN);
      },
    );
  void wait(pending);
}
