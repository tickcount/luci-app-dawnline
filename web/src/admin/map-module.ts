// LuCI module `dawnline.map`: the admin's map (map.ts: MapLibre on a globe,
// its markers, plates and labels), a device's places under it
// (places/render.ts) and their stylesheet, apart from the pages' module
// (main.ts) so that one stays small. A page loads it on demand when it draws
// a map (shell/maps.ts: L.require). Its own copy of what it shares with the
// pages has no state of theirs: `bind` hands it the pages' layer, where the
// marker card floats.

import css from './styles/shadow/maps.css';
import { setLayer } from '../portal/ui/layer';
import { ConnectionMap } from './map';
import { PlacesView } from './places/render';

/** The pages' layer (shell/layer.ts): the marker card goes there, as the sheet and the menus do. */
function bind(root: ShadowRoot) {
  setLayer(root);
}

export { ConnectionMap, PlacesView, css, bind };
