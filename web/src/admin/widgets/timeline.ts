// The link timeline (the concept's kit/timeline.ts): whether a device worked,
// hour by hour, over 24 h / 7 days / 30 days, as a strip (the Places strips
// speak the same language): an 8 px track at text 8 %, the runs in their
// state's colour (in the network ok, failing warn, let in only to the
// portal and DNS bad), a tick where its
// configuration or access changed, the "now" marker at the right end. Above
// it, in the usage block's roles, one line that says since when it is the way
// it is; the pointer, a tap or the keys read a run in its place, at once
// (DESIGN.md: a hover readout never morphs); a new period morphs the line and
// crossfades the strip. What it draws is events/timeline.ts.

import { reshape, same } from '../ui/reshape';
import { h } from '../../portal/dom';
import { EASE_IN, EASE_OUT, play, still } from '../../portal/motion';
import { appear, morphText } from '../../portal/ui/morph';
import { duration, parseDay } from '../../shared/format';
import { fmt, locale } from '../../shared/i18n';
import { changedText, deviceChangedText, linkStateText, noteText } from '../events/model';
import { routerDay, routerTime } from '../events/clock';
import {
  SPAN,
  spanWords,
  summary,
  type LinkTimeline,
  type Run,
  type RunState,
  type Span,
  type Tick,
  type TimelineInput,
} from '../events/timeline';
import { tabs } from '../ui/tabs';
import { putChildren } from '../../portal/ui/put';

/** A router day as the axis and the readouts write it: "2 Nov". */
const dayLabel = (day: string): string => parseDay(day).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

/** What a moment on the strip is: a run, the gap between two, or a tick. */
type Piece = { k: 'run'; r: Run } | { k: 'gap'; a: number; b: number } | { k: 'tick'; t: Tick };
const start = (p: Piece) => (p.k === 'run' ? p.r.a : p.k === 'gap' ? p.a : p.t.t);
const end = (p: Piece, now: number) => (p.k === 'run' ? Math.min(p.r.b, now) : p.k === 'gap' ? p.b : p.t.t);
const mid = (p: Piece, now: number) => (start(p) + end(p, now)) / 2;

interface Words {
  lbl: string;
  val: string;
  tone: string;
  sub: string;
}

export interface TimelineWidget {
  el: HTMLElement;
  /** New data (the live page): drawn again in place, the picked run let go. */
  update(input: TimelineInput, t: LinkTimeline): void;
}

