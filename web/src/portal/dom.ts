// The portal's DOM builders: an element from a tag, attributes and children;
// an icon; markup that is ours (icons, glass icons, QR codes) as an element.
// No framework. The page's CSP forbids inline styles, so nothing here writes a
// `style` attribute: styles set from script go through `el.style`.

import { iconSvg } from '../shared/icons';

export type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;
export type Kid = Node | string | null | undefined | false | Kid[];

function append(el: Node, kids: Kid[]) {
  const add = (c: Kid) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  };
  kids.forEach(add);
}

export function h(tag: string, attrs: Attrs = {}, ...kids: Kid[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, kids);
  return el;
}

/** Replace what `el` holds with `kids` (nested lists flattened, empty ones skipped). */
export function put(el: HTMLElement, ...kids: Kid[]) {
  el.replaceChildren();
  append(el, kids);
}

/** Our own markup (never anything a visitor or the router typed) as one element. */
export function markup(html: string): Element {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild!;
}

/** A line icon (`svg.i`, stroke = currentColor), sized by CSS. */
export const ic = (name: string, cls = 'i'): Element => markup(iconSvg(name, cls));
