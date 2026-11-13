// The admin's own glass shapes: the objects it has a picture for and the
// portal does not, as data. They come with the stylesheet's module
// (style-module.ts), not with the pages': a page draws glass only once its
// stylesheet stands, and the pages' module is close to its size budget
// (rules/frontend.md). ui/glass.ts draws them and holds the shapes that carry
// a product's mark. A picture draws the thing its place names, and one
// picture has one meaning (DESIGN.md › Glass icon catalogue).

import type { GlassShape } from '../../portal/ui/glass';

/** The app's pane with its dot behind: what most of these are drawn on (the same in ui/glass.ts). */
const DOT = '<circle cx="16" cy="8" r="6"/>';
const PANE = '<rect x="2.5" y="7.5" width="14.5" height="14.5" rx="4.2"/>';
const pane = (d: string): GlassShape => ({ b: DOT, f: PANE, d });

export const SHAPES: Record<string, GlassShape> = {
  person: {
    b: '<rect x="10" y="2" width="12" height="12" rx="4"/>',
    f: '<circle cx="10" cy="8.6" r="4.6"/><path d="M2.2 21.6c0-4.7 3.5-7.7 7.8-7.7s7.8 3 7.8 7.7z"/>',
    d: '<path d="M7.6 18.4h4.8"/>',
  },
  people: {
    b: '<circle cx="16.8" cy="8" r="3.8"/><path d="M11.5 19.5c.4-3.9 2.6-6.4 5.3-6.4s5 2.5 5.2 6.4z"/>',
    f: '<circle cx="8.6" cy="9.2" r="4.2"/><path d="M1.8 21.6c0-4.4 3-7.3 6.8-7.3s6.8 2.9 6.8 7.3z"/>',
    d: '',
  },
  log: {
    b: '<rect x="9" y="2" width="13" height="13" rx="3.2"/>',
    f: '<rect x="2.5" y="6.5" width="15" height="15.5" rx="3.4"/>',
    d: '<path d="M6 11h.3M6 14.5h.3M6 18h.3" stroke-width="2.2"/><path d="M8.8 11h5.4M8.8 14.5h5.4M8.8 18h3.6"/>',
  },
  mask: {
    b: '<circle cx="16" cy="8" r="6"/>',
    f: '<path d="M2.5 10.5c2.6-1.6 5.3-2.2 8-2.2s5.4.6 8 2.2c0 6.2-3.2 10.5-8 10.5s-8-4.3-8-10.5z"/>',
    d: '<path d="M6.3 13.6c.8-.8 2-.8 2.8 0M11.9 13.6c.8-.8 2-.8 2.8 0"/>',
  },
  route: {
    b: '<circle cx="17" cy="7" r="5"/>',
    f: '<rect x="2.5" y="7.5" width="14.5" height="14.5" rx="4.2"/>',
    d: '<circle cx="6.6" cy="17.6" r="1.5"/><circle cx="12.9" cy="11.4" r="1.5"/><path d="M8 16.2l3.5-3.4"/>',
  },
  update: {
    b: '<rect x="12" y="2" width="10" height="10" rx="3"/>',
    f: '<rect x="2.5" y="7.5" width="14.5" height="14.5" rx="4.2"/>',
    d: '<path d="M9.75 18.2v-7M6.9 13.9l2.85-2.8 2.85 2.8"/>',
  },
  backup: {
    b: '<rect x="4" y="2" width="16" height="6" rx="2.4"/>',
    f: '<rect x="2" y="7" width="20" height="15" rx="3.4"/>',
    d: '<path d="M9 12.5h6"/>',
  },
  pulse: pane('<path d="M4.6 15h2.6l1.6-3.4 2.4 6 1.6-2.6h2.2"/>'),
  // a core in general (AmneziaWG today, others to come): a chip
  core: pane(
    '<rect x="6.75" y="11.75" width="6" height="6" rx="1.3"/><path d="M8.4 11.75v-1.7M11.1 11.75v-1.7M8.4 17.75v1.7M11.1 17.75v1.7M6.75 13.4h-1.7M6.75 16.1h-1.7M12.75 13.4h1.7M12.75 16.1h1.7" stroke-width="1.2"/>',
  ),
  // Settings as a whole: two sliders
  settings: pane(
    '<path d="M5.7 12.4h3.3M12.9 12.4h.9M5.7 17.1h.9M10.5 17.1h3.3"/><circle cx="10.95" cy="12.4" r="1.7"/><circle cx="8.55" cy="17.1" r="1.7"/>',
  ),
  // a service at home (a NAS, a camera): a machine in a rack, not a Dawnline server (the portal's `server`)
  service: {
    b: '<rect x="7" y="2" width="15" height="8" rx="2.6"/>',
    f: '<rect x="2" y="8" width="16" height="14" rx="3"/>',
    d: '<path d="M5.5 12.5h.4M5.5 17.5h.4" stroke-width="2.4"/><path d="M2.4 15h15.2" stroke-width="1"/>',
  },
  // what is kept on flash: a store of records
  storage: {
    b: '<ellipse cx="14.5" cy="6.6" rx="7.5" ry="4"/>',
    f: '<path d="M2.5 10.4c0-1.9 3.6-3.4 8-3.4s8 1.5 8 3.4v8.2c0 1.9-3.6 3.4-8 3.4s-8-1.5-8-3.4z"/>',
    d: '<path d="M2.9 11c.8 1.5 3.8 2.6 7.6 2.6s6.8-1.1 7.6-2.6" stroke-width="1.1"/><path d="M6.2 17.6h.4" stroke-width="2.4"/>',
  },
  // a certificate: a sheet with its seal
  cert: {
    b: '<rect x="9.5" y="2" width="12.5" height="14" rx="3"/>',
    f: '<rect x="2.5" y="6" width="15.5" height="16" rx="3.2"/>',
    d: '<path d="M6 10.4h8.4M6 13.6h3.6"/><circle cx="12.4" cy="16.4" r="2"/><path d="M11.4 18.2v2M13.4 18.2v2" stroke-width="1.2"/>',
  },
  // a place on the map
  pin: {
    b: DOT,
    f: '<path d="M10.5 22.2c-.5 0-7-5.6-7-11.2a7 7 0 0 1 14 0c0 5.6-6.5 11.2-7 11.2z"/>',
    d: '<circle cx="10.5" cy="11" r="2.4"/>',
  },
  wifi: pane('<path d="M5.2 13.4a6.4 6.4 0 0 1 9.1 0M7.3 15.9a3.5 3.5 0 0 1 4.9 0"/><path d="M9.75 18.5h.01" stroke-width="2.2"/>'),
  // the way in: an arrow through a door; leaving: the same door, the arrow out
  entry: pane('<path d="M5.2 14.75h5.4M8 12l2.75 2.75L8 17.5"/><path d="M11.6 10.6h1.7a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1h-1.7"/>'),
  out: pane('<path d="M7.9 10.6H6.2a1 1 0 0 0-1 1v6.3a1 1 0 0 0 1 1h1.7"/><path d="M8.6 14.75h5.6M11.6 12l2.75 2.75-2.75 2.75"/>'),
  // a tunnel: its mouth and the road into it
  tunnel: {
    b: '<rect x="9" y="2" width="13" height="13" rx="4"/>',
    f: '<path d="M2.5 22v-8.5a8 8 0 0 1 16 0V22z"/>',
    d: '<path d="M6.8 21.6v-7.9a3.7 3.7 0 0 1 7.4 0v7.9"/><path d="M10.5 15.6v1.5M10.5 19.2v1.4"/>',
  },
  // a person to come: the plus on them
  newperson: {
    b: '<rect x="10" y="2" width="12" height="12" rx="4"/>',
    f: '<circle cx="10" cy="8.6" r="4.6"/><path d="M2.2 21.6c0-4.7 3.5-7.7 7.8-7.7s7.8 3 7.8 7.7z"/>',
    d: '<path d="M10 16.1v4.4M7.8 18.3h4.4"/>',
  },
};