export function timelineWidget(first: TimelineInput, firstT: LinkTimeline, range: Span = '7d'): TimelineWidget {
  let input = first;
  let tl = firstT;
  let rng = range;
  const now = () => input.now;
  const tz = () => input.tz;
  const lbl = h('span', { class: 'use-lbl lt-lbl' });
  const val = h('b', { class: 'lt-val' });
  const sub = h('span', { class: 'lt-sub' });
  const track = tabs(
    (['24h', '7d', '30d'] as Span[]).map((s) => ({ id: s, label: { '24h': _('24h'), '7d': _('7 days'), '30d': _('30 days') }[s] })),
    range,
    (r) => {
      rng = r;
      // another period: the strip crosses whole and the card glides to its new height (a key, a line coming or
      // going), so what stands under it moves with it
      reshape(el, () => redraw());
    },
    { cls: 'range lt-range', label: _('Period') },
  );
  const viz = h('div', { class: 'lt-viz' });
  const el = h('div', { class: 'lt' }, h('div', { class: 'lt-top' }, h('div', { class: 'lt-txt' }, lbl, val, sub), track.el), viz);

  let pieces: Piece[] = [];
  let pinned: Piece | null = null;
  let band: HTMLElement = h('div');

  const hm = (t: number) => routerTime(t, tz());
  const day = (t: number) => dayLabel(routerDay(t, tz()));
  /** "2 Nov, 09:10–13:00", "2 Nov 09:10 – 4 Nov now". */
  const spanText = (a: number, b: number) => {
    const until = b >= now() - 60 ? _('now') : hm(b);
    return day(a) === day(b) ? `${day(a)}, ${hm(a)}–${until}` : `${day(a)} ${hm(a)} – ${day(b)} ${until}`;
  };
  const stateWords = (s: RunState): string =>
    s === 'warn'
      ? (linkStateText(input.device.link?.state ?? '')?.title ?? _('The connection failed'))
      : { ok: _('Online'), bad: _('Only the portal and the router’s DNS') }[s];
  const keyWords = (s: RunState): string =>
    s === 'warn' ? stateWords('warn').toLocaleLowerCase(locale()) : { ok: _('online'), bad: _('only the portal and DNS: the limit') }[s];
  /** A tick's words: what changed, and how. */
  const tickWords = (k: Tick): [string, string] => {
    if (k.sys) return [_('Its server’s settings changed'), k.sys.note ? noteText(k.sys.note) : (k.sys.who ?? '')];
    const e = k.ev!;
    if (e.type === 'device_keys') return [_('New keys'), ''];
    if (e.type === 'person_changed') return [_('The person’s access changed'), e.detail ? changedText(e.detail) : ''];
    return [_('Its settings changed'), e.detail ? deviceChangedText(e.detail) : ''];
  };

  const rest = (): Words => {
    const s = summary(tl, input, rng, dayLabel);
    return { lbl: fmt(_('Connection in the %s'), spanWords(rng)), val: s.value, tone: s.tone, sub: s.sub };
  };
  /** Words in place: a readout swaps at once; a new period or new data morphs (the line under it as whole words). */
  const tell = (w: Words, morph = false) => {
    for (const [e, t] of [
      [lbl, w.lbl],
      [val, w.val],
      [sub, w.sub],
    ] as const) {
      if (morph && e.textContent && e.textContent !== t) morphText(e, t, undefined, e === sub ? { whole: true } : {});
      else if (morph && t && !e.textContent) {
        // a line that was empty (no data yet): its words blur in while the card unfolds to it
        e.textContent = t;
        appear(e);
      } else if (e.textContent !== t) e.textContent = t;
    }
    val.className = `lt-val ${w.tone ? `${w.tone}-t` : ''}`;
  };
  const read = (p: Piece | null) => {
    band.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
    if (!p) {
      band.classList.remove('aim');
      const r = rest();
      band.setAttribute('aria-valuetext', `${r.val}. ${r.sub}`);
      return tell(r);
    }
    let w: Words;
    if (p.k === 'run')
      w = {
        lbl: spanText(p.r.a, p.r.b),
        val: stateWords(p.r.s),
        tone: p.r.s,
        sub: [p.r.where, duration(Math.min(p.r.b, now()) - p.r.a)].filter(Boolean).join(' · '),
      };
    else if (p.k === 'gap') w = { lbl: spanText(p.a, p.b), val: _('Offline'), tone: '', sub: duration(p.b - p.a) };
    else {
      const [title, line] = tickWords(p.t);
      w = { lbl: `${day(p.t.t)}, ${hm(p.t.t)}`, val: title, tone: '', sub: line };
    }
    tell(w);
    band.setAttribute('aria-valuetext', `${w.lbl}: ${w.val}. ${w.sub}`);
    band.querySelector(`[data-i="${pieces.indexOf(p)}"]`)?.classList.add('on');
  };

  function draw(): HTMLElement {
    const n = now();
    const from = n - SPAN[rng];
    const x = (t: number) => ((Math.max(from, Math.min(n, t)) - from) / SPAN[rng]) * 100;
    const runs = tl.runs.filter((r) => r.b > from && r.a < n).map((r) => ({ ...r, a: Math.max(r.a, from) }));
    // The period as pieces in time order: runs, the gaps between them (over 10 minutes), ticks.
    pieces = [];
    let t = from;
    for (const r of runs) {
      if (r.a - t > 10 * 60) pieces.push({ k: 'gap', a: t, b: r.a });
      pieces.push({ k: 'run', r });
      t = Math.max(t, Math.min(r.b, n));
    }
    if (n - t > 10 * 60) pieces.push({ k: 'gap', a: t, b: n });
    for (const k of tl.ticks.filter((k) => k.t > from && k.t <= n)) pieces.push({ k: 'tick', t: k });
    pieces.sort((p, q) => start(p) - start(q));
    band = h('div', {
      class: 'lt-band',
      tabindex: '0',
      role: 'slider',
      'aria-label': fmt(_('Connection in the %s: ← → by stretch'), spanWords(rng)),
      'aria-valuemin': '0',
      'aria-valuemax': '100',
    });
    pieces.forEach((p, i) => {
      if (p.k === 'run') {
        const s = h('i', { class: `lt-s ${p.r.s}`, 'data-i': String(i) });
        s.style.left = `${x(p.r.a)}%`;
        s.style.width = `${x(p.r.b) - x(p.r.a)}%`;
        band.append(s);
      } else if (p.k === 'tick') {
        const k = h('i', { class: 'lt-k', 'data-i': String(i) });
        k.style.left = `${x(p.t.t)}%`;
        band.append(k);
      }
    });
    band.append(h('i', { class: 'lt-now', 'aria-hidden': 'true' }));
    const axis = h('div', { class: 'lt-axis num', 'aria-hidden': 'true' });
    // Marks at the router's midnights (every 6 h in a day; Mondays in a month).
    const today = routerDay(n, tz());
    const midnight = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000 - (tz() ?? -new Date().getTimezoneOffset()) * 60;
    const m0 = midnight(today);
    const marks: [number, string][] = [];
    if (rng === '24h') {
      for (let k = m0 - 86400; k < n; k += 6 * 3600) if (k > from) marks.push([k, routerTime(k, tz()) === '00:00' ? day(k) : hm(k)]);
    } else if (rng === '7d') {
      for (let k = m0 - 6 * 86400; k < n; k += 86400) marks.push([k, day(k)]);
    } else {
      for (let k = m0 - 35 * 86400; k < n; k += 86400) if (k > from && parseDay(routerDay(k, tz())).getDay() === 1) marks.push([k, day(k)]);
    }
    for (const [k, w] of marks) {
      const s = h('span', {}, w);
      s.style.left = `${x(k)}%`;
      axis.append(s);
    }
    axis.append(h('span', { class: 'last' }, _('now')));
    const has = new Set(runs.map((r) => r.s));
    const ticks = tl.ticks.some((k) => k.t > from && k.t <= n);
    const key = h(
      'div',
      { class: 'lt-key' },
      ...(['ok', 'warn', 'bad'] as RunState[]).filter((s) => has.has(s)).map((s) => h('span', {}, h('i', { class: s }), keyWords(s))),
      ticks ? h('span', {}, h('i', { class: 'k' }), _('settings changed')) : null,
      // A period with no session at all says so where the legend would be.
      !has.size && !ticks ? h('span', { class: 'none' }, _('No connections in this period')) : null,
    );
    wire(band);
    return h('div', { class: 'lt-v' }, band, axis, key);
  }

  /** The axis keeps its last word ("now") clear: a date within 6 px of it or of the one before goes (measured). */
  const tidy = (v: HTMLElement) => {
    if (v.classList.contains('leaving')) return;
    const axis = v.querySelector<HTMLElement>('.lt-axis');
    const last = axis?.querySelector<HTMLElement>('.last');
    if (!axis || !last || !axis.offsetWidth) return;
    const edge = last.getBoundingClientRect().left - 6;
    let prev = -Infinity;
    for (const s of axis.querySelectorAll<HTMLElement>('span:not(.last)')) {
      const r = s.getBoundingClientRect();
      const hide = r.right > edge || r.left < prev + 6;
      s.style.visibility = hide ? 'hidden' : '';
      if (!hide) prev = r.right;
    }
  };

  function wire(b: HTMLElement) {
    const at = (e: PointerEvent): Piece | null => {
      const r = b.getBoundingClientRect();
      const f = (e.clientX - r.left) / r.width;
      const n = now();
      const t = n - SPAN[rng] + f * SPAN[rng];
      b.style.setProperty('--hx', `${Math.max(0, Math.min(1, f)) * 100}%`);
      const tick = pieces.find(
        (p) => p.k === 'tick' && Math.abs(((p.t.t - (n - SPAN[rng])) / SPAN[rng]) * r.width - (e.clientX - r.left)) <= 6,
      );
      return tick ?? pieces.find((p) => p.k !== 'tick' && start(p) <= t && t <= end(p, n)) ?? null;
    };
    b.addEventListener('pointermove', (e) => {
      if (pinned) return;
      b.classList.add('aim');
      read(at(e));
    });
    b.addEventListener('pointerleave', () => !pinned && read(null));
    b.addEventListener('pointerdown', (e) => {
      const p = at(e);
      pinned = pinned === p ? null : p;
      b.classList.toggle('aim', !!pinned || e.pointerType === 'mouse');
      read(pinned ?? (e.pointerType === 'mouse' ? p : null));
    });
    b.addEventListener('keydown', (e) => {
      const cur = pinned ? pieces.indexOf(pinned) : pieces.length;
      let i = -1;
      if (e.key === 'ArrowLeft') i = Math.max(0, cur - 1);
      else if (e.key === 'ArrowRight') i = pinned ? Math.min(pieces.length - 1, cur + 1) : pieces.length - 1;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = pieces.length - 1;
      else if (e.key === 'Escape' && pinned) {
        pinned = null;
        read(null);
        e.stopPropagation();
        return e.preventDefault();
      } else return;
      if (!pieces.length) return;
      e.preventDefault();
      pinned = pieces[i];
      b.style.setProperty('--hx', `${((mid(pinned, now()) - (now() - SPAN[rng])) / SPAN[rng]) * 100}%`);
      b.classList.add('aim');
      read(pinned);
    });
  }
  // A tap elsewhere lets go of a picked run (read along the path: the page is in a shadow root).
  const away = (e: Event) => {
    if (!el.isConnected) return document.removeEventListener('pointerdown', away);
    if (pinned && !e.composedPath().includes(band)) {
      pinned = null;
      read(null);
    }
  };
  document.addEventListener('pointerdown', away);

  /** A new period or new data: the old strip fades where it stands while the new one blurs in over it. */
  function redraw(first = false, made?: HTMLElement) {
    pinned = null;
    const olds = [...viz.children].filter((x) => !x.classList.contains('leaving')) as HTMLElement[];
    const v = made ?? draw();
    if (olds.length && !first && !still()) {
      for (const old of olds) {
        const cs = getComputedStyle(old);
        const from = { opacity: cs.opacity, filter: cs.filter === 'none' ? 'blur(0px)' : cs.filter };
        old.getAnimations().forEach((a) => a.cancel());
        old.classList.add('leaving');
        Object.assign(old.style, { position: 'absolute', inset: '0 0 auto 0', pointerEvents: 'none' });
        old.setAttribute('aria-hidden', 'true');
        old.querySelector('.lt-band')?.removeAttribute('tabindex');
        play(old, [from, { opacity: 0, filter: 'blur(4px)' }], {
          duration: 180 * +from.opacity,
          easing: EASE_IN,
          fill: 'forwards',
        }).onfinish = () => old.remove();
      }
      viz.append(v);
      play(
        v,
        [
          { opacity: 0, filter: 'blur(4px)' },
          { opacity: 1, filter: 'blur(0px)' },
        ],
        { duration: 280, delay: 60, easing: EASE_OUT, fill: 'backwards' },
      );
    } else putChildren(viz, [v]);
    requestAnimationFrame(() => tidy(v));
    tell(rest(), !first);
    band.setAttribute('aria-valuetext', `${rest().val}. ${rest().sub}`);
  }
  redraw(true);
  new ResizeObserver(() => viz.lastElementChild && tidy(viz.lastElementChild as HTMLElement)).observe(viz);
  return {
    el,
    update(i, t) {
      const unchanged =
        JSON.stringify(t) === JSON.stringify(tl) && i.device.online === input.device.online && !!i.device.link === !!input.device.link;
      input = i;
      tl = t;
      // While a run is picked the strip stays as it is; the next update after it is let go redraws it.
      if (unchanged || pinned) {
        if (!pinned) tell(rest());
        return;
      }
      // The strip as one (DESIGN: a new period or new data crosses whole): the old strip fades where it stands as
      // the new one blurs in over it, never run by run; the words morph; the card glides to its new height. The
      // same strip (nothing it shows moved): put in, still.
      const next = draw();
      const cur = viz.lastElementChild as HTMLElement | null;
      if (cur && same(cur.outerHTML, next.outerHTML))
        reshape(el, () => {
          cur.replaceWith(next);
          tell(rest(), true);
        });
      else reshape(el, () => redraw(false, next));
      requestAnimationFrame(() => viz.lastElementChild && tidy(viz.lastElementChild as HTMLElement));
    },
  };
}
