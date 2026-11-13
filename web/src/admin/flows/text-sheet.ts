// One line of text, or a note, in the portal's sheet (a person's name, the
// admin's note on them): the portal's field with its arrow, the router's
// reason in red under it when it refuses, the sheet closing once it took.

import { h } from '../../portal/dom';
import { closeSheet, head, hint, openSheet, type View } from '../../portal/ui/sheet';
import { badLine } from '../../portal/ui/bad-line';
import { once } from '../../portal/ui/feedback';
import { shake } from '../../shared/shake';
import { ic } from '../ui/icons';
import { errorText } from '../ui/toast';

export interface TextSheet {
  title: string;
  value: string;
  placeholder: string;
  /** Several lines (a note). */
  long?: boolean;
  max: number;
  hint?: string;
  /** Why `v` is refused, or null. */
  refuse(v: string): string | null;
  /** Save it; rejects with the router's reason. */
  save(v: string): Promise<void>;
}

function view(o: TextSheet): View {
  const input = (
    o.long
      ? h('textarea', { rows: 1, maxlength: o.max, placeholder: o.placeholder, 'aria-label': o.title }, o.value)
      : h('input', {
          type: 'text',
          value: o.value,
          maxlength: o.max,
          placeholder: o.placeholder,
          'aria-label': o.title,
          autocomplete: 'off',
          'data-1p-ignore': true,
        })
  ) as HTMLInputElement | HTMLTextAreaElement;
  const go = h('button', { class: 'go ready', type: 'submit', 'aria-label': _('Save') }, ic('arrow')) as HTMLButtonElement;
  const form = h('form', { class: `field${o.long ? ' long' : ''}`, autocomplete: 'off' }, input, go);
  const { el: err, say, unsay } = badLine();
  input.addEventListener('input', () => unsay());
  const save = async () => {
    const v = input.value.trim();
    const why = o.refuse(v);
    if (why) {
      say(why);
      shake(form);
      return;
    }
    try {
      await o.save(v);
      closeSheet();
    } catch (e) {
      say(errorText(e));
      shake(form);
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void once(go, save);
  });
  if (o.long)
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' && ((e as KeyboardEvent).metaKey || (e as KeyboardEvent).ctrlKey)) {
        e.preventDefault();
        void once(go, save);
      }
    });
  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  });
  const el = h('div', { class: 'view' }, head(o.title), form, err, o.hint ? hint(o.hint) : null);
  return { el, label: o.title };
}

export const textSheet = (o: TextSheet) => openSheet(() => view(o));
