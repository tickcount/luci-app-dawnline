// Puts the demo's router behind the page: fetch() to <base>/api/... is answered
// in the browser, after a router-like pause, and never leaves the page. The
// devices are kept in localStorage (a private window starts fresh each time).
// Imported first by demo/main.ts: it must own fetch before the portal asks.

import { createRouter, type DemoDb } from './router';

const STORE = 'dawnline-demo';

export const router = createRouter({
  keep: {
    load() {
      try {
        return JSON.parse(localStorage.getItem(STORE) ?? 'null');
      } catch {
        return null; // storage off or a broken entry: the demo starts over
      }
    },
    save(db: DemoDb) {
      try {
        localStorage.setItem(STORE, JSON.stringify(db));
      } catch {
        /* storage off: the devices last until the page is closed */
      }
    },
  },
  want: new URLSearchParams(location.search).get('s'),
  // "Open securely" leads back to the demo as it is with HTTPS.
  secureUrl: () => `${location.origin}${location.pathname}?s=normal`,
});

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const at = url.pathname.indexOf('/api/');
  if (url.origin !== location.origin || at < 0) return realFetch(input, init);
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  // A router takes a moment, a change longer: busy buttons show their orb, as they would.
  await pause(method === 'POST' ? 450 + Math.random() * 350 : 120);
  const a = router.answer(method, url.pathname.slice(at + 5), body);
  return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'Content-Type': 'application/json' } });
};
