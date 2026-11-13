// Where the floating parts go: the sheet, ⋯ menus, the picker's pop, the
// selection handles and the toasts are put in one layer, and opening the
// sheet locks one scroller. On the portal both are the page itself
// (document.body); the admin, drawn inside LuCI in a Shadow DOM, hands in a
// shadow root of its own on <body> and LuCI's content scroller
// (admin/shell/layer.ts). Nothing here draws; the modules that do ask.

type Root = HTMLElement | ShadowRoot;

let root: Root | null = null;
let lockTarget: HTMLElement | null = null;

/** Put the floating parts in `at` and lock `lock` while the sheet is open (the admin; once, before anything opens). */
export function setLayer(at: Root, lock: HTMLElement = document.body) {
  root = at;
  lockTarget = lock;
}

/** The layer's root: what a floating part is appended to. */
export const layer = (): Root => root ?? document.body;

/** Where elements the page drew may be looked up: the document, and the layer when it is a shadow root of its own. */
export const scopes = (): ParentNode[] => (root && root !== document.body ? [document, root] : [document]);

/**
 * The scroller stops while the sheet is open. The portal's own stylesheet
 * does it for body.locked; a scroller outside the layer's stylesheet (LuCI's)
 * is held by its inline overflow.
 */
export function lockScroll(on: boolean) {
  const t = lockTarget ?? document.body;
  t.classList.toggle('locked', on);
  if (t !== document.body) t.style.overflow = on ? 'hidden' : '';
}
