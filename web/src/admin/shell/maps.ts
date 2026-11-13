// The map's own LuCI module (map-module.ts, `dawnline.map`), loaded the first
// time a page draws a map and kept for the session: LuCI fetches it once
// (cached like every module) and every later map is drawn at once. Its
// stylesheet joins the pages' in every host (host.ts), and it is handed the
// layer its marker card floats in.

import type * as Kit from '../map-module';
import { layer } from '../../portal/ui/layer';
import { addSheet } from './host';

export type MapKit = typeof Kit;

let kit: Promise<MapKit> | null = null;

/** The map's module; rejects with words for the page when it could not be loaded (it is asked again next time). */
export function loadMaps(): Promise<MapKit> {
  kit ??= L.require('dawnline.map').then(
    (m) => {
      const k = m as MapKit;
      const root = layer();
      if (root instanceof ShadowRoot) k.bind(root);
      addSheet(k.css);
      return k;
    },
    () => {
      kit = null;
      throw new Error(_('Could not load the map. Reload the page to try again.'));
    },
  );
  return kit;
}
