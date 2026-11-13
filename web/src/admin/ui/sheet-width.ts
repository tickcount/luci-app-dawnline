// A sheet whose views differ in width glides between them instead of snapping (the device's dialog is 1000 wide,
// a question or a set-up after it 400). To a narrower view the sheet's max-width glides there on SMOOTH (the new
// view is small, its layout follows cheaply). To a wider one the sheet takes its width at once, so the wide view
// is laid out once at its final size, and is unveiled from the narrow one's width by a clip on the same spring
// (no reflow of a heavy view on every frame); what leaves keeps the width it had.
// The mock's stand-in for what the build puts into portal/ui/sheet.ts beside its width plan for a dense QR.

import { SMOOTH, play } from '../../portal/motion';

/** Watch the open sheet until `stop()`. */
export function glideWidths(sheet: HTMLElement): () => void {
  const vp = sheet.querySelector('.vp');
  if (!vp) return () => undefined;
  let last = sheet.offsetWidth;
  const mo = new MutationObserver((ms) => {
    // only a view that comes changes the width; one that has faded and goes leaves the glide alone
    if (!ms.some((m) => m.addedNodes.length)) return;
    sheet.getAnimations().forEach((a) => a.id === 'dvw' && a.cancel());
    const to = sheet.offsetWidth;
    const from = last;
    last = to;
    if (Math.abs(to - from) < 2) return;
    const a =
      to < from
        ? play(sheet, [{ maxWidth: `${from}px` }, { maxWidth: `${to}px` }], { duration: SMOOTH.duration, easing: SMOOTH.easing })
        : play(sheet, [{ clipPath: `inset(0 ${(to - from) / 2}px round 36px)` }, { clipPath: 'inset(0 0px round 36px)' }], {
            duration: SMOOTH.duration,
            easing: SMOOTH.easing,
          });
    a.id = 'dvw';
  });
  mo.observe(vp, { childList: true });
  return () => mo.disconnect();
}
