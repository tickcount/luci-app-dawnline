// Inline SVG icons (stroke = currentColor), sized by CSS.

const P: Record<string, string> = {
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  computer: '<rect x="3" y="4.5" width="18" height="12" rx="1.8"/><path d="M2 19.5h20"/>',
  tablet: '<rect x="4.5" y="2.5" width="15" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  router: '<rect x="3" y="13" width="18" height="7" rx="1.8"/><path d="M7 16.5h.01M10.5 16.5h.01M8 13l-2-6M16 13l2-6"/>',
  other: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  ethernet:
    '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
  bridge: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M6 8.2v4.3a4 4 0 0 0 4 4h5.8"/>',
  wifi: '<path d="M4.5 9.5a11 11 0 0 1 15 0M7.5 12.8a6.5 6.5 0 0 1 9 0M10.6 16a2 2 0 0 1 2.8 0"/><circle cx="12" cy="19" r=".6"/>',
  tunnel: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5l1.5-1.5a4.2 4.2 0 0 1 6 6L17 12.5M13 17.5 11.5 19a4.2 4.2 0 0 1-6-6L7 11.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  package: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9M8 5.3l8 4.5"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4"/>',
  sunrise: '<path d="M4 16a8 8 0 0 1 16 0z"/><path d="M2 19.5h20"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.2"/><path d="M5 9v10h14V9M10 13h4"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2"/>',
  out: '<path d="M14 4h6v16h-6M10 8l-4 4 4 4M6 12h10"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  shieldplus: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 9v6M9 12h6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2"/>',
  zap: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  network:
    '<circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="5" r="1.8"/><circle cx="19" cy="5" r="1.8"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="19" r="1.8"/><path d="m6.4 6.4 3.8 3.8M17.6 6.4l-3.8 3.8M6.4 17.6l3.8-3.8M17.6 17.6l-3.8-3.8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  minus: '<path d="M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
};

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
