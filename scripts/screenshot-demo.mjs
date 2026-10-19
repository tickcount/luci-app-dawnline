// Demo data for the README screenshots (scripts/capture-screenshots.mjs --demo):
// the router's own answers (luci.dawnline status, events) with a made-up cast in
// place of its people, devices, places and activity, in the states the
// screenshots should show (online, ending soon, over the limit, paused, ended,
// outside their hours). The router's ids stay, so every page keeps working; it
// is only ever read.

// The admin counts in binary units: "100 GB" is 100 GiB.
const GB = 2 ** 30;
const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

/** Where the cast connects from: [lat, lon, country, cc, network]. */
const CITIES = {
  Lisbon: [38.7223, -9.1393, 'Portugal', 'PT', 'MEO'],
  Porto: [41.1579, -8.6291, 'Portugal', 'PT', 'NOS'],
  Sintra: [38.8029, -9.3817, 'Portugal', 'PT', 'Vodafone Portugal'],
  Madrid: [40.4168, -3.7038, 'Spain', 'ES', 'Telefonica de Espana'],
  Barcelona: [41.3874, 2.1686, 'Spain', 'ES', 'Orange Espagne'],
  Berlin: [52.52, 13.405, 'Germany', 'DE', 'Deutsche Telekom'],
  Milan: [45.4642, 9.19, 'Italy', 'IT', 'TIM'],
  Amsterdam: [52.3676, 4.9041, 'Netherlands', 'NL', 'KPN'],
  Paris: [48.8566, 2.3522, 'France', 'FR', 'Orange'],
  London: [51.5072, -0.1276, 'United Kingdom', 'GB', 'BT'],
  Stockholm: [59.3293, 18.0686, 'Sweden', 'SE', 'Telia'],
};
/** The router's own place. */
const HOME = 'Lisbon';
/** Shared at home (Access): what a Home-only person can be limited to. */
const SERVICES = [
  { id: 'demo-nas', name: 'NAS', address: '10.0.1.20', ports: ['445', '5000'] },
  {
    id: 'demo-ha',
    name: 'Home Assistant',
    address: '10.0.1.30',
    ports: ['8123'],
  },
];
/** How busy each day of the week is, Monday first. */
const WEEK = [0.9, 1.15, 0.8, 1.05, 1.3, 0.75, 1.1];

/**
 * Who the screenshots show, the --person first (the Person page), each with
 * their city. A device: [name, kind, when it was last seen, GB this month,
 * earlier places as 'City:days ago']; when: 'online', 'mins:N', 'hours:N',
 * 'days:N', 'never', 'stale' (settings changed since), 'disabled'. Its last
 * place is the person's city unless `at` names another.
 */
export const CAST = [
  {
    name: 'Lena Ortiz',
    city: 'Lisbon',
    limit: 4,
    quota: 100,
    used: 38.6,
    note: 'Family',
    devices: [
      ['iPhone 16', 'phone', 'online', 14.2, ['Sintra:3', 'Porto:9', 'Madrid:16']],
      ['MacBook Pro', 'computer', 'hours:3', 21.9, ['Berlin:12']],
      ['iPad Air', 'tablet', 'never', 0],
    ],
    added: [['iPad Air', 2, 'portal']],
  },
  {
    name: 'Marco Rossi',
    city: 'Milan',
    ends: 4,
    devices: [
      ['Pixel 9', 'phone', 'online', 6.4, ['Barcelona:8']],
      ['ThinkPad X1', 'computer', 'days:1', 12.8],
    ],
  },
  {
    name: 'Yuki Tanaka',
    city: 'Amsterdam',
    state: 'quota',
    quota: 20,
    used: 20.4,
    devices: [
      ['Galaxy S24', 'phone', 'hours:6', 14.1, ['Paris:5']],
      ['Living room TV', 'other', 'stale', 6.3],
    ],
  },
  {
    name: 'Sam Okafor',
    city: 'London',
    state: 'paused',
    paused: 3,
    devices: [
      ['Gaming PC', 'computer', 'days:9', 3.1],
      ['Steam Deck', 'other', 'disabled', 0],
    ],
  },
  {
    name: 'Nora Lindqvist',
    city: 'Stockholm',
    state: 'expired',
    ends: -3,
    devices: [['iPhone 13 mini', 'phone', 'days:4', 1.2]],
  },
  {
    name: 'Mia Ortiz',
    city: 'Lisbon',
    state: 'hours',
    hours: '07:00-21:00',
    limit: 1,
    devices: [['Fire HD 10', 'tablet', 'hours:11', 2.6]],
  },
];

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const date = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const seen = (when, now) => {
  const [k, n] = when.split(':');
  const v = +n || 0;
  return (
    {
      online: now - 40,
      mins: now - v * MIN,
      hours: now - v * HOUR,
      days: now - v * DAY,
      stale: now - 2 * DAY,
      disabled: now - 41 * DAY,
    }[k] ?? 0
  );
};
/** A week of daily totals that adds up to about a quarter of the month, today last (nothing before it was first seen). */
const week = (gb, last, now) =>
  [0.8, 1.3, 0.6, 1.1, 1.6, 0.9, 1].map((f, i) => (!gb || now - (6 - i) * DAY < last - DAY ? 0 : Math.round(((gb / 4) * f * GB) / 7)));
