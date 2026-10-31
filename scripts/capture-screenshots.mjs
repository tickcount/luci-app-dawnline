#!/usr/bin/env node
// Capture the raw README screenshots of the admin pages from a live router into
// docs/screenshots/raw/<name>.png (2x PNG); scripts/frame-screenshots.py then
// frames them for the README. The portal's come from its demo instead
// (scripts/capture-portal.mjs): no one's real page, and adding a device there adds none.
//
// Drives a headless Chromium (BROWSER=/path/to/chrome, default: Brave or Chrome
// on macOS) over the DevTools protocol (scripts/cdp.mjs). Signs in to LuCI with
// the password from LUCI_PASSWORD or asked on the terminal; the session lives
// only in a throwaway profile (LUCI_USER picks another user than root). Nothing on the router is changed.
//
//   scripts/capture-screenshots.mjs [--router https://router.lan] [--person id]
//                                   [--mask real=shown ...] [--name real=shown ...]
//                                   [--only overview,people] [--demo] [--lang ru]
//
// --lang asks LuCI for the pages in that language (its catalog, po/<lang>/dawnline.po;
// the router's LuCI language left on auto) and names the captures <name>-<lang>.png
// for that README (README_ru.md); English (the default) keeps <name>.png.
// --mask replaces text on every page before the capture (a domain, a name);
// --name does the same for a person's name in any case, and for their initials.
// Public IPv4 addresses are always swapped for documentation ones (203.0.113.x).
// --demo shows a made-up cast instead of the router's people (scripts/screenshot-demo.mjs):
// the router's answers are rewritten in the headless browser on their way to the page.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { die, launch, sleep } from './cdp.mjs';
import { demoRpc } from './screenshot-demo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'docs', 'screenshots', 'raw');
const SCALE = 2;

const args = {
  router: 'https://outline.lan',
  person: '',
  mask: [],
  names: [],
  only: [],
  demo: false,
  lang: 'en',
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => process.argv[++i] ?? die(`${a} needs a value`);
  if (a === '--router') args.router = v().replace(/\/+$/, '');
  else if (a === '--person') args.person = v();
  else if (a === '--mask') args.mask.push(v().split('=', 2));
  else if (a === '--name') args.names.push(v().split('=', 2));
  else if (a === '--only') args.only = v().split(',');
  else if (a === '--demo') args.demo = true;
  else if (a === '--lang') args.lang = v();
  else die(`unknown argument ${a}`);
}
const SUFFIX = args.lang === 'en' ? '' : `-${args.lang}`;

/** The admin's catalog for --lang: msgid -> msgstr, the entries without a context (English: none). */
const CATALOG = (() => {
  const out = new Map();
  if (args.lang === 'en') return out;
  let po;
  try {
    po = readFileSync(join(ROOT, 'package', 'luci-app-dawnline', 'po', args.lang, 'dawnline.po'), 'utf8');
  } catch {
    die(`no admin catalog for --lang ${args.lang}`);
  }
  for (const m of po.matchAll(/^(msgctxt .*\n)?msgid "(.*)"\nmsgstr "(.*)"$/gm)) if (!m[1] && m[3]) out.set(m[2], m[3]);
  return out;
})();
/** A button's words as the page shows them in --lang (the pages are clicked by what they say). */
const tr = (id) => CATALOG.get(id) ?? id;
if ([...args.mask, ...args.names].some((m) => m.length !== 2 || !m[0])) die('--mask and --name take real=shown');

/** As shared/format initials(): first letters of the first and last word, or the first two of one word. */
const initials = (name) => {
  const p = name.trim().split(/\s+/);
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] ?? ''))).toUpperCase();
};
for (const [real, shown] of args.names)
  args.mask.push([real, shown], [real.toLowerCase(), shown.toLowerCase()], [real.toUpperCase(), shown.toUpperCase()]);
const INITIALS = args.names.map(([real, shown]) => [initials(real), initials(shown)]);

const LUCI = `${args.router}/cgi-bin/luci/admin/services/dawnline`;
const USER = process.env.LUCI_USER || 'root';

/*
 * Each shot: the page, what must be on it before the capture, what to do
 * first (in the page), and the area to keep (in the page, CSS pixels).
 * Admin pages keep the theme's header and the content column, 48px either side.
 */
