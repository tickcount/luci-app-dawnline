// The admin's demo (npm run build:demo → dist/admin-demo): the admin's real pages outside LuCI, over a router that
// lives in the page and is all made up (cast.ts, past.ts, status.ts, router.ts, serve.ts), inside the Outline
// theme's shell (index.html, shell.ts; the theme's own files are not here: whoever serves the page serves them at
// /luci-static/outline). It is what the README's pictures of the admin are taken from
// (scripts/capture-screenshots.mjs), so nobody's router, people or addresses are ever in them. It answers what
// those pages ask and refuses the rest: not a demo for visitors, as the portal's is (portal/demo).
//
// This file is LuCI's part: it hands the admin its modules and runs the view the address names, as LuCI runs a
// view (load, then render into #view). The order of the imports is the boot order: LuCI's globals, then the
// router at its door, then the admin.

import { provide } from './luci';
import './serve';
import * as app from '../main';
import * as style from '../style-module';
import * as map from '../map-module';
import * as qr from '../qr-module';
import { here } from '../shell/routes';
import { drawShell } from './shell';

// On a router these are LuCI modules of their own, fetched when asked for (shell/style.ts, maps.ts, qr.ts).
provide('dawnline.style', style);
provide('dawnline.map', map);
provide('dawnline.qr', qr);

interface View {
  load(): Promise<unknown>;
  render(data: never): Node;
}

async function open(): Promise<void> {
  drawShell();
  const make = (app as Record<string, (() => View) | undefined>)[here().view] ?? app.overview;
  const view = make();
  const data = await view.load();
  document.getElementById('view')?.replaceChildren(view.render(data as never));
}

void open();
