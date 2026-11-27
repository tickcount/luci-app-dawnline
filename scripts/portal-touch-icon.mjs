#!/usr/bin/env node
// Draw the portal's home-screen icon, web/src/portal/touch-icon.png, from
// web/src/portal/icon.svg: the mark in its light-scheme colours (white on the
// near-black tile) as a full 180×180 square. iOS rounds the corners itself and
// paints anything transparent black, so the tile's own rounding goes. The PNG
// is committed (the build only copies it); run this again when icon.svg
// changes. Needs a Chromium-based browser (scripts/cdp.mjs).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { die, launch } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'web', 'src', 'portal', 'icon.svg');
const OUT = join(ROOT, 'web', 'src', 'portal', 'touch-icon.png');
/** Apple's size for an iPhone's home screen (60 pt at 3x). */
const SIZE = 180;

const svg = readFileSync(SRC, 'utf8');
// The tile is the first rect, rounded: square it.
const square = svg.replace(/(<rect class="t" [^>]*?) rx="[0-9.]+"/, '$1');
if (square === svg) die('icon.svg changed: its tile (<rect class="t" … rx="…">) is not where this script looks');

const { page, go, close } = await launch();
try {
  await page.send('Emulation.setDeviceMetricsOverride', { width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  const html = `<!doctype html><style>html,body{margin:0;background:#000}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${square}`;
  await go(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: SIZE, height: SIZE, scale: 1 } });
  writeFileSync(OUT, Buffer.from(data, 'base64'));
  console.log(`wrote ${OUT}`);
} finally {
  await close();
}
