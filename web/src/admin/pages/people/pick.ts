// Picking several people (the concept's screens/pick.ts), for the few things
// the admin does to several at once: a month more, pause, resume. «Select» in
// the bar, or a card held for 450 ms (the hold is honest: the card's fill
// deepens linearly while it is held, and lets go fast), turns the list into
// picking: each person's face gives way to a round mark in its place, the
// cards' own actions step aside, and a glass dock rises from under the window's
// edge (in the layer, shell/layer.ts) with the count and the actions. A press
// on a card picks it; a press on a mark and a slide over the others picks a run
// of cards (as iOS Photos does); a group head picks or lets go its whole group. An action asks
// nothing: one people_update for everyone (all or nothing), a toast with Undo
// that puts everyone back with one more, and the dock gives its place to the
// toast. Writes, so only where the login writes (index.ts decides).

import type { Person } from '../../../shared/types';
import { api, type PeopleChange } from '../../api';
import { h } from '../../../portal/dom';
import { morphText } from '../../../portal/ui/morph';
import { POP, play } from '../../../portal/motion';
import { dockIn, dockOut } from '../../ui/dock';
import { layer } from '../../../portal/ui/layer';
import { sheetOpen } from '../../../portal/ui/sheet';
import { fmt, plural } from '../../../shared/i18n';
import { ic } from '../../ui/icons';
import { onNavigate } from '../../ui/nav';
import { errorText, notify } from '../../ui/toast';
import { say } from '../../shell/toast';
import { extendAll, pauseAll, resumes, type Bulk } from '../../people/bulk';

const HOLD = 450;
const CARD = 'section.grp .pp-card[data-id]';

export interface PickCtx {
  /** The people as the router has them now. */
  people(): Person[];
  today(): string;
  /** Read the router again and draw what changed. */
  reload(): Promise<void>;
}

export interface Pick {
  /** Cards drawn since (a repaint, a search) take the picking's state. */
  adopt(): void;
  /** Picking now: the page keeps its cards where they are. */
  picking(): boolean;
  /** Stop picking at once (a page opens in the list's place). */
  leave(): void;
}

