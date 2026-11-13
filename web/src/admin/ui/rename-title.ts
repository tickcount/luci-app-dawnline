// Renaming where the name stands (kit: the portal's «Rename on the card», flows/rename.ts, for a head's title).
// At rest the title is a button that hugs its words, a faint wash under the pointer. A click (or Rename in the ⋯
// menu) turns it into its own input in the title's font and place, with nothing around it but the field's caret
// and selection, the name selected; the line under the title gives way to how to finish. Return saves: the words
// shimmer while the router answers, then the head is drawn again with the new name. Esc or a click away puts the
// name back. What the router would not take never gets in; a refusal shakes the words and says why in red.

import { h } from '../../portal/dom';
import { guardDeviceName } from '../../shared/name-guard';
import { shake } from '../../shared/shake';
import { smoothCaret } from '../../portal/ui/caret';
import { appear } from '../../portal/ui/morph';
import { shimmer } from '../../portal/ui/shimmer';
import { errorText } from './toast';

export interface RenameTitle {
  /** The head (.ph) whose title is the name. */
  head: HTMLElement;
  name: string;
  label: string;
  /** Why `v` is refused before asking the router, or null. */
  refuse(v: string): string | null;
  /** Save it; rejects with the router's reason. */
  save(v: string): Promise<void>;
  /** A person's name, not a device's: any letters, up to `max` (a device's are kept to what the router takes as typed). */
  free?: { max: number };
}

let editing: (() => void) | null = null;

/** The title as a button that edits itself (idempotent: a head drawn again is set up again). */
export function editableTitle(o: () => RenameTitle | null) {
  const r = o();
  const title = r?.head.querySelector<HTMLElement>('.ph-title');
  if (!r || !title || title.classList.contains('can-edit')) return;
  title.classList.add('can-edit');
  title.setAttribute('role', 'button');
  title.tabIndex = 0;
  title.setAttribute('aria-label', r.label);
  const start = () => {
    const now = o();
    if (now) renameTitle(now);
  };
  title.addEventListener('click', start);
  title.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    start();
  });
}

/** Edit the name in its head now. */
export function renameTitle(o: RenameTitle) {
  editing?.();
  const title = o.head.querySelector<HTMLElement>('.ph-title');
  const sub = o.head.querySelector<HTMLElement>('.ph-sub');
  if (!title || !sub || title.hidden) return;
  const hintText = matchMedia('(pointer: fine)').matches ? _('Return to save, Esc to cancel') : '';
  const hint = h('div', { class: 'ph-sub kt-rn-hint' }, hintText);
  const say = (text: string, bad = false) => {
    hint.textContent = text;
    hint.classList.toggle('bad-t', bad);
    hint.title = text;
    appear(hint);
  };
  const input = h('input', {
    type: 'text',
    'aria-label': o.label,
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'data-1p-ignore': true,
  }) as HTMLInputElement;
  input.value = o.name;
  const form = h('form', { class: 'field inline kt-rn', autocomplete: 'off' }, input);
  if (o.free) input.maxLength = o.free.max;
  else guardDeviceName(input, form, (why) => why && say(why, true), { ring: false });
  input.addEventListener('input', () => hint.classList.contains('bad-t') && say(hintText));
  // the hint takes the facts' line whole, at its height (two lines on a phone): nothing under the head moves
  hint.style.minHeight = `${sub.offsetHeight}px`;
  title.after(form);
  title.hidden = true;
  sub.after(hint);
  sub.hidden = true;
  appear(hint);
  smoothCaret(form);
  input.focus();
  const all = () => input.setSelectionRange(0, input.value.length);
  all();
  requestAnimationFrame(() => input.selectionStart === input.selectionEnd && all());

  let saving = false;
  const finish = (back: boolean) => {
    editing = null;
    document.removeEventListener('pointerdown', away, true);
    form.remove();
    hint.remove();
    title.hidden = false;
    sub.hidden = false;
    if (sub.isConnected) appear(sub);
    if (back && title.isConnected) title.focus({ preventScroll: true });
  };
  const refuse = (why: string) => {
    say(why, true);
    shake(form, { ring: false });
    input.focus();
  };
  const save = async () => {
    const next = input.value.trim();
    if (saving) return;
    if (next === o.name) return finish(true);
    const why = o.refuse(next);
    if (why) return refuse(why);
    saving = true;
    input.readOnly = true;
    const stop = shimmer(form, input);
    try {
      await o.save(next);
      await stop();
      title.textContent = next;
      finish(true);
    } catch (e) {
      await stop();
      input.readOnly = false;
      refuse(errorText(e));
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
    finish(true);
  });
  const away = (e: Event) => {
    if (saving || e.composedPath().includes(form)) return;
    finish(false);
  };
  document.addEventListener('pointerdown', away, true);
  editing = () => finish(false);
}
