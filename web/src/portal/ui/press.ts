// A control pressed scales down (its :active look, in the stylesheets): let go near its edge after a moment and
// the pointer is outside it by then, so the browser gives the click to what holds both and nothing happens. Here
// what was pressed keeps the footprint it had when pressed: let go inside that and it gets the click, the
// browser's own (to the ancestor) dropped. A mouse or trackpad only: a touch stays with what it pressed.

const PRESSABLE = 'button, a[href], [role="button"], label';

let pressed: { el: HTMLElement; at: DOMRect } | null = null;
/** The browser's own click of this press, to the ancestor, is to be dropped. */
let swallow = false;

export function keepPressFootprint() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.pointerType === 'mouse' && e.button === 0 ? (e.target as Element).closest?.<HTMLElement>(PRESSABLE) : null;
      pressed = el ? { el, at: el.getBoundingClientRect() } : null;
    },
    true,
  );
  document.addEventListener(
    'pointerup',
    (e) => {
      const p = pressed;
      pressed = null;
      if (!p || p.el.contains(e.target as Node)) return;
      const { at } = p;
      if (e.clientX < at.left || e.clientX > at.right || e.clientY < at.top || e.clientY > at.bottom) return;
      swallow = true;
      // The click, if the browser sends one, comes right after this; anything later is another press.
      setTimeout(() => (swallow = false));
      p.el.click();
    },
    true,
  );
  document.addEventListener(
    'click',
    (e) => {
      if (!swallow || !e.isTrusted) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
}
