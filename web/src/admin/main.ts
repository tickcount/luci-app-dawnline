// LuCI module `dawnline.app`: one factory per admin view. The thin files in
// view/dawnline/*.js do `return view.extend(app.<page>())`.

import { PeoplePage } from './pages/people';
import { ServerPage } from './pages/server';
import { SettingsPage } from './pages/settings';
import { ComponentsPage } from './pages/components';
import { PersonPage } from './pages/person';
import { DiagnosticsPage } from './pages/diagnostics';
import { styleNode } from './styles';

interface Page {
  load(): Promise<any>;
  render(data: any): Node | Promise<Node>;
  /** No footer at all (otherwise LuCI's, without its form buttons). */
  noFooter?: boolean;
}

function factory<P extends Page>(Cls: new () => P) {
  return () => {
    const page = new Cls();
    const v: Record<string, unknown> = {
      load: () => page.load(),
      render: async (data: unknown) => {
        const node = await page.render(data);
        const root = document.createElement('div');
        root.className = 'dl-root';
        root.append(styleNode(), node);
        return root;
      },
      addFooter(this: any) {
        return page.noFooter ? document.createElement('div') : this.super('addFooter', []);
      },
    };
    // No page is a LuCI form (changes go through RPC): nothing to Save & Apply.
    return Object.assign(v, { handleSave: null, handleSaveApply: null, handleReset: null });
  };
}

// The old Overview address opens the Servers page (it holds each server's overview now).
const overview = factory(ServerPage);
const people = factory(PeoplePage);
const server = factory(ServerPage);
const settings = factory(SettingsPage);
const person = factory(PersonPage);
const diagnostics = factory(DiagnosticsPage);
const updates = factory(ComponentsPage);

/** Health and Activity became Diagnostics tabs: old addresses and bookmarks go there. */
function moved(tab: '' | 'log') {
  return () => ({
    load: () => {
      ui.menu?.flushCache();
      location.replace(`${L.url('admin/services/dawnline/diagnostics')}${tab ? `?tab=${tab}` : ''}`);
      return new Promise(() => {});
    },
    render: () => document.createElement('div'),
    handleSave: null,
    handleSaveApply: null,
    handleReset: null,
  });
}
const health = moved('');
const activity = moved('log');

export { overview, people, person, activity, server, settings, health, diagnostics, updates };
