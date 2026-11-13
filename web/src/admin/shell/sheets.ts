// What the pages add around the portal's sheet (portal/ui/sheet.ts, drawn
// in the layer): waiting for its opening motion before something heavy (a
// map) starts, and leaving for another page from inside it. The sheet's own
// history entry goes first, then the page moves, so Back from there returns to
// the page under the sheet, not to the sheet.

import { closeSheet, sheetOpen } from '../../portal/ui/sheet';
import { layer } from '../../portal/ui/layer';
import { visit } from './visit';

/** The sheet's own element, once built (the first open). */
const sheetEl = (): HTMLElement | null => (layer() as ParentNode).querySelector<HTMLElement>('.sheet-root .sheet');

/** After the sheet's opening motion (a dialog's pop, a drawer's rise): WebGL under its scale and blur would redraw every frame. */
export function afterOpen(): Promise<void> {
  return new Promise((res) =>
    requestAnimationFrame(() => {
      const el = sheetEl();
      const run = el ? el.getAnimations().filter((a) => a.playState === 'running') : [];
      void Promise.allSettled(run.map((a) => a.finished)).then(() => res());
    }),
  );
}

/** Go to `to` from inside a sheet: the sheet and its history entry go first, then the page moves (shell/visit.ts). */
export function leaveTo(to: string) {
  if (!sheetOpen()) {
    visit(to);
    return;
  }
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    removeEventListener('popstate', fire);
    visit(to);
  };
  addEventListener('popstate', fire);
  closeSheet(true);
  setTimeout(fire, 300);
}

/** A plain click (no new tab or window asked for): the page may open its sheet instead of following the link. */
export const plain = (e: Event): boolean => {
  const m = e as MouseEvent;
  return m.button === 0 && !m.metaKey && !m.ctrlKey && !m.shiftKey && !m.altKey;
};
