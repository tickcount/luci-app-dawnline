#!/usr/bin/env node
// Capture the raw README screenshots of the personal portal into
// docs/screenshots/raw/ (2x PNG): the page (portal.png) and the three steps of
// adding a phone in front of it (portal-add-1..3.png: Add a device, the set-up
// sheet waiting, the phone connected), each sheet alone on a transparent page.
// The Russian ones take a -ru suffix. scripts/frame-screenshots.py then frames
// them for the README.
//
// The portal is its demo build (web/dist/demo, `npm run build:demo`, built
// first unless --no-build): the real portal over a router that lives in the
// page, so no one's real page is shown and adding a device adds none. It is
// opened as https://vpn.example.com/<code> and every file is answered from the
// build over the DevTools protocol (scripts/cdp.mjs), so its personal link
// reads like one. The cast is made up here: the demo's own three devices (the
// ones its router keeps, so adding one works) under other names, three more
// shown beside them, and the person's and the server's names.
//
//   scripts/capture-portal.mjs [--lang en,ru] [--no-build]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { die, launch, sleep } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const DEMO = join(WEB, 'dist', 'demo');
const RAW = join(ROOT, 'docs', 'screenshots', 'raw');
const SCALE = 2;
/** The page's width, as the README shot always had it. */
const WIDTH = 1320;
/** Around a sheet in its capture: left, top, right, bottom (frame-screenshots.py FLOW_MARGIN). */
const MARGIN = [56, 40, 56, 72];
const ORIGIN = 'https://vpn.example.com';
/** The demo's personal link (web/src/portal/demo/index.html, data-base). */
const CODE = 'kelino-sarupa-motive';
const NAMES = { person: 'Aemeath', server: 'Ames Gateway' };
/** The device this page is open on (its card says "This device"). */
const HERE = 'MacBook Air';
/** The phone added in the steps. */
const NEW = 'Pixel 9';
const SLOTS = 8;

const args = { langs: ['en', 'ru'], build: true };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--lang') args.langs = (process.argv[++i] ?? die('--lang needs a value')).split(',');
  else if (a === '--no-build') args.build = false;
  else die(`unknown argument ${a}`);
}

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

/**
 * What the demo's router keeps (its DemoDb, in localStorage before the page loads): three devices, so one more
 * fits its limit of four and the steps add it for real.
 */
function demoDb(t) {
  const dev = (id, name, kind, n, gb, hs, days) => ({
    id,
    name,
    kind,
    n,
    gb,
    hs,
    connectAt: 0,
    created: t - days * DAY,
    by: 'admin',
    stale: false,
  });
  return {
    scenario: 'normal',
    devs: [
      dev('d_mac', HERE, 'computer', 2, 5.4, t - 20, 60),
      dev('d_iph', 'iPhone 16', 'phone', 3, 2.3, t - 40, 58),
      dev('d_gal', 'Galaxy S24', 'phone', 4, 0.66, t - 26 * 3600, 30),
    ],
    next: 5,
  };
}

/**
 * The page's side, before it loads: the language, the router's devices, the demo's own chrome hidden, and every
 * answer of its router touched on the way to the page (the names, this device, the slots, the devices shown
 * beside the ones it keeps).
 */
const prelude = (lang, db) => `(() => {
  try {
    localStorage.setItem('dl.lang', ${JSON.stringify(lang)});
    localStorage.setItem('dawnline-demo', ${JSON.stringify(JSON.stringify(db))});
  } catch {}
  const NAMES = ${JSON.stringify(NAMES)}, HERE = ${JSON.stringify(HERE)}, SLOTS = ${SLOTS};
  const extra = (devs, t) => {
    const like = (d, o) => ({ ...d, link: null, setup: null, online: false, config_stale: false, created_by: 'admin', ...o });
    const mac = devs.find((d) => d.name === HERE) ?? devs[0];
    const none = { handshake: 0, endpoint: '', month: [0, 0], total: [0, 0], spark: mac.spark.map(() => [0, 0]) };
    const scale = (p, f) => p.map((v) => Math.round(v * f));
    return [
      like(mac, { id: 'x_tv', name: 'Living room TV', kind: 'other', address: '10.8.0.6', handshake: t - 3 * 3600,
        config_stale: true, month: scale(mac.month, 1.13), total: scale(mac.total, 1.4),
        spark: mac.spark.map((p) => scale(p, 1.1)), created: t - 45 * 86400 }),
      like(mac, { id: 'x_ipad', name: 'iPad', kind: 'tablet', address: '10.8.0.7', created: t - 2 * 86400, ...none }),
      like(mac, { id: 'x_rtr', name: 'Cottage router', kind: 'router', address: '10.8.0.8', created: t - 86400, ...none }),
    ];
  };
  const touch = (st) => {
    if (!st?.person) return;
    const own = st.person.devices;
    st.person.name = NAMES.person;
    if (st.server) st.server.name = NAMES.server;
    st.person.devices = [...own, ...extra(own, st.now)];
    st.person.device_limit = SLOTS;
    st.can_add = st.person.devices.length < SLOTS;
    st.here = own.find((d) => d.name === HERE)?.id ?? null;
  };
  let inner = window.fetch;
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    get: () => inner,
    // The demo's router takes fetch over (demo/serve.ts): its answers pass through here.
    set: (f) => {
      inner = async (...a) => {
        const r = await f(...a);
        if (!String(a[0] instanceof Request ? a[0].url : a[0]).includes('/api/')) return r;
        let j;
        try { j = await r.clone().json(); } catch { return r; }
        touch(j?.person ? j : j?.state);
        return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } });
      };
    },
  });
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    // The demo's chip, GitHub knob and set-up state switch go, and the path takes the row again, as on a router's
    // page.
    s.textContent = '.dm-chip, .dm-gh, .dm-way { display: none !important; } .cr-path { flex: 1 !important; }';
    document.head.append(s);
  });
})()`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