const column = `(() => {
  const r = document.querySelector('.dl-root').getBoundingClientRect();
  return { x: r.left - 48, w: r.width + 96 };
})()`;
// From the top down to an element; whatever follows it is hidden, not cut through.
const below = (sel) => `(() => {
  const c = ${column}, el = document.querySelector(${JSON.stringify(sel)});
  for (let e = el; e && !e.classList.contains('dl-root'); e = e.parentElement)
    for (let n = e.nextElementSibling; n; n = n.nextElementSibling) n.style.visibility = 'hidden';
  return { x: c.x, y: 0, width: c.w, height: el.getBoundingClientRect().bottom + 40 };
})()`;

const SHOTS = [
  {
    name: 'overview',
    url: () => `${LUCI}/server`,
    width: 1400,
    ready: '.dl-srvov .dl-panel.flush .maplibregl-canvas',
    // The map shows the last 30 days, not only who is online now.
    prep: `(() => {
      const b = [...document.querySelectorAll('.dl-srvov .dl-panel.flush button')].find((x) => x.textContent.trim() === ${JSON.stringify(tr('30 days'))});
      b?.click();
    })()`,
    settle: 6000,
    clip: below('.dl-srvov .dl-panel.flush'),
  },
  {
    name: 'people',
    url: () => `${LUCI}/server?section=people`,
    width: 1400,
    ready: '.dl-srvbody a[href*="dawnline/person"]',
    clip: below('.dl-srvbody'),
  },
  {
    name: 'person',
    url: (s) => `${LUCI}/person?id=${encodeURIComponent(s.person)}`,
    width: 1400,
    ready: '.dl-grid-person .dl-row',
    // Where they connected from, on the map.
    prep: `(() => {
      const b = [...document.querySelectorAll('.dl-grid-person button')].find((x) => x.textContent.trim() === ${JSON.stringify(tr('Show map'))});
      b?.click();
    })()`,
    settle: 6000,
    // Down to the end of Access & limits or of the map, whichever is lower; activity rows that would be cut are hidden.
    clip: `(() => {
      const c = ${column}, cols = document.querySelectorAll('.dl-grid-person > .dl-col');
      const places = cols[0].children[2];
      const cut = Math.max(cols[1].getBoundingClientRect().bottom, places ? places.getBoundingClientRect().bottom : 0) + 40;
      document.querySelectorAll('.dl-grid-person .dl-row').forEach((r) => {
        if (r.getBoundingClientRect().bottom > cut - 8) r.style.visibility = 'hidden';
      });
      // Activity that would start right at the cut goes too, its heading with it.
      const act = cols[0].children[3];
      if (act && act.getBoundingClientRect().top > cut - 120) act.style.visibility = 'hidden';
      return { x: c.x, y: 0, width: c.w, height: cut };
    })()`,
  },
];

const MASK = `((pairs, inits) => {
  const doc = new Map();
  const isPrivate = (a) => a[0] === 10 || a[0] === 127 || (a[0] === 172 && a[1] >= 16 && a[1] < 32) ||
    (a[0] === 192 && a[1] === 168) || (a[0] === 100 && a[1] >= 64 && a[1] < 128) || a[0] === 0 || a[0] >= 224;
  const ip = (m) => {
    const a = m.split('.').map(Number);
    if (a.some((x) => x > 255) || isPrivate(a)) return m;
    if (!doc.has(m)) doc.set(m, '203.0.113.' + (24 + doc.size));
    return doc.get(m);
  };
  // IPv6 too, unless link-local or private (fe80::, fc00::/7).
  const ip6 = (m) => {
    if (/^(fe8|fe9|fea|feb|fc|fd)/i.test(m)) return m;
    if (!doc.has(m)) doc.set(m, '2001:db8::' + (24 + doc.size));
    return doc.get(m);
  };
  const swap = (s) =>
    pairs
      .reduce((t, [a, b]) => t.split(a).join(b), s)
      .replace(/\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b/g, ip)
      .replace(/\\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\\b/gi, ip6);
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode()); ) {
    const ini = inits.find(([a]) => n.nodeValue.trim() === a);
    const v = ini ? n.nodeValue.replace(ini[0], ini[1]) : swap(n.nodeValue);
    if (v !== n.nodeValue) n.nodeValue = v;
  }
  document.querySelectorAll('input').forEach((i) => { const v = swap(i.value); if (v !== i.value) i.value = v; });
})(${JSON.stringify(args.mask)}, ${JSON.stringify(INITIALS)})`;

