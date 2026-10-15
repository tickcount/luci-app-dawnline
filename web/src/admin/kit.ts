// Small form pieces shared by Settings and Server: a switch, a text input and
// a labelled setting row (label + help on the left, control on the right).

import { E } from './e';
import { icon } from '../shared/icons';

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
        b.classList.toggle('on', v);
        b.setAttribute('aria-checked', v ? 'true' : 'false');
        onChange?.(v);
      },
    },
    E('i'),
  ) as HTMLButtonElement;
  return b;
}

export const isOn = (b: HTMLElement) => b.classList.contains('on');

export function input(value: string, attrs: Record<string, unknown> = {}): HTMLInputElement {
  return E('input', { type: 'text', class: 'cbi-input-text', value, ...attrs }) as HTMLInputElement;
}

export function row(label: string, control: Node, help?: string): HTMLElement {
  return E('div', { class: 'dl-setrow' }, [
    E('div', { class: 'dl-stack' }, [E('span', { class: 'dl-setrow-label' }, label), help ? E('span', { class: 'dl-sub' }, help) : '']),
    E('div', { class: 'dl-setrow-ctl' }, control),
  ]);
}

/** A section card with its own footer (Save etc.). */
export function card(title: string, body: (Node | string)[], foot: (Node | string)[], extra = ''): HTMLElement {
  return E('section', { class: `dl-setsec ${extra}` }, [
    E('div', { class: 'dl-setsec-body' }, [title ? E('h3', {}, title) : '', ...body]),
    foot.length ? E('div', { class: 'dl-setsec-foot' }, foot) : '',
  ]);
}

/** A titled group inside a settings card: icon, title and a short line, then its rows separated by hairlines. */
export function group(ic: string, title: string, sub: string, items: (Node | string)[]): HTMLElement {
  return E('div', { class: 'dl-group' }, [
    E('div', { class: 'dl-group-head' }, [
      E('span', { class: 'dl-group-ic' }, icon(ic)),
      E('span', { class: 'dl-stack' }, [E('b', {}, title), sub ? E('span', { class: 'dl-sub' }, sub) : '']),
    ]),
    E(
      'div',
      { class: 'dl-group-body' },
      items.filter((x) => x !== ''),
    ),
  ]);
}
