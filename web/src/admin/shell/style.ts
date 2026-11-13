// The pages' stylesheet, a LuCI module of its own (style-module.ts,
// `dawnline.style`): a view asks for it alongside its data, LuCI fetches it
// once per page load and hands the same text to every later view. Each view
// file (htdocs/.../view/dawnline/*.js) also names it beside `dawnline.app`, so
// LuCI fetches the two together: asked for only from here it would start
// after the app has come and run, and a page would wait that much longer.

import type { GlassShape } from '../../portal/ui/glass';
import { addIcons } from '../../shared/icons';
import { addGlass } from '../ui/glass';

interface StyleModule {
  css: string;
  /** The admin's line icons and the marks a page draws as soon as it stands: added to the icons when the module comes. */
  icons: Record<string, string>;
  /** The admin's glass shapes: added to its glass the same way. */
  glass: Record<string, GlassShape>;
}

let mod: Promise<StyleModule> | null = null;

function load() {
  mod ??= (L.require('dawnline.style') as Promise<StyleModule>).then(
    (m) => {
      addIcons(m.icons);
      addGlass(m.glass);
      return m;
    },
    () => {
      mod = null;
      throw new Error(_('Could not load the page’s styles. Reload the page to try again.'));
    },
  );
  return mod;
}

/** The stylesheet's text; rejects with words for the page when it could not be loaded (asked again next time). */
export const loadStyle = (): Promise<string> => load().then((m) => m.css);
