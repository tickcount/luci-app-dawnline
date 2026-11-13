// A labelled field in a sheet: the name above it (the new person's «choice»
// head), the portal's field, and the line under it that says what the value
// means or, in red, why it is refused, kept current as it is typed. The
// sheets that set a few values at once use it (a home service, a circle, a new
// server).

import { h } from '../../portal/dom';
import { shake } from '../../shared/shake';
import type { Help } from '../netcheck';

export interface Field {
  el: HTMLElement;
  input: HTMLInputElement;
  value(): string;
  /** Check it now: its line says why when it is refused (the field shakes); true when it is fine. */
  check(): boolean;
  /** Say the line again (an answer came in that changes it). */
  refresh(): void;
}

export function field(
  label: string,
  value: string,
  help: (v: string) => Help,
  o: { placeholder?: string; mono?: boolean; numeric?: boolean; plain?: boolean } = {},
): Field {
  const input = h('input', {
    type: 'text',
    value,
    placeholder: o.placeholder ?? '',
    'aria-label': label,
    autocomplete: 'off',
    autocapitalize: o.plain ? 'none' : null,
    autocorrect: o.plain ? 'off' : null,
    spellcheck: 'false',
    inputmode: o.numeric ? 'numeric' : null,
    'data-1p-ignore': true,
    class: o.mono ? 'mono' : null,
  }) as HTMLInputElement;
  const box = h('label', { class: 'field fl-f' }, input);
  const line = h('p', { class: 'hint fl-h' });
  const say = () => {
    const r = help(input.value);
    line.textContent = r.text;
    line.classList.toggle('bad-t', r.bad);
    line.hidden = !r.text;
    return r;
  };
  input.addEventListener('input', say);
  say();
  return {
    el: h('div', { class: 'choice fl' }, h('div', { class: 'choice-h' }, h('span', {}, label)), box, line),
    input,
    value: () => input.value.trim(),
    check() {
      if (!say().bad) return true;
      shake(box);
      input.focus();
      return false;
    },
    refresh: () => void say(),
  };
}