let ipN = 10;
/** A documentation address (the capture swaps public addresses for these anyway). */
const ip = () => `203.0.113.${ipN++}`;
const where = (city) => `${city} · ${CITIES[city][4]}`;

/** What the last status made of the router's ids, for the calls that come after it (events, usage). */
const demo = { events: [], people: new Map(), days: [], now: 0 };

/**
 * Daily traffic over `days` (oldest first) for `gb` this month: busier some days of the week, today
 * only partly gone. Each day's [rx, tx] in bytes, rx (from the devices) about an eighth.
 */
function daily(days, gb, now) {
  const month = days[days.length - 1].slice(0, 7);
  const w = days.map((d, i) => {
    const wd = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
    const today = i === days.length - 1 ? ((now % DAY) / DAY) * 0.9 + 0.1 : 1;
    return WEEK[wd] * (0.85 + ((i * 37) % 11) / 30) * today;
  });
  const inMonth = w.reduce((s, x, i) => s + (days[i].startsWith(month) ? x : 0), 0) || 1;
  return w.map((x) => {
    const b = (x / inMonth) * gb * GB;
    return [Math.round(b * 0.12), Math.round(b * 0.88)];
  });
}
const usage = (days, pairs) => days.map((day, i) => ({ day, rx: pairs[i][0], tx: pairs[i][1] }));

/** The places a device was at, oldest first: [city, ts, ip]. */
function trail(c, d, hs, now) {
  if (!hs) return [];
  const earlier = (d[4] ?? []).map((s) => {
    const [city, ago] = s.split(':');
    return [city, now - +ago * DAY - 5 * HOUR, ip()];
  });
  return [...earlier.reverse(), [c.city, hs, ip()]];
}

function demoStatus(st, first) {
  const now = st.now;
  ipN = 10;
  const real = [...st.people].sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : a.id < b.id ? -1 : 1));
  const spare = real.flatMap((p) => p.devices);
  const points = [];
  const events = [];
  const people = CAST.map((c, i) => {
    const base = real[i] ?? {
      ...real[real.length - 1],
      id: `demo-${i}`,
      devices: [],
    };
    const state = c.state ?? 'active';
    const devices = c.devices.map((cd, j) => {
      const [name, kind, when, gb] = cd;
      const tpl = base.devices[j] ?? {
        ...spare[j % spare.length],
        id: `${base.id}-demo-${j}`,
        address: `10.8.0.${200 + i * 8 + j}`,
      };
      const hs = when === 'never' ? 0 : seen(when, now);
      const online = when === 'online' && !['paused', 'expired', 'hours'].includes(state);
      const places = trail(c, cd, hs, now);
      places.forEach(([city, ts, addr], k) => {
        const [lat, lon, country, cc, org] = CITIES[city];
        const current = online && k === places.length - 1;
        points.push({
          person: base.id,
          device: tpl.id,
          ip: addr,
          ts,
          online: current,
          lat,
          lon,
          city,
          country,
          cc,
          asn: 0,
          org,
        });
        const ev = {
          person: base.id,
          device: tpl.id,
          pname: c.name,
          dname: name,
          dkind: kind,
        };
        // Online now: connected a while ago (the handshake renews every few minutes); otherwise on for a couple of hours.
        events.push({
          ...ev,
          type: 'connect',
          detail: addr,
          where: where(city),
          ts: current ? now - 95 * MIN - j * 13 * MIN : ts - 2 * HOUR,
        });
        if (!current) events.push({ ...ev, type: 'disconnect', ts });
      });
      // A phone in hand switches between Wi-Fi and mobile data.
      if (online && kind === 'phone') {
        const [, , addr] = places[places.length - 1];
        events.push({
          person: base.id,
          device: tpl.id,
          pname: c.name,
          dname: name,
          dkind: kind,
          type: 'roam',
          detail: `${ip()} → ${addr}`,
          ts: now - 25 * MIN,
        });
      }
      return {
        ...tpl,
        name,
        kind,
        online,
        active: online,
        handshake: hs,
        endpoint: places.length ? places[places.length - 1][2] : '',
        config_stale: when === 'stale',
        disabled: when === 'disabled',
        month: [Math.round(gb * 0.12 * GB), Math.round(gb * 0.88 * GB)],
        total: [Math.round(gb * 0.3 * GB), Math.round(gb * 2.2 * GB)],
        spark: week(gb, hs, now),
        hostname: hs ? `${slug(name)}.${slug(c.name.split(' ')[0])}.lan` : '',
      };
    });
    for (const [name, ago, by] of c.added ?? []) {
      const d = devices.find((x) => x.name === name);
      if (d)
        events.push({
          person: base.id,
          device: d.id,
          pname: c.name,
          dname: name,
          dkind: d.kind,
          type: 'device_added',
          detail: name,
          by,
          ts: now - ago * DAY,
        });
    }
    if (c.paused)
      events.push({
        person: base.id,
        pname: c.name,
        type: 'paused',
        by: 'admin',
        ts: now - c.paused * DAY,
      });
    const month = devices.reduce((s, d) => [s[0] + d.month[0], s[1] + d.month[1]], [0, 0]);
    const live = devices.some((d) => d.online);
    demo.people.set(base.id, {
      devices: devices.map((d, j) => [d.id, c.devices[j][3]]),
    });
    return {
      ...base,
      name: c.name,
      state,
      paused: state === 'paused',
      hours: c.hours ?? '',
      note: c.note ?? '',
      expires: c.ends !== undefined ? date(now + c.ends * DAY) : '',
      device_limit: c.limit ?? Math.max(3, devices.length),
      quota_gb: c.quota ?? 0,
      quota_period: 'month',
      quota_limit: (c.quota ?? 0) * GB,
      quota_used: Math.round((c.used ?? (month[0] + month[1]) / GB) * GB),
      bonus_gb: 0,
      month,
      total: [month[0] * 3, month[1] * 3],
      online: devices.filter((d) => d.online).length,
      last_seen: Math.max(0, ...devices.map((d) => d.handshake)),
      rate: (base.rate ?? []).map(([t], k) => [t, live ? 12000 + ((k * 7919) % 9000) : 0, live ? 120000 + ((k * 104729) % 90000) : 0]),
      devices,
    };
  });
  const devices = people.flatMap((p) => p.devices);
  const month = people.reduce((s, p) => [s[0] + p.month[0], s[1] + p.month[1]], [0, 0]);
  events.sort((a, b) => a.ts - b.ts);
  demo.events = events;
  points.sort((a, b) => b.ts - a.ts);
  demo.now = now;
  demo.days = (st.series ?? []).map((x) => x.day);
  if (!demo.days.length) for (let k = 29; k >= 0; k--) demo.days.push(date(now - k * DAY));
  const all = CAST.reduce((s, c) => s + c.devices.reduce((t, d) => t + d[3], 0), 0);
  const series = usage(demo.days, daily(demo.days, all, now));
  const today = series[series.length - 1];
  const [lat, lon, country, cc, org] = CITIES[HOME];
  return {
    ...st,
    people,
    totals: {
      ...st.totals,
      people: people.length,
      devices: devices.length,
      online: devices.filter((d) => d.online).length,
      active: people.filter((p) => p.state === 'active').length,
      today: [today.rx, today.tx],
      month,
    },
    series,
    servers: st.servers.map((x) => ({ ...x, series })),
    services: st.services?.length ? st.services : SERVICES,
    geo: st.geo && {
      ...st.geo,
      home: { lat, lon, city: HOME, country, cc, asn: 0, org },
      points,
    },
    events: events.slice(-60),
  };
}

