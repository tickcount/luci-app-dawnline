// The Traffic card of a device's page and of a person's (their devices summed):
// the last 7 days read a day at a time (widgets/week-use.ts: the days as bars,
// their sum down and up, a day under the pointer in the sum's place), then this
// month and all time, and while online the speed now (the live meter, read only
// while the card is on screen).

import { reshape } from '../../../ui/reshape';
import { h } from '../../../../portal/dom';
import { SMOOTH, play, still } from '../../../../portal/motion';
import { appear, fadeAway, look, morphText, setText } from '../../../../portal/ui/morph';
import { rateOf, bytes } from '../../../../shared/format';
import type { Pair } from '../../../../shared/types';
import { weekUse } from '../../../widgets/week-use';

export interface TrafficCard {
  el: HTMLElement;
  /** New numbers (a repaint): the values that changed morph, the bars are drawn again. */
  set(d: Use): void;
  /** The speed now ([rx, tx] in bytes/s, rx from the device); 'wait': online, the meter has no second yet (the
   * tile stays, with what it said or a dash); null: offline, it goes. Fed once a second, its words
   * change every third (at once when they come). */
  speed(v: [number, number] | 'wait' | null): void;
}

/** A value that morphs when it changes, said plainly the first time. */
function put(el: HTMLElement, text: string) {
  if (!el.textContent) setText(el, text);
  else if (text !== el.textContent) morphText(el, text);
}

/** Its numbers: each of the last 7 days, the last 30 days and all time (each a Pair, the router's [rx, tx]). */
export interface Use {
  spark: Pair[];
  month: Pair;
  total: Pair;
}

/** A person's: their devices' days added up (the newest last, as each device's). */
export function personUse(p: { devices: { spark: Pair[] }[]; month: Pair; total: Pair }): Use {
  const n = Math.max(0, ...p.devices.map((d) => d.spark.length));
  const spark = Array.from({ length: n }, (_x, k): Pair => {
    const s: Pair = [0, 0];
    for (const d of p.devices) {
      const v = d.spark[d.spark.length - n + k];
      if (v) {
        s[0] += v[0];
        s[1] += v[1];
      }
    }
    return s;
  });
  return { spark, month: p.month, total: p.total };
}

/** `key`, `name`: whose traffic it is (its numbers' names for a repaint, its name for a screen reader). */
export function trafficCard(d0: Use, key: string, name: string): TrafficCard {
  const val = () => h('b', { class: 'num' });
  const sub = () => h('span', { class: 'stat-sub' });
  const tile = (label: string, v: HTMLElement, s: HTMLElement) => h('div', { class: 'stat' }, h('span', { class: 'use-lbl' }, label), v, s);
  const week = weekUse(key, name, d0.spark);
  const [month, monthSub, total, totalSub, down, up] = [val(), sub(), val(), sub(), val(), sub()];
  const now = tile(_('Now', 'speed'), down, up);
  now.classList.add('live-speed');
  now.hidden = true;
  const stay = [tile(_('30 days'), month, monthSub), tile(_('Total'), total, totalSub)];
  const stats = h('div', { class: 'stats' }, ...stay, now);
  const el = h('div', { class: 'card traffic' }, week.el, stats);
  /**
   * «Now» comes or goes: the grid takes another column (or a phone's second row), and nothing jumps. The tiles that
   * stay glide from where they stand to their new place and width (SMOOTH, from a glide under way too), «Now» blurs
   * in at its place or fades where it stood, and the card glides to its new height.
   */
  const toggle = (show: boolean) => {
    // a page that stands still: «Now» is there or it is not
    if (still()) return void (now.hidden = !show);
    const was = stay.map((t) => t.getBoundingClientRect());
    const at = now.getBoundingClientRect();
    const from = stats.getBoundingClientRect();
    const ghost = !show && now.getClientRects().length ? (now.cloneNode(true) as HTMLElement) : null;
    const shows = ghost ? look(now) : undefined;
    stay.forEach((t) => t.getAnimations().forEach((a) => a.cancel()));
    reshape(el, () => (now.hidden = !show));
    stay.forEach((t, i) => {
      const r = t.getBoundingClientRect();
      if (
        r.width &&
        was[i].width &&
        (Math.abs(r.left - was[i].left) > 0.5 || Math.abs(r.top - was[i].top) > 0.5 || Math.abs(r.width - was[i].width) > 0.5)
      )
        play(
          t,
          [
            { transform: `translate(${was[i].left - r.left}px, ${was[i].top - r.top}px)`, width: `${was[i].width}px` },
            { transform: 'none', width: `${r.width}px` },
          ],
          { duration: SMOOTH.duration, easing: SMOOTH.easing },
        );
    });
    if (show) appear(now);
    else if (ghost && el.isConnected) fadeAway(ghost, at, stats, from, shows);
  };
  let beat = 0;
  const set = (d: Use) => {
    week.set(d.spark);
    put(month, bytes(d.month[0] + d.month[1]));
    put(monthSub, `↓ ${bytes(d.month[1])} · ↑ ${bytes(d.month[0])}`);
    put(total, bytes(d.total[0] + d.total[1]));
    put(totalSub, `↓ ${bytes(d.total[1])} · ↑ ${bytes(d.total[0])}`);
  };
  set(d0);
  return {
    el,
    set,
    speed(v) {
      if (!v) {
        // gone: it fades where it stood, the tiles left glide to fill its place, the card folds (a phone's second row)
        if (!now.hidden) toggle(false);
        beat = 0;
        return;
      }
      if (v === 'wait') {
        // online but no reading this second (the meter's gap): the tile keeps its place and its last words
        if (now.hidden) {
          setText(down, '↓ —');
          setText(up, '↑ —');
          toggle(true);
          beat = 0;
        }
        return;
      }
      if (now.hidden) {
        // back in sight: said at once, plainly; the tile blurs in, the others make room, the card unfolds to it
        setText(down, `↓ ${rateOf(v[1])}`);
        setText(up, `↑ ${rateOf(v[0])}`);
        toggle(true);
        beat = 1;
        return;
      }
      if (beat++ % 3) return;
      put(down, `↓ ${rateOf(v[1])}`);
      put(up, `↑ ${rateOf(v[0])}`);
    },
  };
}
