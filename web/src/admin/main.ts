// LuCI module `dawnline.app`: one factory per admin view. The thin files in
// view/dawnline/*.js do `return view.extend(app.<page>())`.

import { PeoplePage } from './pages/people';
import { ServerPage } from './pages/server';
import { SettingsPage } from './pages/settings';
import { HealthPage, UpdatesPage } from './pages/maintenance';
import { PersonPage } from './pages/person';
import { ActivityPage } from './pages/activity';
import { styleNode } from './styles';

interface Page {
  load(): Promise<any>;
  render(data: any): Node | Promise<Node>;
  /** Set by a form page when it rendered something without a form. */
  noFooter?: boolean;
}

function factory<P extends Page>(Cls: new () => P, formBased: boolean) {
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
    // Pages without a form.Map have nothing to save: hide the footer buttons.
    if (!formBased) Object.assign(v, { handleSave: null, handleSaveApply: null, handleReset: null });
    return v;
  };
}

// The old Overview address opens the Servers page (it holds each server's overview now).
const overview = factory(ServerPage, false);
const people = factory(PeoplePage, true);
const server = factory(ServerPage, false);
const settings = factory(SettingsPage, false);
const person = factory(PersonPage, false);
const activity = factory(ActivityPage, false);
const health = factory(HealthPage, false);
const updates = factory(UpdatesPage, false);

export { overview, people, person, activity, server, settings, health, updates };
