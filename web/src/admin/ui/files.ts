// The clipboard and files: copy, download.

import { h } from '../../portal/dom';
import { errorText, notify } from './toast';

/**
 * Copy to the clipboard and say so. `quiet`: a copy that is a convenience
 * after something else (a link right after creating a person): browsers
 * refuse a write outside the click that started it (Safari after an await),
 * and then nothing is said — the link is on screen with its own Copy button.
 */
export async function copyText(text: string, what = _('Copied to clipboard'), quiet = false): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text) as HTMLTextAreaElement;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error(_('Copying is blocked here. Select the text and copy it by hand.'));
    }
    notify(what, 'success', 2500);
    return true;
  } catch (e) {
    if (!quiet) notify(errorText(e), 'error');
    return false;
  }
}

/** Saves a file; pass application/octet-stream for .conf, or Safari appends .txt. */
export function downloadFile(name: string, content: string | Blob, type = 'text/plain') {
  const g = globalThis as unknown as { Blob: typeof Blob };
  const blob = typeof content === 'string' ? new g.Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}
