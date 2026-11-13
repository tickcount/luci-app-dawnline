#!/usr/bin/env node
// Capture the raw README screenshots of the admin into docs/screenshots/raw/ (2x PNG): People (people.png), a
// person's page (person.png), Places (places.png), a server's core settings (core.png), each cut to the content
// column, and a device's dialog alone on a transparent page (device.png). The Russian ones take a -ru suffix.
// scripts/frame-screenshots.py then frames them for the README.
//
// No router is involved, and nothing real can be in a picture: the admin is its demo build (web/dist/admin-demo,
// `npm run build:demo`, built first unless --no-build), the real pages over a router that lives in the page with a
// made-up cast (web/src/admin/demo: eight people, fifteen devices, one fixed day). It is opened at LuCI's own
// addresses on https://router.example and every file is answered over the DevTools protocol (scripts/cdp.mjs).
//
// The Outline theme around the pages is not this repository's: its built files (main.css, icons, fonts) are read
// from --theme, by default the luci-theme-outline checkout beside this one (run `pnpm build` in its .dev/ first).
// The theme is shown with its navbar on top. The Places map draws its tiles from the network, as it does on a
// router, so that one shot needs the internet.
//
//   scripts/capture-screenshots.mjs [--lang en,ru] [--only people,core] [--theme <luci-static/outline>] [--no-build]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { die, launch, sleep } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const DEMO = join(WEB, 'dist', 'admin-demo');
const RAW = join(ROOT, 'docs', 'screenshots', 'raw');
const SCALE = 2;
/** The window: wide enough for the theme's content column, and tall, since Outline scrolls #maincontent, not the page. */
const WIDTH = 1400;
const HEIGHT = 2600;
/** Either side of the content column in a page's capture, and under the last thing it shows. */
const SIDE = 48;
const FOOT = 40;
/** Around the dialog in its capture: left, top, right, bottom (frame-screenshots.py FLOW_MARGIN). */
const MARGIN = [56, 40, 56, 72];
const ORIGIN = 'https://router.example';
const LUCI = `${ORIGIN}/cgi-bin/luci/admin/services/dawnline`;
/** The cast's server, the person whose page is shown and the device whose dialog is (web/src/admin/demo/cast.ts). */
const SERVER = 's_home';
const PERSON = 'p_artem';
const DEVICE = 'd_a1';

const args = {
  langs: ['en', 'ru'],
  only: [],
  build: true,
  theme: resolve(ROOT, '..', 'luci-theme-outline', 'htdocs', 'luci-static', 'outline'),
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => process.argv[++i] ?? die(`${a} needs a value`);
  if (a === '--lang') args.langs = v().split(',');
  else if (a === '--only') args.only = v().split(',');
  else if (a === '--theme') args.theme = resolve(v());
  else if (a === '--no-build') args.build = false;
  else die(`unknown argument ${a}`);
}

// In the page: the pages' shadow root and the layer's (what floats: a dialog), and whether the page has been drawn.
const HOST = `document.querySelector('.dl-host')?.shadowRoot`;
const LAYER = `document.querySelector('.dl-layer')?.shadowRoot`;
const has = (sel) => `${HOST}?.querySelector(${JSON.stringify(sel)})`;

/** Each shot: its address, what must stand before it is taken, and how long what it draws takes to come to rest. */
const SHOTS = [
  { name: 'people', at: `people?server=${SERVER}`, ready: has('.pp-card') },
  { name: 'person', at: `people?server=${SERVER}&id=${PERSON}`, ready: has('.pp-cols') },
  // the map's module, then its tiles from the network
  { name: 'places', at: `people?server=${SERVER}&view=map`, ready: has('.maplibregl-canvas'), settle: 7000 },
  { name: 'core', at: `server?server=${SERVER}&p=core`, ready: has('.sv-core') },
  { name: 'device', at: `people?device=${DEVICE}`, ready: `${LAYER}?.querySelector('.sheet[role=dialog]')`, dialog: true },
];
const unknown = args.only.filter((n) => !SHOTS.some((s) => s.name === n));
if (unknown.length) die(`unknown shot ${unknown.join(', ')} (one of ${SHOTS.map((s) => s.name).join(', ')})`);
if (!existsSync(join(args.theme, 'main.css')))
  die(
    `No build of the Outline theme in ${args.theme}: run \`pnpm build\` in luci-theme-outline/.dev, or point --theme at its luci-static/outline`,
  );

