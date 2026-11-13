// The glass dock at the window's foot (People's selection, Settings' waiting changes) coming and going: it rises from
// under the window's edge on SMOOTH and sinks back on EASE_IN (180), each from where it stands, so one shown again
// while it sinks turns back there; on a transform alone (Safari leaves a backdrop blur undrawn while opacity runs).
// With less motion it only fades (160).

import { EASE_IN, SMOOTH, calm, play } from '../../portal/motion';
import { layer } from '../../portal/ui/layer';

const AWAY = 'translateY(calc(100% + 32px))';

/** Where it stands now: under way, its live place; at rest, `rest`. */
function now(dock: HTMLElement, rest: string): Keyframe {
  const moving = dock.isConnected && dock.getAnimations().length > 0;
  const cs = getComputedStyle(dock);
  return calm()
    ? { opacity: moving ? cs.opacity : rest === AWAY ? 0 : 1 }
    : { transform: moving && cs.transform !== 'none' ? cs.transform : rest };
}

/** In the layer, rising into its place. */
export function dockIn(dock: HTMLElement) {
  const from = now(dock, AWAY);
  if (!dock.isConnected) layer().append(dock);
  const old = dock.getAnimations();
  play(
    dock,
    [from, calm() ? { opacity: 1 } : { transform: 'none' }],
    calm() ? { duration: 160 } : { duration: SMOOTH.duration, easing: SMOOTH.easing },
  );
  old.forEach((a) => a.cancel());
}

/** Sinking away, then out of the layer unless `stays()` says it was asked back meanwhile. */
export function dockOut(dock: HTMLElement, stays: () => boolean) {
  const from = now(dock, 'none');
  const old = dock.getAnimations();
  play(dock, [from, calm() ? { opacity: 0 } : { transform: AWAY }], { duration: 180, easing: EASE_IN, fill: 'forwards' }).onfinish = () => {
    if (!stays()) dock.remove();
  };
  old.forEach((a) => a.cancel());
}
