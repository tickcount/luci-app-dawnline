// Who the admin's demo shows (past.ts, status.ts and router.ts make the router's answers of them): a server with
// eight people and fifteen devices on it and a second one turned off, in the states the README's pictures are about
// (a limit reached, a device that does not connect, a term about to end, people online, someone offline, someone
// paused). Everyone is made up, in English and in Russian: the Russian cast lives around Krasnodar, the English one
// in Portugal and Spain. Data only: no router's or person's real name, address or key belongs here, and public
// addresses are the documentation ranges' (past.ts).

import type { Access, Kind, LinkState } from '../../shared/types';

export type Lang = 'en' | 'ru';
/** A name as it is said in each language, or the same in both. */
export type Said = string | readonly [en: string, ru: string];
export const say = (s: Said, lang: Lang): string => (typeof s === 'string' ? s : s[lang === 'ru' ? 1 : 0]);

/** Where the cast connects from: home is the router's own city. */
export type PlaceId = 'home' | 'north' | 'south' | 'inland' | 'far';

interface Place {
  city: string;
  country: string;
  cc: string;
  lat: number;
  lon: number;
  /** The network operator there. */
  org: string;
}

export const PLACES: Record<Lang, Record<PlaceId, Place>> = {
  en: {
    home: { city: 'Lisbon', country: 'Portugal', cc: 'PT', lat: 38.7223, lon: -9.1393, org: 'MEO' },
    north: { city: 'Porto', country: 'Portugal', cc: 'PT', lat: 41.1579, lon: -8.6291, org: 'MEO' },
    south: { city: 'Faro', country: 'Portugal', cc: 'PT', lat: 37.0194, lon: -7.9304, org: 'NOS' },
    inland: { city: 'Coimbra', country: 'Portugal', cc: 'PT', lat: 40.2033, lon: -8.4103, org: 'Vodafone' },
    far: { city: 'Seville', country: 'Spain', cc: 'ES', lat: 37.3891, lon: -5.9845, org: 'Orange' },
  },
  ru: {
    home: { city: 'Краснодар', country: 'Россия', cc: 'RU', lat: 45.035, lon: 38.975, org: 'Ростелеком' },
    north: { city: 'Новороссийск', country: 'Россия', cc: 'RU', lat: 44.723, lon: 37.769, org: 'Ростелеком' },
    south: { city: 'Сочи', country: 'Россия', cc: 'RU', lat: 43.585, lon: 39.723, org: 'МТС' },
    inland: { city: 'Ростов-на-Дону', country: 'Россия', cc: 'RU', lat: 47.2357, lon: 39.7015, org: 'МегаФон' },
    far: { city: 'Ставрополь', country: 'Россия', cc: 'RU', lat: 45.0428, lon: 41.9734, org: 'Билайн' },
  },
};

export interface CastDevice {
  id: string;
  name: Said;
  kind: Kind;
  /** Days since it was added. */
  added: number;
  /** GB it moved in the last 30 days. */
  gb: number;
  /** Hours it has been online for; absent: it is not. */
  on?: number;
  /** Seconds since it was last seen (an online one: its last handshake). */
  seen: number;
  /** Where it was last seen (home when absent), and where it was on the days before: [place, days ago]. */
  at?: PlaceId;
  was?: readonly (readonly [PlaceId, number])[];
  /** Its configuration changed since it last fetched it. */
  stale?: boolean;
  disabled?: boolean;
  /** Its link failing in a named way. */
  link?: LinkState;
  /** Its own keep-alive, seconds. */
  keepalive?: number;
  /** The networks behind a router. */
  behind?: string[];
  /** Added by its person on their own page. */
  portal?: boolean;
}

export interface CastPerson {
  id: string;
  name: Said;
  access: Access;
  /** Days since they were added. */
  joined: number;
  limit: number;
  devices: CastDevice[];
  /** Days until their term ends (negative: since it ended); absent: no end date. */
  ends?: number;
  /** A traffic limit in GB and its period. */
  quota?: readonly [gb: number, period: 'month' | 'total'];
  /** Days since they were paused. */
  paused?: number;
  note?: Said;
  circle?: string;
}

export const SERVER = {
  id: 's_home',
  name: 'Ames Gateway',
  ifname: 'awg0',
  port: 4500,
  subnet: '10.8.0.0/24',
  address: '10.8.0.1',
  endpoint: 'vpn.ames.example',
  /** "dawnline-demo-key-not-a-real-one", not a key of anything. */
  public_key: 'ZGF3bmxpbmUtZGVtby1rZXktbm90LWEtcmVhbC1vbmU=',
  home: '192.168.1.0/24',
  /** Seconds its tunnel has been up. */
  uptime: 16 * 86400 + 3 * 3600,
} as const;

/** A second server, set up and turned off: nobody is on it. */
export const SPARE = {
  id: 's_cottage',
  name: ['Cottage', 'Дача'],
  ifname: 'awg1',
  port: 4501,
  subnet: '10.9.0.0/24',
  address: '10.9.0.1',
} as const;

export const CIRCLES: readonly { id: string; name: Said; color: number }[] = [
  { id: 'c1', name: ['Family', 'Семья'], color: 0 },
  { id: 'c2', name: ['Guests', 'Гости'], color: 3 },
];

/** What is shared at home (Access). */
export const SERVICES: readonly { id: string; name: string; address: string; ports: string[] }[] = [
  { id: 'sv1', name: 'NAS', address: '192.168.1.10', ports: ['445'] },
  { id: 'sv2', name: 'Home Assistant', address: '192.168.1.20', ports: ['8123'] },
];

