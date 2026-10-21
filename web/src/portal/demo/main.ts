// The portal demo (npm run build:demo → dist/demo, a static site): the real
// portal over a router that lives in the page (serve.ts, router.ts, data.ts),
// with a scenario picker and a GitHub link in the breadcrumb (crumbs.ts,
// picker.ts) and a set-up state switch in the set-up sheet (way-pick.ts). The order of the imports is the boot order: the router owns
// fetch before the portal loads.

// First: the translation globals, before anything draws.
import { addCatalog } from '../i18n';
import ru from './i18n/ru.po';
import { router } from './serve';
import '../main';
import { toast } from '../ui/feedback';
import { mountCrumbs } from './crumbs';
import { mountWayPick } from './way-pick';

// The demo's own words (the scenarios, its chip and toasts), beside the portal's.
addCatalog('ru', ru);
mountCrumbs(router);
mountWayPick(router);

// An AmneziaVPN key would add a server that connects nowhere to the visitor's app: the demo keeps it on the page.
document.addEventListener(
  'click',
  (e) => {
    if (!(e.target as Element).closest?.('a[href^="vpn:"]')) return;
    e.preventDefault();
    e.stopPropagation();
    toast(_('Demo keys connect nowhere'), true);
  },
  true,
);
