// The bar of a server's changes that wait to be applied (servers/pending.ts):
// a glass dock at the window's foot, in the layer (People's selection dock is
// the same glass): how many changes, how many devices will fetch their
// configuration after them, «Cancel» (every field goes back) and «Apply»
// (one question that names them all, one rollout). It rises when the first
// change is staged and leaves when none waits; its words morph as the count
// moves. Leaving the page while changes wait is asked about first (a link of
// the admin, the menu, `visit()`), and the browser asks on a reload or a
// closed tab.

import { h } from '../../../portal/dom';
import { appear, fadeAway, look, morphText } from '../../../portal/ui/morph';
import { dockIn, dockOut } from '../../ui/dock';
import { closeSheet, openSheet, sheetOpen } from '../../../portal/ui/sheet';
import { plural } from '../../../shared/i18n';
import { ic } from '../../ui/icons';
import { onNavigate } from '../../ui/nav';
import { visit } from '../../shell/visit';
import { askView } from '../../flows/ask';
import { plain } from '../../shell/sheets';
import type { Summary } from '../../servers/pending';

export interface PendingDock {
  /** What waits now (no change: the dock leaves). */
  sync(s: Summary): void;
}

/** In full, for the dock's title and a screen reader. */
const fetchWords = (n: number): string =>
  n ? plural(n, '%s device will fetch the configuration', '%s devices will fetch the configuration') : _('no device has to fetch anything');

/** On the dock: the ⟳ mark the fields carry says "will fetch", so the words are the count alone (one line on a phone). */
const fetchShort = (n: number): string => (n ? plural(n, '%s device', '%s devices') : _('no device has to fetch anything'));

export function pendingDock(o: { apply(): void; cancel(): void; column?: () => HTMLElement | null }): PendingDock {
  const count = h('b', { class: 'num' }, '');
  const devices = h('span', { class: 'num' }, '');
  const mark = ic('refresh', 'i st-dock-re');
  const sub = h('span', { class: 'st-dock-s' }, mark, devices);
  const cancel = h('button', { type: 'button', class: 'btn soft sm st-dock-x' }, h('span', {}, _('Cancel', 'changes')));
  const apply = h('button', { type: 'button', class: 'btn accent sm' }, ic('refresh'), h('span', {}, _('Apply')));
  cancel.addEventListener('click', o.cancel);
  apply.addEventListener('click', o.apply);
  const dock = h(
    'div',
    { class: 'kt-dock st-dock', role: 'region', 'aria-label': _('Changes that wait to be applied') },
    h('span', { class: 'st-dock-t', 'aria-live': 'polite' }, count, sub),
    cancel,
    apply,
  );
  let shown = false;
  // Over the sections' column, not the window's middle: beside a rail the middle would cover the rail's foot.
  // A narrow window (no rail beside) keeps the dock's own centring.
  const place = () => {
    const r = o.column?.()?.getBoundingClientRect();
    if (!r || !r.width || innerWidth < 760) {
      dock.style.left = dock.style.right = dock.style.width = dock.style.margin = '';
      return;
    }
    const w = Math.min(560, r.width);
    Object.assign(dock.style, { left: `${Math.round(r.left + (r.width - w) / 2)}px`, right: 'auto', width: `${w}px`, margin: '0' });
  };
  addEventListener('resize', () => shown && place(), { passive: true });
  const off = onNavigate(() => {
    dock.remove();
    off();
  });
  return {
    sync(s) {
      if (!s.changes) {
        if (!shown) return;
        shown = false;
        dockOut(dock, () => shown);
        return;
      }
      const cw = plural(s.changes, '%s change', '%s changes');
      const dw = fetchShort(s.refetch.n);
      sub.title = fetchWords(s.refetch.n);
      // the ⟳ mark comes and goes as the dock stands: it blurs in, or fades where it stood
      const has = !!s.refetch.n;
      if (shown && has === mark.hasAttribute('hidden') && dock.isConnected) {
        if (has) {
          mark.removeAttribute('hidden');
          appear(mark);
        } else {
          const ghost = mark.cloneNode(true) as SVGElement;
          const at = mark.getBoundingClientRect();
          const shows = look(mark);
          const from = dock.getBoundingClientRect();
          mark.setAttribute('hidden', '');
          fadeAway(ghost, at, dock, from, shows);
        }
      } else mark.toggleAttribute('hidden', !has);
      if (!shown) {
        shown = true;
        count.textContent = cw;
        devices.textContent = dw;
        dockIn(dock);
        place();
        return;
      }
      if (count.textContent !== cw) morphText(count, cw);
      if (devices.textContent !== dw) morphText(devices, dw);
    },
  };
}

/**
 * Leaving the page while changes wait: a plain click on a link that leads off this view is held and asked about
 * («Leave» lets them go and follows it); the browser asks itself on a reload or a closed tab. `waiting()`: how many
 * wait now; `drop()`: they are let go. Returns the question, for a leave the page starts from code.
 */
export function guardLeaving(o: { waiting(): number; drop(): void }): (leave: () => void) => void {
  const ask = (leave: () => void) => {
    const n = o.waiting();
    if (!n) return leave();
    const go = () => {
      o.drop();
      leave();
    };
    openSheet(() =>
      askView({
        icon: 'out',
        tone: 'orange',
        title: _('Leave without applying?'),
        text: [plural(n, '%s change is not applied: it will be lost.', '%s changes are not applied: they will be lost.')],
        action: _('Leave'),
        cls: 'warn',
        // the question's own history entry goes first, then the page moves
        run: async () => {
          let gone = false;
          const fire = () => {
            if (gone) return;
            gone = true;
            removeEventListener('popstate', fire);
            go();
          };
          addEventListener('popstate', fire);
          closeSheet(true);
          setTimeout(fire, 300);
        },
      }),
    );
  };
  const click = (e: MouseEvent) => {
    if (!o.waiting() || e.defaultPrevented || !plain(e) || sheetOpen()) return;
    const a = e.composedPath().find((x): x is HTMLAnchorElement => x instanceof HTMLAnchorElement && !!x.href);
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const to = new URL(a.href, location.href);
    // a link inside this view (another section) loses nothing
    if (to.origin === location.origin && to.pathname === location.pathname) return;
    e.preventDefault();
    e.stopPropagation();
    ask(() => visit(a.href));
  };
  const unload = (e: BeforeUnloadEvent) => {
    if (!o.waiting()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  document.addEventListener('click', click, true);
  addEventListener('beforeunload', unload);
  const off = onNavigate(() => {
    document.removeEventListener('click', click, true);
    removeEventListener('beforeunload', unload);
    off();
  });
  return ask;
}
