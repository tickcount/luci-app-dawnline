// Rows edited in place (the concept's kit/edits.ts), the portal's option rows
// inside an open accordion row. A text row turns into its own field where its
// value stands, as the portal renames a device on its card (flows/rename.ts):
// in the value's font, the row keeping its size; the field grows leftwards
// from the row's right edge as it is typed in. The line under the row says how
// to finish (a keyboard: Return and Esc; a touch screen: its Done key), or, for
// a value that is a mode ("automatic", "as the server"), what empty means; in
// red what the row does not take, the words shaking. While the router answers
// the words shimmer. Esc, a press elsewhere or the focus gone put the value
// back. Each row says itself how it saves; a row whose change rewrites the
// device's configuration (⟳N on it) closes first and lets its owner ask.
// A switch row flips (the portal's .swrow). Read-only logins get the values
// as still rows (shell/role.ts).

import { h, ic } from '../../portal/dom';
import { EASE_IN, EASE_OUT, SMOOTH, still, play } from '../../portal/motion';
import { morphText } from '../../portal/ui/morph';
import { shimmer } from '../../portal/ui/shimmer';
import { shake } from '../../shared/shake';
import { glass } from './glass';
import { errorText } from './toast';
import { flippedNow } from '../../portal/ui/carry';

/** A value that is a mode, not a number: the field starts empty, its placeholder names the mode, the line says it. */
interface Mode {
  /** Shown on the row while the mode holds ("1280 · automatic"). */
  empty: string;
  /** The field's placeholder ("automatic"). */
  placeholder: string;
  /** The line under the row while it is edited ("1280–1500, or empty: automatic"). */
  says: string;
  /** The mode holds now. */
  on: boolean;
}

export interface TextRow {
  label: string;
  /** As the row shows it. */
  value: string;
  /** What the field starts with (the number without its unit); the value when not given. */
  start?: string;
  mono?: boolean;
  /** The row's own line under it, always shown. */
  hint?: string;
  /** ⟳N: devices that fetch their configuration again after this change. */
  re?: number;
  mode?: Mode;
  numeric?: boolean;
  /** No capitals or corrections from a phone's keyboard (names in the network, addresses). */
  plain?: boolean;
  /** Why `v` is refused, or null. */
  refuse(v: string): string | null;
  /**
   * Save `v` ('' = the mode): resolves with what the row shows now, or rejects with the router's reason (said in
   * red). With `ask`, the field closes first and `ask` runs instead (a question in a sheet); it saves itself.
   */
  save?(v: string): Promise<string>;
  ask?(v: string): void;
}

/** Ids for the lines under rows that say why a value was refused. */
let lines = 0;

/**
 * ⟳N: how many devices fetch their configuration again after this change (none: no mark). It stands at the right
 * end of what it belongs to: before a row's value or switch, at the end of a head or a caption.
 */
export function reMark(n: number): HTMLElement | null {
  if (!n) return null;
  const el = h('span', { class: 'reimp num', title: _('Devices fetch their configuration again after this change') }, ic('refresh'));
  el.dataset.n = String(n);
  el.append(String(n));
  return el;
}

/**
 * A line under a row says something else: its words morph (whole), and when they take another number of lines
 * its height glides there on SMOOTH, from where it stands.
 */
function retext(el: HTMLElement, text: string) {
  if (el.textContent === text) return;
  const from = el.getBoundingClientRect().height;
  const probe = el.cloneNode(false) as HTMLElement;
  probe.textContent = text;
  Object.assign(probe.style, {
    position: 'absolute',
    visibility: 'hidden',
    height: 'auto',
    width: `${el.getBoundingClientRect().width}px`,
  });
  el.parentElement!.append(probe);
  const to = probe.getBoundingClientRect().height;
  probe.remove();
  morphText(el, text, undefined, { whole: true });
  if (still() || Math.abs(to - from) < 1) return;
  el.getAnimations()
    .filter((a) => a.id === 'retext')
    .forEach((a) => a.cancel());
  const a = play(
    el,
    [
      { height: `${from}px`, overflow: 'hidden' },
      { height: `${to}px`, overflow: 'hidden' },
    ],
    {
      duration: SMOOTH.duration,
      easing: SMOOTH.easing,
    },
  );
  a.id = 'retext';
}

/** A still row: a name and its value (read-only, or a value the router makes). */
export const stillRow = (label: string, value: string, mono = false): HTMLElement =>
  h('div', { class: 'editrow static' }, h('span', {}, label), h('b', { class: mono ? 'mono' : '', title: value }, value));

/** A text row, edited in place; `write`: false draws it still (a read-only login). */
export function textRow(o: TextRow, write = true): HTMLElement {
  if (!write) return h('div', { class: 'ed' }, stillRow(o.label, o.value, o.mono), o.hint ? h('p', { class: 'ed-hint' }, o.hint) : null);
  const b = h('b', { class: o.mono ? 'mono' : '' }, o.value);
  const row = h(
    'button',
    { type: 'button', class: 'editrow', title: _('Change'), 'aria-label': `${o.label}: ${o.value}. ${_('Change')}` },
    h('span', {}, o.label),
    reMark(o.re ?? 0),
    b,
    ic('edit', 'i ed-ic'),
  ) as HTMLButtonElement;
  const own = o.hint ? h('p', { class: 'ed-hint' }, o.hint) : null;
  row.addEventListener('click', () => edit(o, row, b, own));
  return h('div', { class: 'ed' }, row, own);
}