/**
 * A ubus JSON-RPC exchange (LuCI batches calls into one request) with the
 * luci.dawnline answers made into the demo; anything else as it came.
 */
export function demoRpc(request, response, first) {
  let req;
  let res;
  try {
    req = JSON.parse(request);
    res = JSON.parse(response);
  } catch {
    return response;
  }
  const calls = new Map((Array.isArray(req) ? req : [req]).map((c) => [c.id, c.params ?? []]));
  const fix = (r) => {
    const [, object, method, args] = calls.get(r?.id) ?? [];
    const data = r?.result?.[1];
    if (object !== 'luci.dawnline' || !data || typeof data !== 'object') return r;
    if (method === 'status' && Array.isArray(data.people)) return { ...r, result: [r.result[0], demoStatus(data, first)] };
    if (method === 'person_usage' && demo.people.has(args?.id) && demo.days.length) {
      const devs = demo.people.get(args.id).devices ?? [];
      const per = Object.fromEntries(devs.map(([id, gb]) => [id, daily(demo.days, gb, demo.now)]));
      const sum = demo.days.map((_, i) => devs.reduce((s, [id]) => [s[0] + per[id][i][0], s[1] + per[id][i][1]], [0, 0]));
      const devices = Object.fromEntries(devs.map(([id]) => [id, usage(demo.days, per[id])]));
      return {
        ...r,
        result: [r.result[0], { ...data, person: usage(demo.days, sum), devices }],
      };
    }
    // Every check passes: the screenshots show Dawnline, not this router's own setup.
    if (method === 'health' && Array.isArray(data.checks))
      return {
        ...r,
        result: [
          r.result[0],
          {
            ...data,
            checks: data.checks.map((c) => (c.status === 'warn' || c.status === 'error' ? { ...c, status: 'ok', problem: null } : c)),
          },
        ],
      };
    if (method === 'events' && Array.isArray(data.events)) {
      const mine = demo.events.filter((e) => !args?.person || e.person === args.person);
      return {
        ...r,
        result: [r.result[0], { ...data, events: mine, total: mine.length }],
      };
    }
    return r;
  };
  return JSON.stringify(Array.isArray(res) ? res.map(fix) : fix(res));
}