/** Picking over `root` (People's groups): the bar's `.pk-toggle`, each group head's `.pk-all`, each `.pp-card[data-id]`. */
export function pickPeople(root: HTMLElement, toggle: HTMLButtonElement, c: PickCtx): Pick {
  const byId = () => new Map(c.people().map((p) => [p.id, p]));
  root.classList.add('pk');
  const rowsAll = () => [...root.querySelectorAll<HTMLElement>(CARD)];
  const picked = new Set<string>();
  let picking = false;
  const toggleWords = toggle.querySelector<HTMLElement>('span')!;

  // ── the dock ──
  const n = h('span', { class: 'pk-n num', 'aria-live': 'polite' }, fmt(_('Selected: %s'), 0));
  const pauseW = h('span', {}, _('Pause'));
  const pause = h('button', { type: 'button', class: 'btn soft sm pk-pause' }, ic('pause'), pauseW) as HTMLButtonElement;
  const extend = h(
    'button',
    { type: 'button', class: 'btn accent sm pk-ext', title: _('A month on from the end date (or from today once it has passed)') },
    ic('calendar'),
    h('span', {}, _('Extend')),
  ) as HTMLButtonElement;
  const x = h('button', { type: 'button', class: 'knob pk-x', 'aria-label': _('Cancel selection'), title: _('Cancel selection') }, ic('x'));
  const dock = h(
    'div',
    { class: 'kt-dock pk-dock', role: 'toolbar', 'aria-label': _('Actions with the selected') },
    x,
    n,
    h('span', { class: 'pk-sp' }),
    pause,
    extend,
  );

  const chosen = () => {
    const m = byId();
    return [...picked].map((id) => m.get(id)).filter((p): p is Person => !!p);
  };
  const sync = () => {
    const ps = chosen();
    const words = fmt(_('Selected: %s'), ps.length);
    if (n.textContent !== words) morphText(n, words);
    pause.disabled = !ps.length;
    const resume = resumes(ps);
    const pw = resume ? _('Resume') : _('Pause');
    if (pauseW.textContent !== pw) {
      morphText(pauseW, pw);
      // its icon turns in as the portal's check after a copy (POP from s.6, b3)
      const i = ic(resume ? 'play' : 'pause');
      pause.querySelector('.i')?.replaceWith(i);
      play(
        i,
        [
          { opacity: 0, transform: 'scale(.6)', filter: 'blur(3px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0px)' },
        ],
        { duration: POP.duration, easing: POP.easing },
      );
    }
    // Nobody picked has an end date: nothing to extend.
    extend.disabled = !ps.some((p) => p.expires);
    for (const sec of root.querySelectorAll<HTMLElement>('section.grp')) {
      const ids = [...sec.querySelectorAll<HTMLElement>('.pp-card[data-id]')].map((r) => r.dataset.id!);
      const w = ids.length && ids.every((id) => picked.has(id)) ? _('Clear') : _('Select all');
      const s = sec.querySelector<HTMLElement>('.pk-all span');
      if (s && s.textContent !== w) morphText(s, w);
    }
  };
  const set = (r: HTMLElement, on: boolean) => {
    const id = r.dataset.id!;
    if (on) picked.add(id);
    else picked.delete(id);
    r.classList.toggle('picked', on);
    if (picking) r.querySelector('.dev-a')?.setAttribute('aria-checked', String(on));
  };

  /** While picking, each card's role and state (its name is the checkbox; its buttons and links step aside). */
  const adopt = () => {
    for (const r of rowsAll()) {
      const a = r.querySelector('.dev-a');
      if (!a || !picking) continue;
      a.setAttribute('role', 'checkbox');
      a.setAttribute('aria-checked', String(picked.has(r.dataset.id!)));
      r.classList.toggle('picked', picked.has(r.dataset.id!));
      r.querySelectorAll<HTMLElement>('.pp-act, .knob, .pp-tile, .pp-found').forEach((b) => (b.tabIndex = -1));
    }
    // Someone gone from the list (removed elsewhere) is not picked any more.
    const shown = new Set(rowsAll().map((r) => r.dataset.id!));
    for (const id of picked) if (!shown.has(id)) picked.delete(id);
    if (picking) sync();
  };
  adopt();

  function enter() {
    if (picking) return;
    picking = true;
    root.classList.add('picking');
    morphText(toggleWords, _('Done'));
    toggle.setAttribute('aria-pressed', 'true');
    adopt();
    root.querySelectorAll<HTMLElement>('.pk-all').forEach((b) => (b.tabIndex = 0));
    sync();
    dockIn(dock);
  }
  function leave(now = false) {
    if (!picking) return;
    if (now) root.classList.add('pk-instant');
    root.classList.remove('picking');
    for (const r of rowsAll()) {
      set(r, false);
      const a = r.querySelector('.dev-a');
      a?.removeAttribute('role');
      a?.removeAttribute('aria-checked');
      r.querySelectorAll<HTMLElement>('.pp-act, .knob, .pp-tile, .pp-found').forEach((b) => b.removeAttribute('tabindex'));
    }
    picking = false;
    root.querySelectorAll<HTMLElement>('.pk-all').forEach((b) => (b.tabIndex = -1));
    toggle.setAttribute('aria-pressed', 'false');
    picked.clear();
    if (now) {
      toggleWords.textContent = _('Select');
      dock.getAnimations().forEach((a) => a.cancel());
      dock.remove();
      requestAnimationFrame(() => root.classList.remove('pk-instant'));
      return;
    }
    morphText(toggleWords, _('Select'));
    dockOut(dock, () => picking);
  }

  toggle.addEventListener('click', () => (picking ? leave() : enter()));
  x.addEventListener('click', () => leave());
  // The keyboard never animates: Escape lets go at once (a sheet or a menu over it takes it first).
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && picking && !e.defaultPrevented && !sheetOpen() && !layer().querySelector('.drop')) leave(true);
  };
  document.addEventListener('keydown', esc);
  const off = onNavigate(() => {
    document.removeEventListener('keydown', esc);
    dock.remove();
    off();
  });

  // A card picked by a click (its links go nowhere while picking), Space or Enter; a group head picks its group.
  // Capture: before the links and the card's own buttons.
  root.addEventListener(
    'click',
    (e) => {
      // the click that ends a hold is the hold's (below)
      if (!picking || swallow) return;
      const t = e.target as HTMLElement;
      if (t.closest('.pk-all') || !t.closest(CARD)) return;
      e.preventDefault();
      e.stopPropagation();
      pickAt(e, t);
    },
    true,
  );
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const all = t.closest<HTMLElement>('.pk-all');
    if (all && picking) {
      const rs = [...all.closest('section')!.querySelectorAll<HTMLElement>('.pp-card[data-id]')];
      const on = !rs.every((r) => picked.has(r.dataset.id!));
      rs.forEach((r) => set(r, on));
      return sync();
    }
  });
  function pickAt(e: Event, t: HTMLElement) {
    const r = t.closest<HTMLElement>(CARD);
    if (!r) return;
    // The mark picks on press (and by sliding), not again on its click.
    if (t.closest('.pk-ck') && (e as MouseEvent).detail) return;
    set(r, !picked.has(r.dataset.id!));
    sync();
  }
  root.addEventListener('keydown', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('.dev-a');
    if (!picking || !a || e.key !== ' ') return;
    e.preventDefault();
    a.click();
  });

  // ── hold a row to start picking (touch and mouse alike) ──
  let hold = 0;
  let held: HTMLElement | null = null;
  let swallow = false;
  let at0 = { x: 0, y: 0 };
  const drop = () => {
    clearTimeout(hold);
    held?.classList.remove('holding');
    held = null;
  };
  root.addEventListener('pointerdown', (e) => {
    swallow = false;
    const r = (e.target as HTMLElement).closest<HTMLElement>(CARD);
    if (picking || !r || (e.target as HTMLElement).closest('button, .pp-tile, .pp-found') || e.button > 0 || !e.isPrimary) return;
    held = r;
    at0 = { x: e.clientX, y: e.clientY };
    r.classList.add('holding');
    hold = window.setTimeout(() => {
      const row = held;
      drop();
      if (!row) return;
      swallow = true;
      navigator.vibrate?.(8);
      enter();
      set(row, true);
      sync();
    }, HOLD);
  });
  root.addEventListener('pointermove', (e) => {
    if (held && Math.hypot(e.clientX - at0.x, e.clientY - at0.y) > 10) drop();
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) root.addEventListener(ev, () => held && drop());
  // No system menu over a held row (the link's long-press menu), and none while picking.
  root.addEventListener('contextmenu', (e) => {
    if ((picking || held || swallow) && (e.target as HTMLElement).closest('.pp-card')) e.preventDefault();
  });
  // The click that ends a hold is not a click on the row (a touch may end without one: the next press clears it).
  root.addEventListener(
    'click',
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  // ── press a mark and slide: the rows between the first and the one under the finger take the first one's new
  // state; rows the run leaves again go back to what they were ──
  let drag: { from: number; to: number; on: boolean; was: Set<string> } | null = null;
  const scope = () => root.getRootNode() as ShadowRoot | Document;
  root.addEventListener('pointerdown', (e) => {
    const ck = (e.target as HTMLElement).closest<HTMLElement>('.pk-ck');
    if (!picking || !ck || e.button > 0) return;
    e.preventDefault();
    const list = rowsAll();
    const i = list.indexOf(ck.closest<HTMLElement>('.pp-card')!);
    if (i < 0) return;
    drag = { from: i, to: i, on: !picked.has(list[i].dataset.id!), was: new Set(picked) };
    try {
      ck.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer the browser no longer tracks: the slide still follows the moves it sees */
    }
    paint();
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = scope().elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(CARD);
    const i = r ? rowsAll().indexOf(r) : -1;
    if (i >= 0 && i !== drag.to) {
      drag.to = i;
      paint();
    }
  });
  for (const ev of ['pointerup', 'pointercancel'] as const) root.addEventListener(ev, () => (drag = null));
  function paint() {
    if (!drag) return;
    const [a, b] = [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)];
    rowsAll().forEach((r, k) => set(r, k >= a && k <= b ? drag!.on : drag!.was.has(r.dataset.id!)));
    sync();
  }

  // ── the actions: one change for everyone, said with its Undo ──
  const send = async (list: PeopleChange[]) => {
    try {
      await api.peopleUpdate(list);
      return true;
    } catch (e) {
      notify(errorText(e), 'error', 10000);
      return false;
    }
  };
  const run = async (b: Bulk, done: string, undone: string) => {
    if (!b.changes.length) return leave();
    if (!(await send(b.changes))) return;
    leave();
    void c.reload();
    say(done, { undo: () => void send(b.undo).then((ok) => void (ok && c.reload())), undone });
  };
  const people_ = (k: number) => plural(k, '%s person', '%s people');
  extend.addEventListener('click', () => {
    const b = extendAll(chosen(), c.today());
    void run(b, fmt(_('Extended: %s'), people_(b.changes.length)), _('Extension undone'));
  });
  pause.addEventListener('click', () => {
    const resume = resumes(chosen());
    const b = pauseAll(chosen(), !resume);
    void run(
      b,
      resume ? fmt(_('Resumed: %s'), people_(b.changes.length)) : fmt(_('Paused: %s'), people_(b.changes.length)),
      resume ? _('Paused again') : _('Pause lifted'),
    );
  });

  return { adopt, picking: () => picking, leave: () => leave(true) };
}
