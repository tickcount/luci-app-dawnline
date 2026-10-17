#!/usr/bin/env node
// Capture the raw README screenshots from a live router into
// docs/screenshots/raw/<name>.png (2x PNG); scripts/frame-screenshots.py then
// puts them into a browser window for the README.
//
// Drives a headless Chromium (BROWSER=/path/to/chrome, default: Brave or Chrome
// on macOS) over the DevTools protocol, no npm packages. Signs in to LuCI with
// the password from LUCI_PASSWORD or asked on the terminal; the session lives
// only in a throwaway profile (LUCI_USER picks another user than root). Nothing on the router is changed.
//
//   scripts/capture-screenshots.mjs [--router https://router.lan] [--person id]
//                                   [--mask real=shown ...] [--name real=shown ...]
//                                   [--only overview,people]
//
// --mask replaces text on every page before the capture (a domain, a name);
// --name does the same for a person's name in any case, and for their initials.
// Public IPv4 addresses are always swapped for documentation ones (203.0.113.x).

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'docs', 'screenshots', 'raw');
const SCALE = 2;

const args = { router: 'https://outline.lan', person: '', mask: [], names: [], only: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => process.argv[++i] ?? die(`${a} needs a value`);
  if (a === '--router') args.router = v().replace(/\/+$/, '');
  else if (a === '--person') args.person = v();
  else if (a === '--mask') args.mask.push(v().split('=', 2));
  else if (a === '--name') args.names.push(v().split('=', 2));
  else if (a === '--only') args.only = v().split(',');
  else die(`unknown argument ${a}`);
}
if ([...args.mask, ...args.names].some((m) => m.length !== 2 || !m[0])) die('--mask and --name take real=shown');

/** As shared/format initials(): first letters of the first and last word, or the first two of one word. */
const initials = (name) => {
  const p = name.trim().split(/\s+/);
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] ?? ''))).toUpperCase();
};
for (const [real, shown] of args.names)
  args.mask.push([real, shown], [real.toLowerCase(), shown.toLowerCase()], [real.toUpperCase(), shown.toUpperCase()]);
const INITIALS = args.names.map(([real, shown]) => [initials(real), initials(shown)]);

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const LUCI = `${args.router}/cgi-bin/luci/admin/network/dawnline`;
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
      const b = [...document.querySelectorAll('.dl-srvov .dl-panel.flush button')].find((x) => x.textContent.trim() === '30 days');
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
    // Down to the end of Access & limits; activity rows that would be cut are hidden.
    clip: `(() => {
      const c = ${column}, cut = document.querySelector('.dl-grid-person > .dl-col:last-child').getBoundingClientRect().bottom + 40;
      document.querySelectorAll('.dl-grid-person .dl-row').forEach((r) => {
        if (r.getBoundingClientRect().bottom > cut - 8) r.style.visibility = 'hidden';
      });
      return { x: c.x, y: 0, width: c.w, height: cut };
    })()`,
  },
  {
    name: 'access',
    url: () => `${LUCI}/server?section=access`,
    width: 1400,
    ready: 'section.dl-ifcard details',
    // The home network card alone, its folded lists closed.
    prep: `(() => {
      const card = [...document.querySelectorAll('section.dl-ifcard')].find((s) => s.querySelector('details'));
      card.querySelectorAll('details[open]').forEach((d) => (d.open = false));
      card.setAttribute('data-shot', '');
    })()`,
    clip: `(() => {
      const r = document.querySelector('[data-shot]').getBoundingClientRect();
      return { x: r.left - 12, y: r.top - 12, width: r.width + 24, height: r.height + 24 };
    })()`,
  },
  {
    name: 'portal',
    url: (s) => s.portal,
    width: 1320,
    ready: 'body',
    settle: 3000,
    // The content: everything but full-width or full-height wrappers, 36px around it.
    clip: `(() => {
      let l = innerWidth, r = 0, b = 0;
      for (const e of document.body.querySelectorAll('*')) {
        const x = e.getBoundingClientRect();
        if (!x.width || !x.height || x.width > innerWidth - 40 || x.height > innerHeight - 40) continue;
        l = Math.min(l, x.left);
        r = Math.max(r, x.right);
        b = Math.max(b, x.bottom);
      }
      return { x: l - 36, y: 0, width: r - l + 72, height: b + 40 };
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
  const swap = (s) => pairs.reduce((t, [a, b]) => t.split(a).join(b), s).replace(/\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b/g, ip);
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

function findBrowser() {
  const c = [
    process.env.BROWSER,
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ];
  return c.find((b) => b && existsSync(b)) ?? die('No Chromium-based browser found; set BROWSER=/path/to/chrome');
}

/** A page over the DevTools protocol: send(method, params) and waitFor(event). */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method) {
      for (const w of waiters.filter((x) => x.method === msg.method)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.ok(msg.params);
      }
    }
  };
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      pending.set(++id, { ok, fail });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const waitFor = (method) => new Promise((ok) => waiters.push({ method, ok }));
  return { send, waitFor, close: () => ws.close() };
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function main() {
  const pass = await password();
  const profile = mkdtempSync(join(tmpdir(), 'dawnline-shots-'));
  const chrome = spawn(
    findBrowser(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      // The router's certificate is usually for its public name, not router.lan.
      '--ignore-certificate-errors',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      // MapLibre needs WebGL; headless gets it from SwiftShader.
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = await connect(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

    const evaluate = async (expression) => {
      const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const go = async (url) => {
      const loaded = page.waitFor('Page.loadEventFired');
      await page.send('Page.navigate', { url });
      await loaded;
    };
    const waitSel = async (sel, ms = 20000) => {
      for (let t = 0; t < ms; t += 250) {
        if (await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)) return;
        await sleep(250);
      }
      throw new Error(`timed out waiting for ${sel}`);
    };
    // A tall window: Outline scrolls #maincontent, not the page, so it must hold everything.
    const viewport = (width, height = 2600) =>
      page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: SCALE, mobile: false });

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

    // The person to show (the first one on People unless --person) and their personal link.
    const s = { person: args.person, portal: '' };
    await go(`${LUCI}/server?section=people`);
    await waitSel('.dl-srvbody a[href*="dawnline/person"]');
    if (!s.person)
      s.person = await evaluate(
        `new URL(document.querySelector('.dl-srvbody a[href*="dawnline/person"]').href).searchParams.get('id')`,
      );
    s.portal = await evaluate(`L.require('rpc').then((rpc) =>
      rpc.declare({ object: 'luci.dawnline', method: 'person_links', params: ['id'] })(${JSON.stringify(s.person)}))
      .then((r) => r.link ?? r.links?.[0] ?? '')`);

    for (const shot of SHOTS) {
      if (args.only.length && !args.only.includes(shot.name)) continue;
      const url = shot.url(s);
      if (!url) {
        console.log(`skip ${shot.name}: no URL (the portal is off?)`);
        continue;
      }
      await viewport(shot.width);
      await go(url);
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
      writeFileSync(join(RAW, `${shot.name}.png`), Buffer.from(data, 'base64'));
      console.log(`${shot.name}: ${Math.round(clip.width)}x${Math.round(clip.height)} (x${SCALE})`);
    }
    page.close();
  } finally {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((e) => die(e.message));
