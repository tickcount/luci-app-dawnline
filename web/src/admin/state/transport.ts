// The admin's way to the backend's object `dawnline` (backend/api): calls as JSON-RPC through LuCI's own
// door with its session, and the event stream where the web server is uhttpd with its ubus door
// (GET <ubuspath>/subscribe/dawnline, the session as a Bearer token). shared/live/follow.ts follows over it.
//
// Not LuCI's rpc.declare: a held call (`wait`) must not sit in one of its batches, and must be let go when
// the page stops following.

import type { Answer, Hello, StreamMessage, Transport } from '../../shared/live/follow';

/** A call the backend or rpcd refused: ubus's status (4 no such object, 6 not allowed), or -32002 from uhttpd. */
class Refused extends Error {
  constructor(readonly code: number) {
    super(`dawnline: ${code}`);
  }
}

const session = () => rpc.getSessionID?.() ?? L.env.sessionid ?? '00000000000000000000000000000000';
const door = () => rpc.getBaseURL?.() ?? L.env.ubuspath ?? L.url('admin/ubus');

let ids = 0;

async function call<T>(method: string, args: object, stop?: AbortSignal): Promise<T> {
  const res = await fetch(door(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    signal: stop,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++ids, method: 'call', params: [session(), 'dawnline', method, args] }),
  });
  if (!res.ok) throw new Error(`dawnline: http ${res.status}`);
  const r = (await res.json()) as { result?: [number, T?]; error?: { code: number } };
  if (r.error) throw new Refused(r.error.code);
  if (!Array.isArray(r.result) || r.result[0] !== 0) throw new Refused(r.result?.[0] ?? -1);
  return (r.result[1] ?? {}) as T;
}

/** One block of an event stream: its event's name and its data line. */
function parse(block: string): StreamMessage | null {
  let name = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    const d = JSON.parse(data) as { epoch: string; seq: number; topic: string; op: 'put' | 'patch' | 'append' | 'drop'; data?: unknown };
    if (name === 'ping') return { kind: 'ping', epoch: d.epoch, seq: d.seq };
    if (name === 'event') return { kind: 'event', epoch: d.epoch, event: { seq: d.seq, topic: d.topic, op: d.op, data: d.data } };
  } catch {
    // a line that is not ours
  }
  return null;
}

async function stream(on: (m: StreamMessage) => void, stop: AbortSignal): Promise<void> {
  const base = (L.env.ubuspath ?? '').replace(/\/$/, '');
  const res = await fetch(`${base}/subscribe/dawnline`, {
    headers: { Authorization: `Bearer ${session()}` },
    credentials: 'same-origin',
    signal: stop,
  });
  // refused, it answers with JSON, not a stream
  if (!res.ok || !res.body || !(res.headers.get('Content-Type') ?? '').startsWith('text/event-stream'))
    throw new Error('dawnline: no event stream');
  const reader = res.body.getReader();
  const text = new TextDecoder();
  let kept = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    kept += text.decode(value, { stream: true });
    for (let end = kept.indexOf('\n\n'); end >= 0; end = kept.indexOf('\n\n')) {
      const m = parse(kept.slice(0, end));
      kept = kept.slice(end + 2);
      if (m) on(m);
    }
  }
}

export function luciTransport(): Transport {
  return {
    hello: () => call<Hello>('hello', {}),
    sync: (at) => call<Answer>('sync', at),
    wait: (at, stop) => call<Answer>('wait', at, stop),
    watch: (topics) => call('watch', { topics }),
    refresh: () => call('refresh', {}),
    // only uhttpd's own door can hold a stream
    stream: L.env.ubuspath ? stream : undefined,
  };
}
