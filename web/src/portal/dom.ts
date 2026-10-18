// The portal's two DOM builders: an element from a tag, attributes and
// children, and an icon. No framework; shared by the page (main.ts) and the
// pieces drawn outside it (waitpath.ts).

import { iconSvg } from '../shared/icons';

export type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;
export type Kid = Node | string | null | undefined | false | Kid[];

export function h(tag: string, attrs: Attrs = {}, ...kids: Kid[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  const add = (c: Kid) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  };
  kids.forEach(add);
  return el;
}

export function ic(name: string): HTMLElement {
  const s = h('span', { class: 'ic' });
  s.innerHTML = iconSvg(name, 'ic-svg');
  return s;
}
