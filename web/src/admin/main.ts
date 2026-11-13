// LuCI module `dawnline.app`: the admin's pages on the portal's design system
// inside LuCI, one factory per view; the thin files in view/dawnline/*.js do
// `return view.extend(app.<page>())` with `'require dawnline.app as app'`. A
// page renders into a Shadow DOM host (shell/host.ts) with its own section row;
// what floats above it goes in the layer on <body> (shell/layer.ts). Two
// modules of its own come with it: the stylesheet (`dawnline.style`, loaded
// with each view's data: shell/style.ts) and the map (`dawnline.map`, loaded
// when a page draws one: shell/maps.ts). The old addresses (menu.d nodes kept
// for bookmarks, links in notes and the history) are views here too, each
// sending the browser on at once (shell/redirects.ts).

import { standStill } from '../portal/motion';
import { tipsLeaveWith } from '../portal/ui/tip';
import { onNavigate } from './ui/nav';
import { shadowHost } from './shell/host';
import { useLayer } from './shell/layer';
import { redirected } from './shell/moved';
import { loadStyle } from './shell/style';
import { pageView, type Page } from './shell/view';
import { setPages, stagePage, type Kind } from './shell/pages';
import { OverviewPage, type OverviewData } from './pages/overview';
import { LogPage, type LogData } from './pages/log';
import { ServerPage, type ServerData } from './pages/server';
import { SettingsPage, type SettingsPageData } from './pages/settings';

// The admin's pages stand still: a change is drawn in place at once; only a page or a view coming in (its blocks
// rise, ui/entrance.ts) and what is opened or pressed move (a sheet, a menu, a toast, a switch, a track's pill, the
// map). DESIGN.md › Motion › 16.
standStill();
// a tooltip goes with the page it stood on
tipsLeaveWith(onNavigate);

/** No LuCI form (changes go through RPC): no footer, nothing to Save & Apply. */
const noForm = {
  addFooter: () => document.createElement('div'),
  handleSave: null,
  handleSaveApply: null,
  handleReset: null,
};

function factory<D>(Cls: new () => Page<D>, kind: Kind) {
  return () => ({
    ...pageView(
      () => new Cls(),
      redirected,
      (page, got, css) => {
        useLayer(css);
        const { host, root } = shadowHost(css, 'dl-host');
        // the page on screen from here on: a move to another page of Dawnline's changes it in place (shell/pages.ts)
        stagePage(root, page, got, kind);
        return host;
      },
      loadStyle,
    ),
    ...noForm,
  });
}

/** A node that only leads elsewhere now: its view sends the browser on. */
function moved() {
  return () => ({
    load: () => redirected() ?? Promise.resolve(null),
    render: () => document.createElement('div'),
    ...noForm,
  });
}

const overview = factory<OverviewData>(OverviewPage, 'overview');
const log = factory<LogData>(LogPage, 'log');
// A server's page is two views: `server` (its Overview and its settings) and `people` (its people and their places,
// the People page inside the server's frame, so every address of a person or a device stays what it was).
const server = factory<ServerData>(ServerPage, 'server');
const people = factory<ServerData>(ServerPage, 'server');
// Settings sends its own old queries on (?section=, ?tab=) before it loads anything.
const settings = factory<SettingsPageData>(SettingsPage, 'settings');

// every page by its kind, for a move from one to another inside the view
setPages({
  overview: () => new OverviewPage(),
  log: () => new LogPage(),
  server: () => new ServerPage(),
  settings: () => new SettingsPage(),
});

// A person and a device are panels of a server's People, Places its map view, the router's own settings sections of
// Settings, Health a part of Overview: their nodes send the browser there.
const person = moved();
const device = moved();
const places = moved();
const system = moved();
const activity = moved();
const health = moved();
const diagnostics = moved();
const updates = moved();

export { overview, log, places, device, people, person, server, system, activity, health, diagnostics, settings, updates };