/** Answer the page's requests from the demo build: its page for the personal link, its files by name. */
async function serve(page) {
  page.on('Fetch.requestPaused', async (e) => {
    const path = new URL(e.request.url).pathname;
    const file = path === `/${CODE}` || path === '/' ? 'index.html' : path.slice(1);
    let body;
    try {
      body = readFileSync(join(DEMO, file));
    } catch {
      await page.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 404, body: '' }).catch(() => {});
      return;
    }
    await page.send('Fetch.fulfillRequest', {
      requestId: e.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: TYPES[extname(file)] ?? 'application/octet-stream' }],
      body: body.toString('base64'),
    });
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: `${ORIGIN}/*`, requestStage: 'Request' }] });
}

async function shoot(page, file, clip) {
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...clip, scale: 1 },
    captureBeyondViewport: true,
  });
  writeFileSync(join(RAW, file), Buffer.from(data, 'base64'));
  console.log(`${file}: ${Math.round(clip.width)}x${Math.round(clip.height)} (x${SCALE})`);
}

// The page's content: everything on screen but full-width or full-height wrappers, 36px around it (as the
// README shot always was; what waits off screen, as a field's measuring copy does, is no content).
const PAGE_CLIP = `(() => {
  let l = innerWidth, r = 0, b = 0;
  for (const e of document.querySelectorAll('#app *')) {
    const x = e.getBoundingClientRect();
    if (!x.width || !x.height || x.width > innerWidth - 40 || x.height > innerHeight - 40) continue;
    if (x.left < 0 || x.right > innerWidth) continue;
    l = Math.min(l, x.left);
    r = Math.max(r, x.right);
    b = Math.max(b, x.bottom);
  }
  return { x: l - 36, y: 0, width: r - l + 72, height: b + 40 };
})()`;

// The open sheet alone: the page and the scrim out of sight on a transparent page, MARGIN around the sheet.
const SHEET_CLIP = `(() => {
  const r = document.querySelector('.sheet-root.open .sheet').getBoundingClientRect();
  const [l, t, rr, b] = ${JSON.stringify(MARGIN)};
  return { x: r.left - l, y: r.top - t, width: r.width + l + rr, height: r.height + t + b };
})()`;
const ALONE = `(() => {
  const s = document.createElement('style');
  s.id = 'alone';
  s.textContent = 'html, body { background: transparent !important; } #app { visibility: hidden !important; } .scrim { display: none !important; }';
  document.head.append(s);
})()`;

async function capture(lang) {
  const suffix = lang === 'en' ? '' : `-${lang}`;
  const b = await launch([`--lang=${lang}`]);
  const { page, evaluate, go, waitSel } = b;
  try {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1400, deviceScaleFactor: SCALE, mobile: false });
    // Where the page paints nothing (a sheet alone), the capture is transparent.
    await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await serve(page);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: prelude(lang, demoDb(now())) });
    await go(`${ORIGIN}/${CODE}`);
    await waitSel('.dev[data-id]');
    await sleep(2500);
    await shoot(page, `portal${suffix}.png`, await evaluate(PAGE_CLIP));

    // 1: Add a device, a phone, its name typed in.
    await evaluate(`document.querySelector('.dev.add').click()`);
    await waitSel('.sheet-root.open .kinds');
    await sleep(900);
    await evaluate(`document.querySelectorAll('.sheet-root.open .kind')[1].click()`);
    await sleep(500);
    await evaluate(`(() => { const i = document.querySelector('.sheet-root.open .field input'); i.focus(); i.select(); })()`);
    await page.send('Input.insertText', { text: NEW });
    await evaluate(`document.activeElement.blur()`);
    await sleep(900);
    await evaluate(ALONE);
    await shoot(page, `portal-add-1${suffix}.png`, await evaluate(SHEET_CLIP));
    await evaluate(`document.getElementById('alone').remove()`);

    // 2: the set-up sheet, waiting for the phone, its link open as a code for the phone's camera (the page
    // opens on the app's row, whose code a key makes too dense to read at this size).
    await evaluate(`document.querySelector('.sheet-root.open .field .go').click()`);
    await waitSel('.sheet-root.open .way');
    await sleep(1200);
    await evaluate(`document.querySelector('.sheet-root.open .acc-row:not(.open) .acc-head').click()`);
    await sleep(1500);
    await evaluate(ALONE);
    await shoot(page, `portal-add-2${suffix}.png`, await evaluate(SHEET_CLIP));
    await evaluate(`document.getElementById('alone').remove()`);

    // 3: connected (the demo's phone does within 6-9 s), what was under the way folded away.
    await waitSel('.sheet-root.open .way.done', 15000);
    await sleep(1150);
    await evaluate(ALONE);
    await shoot(page, `portal-add-3${suffix}.png`, await evaluate(SHEET_CLIP));
    page.close();
  } finally {
    await b.close();
  }
}

async function main() {
  if (args.build) execFileSync('npm', ['run', '--silent', 'build:demo'], { cwd: WEB, stdio: 'inherit' });
  for (const lang of args.langs) await capture(lang);
}

main().catch((e) => die(e.message));
