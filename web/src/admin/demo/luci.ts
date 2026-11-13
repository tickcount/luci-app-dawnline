// LuCI's side of the admin, for the demo, where there is no LuCI: the globals the admin's modules take from its
// loader (luci.d.ts: E, L, rpc, poll, ui) and the translation globals _() and N_(), which look a string up in the
// admin's own catalog as LuCI does on a router with luci-i18n-dawnline-<lang> installed. Only what the admin uses,
// each behaving as LuCI's does. It knows nothing of the router: a call goes to LuCI's ubus door as JSON-RPC, and who
// answers there is serve.ts. Imported first, before anything of the admin's (main.ts).

import ru from '../../../../package/luci-app-dawnline/po/ru/dawnline.po';
import type { Catalog } from '../../../i18n/po';

/** Where LuCI sends its calls, and the session it sends them with (nobody's: there is no login here). */
export const DOOR = '/ubus';
const SESSION = '00000000000000000000000000000000';

const CATALOGS: Record<string, Catalog> = { ru };
/** Which plural form a number takes, by each language's gettext rule. */
const FORMS: Record<string, (n: number) => number> = {
  ru: (n) => (n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2),
};

/** The page's language is its <html lang>, which LuCI's server sets (here: whoever serves the page). */
const catalog = (): Catalog | undefined => CATALOGS[document.documentElement.lang];
const key = (s: string, ctx?: string) => (ctx ? `${ctx}\u0004${s}` : s);
const tr = (s: string, ctx?: string): string => catalog()?.s[key(s, ctx)] ?? s;
const ntr = (n: number, one: string, many: string, ctx?: string): string =>
  catalog()?.p[key(one, ctx)]?.[FORMS[document.documentElement.lang]?.(n) ?? 0] ?? (n === 1 ? one : many);

type Attrs = Record<string, unknown>;
type Kid = Node | string | number;

/** LuCI's E() as the admin calls it (e.ts): a function is a listener, an object its JSON, null is left out. */
function element(tag: string, attrs: Attrs = {}, kids: Kid | Kid[] = []): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (typeof v === 'function') el.addEventListener(k, v as EventListener);
    else el.setAttribute(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  for (const kid of Array.isArray(kids) ? kids : [kids]) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

let ids = 0;

/** rpc.declare: the arguments by their names to the ubus door, the answer's data back; a refusal is thrown in LuCI's words. */
const declare: (typeof rpc)['declare'] = <T>({ object, method, params = [] }: { object: string; method: string; params?: string[] }) => {
  return async (...args: unknown[]): Promise<T> => {
    const named = Object.fromEntries(params.map((p, i) => [p, args[i]] as const).filter(([, v]) => v !== undefined));
    const res = await fetch(DOOR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++ids, method: 'call', params: [SESSION, object, method, named] }),
    });
    if (!res.ok) throw new Error(`RPC call to ${object}/${method} failed with HTTP error ${res.status}`);
    const r = (await res.json()) as { result?: [number, unknown?]; error?: { code: number } };
    if (r.error) throw new Error(`RPC call to ${object}/${method} failed with error ${r.error.code}`);
    if (r.result?.[0] !== 0) throw new Error(`RPC call to ${object}/${method} failed with ubus code ${r.result?.[0] ?? -1}`);
    return (r.result[1] ?? {}) as T;
  };
};

const timers = new Map<() => unknown, number>();
const polls: Pick<typeof poll, 'add' | 'remove' | 'start' | 'stop' | 'active'> = {
  add(fn, seconds = 5) {
    if (timers.has(fn)) return false;
    timers.set(fn, window.setInterval(fn, seconds * 1000));
    return true;
  },
  remove(fn) {
    clearInterval(timers.get(fn));
    return timers.delete(fn);
  },
  start() {},
  stop() {
    for (const t of timers.values()) clearInterval(t);
    timers.clear();
  },
  active: () => timers.size > 0,
};

const modules = new Map<string, unknown>();

/** A module as LuCI's loader would hand it out (L.require): the admin's own, built into this page. */
export function provide(name: string, module: unknown): void {
  modules.set(name, module);
}

const luci: Pick<typeof L, 'env' | 'url' | 'hasViewPermission' | 'resolveDefault' | 'require'> = {
  // no ubuspath: nothing here holds an event stream, so the page follows by held calls
  env: { sessionid: SESSION },
  url: (...parts) => `/cgi-bin/luci/${parts.join('/')}`,
  hasViewPermission: () => true,
  resolveDefault: (p, def) => p.catch(() => def),
  require: (name) => (modules.has(name) ? Promise.resolve(modules.get(name)) : Promise.reject(new Error(`No module ${name}`))),
};

Object.assign(globalThis, {
  _: tr,
  N_: ntr,
  E: element,
  L: luci,
  rpc: { declare, getBaseURL: () => DOOR, getSessionID: () => SESSION },
  poll: polls,
  ui: { menu: { flushCache() {} } },
});
