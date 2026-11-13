// The admin's own line icons: those the shared set (shared/icons.ts) lacks,
// on the same 24 grid, 1.8 stroke, round caps and joins, currentColor, as
// data. Like the glass shapes (ui/glass-shapes.ts) they come with the
// stylesheet's module, which adds them to the shared set (shell/style.ts), so
// the portal's own parts the pages use (its ⋯ menu, its sheets) draw them
// too. A picture draws the thing its place names.

export const LINES: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 16.5 16 7.5" stroke-dasharray="2 3"/>',
  log: '<path d="M9 6h11M9 12h11M9 18h7"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.6"/>',
  // a core in general
  chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3"/>',
  sliders: '<path d="M4 7h8M18 7h2M4 17h2M12 17h8"/><circle cx="15" cy="7" r="2.6"/><circle cx="9" cy="17" r="2.6"/>',
  // an overview: a board of tiles
  dashboard:
    '<rect x="3.5" y="3.5" width="7.5" height="9.5" rx="1.8"/><rect x="13" y="3.5" width="7.5" height="5.5" rx="1.8"/><rect x="13" y="11" width="7.5" height="9.5" rx="1.8"/><rect x="3.5" y="15" width="7.5" height="5.5" rx="1.8"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c0-3.6 3.2-6 7.5-6s7.5 2.4 7.5 6"/>',
  people:
    '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c0-3.2 2.8-5.3 6.5-5.3s6.5 2.1 6.5 5.3"/><path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M18.3 14.6c1.9.8 3.2 2.5 3.2 4.9"/>',
  newperson: '<circle cx="10" cy="8" r="4"/><path d="M3 20c0-3.6 3-6 7-6 1.2 0 2.3.2 3.2.6M18 14v6M15 17h6"/>',
  update: '<circle cx="12" cy="12" r="8.5"/><path d="M12 16V8M8.5 11.5 12 8l3.5 3.5"/>',
  // the personal portal: a browser window
  window: '<rect x="3" y="4.5" width="18" height="15" rx="2.2"/><path d="M3 9h18M6.3 6.8h.01M8.8 6.8h.01"/>',
  storage: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  filter: '<path d="M4 5h16l-6.2 7.3V19l-3.6-1.8v-4.9z"/>',
  cards: '<rect x="3.5" y="4.5" width="7.5" height="15" rx="2"/><rect x="13" y="4.5" width="7.5" height="15" rx="2"/>',
  map: '<path d="M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z"/><path d="M9 4.5v13M15 6.5v13"/>',
};
