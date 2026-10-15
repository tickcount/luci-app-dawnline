// The clipboard and files: copy, download, pick.

import { E } from '../e';
import { errorText, notify } from './toast';

export async function copyText(text: string, what = 'Copied to clipboard') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = E('textarea', { style: 'position:fixed;opacity:0' }, text) as HTMLTextAreaElement;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('Copying is blocked here. Select the text and copy it by hand.');
    }
    notify(what, 'success', 2500);
  } catch (e) {
    notify(errorText(e), 'error');
  }
}

/** Saves a file; pass application/octet-stream for .conf, or Safari appends .txt. */
export function downloadFile(name: string, content: string | Blob, type = 'text/plain') {
  const g = globalThis as unknown as { Blob: typeof Blob };
  const blob = typeof content === 'string' ? new g.Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = E('a', { href: url, download: name, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

/** Read a picked file as text or base64. */
export function pickFile(accept: string, as: 'text' | 'base64'): Promise<{ name: string; data: string } | null> {
  return new Promise((resolve) => {
    const input = E('input', { type: 'file', accept, style: 'display:none' }) as HTMLInputElement;
    // Closing the file picker fires "cancel" (no "change"); without it the caller waits forever.
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => {
        const res = String(r.result ?? '');
        resolve({ name: f.name, data: as === 'base64' ? res.replace(/^data:[^,]*,/, '') : res });
      };
      r.onerror = () => resolve(null);
      if (as === 'base64') r.readAsDataURL(f);
      else r.readAsText(f);
    });
    document.body.appendChild(input);
    input.click();
  });
}
