// A value edited where it stands (the behaviour of ui/edit-rows.ts, for a
// value that is not a row of its own: an address and its port inside one row,
// a server's name in its head, a network in a measure): the value becomes its
// own input in the value's font and place, as wide as what is typed. Return
// takes it (refused: the reason in red where the caller says things, the
// input shaking); Esc, a press elsewhere or the focus gone put the value back.

import { h } from '../dom';
import { shake } from '../../shared/shake';

export interface Inline {
  label: string;
  start: string;
  placeholder?: string;
  numeric?: boolean;
  /** No capitals or corrections from a phone's keyboard. */
  plain?: boolean;
  max?: number;
  /** Why `v` is refused, or null. */
  refuse(v: string): string | null;
  /** Take `v` (not the start value). */
  commit(v: string): void;
  /** As it is typed (a live verdict). */
  typing?(v: string): void;
  /** Say how to finish, or in red why not; null: back to what the place said before. */
  say(text: string | null, bad?: boolean): void;
}

export function inlineEdit(btn: HTMLElement, o: Inline) {
  const input = h('input', {
    type: 'text',
    value: o.start,
    'aria-label': o.label,
    placeholder: o.placeholder ?? '',
    autocomplete: 'off',
    autocapitalize: o.plain ? 'none' : null,
    autocorrect: o.plain ? 'off' : null,
    spellcheck: 'false',
    enterkeyhint: 'done',
    inputmode: o.numeric ? 'numeric' : null,
    maxlength: o.max ?? null,
    'data-1p-ignore': true,
  }) as HTMLInputElement;
  const ruler = h('span', { class: 'ed-ruler', 'aria-hidden': 'true' });
  const form = h('form', { class: `kt-ie-f ${btn.className.replace(/\bkt-ie-v\b/, '')}`, autocomplete: 'off' }, input, ruler);
  const fit = () => {
    ruler.textContent = input.value || input.placeholder || ' ';
    input.style.width = `${Math.ceil(ruler.getBoundingClientRect().width) + 4}px`;
  };
  btn.replaceWith(form);
  fit();
  input.focus({ preventScroll: true });
  input.setSelectionRange(0, input.value.length);
  if (matchMedia('(pointer: fine)').matches) o.say(_('Enter: save, Esc: cancel'));
  let done = false;
  const finish = (take: string | null) => {
    if (done) return;
    done = true;
    document.removeEventListener('pointerdown', away, true);
    const held = form.isConnected;
    form.replaceWith(btn);
    o.say(null);
    // the focus goes back to the value (a keyboard goes on from where it was), then the value is taken
    if (held) btn.focus?.({ preventScroll: true });
    if (take != null) o.commit(take);
  };
  const away = (e: Event) => {
    if (!e.composedPath().includes(form)) finish(null);
  };
  document.addEventListener('pointerdown', away, true);
  input.addEventListener('input', () => {
    fit();
    o.typing?.(input.value.trim());
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    finish(null);
  });
  input.addEventListener('blur', () => setTimeout(() => finish(null), 0));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (v === o.start) return finish(null);
    const why = o.refuse(v);
    if (why) {
      o.say(why, true);
      // the frame is the form's (the input inside it has none): the red ring takes its place, corners and all
      shake(form);
      return;
    }
    finish(v);
  });
}