// The content column: the page's host, SIDE either side, from the top of the window (the theme's navbar) down to
// the last thing the page shows (the room it keeps under itself for a dock is not shown).
const PAGE_CLIP = `(() => {
  const host = document.querySelector('.dl-host');
  const r = host.getBoundingClientRect();
  let end = 0;
  for (const e of host.shadowRoot.querySelectorAll('*'))
    if (!e.firstElementChild && e.getClientRects().length) end = Math.max(end, e.getBoundingClientRect().bottom);
  return { x: r.left - ${SIDE}, y: 0, width: r.width + ${2 * SIDE}, height: Math.min(r.bottom, end + 24) + ${FOOT} };
})()`;

// The dialog alone: the page under it, its scrim and the theme's ground are not drawn, MARGIN around the dialog.
const DIALOG_CLIP = `(() => {
  const layer = document.querySelector('.dl-layer');
  for (const k of document.body.children) if (k !== layer) k.style.opacity = '0';
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  const s = document.createElement('style');
  s.textContent = '.sheet-root, .sheet-root::before, .sheet-root::after { background: transparent !important; backdrop-filter: none !important; }' +
    ' .sheet-root > *:not(.sheet) { visibility: hidden !important; }';
  layer.shadowRoot.append(s);
  const r = layer.shadowRoot.querySelector('.sheet[role=dialog]').getBoundingClientRect();
  const [l, t, rr, b] = ${JSON.stringify(MARGIN)};
  return { x: r.left - l, y: r.top - t, width: r.width + l + rr, height: r.height + t + b };
})()`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** The file an address of the made-up router stands for: the demo's page at any LuCI address, its script, the theme's files. */
function fileFor(path, lang) {
  if (path.startsWith('/cgi-bin/luci/'))
    // the page's language is its <html lang>, which LuCI's server sets
    return {
      type: TYPES['.html'],
      body: Buffer.from(readFileSync(join(DEMO, 'index.html'), 'utf8').replace('<html lang="en"', `<html lang="${lang}"`)),
    };
  const from = [
    ['/dawnline-demo/', DEMO],
    ['/luci-static/outline/', args.theme],
  ].find(([prefix]) => path.startsWith(prefix));
  if (!from) return null;
  const file = resolve(from[1], path.slice(from[0].length));
  if (!file.startsWith(from[1] + sep) || !existsSync(file)) return null;
  return { type: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) };
}

/** Answer everything the page asks of the router's origin; the rest (the map's tiles) goes to the network. */
async function serve(page, lang) {
  page.on('Fetch.requestPaused', async (e) => {
    const f = fileFor(decodeURIComponent(new URL(e.request.url).pathname), lang);
    await page
      .send('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: f ? 200 : 404,
        responseHeaders: f ? [{ name: 'Content-Type', value: f.type }] : [],
        body: f ? f.body.toString('base64') : '',
      })
      .catch(() => {});
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: `${ORIGIN}/*`, requestStage: 'Request' }] });
}

/** What the page complains of goes to the terminal: a question the demo's router does not answer, an error. */
async function listen(page, problems) {
  page.on('Runtime.consoleAPICalled', (e) => {
    if (e.type === 'warning' || e.type === 'error') problems.push(e.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  page.on('Runtime.exceptionThrown', (e) => problems.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
  await page.send('Runtime.enable');
}

async function capture(lang) {
  const suffix = lang === 'en' ? '' : `-${lang}`;
  const b = await launch([`--lang=${lang}`]);
  const { page, evaluate, go, waitFor } = b;
  const problems = [];
  try {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
    await listen(page, problems);
    await serve(page, lang);
    for (const shot of SHOTS) {
      if (args.only.length && !args.only.includes(shot.name)) continue;
      // Where the page paints nothing (around a dialog taken alone), the capture is transparent.
      await page.send('Emulation.setDefaultBackgroundColorOverride', shot.dialog ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
      await go(`${LUCI}/${shot.at}`);
      await waitFor(shot.ready, `the ${shot.name} page`);
      await sleep(shot.settle ?? 3000);
      const clip = await evaluate(shot.dialog ? DIALOG_CLIP : PAGE_CLIP);
      if (shot.dialog) await sleep(400);
      const { data } = await page.send('Page.captureScreenshot', {
        format: 'png',
        clip: { ...clip, scale: 1 },
        captureBeyondViewport: true,
      });
      writeFileSync(join(RAW, `${shot.name}${suffix}.png`), Buffer.from(data, 'base64'));
      console.log(`${shot.name}${suffix}: ${Math.round(clip.width)}x${Math.round(clip.height)} (x${SCALE})`);
    }
    page.close();
  } finally {
    await b.close();
  }
  for (const p of new Set(problems)) console.error(`  the page (${lang}): ${p}`);
}

async function main() {
  if (args.build) execFileSync('npm', ['run', '--silent', 'build:demo'], { cwd: WEB, stdio: 'inherit' });
  for (const lang of args.langs) await capture(lang);
}

main().catch((e) => die(e.message));