function edit(o: TextRow, row: HTMLButtonElement, b: HTMLElement, own: HTMLElement | null) {
  const was = b.textContent ?? '';
  const mode = o.mode;
  const start = mode?.on ? '' : (o.start ?? was);
  const keepsMode = (v: string) => !!mode && (v === '' || v.toLowerCase() === mode.placeholder.toLowerCase());
  const fine = matchMedia('(pointer: fine)').matches;
  const input = h('input', {
    type: 'text',
    value: start,
    'aria-label': o.label,
    placeholder: mode?.placeholder ?? '',
    autocomplete: 'off',
    autocapitalize: o.plain ? 'none' : null,
    autocorrect: o.plain ? 'off' : null,
    spellcheck: 'false',
    enterkeyhint: 'done',
    inputmode: o.numeric ? 'numeric' : null,
    'data-1p-ignore': true,
  }) as HTMLInputElement;
  const ruler = h('span', { class: 'ed-ruler', 'aria-hidden': 'true' });
  const form = h('form', { class: 'field inline ed-f', autocomplete: 'off' }, input, ruler);
  const mark = row.querySelector('.reimp');
  const box = h(
    'div',
    { class: `editrow ed-live${row.classList.contains('stack') ? ' stack' : ''}` },
    h('span', {}, o.label),
    mark ? mark.cloneNode(true) : null,
    h('b', { class: b.className }, form),
    ic('edit', 'i ed-ic'),
  );
  box.style.minHeight = `${row.offsetHeight}px`;
  const ownWas = own?.textContent ?? '';
  // A mode says what empty means (that is what is new to learn); otherwise the keys, where there are keys.
  const how = mode?.says || (fine ? _('Enter: save, Esc: cancel') : '');
  let line: HTMLElement | null = own;
  const say = (text: string, bad = false) => {
    if (!line && text) {
      line = h('p', { class: 'ed-hint ed-tmp' });
      box.after(line);
      // A new line: its words set at once and its place opening to their height, 4 px under the row.
      line.textContent = text;
      const gap = parseFloat(getComputedStyle(box.parentElement!).rowGap) || 0;
      if (!still()) {
        play(
          line,
          [
            { height: '0px', marginTop: `${-gap}px` },
            { height: `${line.scrollHeight || 18}px`, marginTop: '0px' },
          ],
          {
            duration: SMOOTH.duration,
            easing: SMOOTH.easing,
          },
        );
        play(
          line,
          [
            { opacity: 0, transform: 'translateY(-4px)', filter: 'blur(4px)' },
            { opacity: 1, transform: 'none', filter: 'blur(0px)' },
          ],
          {
            duration: 220,
            easing: EASE_OUT,
          },
        );
      }
    }
    if (!line) return;
    line.classList.toggle('bad-t', bad);
    retext(line, text);
  };

  // The value's right edge before: the field's words start from there.
  const restRight = b.getBoundingClientRect().right;
  row.replaceWith(box);
  const fit = () => {
    ruler.textContent = input.value || input.placeholder || ' ';
    input.style.width = `${Math.ceil(ruler.getBoundingClientRect().width) + 6}px`;
  };
  fit();
  input.addEventListener('input', fit);
  if (!still()) {
    const dx = restRight - input.getBoundingClientRect().right;
    if (Math.abs(dx) > 0.5 && !box.classList.contains('stack'))
      play(form, [{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
  }
  // Focused inside the tap (iOS raises its keyboard only then), without scrolling.
  input.focus({ preventScroll: true });
  input.setSelectionRange(0, input.value.length);
  if (how) say(how);

  let saving = false;
  let done = false;
  const root = () => box.getRootNode() as Document | ShadowRoot;
  /** Back to the value; `key`: by Escape, at once (the keyboard never animates). */
  const finish = (then?: () => void, key = false) => {
    if (done) return;
    done = true;
    document.removeEventListener('pointerdown', away, true);
    const fieldRight = input.getBoundingClientRect().right;
    box.replaceWith(row);
    const flat = key || still();
    if (!flat) {
      const dx = fieldRight - b.getBoundingClientRect().right;
      if (Math.abs(dx) > 0.5)
        play(b, [{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
      const pen = row.querySelector('.ed-ic');
      if (pen) play(pen, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 80, easing: EASE_OUT, fill: 'backwards' });
    }
    if (line && line !== own) {
      const l = line;
      if (flat) l.remove();
      else {
        // it fades where it stands (from how it shows: it may still be coming in), then its space folds
        const h0 = l.offsetHeight;
        const cs = getComputedStyle(l);
        play(
          l,
          [
            { opacity: cs.opacity, transform: cs.transform, filter: cs.filter === 'none' ? 'blur(0px)' : cs.filter },
            { opacity: 0, transform: 'translateY(-4px)', filter: 'blur(4px)' },
          ],
          {
            duration: 180 * +cs.opacity,
            easing: EASE_IN,
            fill: 'forwards',
          },
        );
        play(
          l,
          [
            { height: `${h0}px`, overflow: 'clip' },
            { height: '0px', marginTop: '-4px', overflow: 'clip' },
          ],
          {
            duration: SMOOTH.duration,
            delay: 170,
            easing: SMOOTH.easing,
            fill: 'forwards',
          },
        ).onfinish = () => l.remove();
      }
    } else if (own) {
      own.classList.remove('bad-t');
      own.removeAttribute('role');
      retext(own, ownWas);
    }
    then?.();
  };
  const refuse = (why: string) => {
    say(why, true);
    // A screen reader hears it too: the field is invalid and described by the red line.
    input.setAttribute('aria-invalid', 'true');
    if (line) {
      line.id ||= `ed-why-${++lines}`;
      line.setAttribute('role', 'alert');
      input.setAttribute('aria-describedby', line.id);
    }
    shake(form, { ring: false });
    input.focus({ preventScroll: true });
  };
  const save = async () => {
    if (saving) return;
    const v = input.value.trim();
    if (v === start || (keepsMode(v) && mode?.on)) return finish(() => row.focus({ preventScroll: true }));
    const why = keepsMode(v) ? null : o.refuse(v);
    if (why) return refuse(why);
    const value = keepsMode(v) ? '' : v;
    if (o.ask) {
      const ask = o.ask;
      return finish(() => {
        row.focus({ preventScroll: true });
        ask(value);
      });
    }
    saving = true;
    input.readOnly = true;
    const stop = shimmer(form, input);
    try {
      const shown = await o.save!(value);
      await stop();
      saving = false;
      finish(() => {
        row.focus({ preventScroll: true });
        morphText(b, shown);
      });
    } catch (e) {
      await stop();
      saving = false;
      input.readOnly = false;
      refuse(errorText(e));
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void save();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || saving) return;
    e.preventDefault();
    e.stopPropagation();
    finish(() => row.focus({ preventScroll: true }), true);
  });
  // Typing again after a refusal: the line says how to finish again.
  input.addEventListener('input', () => {
    if (line?.classList.contains('bad-t')) {
      say(how || ownWas, false);
      input.removeAttribute('aria-invalid');
      line.removeAttribute('role');
    }
  });
  const away = (e: Event) => {
    if (saving || e.composedPath().includes(box)) return;
    finish();
  };
  document.addEventListener('pointerdown', away, true);
  input.addEventListener('blur', () =>
    setTimeout(() => {
      if (done || saving || !document.hasFocus() || box.contains(root().activeElement)) return;
      finish();
    }),
  );
}

/**
 * A switch flipped by hand while the router takes it: the knob goes over at once on its spring and a ring comes in on
 * it, as the busy orb does (whole by 410 ms), turning until the router answers (kit.css). The change is sent once the
 * knob is over, so the repaint its answer brings never cuts the move and finds the ring whole; refused, the knob goes
 * back on the same spring. Resolves with whether it took.
 */
export async function flipping(sw: HTMLElement, run: () => Promise<boolean>): Promise<boolean> {
  sw.classList.add('wait');
  try {
    if (!still()) await new Promise((r) => setTimeout(r, SMOOTH.duration));
    return await run().catch(() => false);
  } finally {
    sw.classList.remove('wait');
  }
}

/**
 * A switch row (the portal's .swrow) with an optional ⟳N glued to the title's last word. `flip` asks or saves and
 * resolves with whether it took; the switch moves at once and goes back if not.
 */
export function switchRow(
  o: { title: string; sub: string; on: boolean; icon: string; re?: number; flip(on: boolean): Promise<boolean> },
  write = true,
): HTMLElement {
  if (!write) return stillRow(o.title, o.on ? _('On') : _('Off'));
  const el = h(
    'button',
    { type: 'button', class: `swrow${o.on ? ' on' : ''}`, role: 'switch', 'aria-checked': String(o.on) },
    glass(o.icon, 'blue'),
    h('span', { class: 'sw-t' }, h('span', { class: 'sw-h' }, h('b', {}, o.title)), h('span', { class: 'sw-sub' }, o.sub)),
    // ⟳N at the row's right, before the switch (every row and head carries it there)
    reMark(o.re ?? 0),
    h('span', { class: 'sw' }),
  );
  let on = o.on;
  const set = (v: boolean) => {
    on = v;
    el.classList.toggle('on', v);
    el.setAttribute('aria-checked', String(v));
    flippedNow(el);
  };
  el.addEventListener('click', async () => {
    if (el.classList.contains('wait')) return;
    const next = !on;
    set(next);
    if (!(await flipping(el, () => o.flip(next)))) set(!next);
  });
  return el;
}
