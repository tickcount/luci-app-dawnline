// The portal's stylesheet made fit for a Shadow DOM (the admin inside LuCI):
// a pure text transform, run by the build (tsup.config.ts) on the bundled
// CSS. What a page's stylesheet says of the document says it of the shadow
// host instead, and the theme follows an attribute the admin sets on the
// host (LuCI's light/dark switch), not the system's choice:
// - `:root`, `html`, `body` (with any class or attribute on them) → `:host`,
//   `:host(.x)`;
// - a selector that starts with a class the portal sets on <html> (`.kbd`,
//   `.own-tsel`) → `:host(.kbd) …`;
// - `@media (prefers-color-scheme: light|dark) { r }` → `r` under
//   `:host([data-theme=light|dark])`;
// - everything else (other at-rules, keyframes, strings) as it is.
// It reads CSS as esbuild writes it (no comments needed, but they are skipped).

export interface ShadowOptions {
  /** Classes the page sets on <html>; a selector starting with one is about the host. */
  rootClasses?: string[];
}

const SCHEME = /^@media\s*\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)$/;
/** At-rules whose block holds rules (the others' blocks are copied as they are). */
const NESTING = /^@(media|supports|container|layer|scope)\b/;

/** A block's text from `open` (just past "{") to its "}"; strings and comments skipped. Returns the index of the "}". */
function blockEnd(css: string, open: number): number {
  let depth = 1;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") i = stringEnd(css, i);
    else if (c === '/' && css[i + 1] === '*') i = css.indexOf('*/', i + 2) + 1 || css.length;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('shadow-css: unbalanced braces');
}

function stringEnd(css: string, at: number): number {
  const q = css[at];
  for (let i = at + 1; i < css.length; i++) {
    if (css[i] === '\\') i++;
    else if (css[i] === q) return i;
  }
  return css.length;
}

/** Split at top-level commas (not inside parentheses, brackets or strings). */
export function splitList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") i = stringEnd(s, i);
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(s.slice(from).trim());
  return out.filter(Boolean);
}

/** The compound at the start of `sel` (up to the first combinator outside parentheses). */
function leadingCompound(sel: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) return [sel.slice(0, i), sel.slice(i)];
  }
  return [sel, ''];
}

/** `:host` with what the compound adds (classes, attributes), e.g. `html.kbd` → `:host(.kbd)`. */
function hostOf(extra: string): string {
  return extra ? `:host(${extra})` : ':host';
}

/** One selector, with the document's root turned into the host; `theme`: under that data-theme. */
export function hostSelector(sel: string, o: ShadowOptions = {}, theme?: string): string {
  const [head, rest] = leadingCompound(sel.trim());
  const root = /^(:root|html|body)(?![\w-])(.*)$/.exec(head);
  const cls = (o.rootClasses ?? []).find((c) => head === `.${c}` || head.startsWith(`.${c}:`) || head.startsWith(`.${c}.`));
  const themeAttr = theme ? `[data-theme=${theme}]` : '';
  if (root) return `${hostOf(themeAttr + root[2])}${rest}`;
  if (head.startsWith(':host')) {
    // Already the host: the theme joins what it says of it.
    if (!themeAttr) return sel.trim();
    const m = /^:host(?:\((.*)\))?(.*)$/.exec(head)!;
    return `${hostOf(themeAttr + (m[1] ?? ''))}${m[2]}${rest}`;
  }
  if (cls) return `${hostOf(themeAttr + head)}${rest}`;
  return theme ? `${hostOf(themeAttr)} ${sel.trim()}` : sel.trim();
}

/** Transform a stylesheet (see the header). */
export function shadowCss(css: string, o: ShadowOptions = {}, theme?: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const open = nextStop(css, i);
    if (open < 0) {
      out += css.slice(i);
      break;
    }
    if (css[open] === ';') {
      // A statement (`@charset`, `@import`): as it is.
      out += css.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    const prelude = css.slice(i, open).trim();
    const close = blockEnd(css, open + 1);
    const body = css.slice(open + 1, close);
    i = close + 1;
    if (prelude.startsWith('@')) {
      const scheme = SCHEME.exec(prelude.replace(/\s+/g, ' '));
      if (scheme) out += shadowCss(body, o, scheme[1]);
      else if (NESTING.test(prelude)) out += `${prelude}{${shadowCss(body, o, theme)}}`;
      else out += `${prelude}{${body}}`;
    } else {
      out += `${splitList(prelude)
        .map((s) => hostSelector(s, o, theme))
        .join(',')}{${body}}`;
    }
  }
  return out;
}

/** The next "{" (a block) or ";" (a statement) outside strings and comments; -1 at the end. */
function nextStop(css: string, from: number): number {
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") i = stringEnd(css, i);
    else if (c === '/' && css[i + 1] === '*') i = css.indexOf('*/', i + 2) + 1 || css.length;
    else if (c === '{' || c === ';') return i;
  }
  return -1;
}
