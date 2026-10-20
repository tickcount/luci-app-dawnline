// What a tap answers with: a toast, a copy (and the check on the control that
// copied), a file shared or downloaded, a button held busy until the router
// answers. Toasts sit in one bottom slot, one at a time.

import { h, ic } from '../dom';
import { BOUNCY, EASE_IN, POP, calm, play } from '../motion';
import { platform } from '../state';
import { BUSY_IN, busyOff, busyOn } from './busy';
import { morphText, textOf } from './morph';

let slot: HTMLElement | null = null;
let shown: HTMLElement | null = null;
let timer = 0;

const leave = (t: HTMLElement, frames: Keyframe[], ms: number) =>
  (play(t, frames, { duration: ms, easing: EASE_IN, fill: 'forwards' }).onfinish = () => t.remove());

/** One toast at a time: a new one sends the last away first. */
export function toast(msg: string, bad = false) {
  slot ??= document.body.appendChild(h('div', { class: 'toasts' }));
  if (shown) leave(shown, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.96)', filter: 'blur(4px)' }], 140);
  const t = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, ic(bad ? 'alert' : 'check'), h('span', {}, msg));
  slot.appendChild(t);
  shown = t;
  play(
    t,
    [
      { opacity: 0, transform: 'translateY(18px) scale(.9)', filter: 'blur(6px)' },
      { opacity: 1, transform: 'none', filter: 'none' },
    ],
    {
      duration: BOUNCY.duration,
      easing: BOUNCY.easing,
    },
  );
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (shown !== t) return;
    shown = null;
    leave(t, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px) scale(.96)', filter: 'blur(4px)' }], 180);
  }, 2400);
}

/**
 * The control that copied says so for a moment: its icon turns into a check
 * and its "Copy…" label (`.lbl`, a badge's main line) into "Copied". Every
 * control that copies with a label says "Copy…" (in any language), so the
 * label is not read for the word.
 */
function copied(from: Element) {
  if (from.classList.contains('copied')) return;
  const icon = from.querySelector('svg.i');
  const label = from.querySelector<HTMLElement>('.lbl, .b-main');
  const was = label ? textOf(label) : '';
  from.classList.add('copied');
  let check: Element | null = null;
  if (icon) {
    check = ic('check', icon.getAttribute('class') ?? 'i');
    icon.replaceWith(check);
    play(
      check,
      [
        { opacity: 0, transform: 'scale(.6)', filter: 'blur(3px)' },
        { opacity: 1, transform: 'none', filter: 'none' },
      ],
      {
        duration: POP.duration,
        easing: POP.easing,
      },
    );
  }
  if (label) morphText(label, _('Copied'));
  setTimeout(() => {
    if (check && icon) check.replaceWith(icon);
    if (label) morphText(label, was);
    from.classList.remove('copied');
  }, 1600);
}

/** `from`: the control that copied, which then shows a check for a moment. */
export async function copy(text: string, what = _('Copied'), from?: EventTarget | null) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { class: 'offscreen' }, text) as HTMLTextAreaElement;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) return toast(_('Copying is blocked here. Select the text and copy it by hand.'), true);
  }
  if (from instanceof Element) copied(from);
  toast(what);
}

/**
 * On an iPhone a share sheet hands the file straight to the VPN app, where a
 * download would land in Files. Returns the action, or null where files
 * cannot be shared.
 */
export function shareFile(name: string, text: string): (() => Promise<void>) | null {
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  // Only iOS: there AmneziaWG, WireGuard and AmneziaVPN take a file from the
  // share sheet. On Android neither app is a share target (and Chrome does not
  // share .conf files), so a download goes into the app's own file picker;
  // desktop browsers claim they can share files and then do nothing.
  if (platform() !== 'ios') return null;
  if (typeof nav.share !== 'function' || typeof File === 'undefined') return null;
  const file = new File([text], name, { type: 'application/octet-stream' });
  if (!nav.canShare?.({ files: [file] })) return null;
  return async () => {
    try {
      // The file alone: with a title, "Save to Files" also writes the title as a .txt.
      await nav.share({ files: [file] });
    } catch (e) {
      // Cancelled: nothing to do. Refused by the browser: the file still has to get out.
      if ((e as Error)?.name !== 'AbortError') download(name, text);
    }
  };
}

export function download(name: string, text: string) {
  // Not text/plain: Safari would save "name.conf.txt".
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: name, class: 'offscreen' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

/** The file out: the share sheet where the browser hands it to an app, a download elsewhere. */
export function sendFile(name: string, text: string) {
  const share = shareFile(name, text);
  if (share) void share();
  else download(name, text);
}

/**
 * Run an action once: its button goes busy (the orb) on the click and stays
 * disabled until the router answers; a quick answer keeps the orb until it is
 * all the way in.
 */
export async function once(btn: HTMLButtonElement, fn: () => Promise<void>) {
  if (btn.disabled) return;
  btn.disabled = true;
  busyOn(btn);
  const t0 = performance.now();
  try {
    await fn();
  } finally {
    const wait = calm() ? 0 : BUSY_IN - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    busyOff(btn);
    btn.disabled = false;
  }
}
