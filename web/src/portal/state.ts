// The page's state: the router's last answer, its clock and calendar, where the
// page is open and what the server runs. Everything that draws reads it from
// here. It also holds the one hook back to the page (`repaint`), so a flow can
// redraw the page without knowing how the page is built (main.ts sets it).

import type { Kind, Person } from '../shared/types';
import { isoDay } from '../shared/format';
import { platformOf, type Platform, type Preset } from './setup';

export interface State {
  person: Person;
  /** device_mesh: devices with home access reach each other through the tunnel. */
  /** awg_disguise: false = plain WireGuard, any WireGuard app connects. */
  /** home: the home networks a device with LAN Bypass still sends into the tunnel (home and internet access). */
  server: { name?: string; endpoint: string; device_mesh?: boolean; awg_disguise?: boolean; preset?: Preset; home?: string[] };
  /** The device this page was opened from (through the tunnel), if any. */
  here?: string | null;
  can_add: boolean;
  /** The admin stopped the person (paused, access ended): the page only shows. */
  locked?: boolean;
  /** Over plain HTTP: the same link over HTTPS, where the connection settings are. */
  https_url?: string | null;
  kinds: Kind[];
  version: string;
  /** The router's day (YYYY-MM-DD) when it sends one; the browser's otherwise. */
  today?: string;
  /** The router's clock (epoch seconds): relative times are measured against it, not the phone's. */
  now?: number;
  /** The router's UTC offset in minutes: the admin sets hours in its time, the page shows the visitor's. */
  tz_offset?: number;
}

let current: State | null = null;

export const state = (): State | null => current;
export function setState(st: State | null) {
  current = st;
}

const app = document.getElementById('app')!;
/** The page's path: the personal link. Its last part is the code (no sessions). */
export const base = app.dataset.base ?? '';
export const code = /^\/[a-z]{6}-[a-z]{6}-[a-z]{6}$/.test(base) ? base.slice(1) : '';
/** This page's own address, without the fragment: what a link to another device carries. */
export const pageUrl = () => location.origin + location.pathname;

/** Today on the router, for days left and chart labels. */
export const today = () => current?.today ?? isoDay(new Date());
/** Now on the router (seconds), for "last connected 3 min ago". */
export const now = () => current?.now ?? Date.now() / 1000;

/** The platform this page is open on (iPad on Safari says Mac; touch points tell). */
export const platform = (): Platform => platformOf(navigator.userAgent, navigator.maxTouchPoints);
/** The server's disguise is off: plain WireGuard, so any WireGuard app connects. */
export const plainWg = () => current?.server.awg_disguise === false;
/** The server's disguise generation, for which apps and versions connect. */
export const preset = (): Preset => current?.server.preset ?? (plainWg() ? 'off' : 'max');
/** The secure twin when this page is plain HTTP, else null. */
export const httpsTwin = () => current?.https_url || null;
/** The place this page belongs to: the server's name, "Dawnline" where there is none to name. */
export const placeName = () => current?.server.name || 'Dawnline';

export interface RepaintOpts {
  /** A card that is new: it pops in. */
  pop?: string;
  /** A card that just connected: a green ring fades on it. */
  flash?: string;
}
let painter: (o: RepaintOpts) => void = () => undefined;
/** main.ts: how to draw the page again. */
export function onRepaint(fn: (o: RepaintOpts) => void) {
  painter = fn;
}
/** Draw the page again from the current state (a flow changed something). */
export const repaint = (o: RepaintOpts = {}) => painter(o);