async function password() {
  if (process.env.LUCI_PASSWORD) return process.env.LUCI_PASSWORD;
  if (!process.stdin.isTTY) die('Set LUCI_PASSWORD or run on a terminal');
  process.stdout.write(`LuCI password for ${USER}: `);
  execFileSync('stty', ['-echo'], { stdio: 'inherit' });
  try {
    const rl = createInterface({ input: process.stdin });
    const line = await new Promise((ok) => rl.once('line', ok));
    rl.close();
    return line.replace(/\r$/, '');
  } finally {
    execFileSync('stty', ['echo'], { stdio: 'inherit' });
    process.stdout.write('\n');
  }
}

async function main() {
  const pass = await password();
  // The router's certificate is usually for its public name, not router.lan.
  const b = await launch(['--ignore-certificate-errors', `--lang=${args.lang}`]);
  const { page, evaluate, go, waitSel } = b;
  try {
    // LuCI on auto speaks the browser's language: this one, whatever this computer's is.
    await page.send('Network.enable');
    await page.send('Network.setExtraHTTPHeaders', { headers: { 'Accept-Language': args.lang } });
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    });
    // The person shown on the Person page; known once People has loaded (or from --person).
    const s = { person: args.person };
    if (args.demo) {
      page.on('Fetch.requestPaused', async (e) => {
        try {
          const r = await page.send('Fetch.getResponseBody', {
            requestId: e.requestId,
          });
          const body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
          const out = demoRpc(e.request.postData ?? '', body, s.person);
          await page.send('Fetch.fulfillRequest', {
            requestId: e.requestId,
            responseCode: e.responseStatusCode ?? 200,
            responseHeaders: e.responseHeaders ?? [],
            body: Buffer.from(out, 'utf8').toString('base64'),
          });
        } catch {
          await page.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {});
        }
      });
      await page.send('Fetch.enable', {
        patterns: [{ urlPattern: '*ubus*', requestStage: 'Response' }],
      });
    }

    // A tall window: Outline scrolls #maincontent, not the page, so it must hold everything.
    const viewport = (width, height = 2600) =>
      page.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: SCALE,
        mobile: false,
      });

    await viewport(1400);
    await go(`${args.router}/cgi-bin/luci/`);
    if (await evaluate(`!!document.querySelector('input[name=luci_password]')`)) {
      await evaluate(`(() => {
        document.querySelector('input[name=luci_username]').value = ${JSON.stringify(USER)};
        document.querySelector('input[name=luci_password]').value = ${JSON.stringify(pass)};
      })()`);
      const loaded = page.waitFor('Page.loadEventFired');
      await evaluate(`document.querySelector('form.login-form, form').submit()`);
      await loaded;
      if (await evaluate(`!!document.querySelector('input[name=luci_password]')`))
        die(
          (await evaluate(`!!document.querySelector('.login-error')`))
            ? `LuCI login failed: wrong password for ${USER} (LUCI_USER sets the user)`
            : `LuCI login failed: still on the login page (${await evaluate('location.href')})`,
        );
    }

    // The person to show: the first one on People unless --person.
    await go(`${LUCI}/server?section=people`);
    await waitSel('.dl-srvbody a[href*="dawnline/person"]');
    if (!s.person)
      s.person = await evaluate(`new URL(document.querySelector('.dl-srvbody a[href*="dawnline/person"]').href).searchParams.get('id')`);

    for (const shot of SHOTS) {
      if (args.only.length && !args.only.includes(shot.name)) continue;
      await viewport(shot.width);
      await go(shot.url(s));
      await waitSel(shot.ready);
      await sleep(2000);
      if (shot.prep) await evaluate(shot.prep);
      await sleep(shot.settle ?? 1500);
      await evaluate(MASK);
      const clip = await evaluate(shot.clip);
      const { data } = await page.send('Page.captureScreenshot', {
        format: 'png',
        clip: { ...clip, scale: 1 },
        captureBeyondViewport: true,
      });
      writeFileSync(join(RAW, `${shot.name}${SUFFIX}.png`), Buffer.from(data, 'base64'));
      console.log(`${shot.name}${SUFFIX}: ${Math.round(clip.width)}x${Math.round(clip.height)} (x${SCALE})`);
    }
    page.close();
  } finally {
    await b.close();
  }
}

main().catch((e) => die(e.message));
