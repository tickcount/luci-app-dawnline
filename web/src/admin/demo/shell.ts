// The Outline theme's chrome around the demo's page: what the theme's own scripts draw into the skeleton its
// header template gives (index.html) once LuCI hands them its menu. They need LuCI itself, so the same markup is
// made here by hand, for a made-up menu: the brand, the five sections a router with statistics has, search and log
// out, LuCI's poll indicator. Laid out by the theme's stylesheet as its navbar or its sidebar (html[data-nav]).
// Follows luci-theme-outline 1.3 (menu-outline.js renderSidebarChrome and render): when the theme changes that
// markup, this changes with it. A picture's frame only: nothing here is pressed.

const MEDIA = '/luci-static/outline';

/** LuCI's top-level sections: its menu node, the theme's icon for it, its title in LuCI's own catalog. */
const SECTIONS = [
  ['status', 'activity', 'Status', 'Состояние'],
  ['system', 'settings', 'System', 'Система'],
  ['services', 'layers', 'Services', 'Службы'],
  ['network', 'network', 'Network', 'Сеть'],
  ['statistics', 'chart-bar', 'Statistics', 'Статистика'],
] as const;
/** The section Dawnline's pages are in. */
const HERE = 'services';

type Kid = Node | string;

function el(tag: string, attrs: Record<string, string>, kids: Kid[] = []): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

const icon = (name: string, size = 20) =>
  el('img', { src: `${MEDIA}/icons/${name}.svg`, width: String(size), height: String(size), alt: '', class: 'outline-icon' });

/** Draw the chrome into the page's skeleton, in the page's language. */
export function drawShell(): void {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const ru = document.documentElement.lang === 'ru';
  const host = sidebar.dataset.hostname ?? 'Outline';
  const out = ru ? 'Выйти' : 'Log out';
  sidebar.replaceChildren(
    el('div', { class: 'sidebar-rail' }, [
      el('a', { class: 'sidebar-rail-home', href: '/', 'aria-label': host }, [
        el('img', { class: 'sidebar-logo', src: `${MEDIA}/images/logo.png`, alt: '', width: '20', height: '20' }),
        el('span', { class: 'sidebar-rail-expand', 'aria-hidden': 'true' }, [icon('panel-left-open')]),
        el('span', { class: 'sidebar-rail-label' }, [host]),
      ]),
      el('div', { class: 'sidebar-rail-sep', role: 'presentation' }),
      el(
        'nav',
        { class: 'sidebar-rail-nav', id: 'sidebar-rail-nav' },
        SECTIONS.map(([name, glyph, en, inRu]) => {
          const title = ru ? inRu : en;
          const cls = name === HERE ? 'sidebar-rail-item active is-shown' : 'sidebar-rail-item';
          return el('a', { class: cls, href: `/cgi-bin/luci/admin/${name}`, 'data-section': name, 'aria-label': title }, [
            icon(glyph),
            el('span', { class: 'sidebar-rail-label' }, [title]),
          ]);
        }),
      ),
      el('div', { class: 'sidebar-footer', id: 'sidebar-footer' }, [
        el('a', { class: 'sidebar-logout', href: '/cgi-bin/luci/admin/logout', 'aria-label': out }, [
          el('span', { class: 'sidebar-icon', 'aria-hidden': 'true' }, [icon('log-out')]),
          el('span', { class: 'sidebar-label' }, [out]),
        ]),
      ]),
    ]),
    el('div', { class: 'sidebar-panel' }, [
      el('div', { class: 'sidebar-header' }, [
        el('a', { class: 'sidebar-brand', href: '/' }, [el('span', { class: 'sidebar-brand-text' }, [host])]),
        el('button', { id: 'cmdk-trigger', class: 'cmdk-trigger sidebar-icon-btn', type: 'button' }, [icon('search')]),
        el('button', { id: 'sidebar-toggle-btn', class: 'sidebar-toggle sidebar-icon-btn', type: 'button' }, [
          el('span', { class: 'icon-collapse' }, [icon('panel-left-close')]),
          el('span', { class: 'icon-expand' }, [icon('panel-left-open')]),
        ]),
      ]),
      el('nav', { class: 'sidebar-nav', id: 'sidebar-nav' }),
    ]),
  );
  sidebar.dataset.outlineBuilt = '1';
  // LuCI's own indicator of its poll, which the theme draws among the top bar's
  document
    .getElementById('indicators')
    ?.replaceChildren(
      el('span', { 'data-indicator': 'poll-status', 'data-clickable': 'true', 'data-style': 'active' }, [ru ? 'Обновление' : 'Refreshing']),
    );
}
