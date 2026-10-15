// LuCI's global E() appends array children only one level deep and
// stringifies nested arrays ("[object HTMLDivElement]"). This wrapper
// flattens children recursively and drops empty values, so components can
// compose freely. Modules import it and thereby shadow the global.

import type { Child } from './luci.d';

function flatten(c: Child, out: (Node | string)[]): (Node | string)[] {
  if (c == null || c === false || c === '') return out;
  if (Array.isArray(c)) c.forEach((x) => flatten(x, out));
  else out.push(c instanceof Node ? c : String(c));
  return out;
}

export function E(tag: string, attrs?: Record<string, unknown> | Child, children?: Child): HTMLElement {
  const luciE = (window as unknown as { E: (t: string, a: Record<string, unknown>, c: Child) => HTMLElement }).E;
  const isAttrs = attrs != null && typeof attrs === 'object' && !Array.isArray(attrs) && !(attrs instanceof Node);
  if (!isAttrs && children === undefined) return luciE(tag, {}, flatten(attrs as Child, []));
  return luciE(tag, (isAttrs ? attrs : {}) as Record<string, unknown>, flatten(children, []));
}
