// A value on a scale: a number picked by dragging between two ends, with the values worth knowing marked
// and named under the track (a default, a limit of a protocol). The knob follows the pointer 1:1 (a handle, one of
// the things that move in the admin), steps by `step`, and holds onto a mark within 8 px of it; arrows step it,
// Page keys by five steps, Home and End reach the ends.
//
// It moves as a slider of iOS does (the owner, 2026-11-12: «сделай в стиле ios анимации движения»): the knob's place
// is a spring worked out every frame, never a transition, so whatever it is asked next it goes on from where it
// stands with the speed it has. Under the pointer the spring is stiff and has no give: the knob is on the finger
// within a frame or two and the steps between values are smoothed, not jumped. A value set from outside («Auto», a
// number typed; the part is drawn again then, and the new knob takes the old one's place and speed) rides a softer
// one, also without give. The knob never goes past where it is headed (the owner, 2026-11-12: «убери у слайдера
// овершут»): neither spring overshoots by itself, and a knob that arrives with speed of its own (let go mid-move)
// stops on its value instead of crossing it. The keyboard and less motion asked for put it there at once.

import { h } from '../../portal/dom';
import { calm } from '../../portal/motion';
import { replaces, turn } from '../../portal/ui/carry';

/** A spring as stiffness and damping (mass 1), on the knob's place as a share of the track. */
type Spring = readonly [k: number, c: number];
/** Under the pointer: critically damped, there in about 90 ms. */
const FOLLOW: Spring = [1400, 75];
/** Set from outside: the house's SMOOTH (300 / 35, critically damped: no give). */
const SETTLE: Spring = [300, 35];

/** Where each slider's knob stands and how fast it moves, for the one a repaint builds in its place. */
const moving = new WeakMap<HTMLElement, { pos: number; vel: number }>();

interface Mark {
  at: number;
  label: string;
}

export interface RangeOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  marks: Mark[];
  idle?: boolean;
  ghost?: number | null;
  write: boolean;
  /** Its name among the controls on screen (ui/carry.ts): built again by a repaint, it glides from where the last one stood. */
  keep?: string;
  /** While dragged. */
  input?(v: number): void;
  /** Let go on a value, or stepped from the keyboard. */
  commit(v: number): void;
}

