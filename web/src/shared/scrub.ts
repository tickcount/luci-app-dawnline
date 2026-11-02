// Reading a chart point by point, the same way in the admin UI and the portal:
// the pointer picks the point under it, a tap keeps one until a tap elsewhere,
// and with the chart focused ← → Home End walk the points (Esc lets go). The
// chart marks the picked point; what its numbers are and where they show (the
// tile's own head, a tooltip) is the caller's. No drawing and no text here.

/** A chart that can be read: the point under a pointer, and marking one (-1: none). */
export interface Readable {
  indexAt(clientX: number): number;
  mark(i: number): void;
}

export interface ScrubOpts {
  /** How many points; the last is the newest, where the keys start. */
  count: () => number;
  /** Point i was picked (-1: let go). */
  pick: (i: number) => void;
  /** The chart's name for assistive technology. */
  label: string;
  /** A point in words, read out as the keys move. */
  say?: (i: number) => string;
}

export interface Scrub {
  /** The points moved under a still pointer (a live chart's new second): pick what is under it now. */
  refresh(): void;
  /** The picked point, or -1. */
  current(): number;
}

/** Wire `host` (the chart's element, or its box) for reading. */
export function scrub(host: HTMLElement, chart: Readable, o: ScrubOpts): Scrub {
  let cur = -1;
  /** Where a mouse rests over the chart (null: it is not over it), so a moving chart can re-pick under it. */
  let restX: number | null = null;
  const words = document.createElement('span');
  words.className = 'offscreen';
  words.setAttribute('aria-live', 'polite');
  host.append(words);
  host.classList.add('scrub');
  host.tabIndex = 0;
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', o.label);

  const pick = (i: number, force = false) => {
    if (i === cur && !force) return;
    const was = cur;
    cur = i;
    chart.mark(i);
    o.pick(i);
    if (i >= 0 && i !== was && o.say) words.textContent = o.say(i);
    // A tap's pick lasts until a tap elsewhere, a scroll or leaving the page section.
    if (i >= 0 && restX == null) document.addEventListener('pointerdown', away, true);
    else document.removeEventListener('pointerdown', away, true);
  };
  const away = (ev: PointerEvent) => {
    if (!host.contains(ev.target as Node)) pick(-1);
  };

  host.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    restX = ev.clientX;
    pick(chart.indexAt(ev.clientX));
  });
  host.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    restX = null;
    pick(-1);
  });
  // No hover on a touch screen: a tap picks, a tap on the same point lets go.
  host.addEventListener('pointerup', (ev) => {
    if (ev.pointerType === 'mouse') return;
    const i = chart.indexAt(ev.clientX);
    pick(i === cur ? -1 : i);
  });
  host.addEventListener('keydown', (ev) => {
    const n = o.count();
    if (!n) return;
    const from = cur < 0 ? n : cur;
    const to =
      ev.key === 'ArrowLeft'
        ? Math.max(0, from - 1)
        : ev.key === 'ArrowRight'
          ? Math.min(n - 1, cur < 0 ? n - 1 : from + 1)
          : ev.key === 'Home'
            ? 0
            : ev.key === 'End'
              ? n - 1
              : ev.key === 'Escape'
                ? -1
                : null;
    if (to == null) return;
    ev.preventDefault();
    restX = null;
    pick(to);
  });
  host.addEventListener('blur', () => restX == null && pick(-1));

  return {
    refresh() {
      if (restX != null) pick(chart.indexAt(restX), true);
      else if (cur >= 0) pick(Math.min(cur, o.count() - 1), true);
    },
    current: () => cur,
  };
}
