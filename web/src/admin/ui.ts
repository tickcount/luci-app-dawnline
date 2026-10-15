// UI helpers on top of LuCI's `ui` and `E()`; markup stays stock LuCI
// (cbi-button, cbi-tabmenu, alert-message) so themes style it.

import type { Child } from './luci.d';
import { E } from './e';
import { icon } from '../shared/icons';

type ButtonKind = 'action' | 'positive' | 'negative' | 'neutral' | 'apply' | 'remove' | 'edit' | 'add' | 'reset' | 'save';

export function button(
  label: Child,
  onClick: (ev: MouseEvent) => unknown,
  kind: ButtonKind = 'neutral',
  extra: Record<string, unknown> = {},
): HTMLButtonElement {
  // E() sets every non-null attribute, so `disabled: false` would still
  // disable the button: boolean state goes through the property.
  const { disabled, ...attrs } = extra;
  const btn = E(
    'button',
    {
      class: `cbi-button cbi-button-${kind}`,
      type: 'button',
      ...attrs,
      click: async (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add('spinning');
        try {
          await onClick(ev);
        } catch (e) {
          notify(errorText(e), 'error');
        } finally {
          btn.disabled = false;
          btn.classList.remove('spinning');
        }
      },
    },
    label,
  ) as HTMLButtonElement;
  btn.disabled = !!disabled;
  return btn;
}

export function iconButton(name: string, title: string, onClick: (ev: MouseEvent) => unknown, kind: ButtonKind = 'neutral', cls = '') {
  return button([icon(name), E('span', { class: 'dl-btn-label' }, title)], onClick, kind, {
    title,
    class: `cbi-button cbi-button-${kind} dl-icon-btn ${cls}`.trim(),
  });
}

/**
 * A small toast at the bottom of the screen, above modals; replaces LuCI's
 * banner at the top of the page. Errors stay longer and can be closed.
 */
export function notify(message: Child, tone: 'info' | 'error' | 'warning' | 'success' = 'info', timeout = 0) {
  let stack = document.querySelector('.dl-toasts') as HTMLElement | null;
  if (!stack) {
    stack = E('div', { class: 'dl-toasts dl-root', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(stack);
  }
  const ic = tone === 'error' ? 'x' : tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : null;
  const close = () => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 200);
  };
  const t = E('div', { class: `dl-toast ${tone}` }, [
    ic ? icon(ic) : '',
    E('span', {}, message),
    tone === 'error' ? E('button', { type: 'button', 'aria-label': 'Close', click: close }, icon('x')) : '',
  ]);
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(close, timeout || (tone === 'error' ? 8000 : tone === 'warning' ? 5000 : 2600));
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run an action; failures become a toast. Returns undefined on error. */
export async function attempt<T>(fn: () => Promise<T>, ok?: Child): Promise<T | undefined> {
  try {
    const r = await fn();
    if (ok) notify(ok, 'success', 3500);
    return r;
  } catch (e) {
    notify(errorText(e), 'error', 10000);
    return undefined;
  }
}

export function modal(title: string, body: Child, actions: Child, cls = '') {
  ui.showModal(title, [E('div', { class: `dl-modal ${cls}` }, body), E('div', { class: 'button-row' }, actions)]);
}

export function closeModal() {
  ui.hideModal();
}

export function confirmDialog(title: string, body: Child, confirmLabel = 'Confirm', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    modal(title, body, [
      E(
        'button',
        {
          class: 'cbi-button cbi-button-neutral',
          type: 'button',
          click: () => {
            closeModal();
            resolve(false);
          },
        },
        'Cancel',
      ),
      ' ',
      E(
        'button',
        {
          class: `cbi-button ${danger ? 'cbi-button-negative' : 'cbi-button-positive'}`,
          type: 'button',
          click: () => {
            closeModal();
            resolve(true);
          },
        },
        confirmLabel,
      ),
    ]);
  });
}

export async function copyText(text: string, what = 'Copied to clipboard') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = E('textarea', { style: 'position:fixed;opacity:0' }, text) as HTMLTextAreaElement;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
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

/** LuCI-style tab strip (cbi-tabmenu) for custom modal content. */
export function tabs(panes: { id: string; label: string; content: Child }[], initial?: string): HTMLElement {
  const head = E('ul', { class: 'cbi-tabmenu' });
  const body = E('div', { class: 'dl-tab-body' });
  const show = (id: string) => {
    head.querySelectorAll('li').forEach((li) => {
      li.classList.toggle('cbi-tab', li.dataset.id === id);
      li.classList.toggle('cbi-tab-disabled', li.dataset.id !== id);
    });
    body.querySelectorAll<HTMLElement>(':scope > [data-pane]').forEach((p) => (p.style.display = p.dataset.pane === id ? '' : 'none'));
  };
  for (const p of panes) {
    head.appendChild(
      E(
        'li',
        { 'data-id': p.id },
        E(
          'a',
          {
            href: '#',
            click: (ev: Event) => {
              ev.preventDefault();
              show(p.id);
            },
          },
          p.label,
        ),
      ),
    );
    body.appendChild(E('div', { 'data-pane': p.id }, p.content));
  }
  show(initial ?? panes[0]?.id);
  return E('div', { class: 'dl-tabs' }, [head, body]);
}

export function field(label: Child, widget: Child, description?: Child): HTMLElement {
  return E('div', { class: 'cbi-value' }, [
    E('label', { class: 'cbi-value-title' }, label),
    E('div', { class: 'cbi-value-field' }, [widget, description ? E('div', { class: 'cbi-value-description' }, description) : '']),
  ]);
}

export function callout(tone: 'ok' | 'warn' | 'error' | 'info', children: Child): HTMLElement {
  const cls = { ok: 'success', warn: 'warning', error: 'error', info: 'notice' }[tone];
  return E('div', { class: `alert-message ${cls}` }, children);
}

export function pill(text: Child, tone = '', title = ''): HTMLElement {
  return E('span', { class: `dl-pill ${tone}`, title }, text);
}

export function svg(markup: string, cls = ''): HTMLElement {
  const el = E('div', { class: cls });
  el.innerHTML = markup;
  return el;
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

export interface MenuItem {
  label: string;
  icon?: Node;
  danger?: boolean;
  warn?: boolean;
  run: () => unknown;
}

/** Small dropdown under `anchor`; closes on pick, outside click or Escape. */
type OpenMenu = HTMLElement & { dlAnchor?: HTMLElement; dlClose?: () => void };

export function dropdown(anchor: HTMLElement, items: (MenuItem | null)[]) {
  // A second click on the same button closes its menu instead of reopening it.
  const prev = document.querySelector('.dl-dd') as OpenMenu | null;
  if (prev) {
    prev.dlClose ? prev.dlClose() : prev.remove();
    if (prev.dlAnchor === anchor) return;
  }
  const menu: OpenMenu = E(
    'div',
    { class: 'dl-dd dl-root', role: 'menu' },
    items.map((it) =>
      it
        ? E(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              class: it.danger ? 'danger' : it.warn ? 'warn' : '',
              click: () => {
                close();
                it.run();
              },
            },
            [it.icon ?? '', E('span', {}, it.label)],
          )
        : E('hr'),
    ),
  );
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth,
    h = menu.offsetHeight;
  // Open upwards when the menu would run off the bottom of the screen.
  menu.style.top = `${r.bottom + 6 + h > window.innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  const onDoc = (ev: Event) => {
    if (!menu.contains(ev.target as Node) && !anchor.contains(ev.target as Node)) close();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };
  menu.dlAnchor = anchor;
  menu.dlClose = close;
  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', close, true);
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
  });
  (menu.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
}
