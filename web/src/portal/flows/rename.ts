// Renaming a device where its name stands on the card: a click on the name (or Rename in its ⋯ menu) turns it
// into its own input, in the name's font and place, with nothing around it but the field's caret and selection
// (ui/caret.ts), the name selected. The status line under it blurs across to how to finish. Return saves: the words
// shimmer while the router answers (ui/shimmer.ts), settle, and the card is drawn again with the new name, its
// status blurring back from the hint. Esc or a click away puts the name it had back, whatever was typed. What the
// router won't take never gets in (shared/name-guard.ts): the words shake and the status line says why in red; the
// router's own refusals (a name taken) say so the same way.

import type { Device } from '../../shared/types';
import { guardDeviceName } from '../../shared/name-guard';
import { shake } from '../../shared/shake';
import { call } from '../api';
import { h } from '../dom';
import { repaint, setState, state, type State } from '../state';
import { smoothCaret } from '../ui/caret';
import { morphText, textOf } from '../ui/morph';
import { shimmer } from '../ui/shimmer';

/** The status line's colours (page/devices.ts), and the red of a refusal. */
const TONES = ['ok-t', 'warn-t', 'here-t', 'bad-t'];

/**
 * The status line says something else in another tone: the hint or a refusal stands in for the status, so the
 * words blur across whole (not letter by letter) and the colour turns from the one it had. Marked `data-whole`
 * meanwhile: the repaint after a save brings the status back the same way. Only the tone classes change hands: a
 * morph under way keeps its own.
 */
function say(stat: HTMLElement, text: string, tone: string, title = text) {
  const color = getComputedStyle(stat).color;
  for (const t of TONES) stat.classList.toggle(t, t === tone);
  // The line is one line: a long reason (the router's own) reads in full on hover.
  stat.title = title;
  stat.dataset.whole = '';
  morphText(stat, text, undefined, { color, whole: true });
}

/**
 * Focus given back to the name without its ring: the browser would draw it (the last thing done was typing), but
 * nobody moved there. The ring is the name's again once focus leaves it, for a Tab that does.
 */
function quietFocus(el: HTMLElement | null) {
  if (!el) return;
  el.classList.add('quiet');
  el.addEventListener('blur', () => el.classList.remove('quiet'), { once: true });
  el.focus({ preventScroll: true });
}

let editing: { id: string; cancel: () => void } | null = null;

/** A name is being edited on its card: the page is not drawn again under it. */
export const renaming = (): boolean => !!editing;

/** Edit `d`'s name on its card (`card`: its `.dev`). Another one being edited lets go first. */
export function renameOnCard(d: Device, card: HTMLElement) {
  if (editing?.id === d.id) return;
  editing?.cancel();
  const name = card.querySelector<HTMLElement>('.dev-name');
  const stat = card.querySelector<HTMLElement>('.dev-stat');
  if (!name || !stat) return;
  // What it says, not what shows: still morphing (a rename just let go), it holds both its old and new letters.
  const was = { text: textOf(stat), tone: TONES.find((t) => stat.classList.contains(t)) ?? '', title: stat.title };
  // How to finish, where a keyboard says it; on a touch screen its Done key saves.
  const hint = matchMedia('(pointer: fine)').matches ? _('Return to save, Esc to cancel') : '';

  const input = h('input', {
    type: 'text',
    'aria-label': _('Device name'),
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'data-1p-ignore': true,
  }) as HTMLInputElement;
  input.value = d.name;
  const form = h('form', { class: 'field inline', autocomplete: 'off' }, input);
  guardDeviceName(input, form, (why) => why && say(stat, why, 'bad-t'), { ring: false });
  // Typing again after a refusal: the hint is back.
  input.addEventListener('input', () => {
    if (stat.classList.contains('bad-t')) say(stat, hint || was.text, hint ? '' : was.tone, hint ? hint : was.title);
  });

  // Where the name stands, in its font, with nothing around it: swapping them shows nothing but the caret.
  name.after(form);
  name.hidden = true;
  if (hint) say(stat, hint, '');
  smoothCaret(form);
  // Focused in the same turn as the click or the menu's item: iOS only raises its keyboard for a focus made
  // inside the tap. The whole name selected at once, and again a frame on: iOS may drop a selection made as the
  // input takes focus (select() it ignores there).
  input.focus();
  const all = () => input.setSelectionRange(0, input.value.length);
  all();
  requestAnimationFrame(() => document.activeElement === input && input.selectionStart === input.selectionEnd && all());

  let saving = false;
  /**
   * `saved`: the new name, null to let go. `back`: focus goes back to the name (Return and Esc, from a keyboard
   * or the screen's Done key: a screen reader, the next Tab, carry on from it); a click or tap away leaves it
   * where it went.
   */
  const finish = (saved: string | null, back: boolean) => {
    if (editing?.id === d.id) editing = null;
    document.removeEventListener('pointerdown', away, true);
    input.removeEventListener('blur', left);
    if (saved) name.textContent = saved;
    name.hidden = false;
    form.remove();
    // Saved: the hint stays for the repaint, which blurs it into the status (words and colour). Let go: it turns
    // back here, and is the status again (a repaint morphs it letter by letter).
    if (!saved) {
      say(stat, was.text, was.tone, was.title);
      delete stat.dataset.whole;
    }
    if (!back) return;
    // After a save the card is drawn again: the name is found anew then.
    if (saved)
      requestAnimationFrame(() => quietFocus(document.querySelector<HTMLElement>(`.dev-name[data-t="${CSS.escape(`${d.id}:name`)}"]`)));
    else quietFocus(name);
  };

  const refuse = (msg: string) => {
    say(stat, msg, 'bad-t');
    shake(form, { ring: false });
    input.focus();
  };

  const save = async () => {
    const next = input.value.trim();
    if (saving) return;
    // Empty: said before asking the router. The same name: nothing to save.
    if (!next) return refuse(_('Give the device a name.'));
    if (next === d.name) return finish(null, true);
    // Another of theirs has it: said here, shorter than the router would.
    const mine = state()?.person.devices ?? [];
    if (mine.some((x) => x.id !== d.id && x.name.toLowerCase() === next.toLowerCase())) return refuse(_('That name is taken.'));
    saving = true;
    input.readOnly = true;
    const stop = shimmer(form, input);
    try {
      const r = await call<{ state: State }>(`devices/${d.id}`, { action: 'rename', name: next });
      setState(r.state);
      // The words settle to solid before the field gives way to the name: nothing changes as it does.
      await stop();
      finish(next, true);
      repaint();
    } catch (e) {
      await stop();
      input.readOnly = false;
      refuse((e as Error).message);
    } finally {
      saving = false;
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
    finish(null, true);
  });
  // A click away lets it go; while saving, the router's answer settles it.
  const away = (e: Event) => {
    if (saving || form.contains(e.target as Node)) return;
    finish(null, false);
  };
  // Focus gone elsewhere in the page (Tab, iPad's hide-keyboard key) lets it go too. Gone from the window (another
  // app, another tab) it stays: coming back, they carry on.
  const left = () =>
    setTimeout(() => {
      if (editing?.id !== d.id || saving || !document.hasFocus() || form.contains(document.activeElement)) return;
      finish(null, false);
    });
  input.addEventListener('blur', left);
  document.addEventListener('pointerdown', away, true);
  editing = { id: d.id, cancel: () => finish(null, false) };
}
