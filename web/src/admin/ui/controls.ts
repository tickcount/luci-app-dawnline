// Form controls in the house style: a switch, a segmented control, a chip
// toggle and a text input; LuCI's own select and multi-select for settings.

import { E } from '../e';

/** dl-switch; `onChange` gets the new state (the switch has already flipped). */
export function sw(on: boolean, label: string, onChange?: (v: boolean) => void): HTMLButtonElement {
  const b = E(
    'button',
    {
      type: 'button',
      role: 'switch',
      class: `dl-switch${on ? ' on' : ''}`,
      'aria-checked': on ? 'true' : 'false',
      'aria-label': label,
      click: () => {
        const v = !b.classList.contains('on');
        setSwitch(b, v);
        onChange?.(v);
      },
    },
    E('i'),
  ) as HTMLButtonElement;
  return b;
}

export function setSwitch(b: HTMLElement, on: boolean) {
  b.classList.toggle('on', on);
  b.setAttribute('aria-checked', on ? 'true' : 'false');
}

export const isOn = (b: HTMLElement) => b.classList.contains('on');

export interface SegOptions<T extends string> {
  /** aria-label of the group. */
  label?: string;
  /** Extra classes: 'sm', 'wide', 'dl-srvsections'… */
  cls?: string;
  /** Called with a different option than the current one. */
  onChange?: (v: T) => void;
  /**
   * Move the selection right away (default). Off for choices that apply on the
   * router at once: the page repaints from the answer, a failure leaves it as it was.
   */
  optimistic?: boolean;
}

/**
 * Single-choice dl-seg (radiogroup). The current choice is in `.dataset.value`.
 * Unknown values get an option of their own, so nothing is lost on save.
 */
export function seg<T extends string>(options: [T, Node | string | (Node | string)[]][], value: T, o: SegOptions<T> = {}): HTMLElement {
  if (!options.some(([v]) => v === value)) options = [...options, [value, value]];
  const el = E('div', {
    class: `dl-seg${o.cls ? ` ${o.cls}` : ''}`,
    role: 'radiogroup',
    'aria-label': o.label ?? null,
    'data-value': value,
  });
  const mark = () =>
    el.querySelectorAll<HTMLElement>(':scope > button').forEach((b) => {
      const on = b.dataset.v === el.dataset.value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  for (const [v, t] of options)
    el.appendChild(
      E(
        'button',
        {
          type: 'button',
          role: 'radio',
          'data-v': v,
          click: () => {
            if (v === el.dataset.value) return;
            if (o.optimistic !== false) {
              el.dataset.value = v;
              mark();
            }
            o.onChange?.(v);
          },
        },
        t,
      ),
    );
  mark();
  return el;
}

/** dl-chipbtn that toggles (aria-pressed); `onToggle` decides and may return the new state. */
export function chipToggle(
  label: Node | string | (Node | string)[],
  on: boolean,
  onToggle: () => unknown,
  attrs: Record<string, unknown> = {},
) {
  return E(
    'button',
    {
      type: 'button',
      ...attrs,
      class: `dl-chipbtn${on ? ' on' : ''}${attrs.class ? ` ${attrs.class}` : ''}`,
      'aria-pressed': on ? 'true' : 'false',
      click: onToggle,
    },
    label,
  );
}

/**
 * Single choice as LuCI's select (a ListValue's widget); the choice is `.value`.
 * Unknown values get an option of their own, so nothing is lost on save.
 */
export function select<T extends string>(options: [T, string][], value: T, label: string, onChange?: (v: T) => void): HTMLSelectElement {
  if (!options.some(([v]) => v === value)) options = [...options, [value, value]];
  return E(
    'select',
    { class: 'cbi-input-select', 'aria-label': label, change: (ev: Event) => onChange?.((ev.target as HTMLSelectElement).value as T) },
    options.map(([v, t]) => E('option', { value: v, selected: v === value ? 'selected' : null }, t)),
  ) as HTMLSelectElement;
}

/** Several choices as LuCI's multi-select dropdown (a MultiValue's widget): `node` to show, `value()` to save. */
export function multiSelect(
  options: [string, Node | string][],
  values: string[],
  label: string,
): { node: HTMLElement; value: () => string[] } {
  const w = new ui.Dropdown(values, Object.fromEntries(options), {
    multiple: true,
    sort: options.map(([v]) => v),
    select_placeholder: _('None'),
  });
  const node = w.render() as HTMLElement;
  node.setAttribute('aria-label', label);
  return { node, value: () => w.getValue() as string[] };
}

export function input(value: string, attrs: Record<string, unknown> = {}): HTMLInputElement {
  return E('input', { type: 'text', class: 'cbi-input-text', value, ...attrs }) as HTMLInputElement;
}