const laptop: Said = ['Laptop', 'Ноутбук'];

export const PEOPLE: readonly CastPerson[] = [
  {
    id: 'p_dima',
    name: ['Dima', 'Дима'],
    access: 'both',
    joined: 50,
    limit: 3,
    quota: [300, 'total'],
    devices: [
      {
        id: 'd_d1',
        name: 'ThinkPad',
        kind: 'computer',
        added: 50,
        gb: 14.7,
        seen: 4 * 86400,
        at: 'south',
        was: [['home', 7]],
        link: 'trying',
      },
      { id: 'd_d2', name: 'Xiaomi 14', kind: 'phone', added: 45, gb: 8.2, on: 0.7, seen: 15, link: 'shared', portal: true },
    ],
  },
  {
    id: 'p_lena',
    name: ['Lena Ortiz', 'Лена Орлова'],
    access: 'both',
    joined: 70,
    limit: 4,
    ends: 2,
    note: ['Sister', 'Сестра'],
    circle: 'c1',
    devices: [
      {
        id: 'd_l1',
        name: 'iPhone 16 Pro',
        kind: 'phone',
        added: 70,
        gb: 16.4,
        on: 1.5,
        seen: 40,
        was: [
          ['south', 6],
          ['north', 5],
        ],
      },
      { id: 'd_l2', name: 'MacBook Air', kind: 'computer', added: 64, gb: 25.5, seen: 7600 },
      { id: 'd_l3', name: 'iPad', kind: 'tablet', added: 30, gb: 5.3, seen: 3 * 86400, at: 'south', stale: true },
    ],
  },
  {
    id: 'p_misha',
    name: ['Misha', 'Миша'],
    access: 'internet',
    joined: 60,
    limit: 3,
    quota: [50, 'month'],
    circle: 'c1',
    devices: [
      { id: 'd_m1', name: 'Galaxy S24', kind: 'phone', added: 60, gb: 22.1, on: 2.2, seen: 25, at: 'inland' },
      { id: 'd_m2', name: laptop, kind: 'computer', added: 58, gb: 28.2, seen: 5 * 3600, at: 'inland' },
    ],
  },
  {
    id: 'p_artem',
    name: ['Artem', 'Артём'],
    access: 'both',
    joined: 40,
    limit: 3,
    ends: 3,
    devices: [
      { id: 'd_a1', name: 'Pixel 9', kind: 'phone', added: 40, gb: 11.5, on: 1.85, seen: 70, was: [['north', 2]] },
      { id: 'd_a2', name: ['Keenetic cottage', 'Keenetic дача'], kind: 'router', added: 38, gb: 17, seen: 9 * 3600, at: 'north' },
    ],
  },
  {
    id: 'p_office',
    name: ['Office', 'Офис'],
    access: 'lan',
    joined: 66,
    limit: 2,
    devices: [
      { id: 'd_o1', name: 'Mikrotik hAP', kind: 'router', added: 66, gb: 47.1, on: 5, seen: 60, keepalive: 25, behind: ['192.168.2.0/24'] },
      { id: 'd_o2', name: ['Print server', 'Принтер-сервер'], kind: 'other', added: 66, gb: 0, seen: 32 * 86400, disabled: true },
    ],
  },
  {
    id: 'p_katya',
    name: ['Katya', 'Катя'],
    access: 'internet',
    joined: 46,
    limit: 3,
    devices: [{ id: 'd_t1', name: laptop, kind: 'computer', added: 44, gb: 6.3, on: 4, seen: 75, stale: true }],
  },
  {
    id: 'p_boris',
    name: ['Boris', 'Борис'],
    access: 'internet',
    joined: 14,
    limit: 3,
    devices: [
      { id: 'd_b1', name: laptop, kind: 'computer', added: 12, gb: 13.1, seen: 7800, stale: true },
      { id: 'd_b2', name: 'iPad', kind: 'tablet', added: 12, gb: 2.8, seen: 15000 },
    ],
  },
  {
    id: 'p_kirill',
    name: ['Kirill (guest)', 'Кирилл (гость)'],
    access: 'internet',
    joined: 20,
    limit: 1,
    ends: -7,
    paused: 7,
    circle: 'c2',
    devices: [{ id: 'd_g1', name: 'iPhone', kind: 'phone', added: 20, gb: 1.4, seen: 10 * 86400, at: 'far' }],
  },
];

/** The router's own words (its checks), which it sends in the page's language. */
export const CHECKS: readonly { id: string; title: Said; detail?: Said; warn?: boolean }[] = [
  { id: 'awg', title: ['AmneziaWG installed', 'AmneziaWG установлен'] },
  { id: 'nft', title: ['Access rules loaded', 'Правила доступа загружены'] },
  { id: `up_${SERVER.id}`, title: ['Tunnel running', 'Туннель работает'] },
  { id: `ep_${SERVER.id}`, title: ['Public address', 'Публичный адрес'] },
  {
    id: `homenet_${SERVER.id}`,
    title: ['A home network is outside the firewall', 'Домашняя сеть вне межсетевого экрана'],
    detail: [
      'guest (192.168.3.0/24) is not in a firewall zone: the firewall rejects this traffic.',
      'guest (192.168.3.0/24) не входит в зону: межсетевой экран отбрасывает этот трафик.',
    ],
    warn: true,
  },
];
