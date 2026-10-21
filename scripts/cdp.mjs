// A headless Chromium driven over the DevTools protocol, no npm packages: what
// the README screenshot scripts share (capture-screenshots.mjs from a router,
// capture-portal.mjs from the portal demo). BROWSER=/path/to/chrome picks the
// browser (default: Brave or Chrome on macOS); its profile is a throwaway one.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

export function die(msg) {
  console.error(msg);
  process.exit(1);
}

export function findBrowser() {
  const c = [
    process.env.BROWSER,
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ];
  return c.find((b) => b && existsSync(b)) ?? die('No Chromium-based browser found; set BROWSER=/path/to/chrome');
}

/** A page over the DevTools protocol: send(method, params), waitFor(event) and on(event, fn). */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  let id = 0;
  const pending = new Map();
  const waiters = [];
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method) {
      for (const l of listeners.filter((x) => x.method === msg.method)) l.fn(msg.params);
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
  const on = (method, fn) => listeners.push({ method, fn });
  return { send, waitFor, on, close: () => ws.close() };
}

/**
 * Start the browser headless on a fresh profile and connect to its first page. `flags` go on its command line
 * (a language, certificate errors). Returns the page, its helpers, and close() that ends the browser and removes
 * the profile.
 */
export async function launch(flags = []) {
  const profile = mkdtempSync(join(tmpdir(), 'dawnline-shots-'));
  const chrome = spawn(
    findBrowser(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      // MapLibre needs WebGL; headless gets it from SwiftShader.
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      ...flags,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const close = async () => {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = await connect(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
    await page.send('Page.enable');
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
    return { page, evaluate, go, waitSel, close };
  } catch (e) {
    await close();
    throw e;
  }
}
