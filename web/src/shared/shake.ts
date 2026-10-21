// The field shake for a name it won't take (iOS's wrong passcode): a damped swing sideways, about four times in
// half a second, from wherever a shake under way has it, so another one starts over without a jump; and its
// outline goes red at once and fades back to what it is. Only their own animations are touched (the field's
// transitions go on). With less motion asked for it doesn't move; the outline still says it. Used by the portal
// and the admin both (shared/name-guard.ts).

const FRAMES = 30;
const SWING = Array.from({ length: FRAMES + 1 }, (_, i) => {
  const t = i / FRAMES;
  return 14 * Math.exp(-4.2 * t) * Math.sin(t * Math.PI * 2 * 3.6);
});

/** How long the outline stays red, then how long it takes to fade back, in ms. */
const RED_HOLD = 700;
const RED_FADE = 800;

/**
 * The outline red at once (a 1.5 px ring: inside the portal's field, as its focus ring is; around the admin's
 * input), then back to whatever the field shows now, focused or not. Another one starts red again.
 */
function redden(el: HTMLElement) {
  el.getAnimations()
    .filter((a) => a.id === 'redden')
    .forEach((a) => a.cancel());
  const cs = getComputedStyle(el);
  const inset = el.classList.contains('field') ? 'inset ' : '';
  const red = `${inset}0 0 0 1.5px ${cs.getPropertyValue('--bad').trim() || '#e5484d'}`;
  const all = RED_HOLD + RED_FADE;
  // No last frame: it fades into the field's own ring as it is then, a focus ring still coming in included.
  el.animate(
    [
      { boxShadow: red, offset: 0 },
      { boxShadow: red, offset: RED_HOLD / all, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    ],
    { duration: all, id: 'redden' },
  );
}

/** `ring: false` for a field drawn without one (a name edited in place on its card): it only moves. */
export function shake(el: HTMLElement, o: { ring?: boolean } = {}) {
  if (o.ring !== false) redden(el);
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const tr = getComputedStyle(el).transform;
  const from = tr && tr !== 'none' ? new DOMMatrix(tr).m41 : 0;
  el.getAnimations()
    .filter((a) => a.id === 'shake')
    .forEach((a) => a.cancel());
  el.animate(
    SWING.map((x, i) => ({ transform: `translateX(${(i === 0 ? from : x).toFixed(2)}px)` })),
    { duration: 520, easing: 'linear', id: 'shake' },
  );
}
