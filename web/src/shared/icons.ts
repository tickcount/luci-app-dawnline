// Inline SVG icons (stroke = currentColor), sized by CSS.

const P: Record<string, string> = {
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  computer: '<rect x="3" y="4.5" width="18" height="12" rx="1.8"/><path d="M2 19.5h20"/>',
  tablet: '<rect x="4.5" y="2.5" width="15" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  // Phones and tablets as one choice (KindPick): a phone in front of a tablet, which stops short of it.
  mobile:
    '<path d="M9.5 6V4.7a2.2 2.2 0 0 1 2.2-2.2h7.1a2.2 2.2 0 0 1 2.2 2.2v11.6a2.2 2.2 0 0 1-2.2 2.2H14"/><rect x="3" y="8" width="8.5" height="13.5" rx="2.2"/><path d="M6.5 18.5h1.5"/>',
  router: '<rect x="3" y="13" width="18" height="7" rx="1.8"/><path d="M7 16.5h.01M10.5 16.5h.01M8 13l-2-6M16 13l2-6"/>',
  server:
    '<rect x="3" y="4" width="18" height="7" rx="1.8"/><rect x="3" y="13" width="18" height="7" rx="1.8"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>',
  // a Dawnline server in a line this small: a terminal (its glass adds the core's mark, ui/glass.ts); `server`, the
  // rack, is a machine in general (the map's host, a service at home)
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.2"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15H16"/>',
  other: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  ethernet:
    '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
  bridge: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M6 8.2v4.3a4 4 0 0 0 4 4h5.8"/>',
  wifi: '<path d="M4.5 9.5a11 11 0 0 1 15 0M7.5 12.8a6.5 6.5 0 0 1 9 0M10.6 16a2 2 0 0 1 2.8 0"/><circle cx="12" cy="19" r=".6"/>',
  tunnel: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5l1.5-1.5a4.2 4.2 0 0 1 6 6L17 12.5M13 17.5 11.5 19a4.2 4.2 0 0 1-6-6L7 11.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4"/>',
  sunrise: '<path d="M4 16a8 8 0 0 1 16 0z"/><path d="M2 19.5h20"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.2"/><path d="M5 9v10h14V9M10 13h4"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  github:
    '<g fill="currentColor" stroke="none" transform="scale(.046875)"><path d="M256 6.3C114.6 6.3 0 120.9 0 262.3c0 113.3 73.3 209 175 242.9 12.8 2.2 17.6-5.4 17.6-12.2 0-6.1-.3-26.2-.3-47.7-64.3 11.8-81-15.7-86.1-30.1-2.9-7.4-15.4-30.1-26.2-36.2-9-4.8-21.8-16.6-.3-17 20.2-.3 34.6 18.6 39.4 26.2 23 38.7 59.8 27.8 74.6 21.1 2.2-16.6 9-27.8 16.3-34.2-57-6.4-116.5-28.5-116.5-126.4 0-27.8 9.9-50.9 26.2-68.8-2.6-6.4-11.5-32.6 2.6-67.8 0 0 21.4-6.7 70.4 26.2 20.5-5.8 42.2-8.6 64-8.6s43.5 2.9 64 8.6c49-33.3 70.4-26.2 70.4-26.2 14.1 35.2 5.1 61.4 2.6 67.8 16.3 17.9 26.2 40.6 26.2 68.8 0 98.2-59.8 120-116.8 126.4 9.3 8 17.3 23.4 17.3 47.4 0 34.2-.3 61.8-.3 70.4 0 6.7 4.8 14.7 17.6 12.2C438.7 471.3 512 375.3 512 262.3c0-141.4-114.6-256-256-256"/></g>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2"/>',
  out: '<path d="M14 4h6v16h-6M10 8l-4 4 4 4M6 12h10"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2"/>',
  zap: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  network:
    '<circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="5" r="1.8"/><circle cx="19" cy="5" r="1.8"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="19" r="1.8"/><path d="m6.4 6.4 3.8 3.8M17.6 6.4l-3.8 3.8M6.4 17.6l3.8-3.8M17.6 17.6l-3.8-3.8"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  minus: '<path d="M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
};

/**
 * More icons, kept out of this module: the apps' and stores' marks (shared/logos.ts), which the portal adds at its
 * start and the admin with its QR module (shell/qr.ts); and the admin's own line icons with the marks its pages
 * draw at once, which come with its stylesheet's module (admin/shell/style.ts).
 */
export function addIcons(more: Record<string, string>) {
  Object.assign(P, more);
}

export function iconSvg(name: string, cls = 'dl-icon'): string {
  const body = P[name] ?? P.phone;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function icon(name: string, cls = 'dl-icon'): HTMLElement {
  const span = document.createElement('span');
  span.className = 'dl-icon-wrap';
  span.innerHTML = iconSvg(name, cls);
  return span;
}
