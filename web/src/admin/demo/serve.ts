// The demo's router at LuCI's ubus door: it owns fetch for that one address and answers the JSON-RPC the page sends
// there as the backend's object `dawnline` does, from status.ts and router.ts. Two kinds of question come: the stream's (hello,
// sync, wait, watch, refresh: state/transport.ts), answered with the whole state as one snapshot that never moves,
// and the pages' own (the log, a person's usage, the checks, the service log, a server's interfaces, a device's
// configuration).
//
// It answers questions only. Anything else (a change, or a question no page of the demo's asks yet) is refused as
// ubus refuses an unknown method, and named on the console, so whoever opens a page it cannot draw sees why.
// Imported before the admin (main.ts): the door is taken before a page asks.

import { DOOR } from './luci';
import { NOW } from './past';
import { config, events, health, interfaces, meter, serviceLog } from './router';
import { status, usage } from './status';
import type { Lang } from './cast';

/** ubus's own status codes. */
const OK = 0;
const METHOD_NOT_FOUND = 3;
const NOT_FOUND = 4;

const EPOCH = 'demo';
const started = Date.now();
/** The router's clock: the demo's moment, moving on with the page (so what the page holds stays fresh). */
const clock = (): number => NOW + (Date.now() - started) / 1000;
/** The router says its own words in the page's language. */
const lang = (): Lang => (document.documentElement.lang === 'ru' ? 'ru' : 'en');

type Args = Record<string, unknown>;
const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The status cut into the stream's topics (state/join.ts puts them together again), with the meter and the backend's own. */
function topics(): Record<string, unknown> {
  const { now, tz, servers, people, circles, services, geo, events: recent, totals, series, hours, ...router } = status(lang());
  return {
    backend: { ok: true, at: clock() },
    router,
    clock: { now, tz },
    traffic: { totals, series, hours },
    servers,
    people,
    circles,
    services,
    places: geo,
    recent,
    meter: meter(),
  };
}

const sleep = (seconds: number) => new Promise((done) => setTimeout(done, seconds * 1000));

const ANSWERS: Record<string, (a: Args) => unknown> = {
  hello: () => ({ version: 'demo', stream: 'poll', epoch: EPOCH, seq: 1, lease: 30, now: clock() }),
  sync: () => ({ epoch: EPOCH, seq: 1, docs: topics() }),
  // nothing ever happens here: a held call is let go empty when its time is up
  wait: (a) => sleep(count(a.timeout) ?? 15).then(() => ({ epoch: EPOCH, seq: 1, events: [] })),
  watch: () => ({}),
  refresh: () => ({}),
  events: (a) => events(lang(), count(a.limit) ?? 0, text(a.person), count(a.since), text(a.device)),
  person_usage: (a) => usage(text(a.id) ?? '', count(a.days) ?? 31),
  health: () => health(lang()),
  interfaces: (a) => interfaces(text(a.id) ?? ''),
  device_config: (a) => config(text(a.id) ?? '', lang()),
  service_log: () => serviceLog(),
};

interface Call {
  id?: unknown;
  params?: unknown;
}

async function answer(call: Call): Promise<object> {
  const [, object, method, args] = Array.isArray(call.params) ? (call.params as unknown[]) : [];
  const reply = (code: number, data?: unknown) => ({
    jsonrpc: '2.0',
    id: call.id ?? null,
    result: data === undefined ? [code] : [code, data],
  });
  if (object !== 'dawnline' || typeof method !== 'string') return reply(NOT_FOUND);
  const made = Object.prototype.hasOwnProperty.call(ANSWERS, method)
    ? await ANSWERS[method](args && typeof args === 'object' ? (args as Args) : {})
    : undefined;
  if (made == null) {
    console.warn(`Dawnline demo: the router does not answer "${method}"`);
    return reply(METHOD_NOT_FOUND);
  }
  return reply(OK, made);
}

/** One request to the door: a call or a batch of them; given up when the page lets it go (a held call it no longer waits for). */
async function door(init: RequestInit = {}): Promise<Response> {
  const gone = new Promise<never>((_ok, fail) =>
    init.signal?.addEventListener('abort', () => fail(new DOMException('Aborted', 'AbortError'))),
  );
  let asked: Call | Call[];
  try {
    asked = JSON.parse(String(init.body)) as Call | Call[];
  } catch {
    return new Response('', { status: 400 });
  }
  const made = Array.isArray(asked) ? Promise.all(asked.map(answer)) : answer(asked);
  return new Response(JSON.stringify(await Promise.race([made, gone])), { headers: { 'Content-Type': 'application/json' } });
}

const real = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(url, location.href).pathname === DOOR ? door(init) : real(input, init);
};