export function range(o: RangeOpts): HTMLElement {
  let v = o.value;
  const share = (x: number) => (x - o.min) / (o.max - o.min);
  const pct = (x: number) => `${share(x) * 100}%`;
  const fill = h('i', { class: 'kt-rg-fill' });
  const knob = h('i', { class: 'kt-rg-knob' });
  const ghost = o.ghost != null ? h('i', { class: 'kt-rg-ghost' }) : null;
  if (ghost) ghost.style.left = pct(o.ghost!);
  const track = h(
    'div',
    { class: 'kt-rg-track' },
    fill,
    ...o.marks.map((m) => {
      const d = h('i', { class: 'kt-rg-dot' });
      d.style.left = pct(m.at);
      return d;
    }),
    ghost,
    knob,
  );
  const scale = h(
    'div',
    { class: 'kt-rg-scale', 'aria-hidden': 'true' },
    ...o.marks.map((m, i) => {
      const s = h(
        'span',
        { class: `kt-rg-m${i === 0 ? ' first' : i === o.marks.length - 1 ? ' last' : ''}` },
        h('b', { class: 'num' }, String(m.at)),
        h('span', {}, m.label),
      );
      s.style.left = pct(m.at);
      return s;
    }),
  );
  const el = h(
    'div',
    {
      class: `kt-rg${o.idle ? ' idle' : ''}`,
      role: 'slider',
      tabindex: o.write ? '0' : null,
      'aria-label': o.label,
      'aria-valuemin': String(o.min),
      'aria-valuemax': String(o.max),
      'aria-disabled': o.write ? null : 'true',
    },
    track,
    scale,
  );
  // the knob's place on the track (0–1), its speed (shares a second) and where it is headed
  const at0 = { pos: share(v), vel: 0 };
  moving.set(el, at0);
  let goal = at0.pos;
  let frame = 0;
  const put = () => {
    fill.style.width = `${at0.pos * 100}%`;
    knob.style.left = `${at0.pos * 100}%`;
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  // the spring the knob rides now, the side of its value it set off from, and when it was last moved
  let spring: Spring = SETTLE;
  let side = 0;
  let last = 0;
  const step = (now: number) => {
    const [k, c] = spring;
    // short steps: a spring this stiff is not stable over a long frame
    let left = Math.min(0.05, (now - last) / 1000);
    last = now;
    while (left > 0) {
      const dt = Math.min(left, 0.004);
      left -= dt;
      at0.vel += (-k * (at0.pos - goal) - c * at0.vel) * dt;
      at0.pos += at0.vel * dt;
    }
    // it never comes out on the other side of its value
    const there = side !== 0 && Math.sign(at0.pos - goal) !== side;
    if (there || (Math.abs(at0.pos - goal) < 0.0004 && Math.abs(at0.vel) < 0.004)) {
      at0.pos = goal;
      at0.vel = 0;
      frame = 0;
      return put();
    }
    put();
    frame = requestAnimationFrame(step);
  };
  /**
   * Head for `goal` on `sp` from where the knob stands, with the speed it has. One clock for the whole move: a new
   * goal (the pointer moved on) changes where the knob is headed, never when it was last moved. Begun anew on every
   * move of the pointer, the clock stood at zero for as long as the pointer kept moving, and the knob with it
   * (the owner, 2026-11-12: «когда слайдер зажимаешь рукой он стоит на месте»).
   */
  const ride = (sp: Spring) => {
    spring = sp;
    side = Math.sign(at0.pos - goal);
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(step);
  };
  /** The value is `v` now: said to a screen reader and on the scale, and the knob goes there (`spring`: null, at once). */
  const draw = (spring: Spring | null = null) => {
    goal = share(v);
    el.setAttribute('aria-valuenow', String(v));
    scale.querySelectorAll('.kt-rg-m').forEach((m, i) => m.classList.toggle('at', o.marks[i].at === v));
    if (spring && !calm() && el.isConnected) return ride(spring);
    stop();
    at0.pos = goal;
    at0.vel = 0;
    put();
  };
  // from where the one it replaces stands and as fast as it moves (pressed a moment ago, or sent to «Auto»), and as
  // that one looks (set by hand or automatic)
  const was = o.keep ? replaces(`range:${o.keep}`, el) : null;
  const old = was ? moving.get(was) : null;
  if (was && old && !calm() && (Math.abs(old.pos - share(v)) > 0.001 || Math.abs(old.vel) > 0.004)) {
    at0.pos = old.pos;
    at0.vel = old.vel;
    put();
    goal = share(v);
    el.setAttribute('aria-valuenow', String(v));
    scale.querySelectorAll('.kt-rg-m').forEach((m, i) => m.classList.toggle('at', o.marks[i].at === v));
    const idle = was.classList.contains('idle');
    if (idle !== !!o.idle)
      turn(
        el,
        () => el.classList.toggle('idle', idle),
        () => el.classList.toggle('idle', !!o.idle),
      );
    // once it is in the page (a frame is asked for only then)
    requestAnimationFrame(() => ride(SETTLE));
  } else draw();
  if (!o.write) return el;
  const clamp = (x: number) => Math.min(o.max, Math.max(o.min, x));
  const at = (x: number): number => {
    const r = track.getBoundingClientRect();
    const raw = o.min + ((x - r.left) / r.width) * (o.max - o.min);
    const near = o.marks.find((m) => Math.abs(((m.at - o.min) / (o.max - o.min)) * r.width - (x - r.left)) <= 8);
    return clamp(near ? near.at : Math.round(raw / o.step) * o.step);
  };
  const take = (n: number, spring: Spring | null) => {
    v = n;
    el.classList.remove('idle');
    draw(spring);
    o.input?.(v);
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    el.setPointerCapture(e.pointerId);
    el.classList.add('held');
    take(at(e.clientX), FOLLOW);
    const move = (m: PointerEvent) => take(at(m.clientX), FOLLOW);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.classList.remove('held');
      o.commit(v);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up, { once: true });
    el.addEventListener('pointercancel', up, { once: true });
  });
  el.addEventListener('keydown', (e) => {
    const by: Record<string, number> = {
      ArrowLeft: -o.step,
      ArrowDown: -o.step,
      ArrowRight: o.step,
      ArrowUp: o.step,
      PageDown: -5 * o.step,
      PageUp: 5 * o.step,
    };
    const n = e.key === 'Home' ? o.min : e.key === 'End' ? o.max : e.key in by ? clamp(v + by[e.key]) : null;
    if (n == null) return;
    e.preventDefault();
    // the keyboard never animates
    take(n, null);
    o.commit(v);
  });
  return el;
}
