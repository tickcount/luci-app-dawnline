// Dawnline — how each device's link behaves, from the counters the agent's
// watcher reads every second (dawnline.awg.dump): a device that knocks but
// never finishes connecting, one whose configuration is in use on two devices,
// one whose traffic the router drops, one whose connection keeps breaking.
//
// The agent keeps one history per device in memory (fresh(), observe(): a few
// events of the last HISTORY seconds, not one entry per tick), classifies it
// (classify(), pure) and shows a state only once it held HOLD seconds
// (settle()). It writes what is shown to dawnline.live.LINK on a change; the
// read side (live.dump's `link`, view.device_view) is dawnline.live's, so the
// portal never loads this module. Who is online stays live.PRESENCE's.
//
// The same history tells the set-up sheet, at once and without HOLD, what a
// device that is being set up does right now (setup_state(), setup()): it
// knocks without finishing, data flows, or it connected but nothing it sends
// comes through. The agent writes that to dawnline.live.SETUP on a change.
//
// What the counters mean (kmod 3.1, receive.c and send.c):
//   * an accepted handshake initiation adds exactly INITIATION bytes to the
//     peer's rx: the S1 prefix and any trailer are cut off and the header
//     protection is undone in place before update_rx_stats(skb->len). The
//     router answers it; its own handshake time moves only when the first
//     packet under the new keys arrives.
//   * a keepalive adds KEEPALIVE plus its content padding; a handshake
//     response (the router initiated) RESPONSE; data 32 + its padded length.
//     Plain data is a multiple of 16, so 148, 296 and 444 never are data.
//   * a data packet the router then drops (its source is not the device's
//     address: an old configuration after renumbering; this is what moves
//     the interface's rx_frame_errors) adds nothing to rx, but the router
//     still answers it with a keepalive within KeepaliveTimeout (about 10 s).

/** Seconds of events kept per device. */
export const HISTORY = 600;
/** A state is shown once it held this long (a flapping mobile link passes). */
export const HOLD = 180;
/** A device is classified at least this often when nothing happened (its spans age). */
export const CHECK_EVERY = 15;

/** Bytes an accepted initiation adds to rx (sizeof(struct message_handshake_initiation)). */
export const INITIATION = 148;
/** Bytes a handshake response adds to rx (the router initiated). */
export const RESPONSE = 92;
/** Bytes an empty data packet adds to rx, before content padding. */
export const KEEPALIVE = 32;
// Random trailers without content padding: a keepalive grows up to a full packet.
const TRAILER_MAX = 1500;
// Initiations a device sends at most in one second (retries are 5 s apart).
const KNOCKS_PER_TICK = 3;

/** trying: at least TRY_KNOCKS accepted initiations within TRY_SPAN seconds while not online. */
export const TRY_SPAN = 120;
export const TRY_KNOCKS = 3;
/*
 * Churning: at least CHURN_COUNT handshakes within CHURN_SPAN seconds, with
 * CHURN_COUNT - 1 of the gaps under CHURN_GAP seconds. A device that is
 * there renews its keys every 100-120 s (RekeyAfterTime), more only when
 * its packets get nothing back (KeepaliveTimeout + RekeyTimeout, ~15 s).
 */
export const CHURN_SPAN = 300;
export const CHURN_COUNT = 4;
export const CHURN_GAP = 45;
/** shared: while churning, the endpoint (ip:port) went back to an earlier one this often. */
export const SHARE_RETURNS = 2;
/*
 * dropped: online with a handshake within DROP_HS seconds, nothing but
 * handshakes and keepalives received for DROP_SPAN seconds, and the router
 * sent something at least DROP_ANSWERS times in that span with nothing
 * coming in (its keepalives answering packets it dropped), under DROP_TX
 * bytes in all (a real download is far more).
 */
export const DROP_SPAN = 180;
export const DROP_HS = 240;
export const DROP_ANSWERS = 6;
export const DROP_TX = 65536;

/** Every state classify() can give. */
export const STATES = [ 'trying', 'shared', 'dropped', 'unstable' ];

/*
 * The set-up sheet's trying: at least SETUP_KNOCKS accepted initiations
 * within SETUP_SPAN seconds, none of them followed by a handshake. A device
 * retries every 5 s, so it shows with the second (5-6 s in) and goes about
 * 15 s after the last.
 */
export const SETUP_SPAN = 20;
export const SETUP_KNOCKS = 2;
/*
 * nodata: online for SETUP_QUIET seconds since the handshake its session
 * began with, nothing but handshakes and keepalives in since, and the router
 * answered at least once with nothing coming in (a keepalive for data it
 * dropped, about 10 s after it: an old address in the configuration). An
 * idle device gets no answers, so it never shows.
 */
export const SETUP_QUIET = 15;

// Per list, the newest entries kept (a device whose endpoint flips every second).
const KEEP = 64;

function keep(list, entry) {
	push(list, entry);
	if (length(list) > KEEP)
		shift(list);
}

/**
 * A new, empty history for a device first seen at `now`. Fields: rx, tx
 * (the counters last read, null before the first read), hs (the newest
 * handshake), ep (the endpoint), data (when rx last carried data), hsev
 * (handshake times), epev ([ ts, ip:port, the one before ] endpoint
 * changes), knocks (times
 * of accepted initiations), ans ([ ts, bytes ] the router sent with nothing
 * received), state/since (what is shown), pend (a state waiting for HOLD),
 * raw (the last classification), checked (when it was made); for the set-up
 * sheet (setup()): on (online at the last read), sess (the handshake its
 * online stretch began with, 0 while away), setup ({ state, since } or null)
 * and due (when setup_state() may change with time alone, 0 for never).
 */
export function fresh(now) {
	return {
		start: now, rx: null, tx: null, hs: 0, ep: null, data: 0,
		hsev: [], epev: [], knocks: [], ans: [],
		state: null, since: 0, pend: null, raw: null, checked: 0,
		on: false, sess: 0, setup: null, due: 0,
	};
};

/**
 * The largest rx a keepalive adds for a server's disguise: KEEPALIVE plus
 * the top of its ContentPaddingAddition, or a full packet with random
 * trailers and no content padding (the apps get the server's values).
 */
export function keepalive_max(srv) {
	let o = srv?.obf ?? {};
	let cpa = split(`${o.content_padding_addition ?? ''}`, '-');
	let hi = +(cpa[length(cpa) - 1]);
	if (o.content_padding_addition != null && o.content_padding_addition != '' && hi > 0)
		return KEEPALIVE + hi;
	if (o.random_trailers == 'on' || o.random_trailers == '1')
		return KEEPALIVE + TRAILER_MAX;
	return KEEPALIVE;
};

/** keepalive_max() for each device's server: { device id: bytes }. */
export function keepalive_sizes(m) {
	let out = {};
	for (let id, d in m.devices)
		out[id] = keepalive_max(m.servers[m.people[d.person]?.server]);
	return out;
};

/** An rx increment made of accepted initiations only. */
export function knock(drx) {
	return drx > 0 && drx % INITIATION == 0 && drx <= KNOCKS_PER_TICK * INITIATION;
};

/**
 * An rx increment that carried no data: nothing, or one keepalive of up to
 * `ka` bytes (keepalive_max); in the second a handshake completed (`shook`)
 * also the handshake messages that came with it. Outside that second a
 * handshake message is never counted in: with a padded keepalive their
 * sums would cover every small packet (a DNS query, an ACK) up to some
 * 670 bytes, and a device with light traffic would look like one whose
 * data never comes through.
 */
export function bare(drx, ka, shook) {
	if (drx <= 0)
		return true;
	if (!shook)
		return drx >= KEEPALIVE && drx <= ka;
	if (drx > KNOCKS_PER_TICK * INITIATION + RESPONSE + ka)
		return false;
	for (let k = 0; k <= KNOCKS_PER_TICK; k++)
		for (let r = 0; r <= 1; r++) {
			let rest = drx - k * INITIATION - r * RESPONSE;
			if (rest == 0 || (rest >= KEEPALIVE && rest <= ka))
				return true;
		}
	return false;
};

/**
 * Fold one read of the device's peer ({ endpoint, handshake, rx, tx } from
 * awg.dump) at `now` into its history `h`; `ka` is its keepalive_max().
 * Returns true when something worth classifying again happened (a
 * handshake, a new endpoint, a knock, an answer, data after a quiet span).
 * Counters that went down (the peer re-added, its tunnel set up again)
 * start a new baseline.
 */
export function observe(h, peer, now, ka) {
	let changed = false;
	let shook = peer.handshake > h.hs;
	if (shook) {
		keep(h.hsev, peer.handshake);
		h.hs = peer.handshake;
		changed = true;
	}
	if (peer.endpoint != h.ep) {
		if (h.ep != null && peer.endpoint != '') {
			keep(h.epev, [ now, peer.endpoint, h.ep ]);
			changed = true;
		}
		h.ep = peer.endpoint;
	}
	if (h.rx == null || peer.rx < h.rx || peer.tx < h.tx) {
		h.rx = peer.rx;
		h.tx = peer.tx;
		return changed;
	}
	let drx = peer.rx - h.rx, dtx = peer.tx - h.tx;
	h.rx = peer.rx;
	h.tx = peer.tx;
	if (drx > 0) {
		if (!shook && knock(drx)) {
			keep(h.knocks, now);
			changed = true;
		}
		else if (!bare(drx, ka, shook)) {
			if (now - h.data >= DROP_SPAN)
				changed = true;
			h.data = now;
		}
	}
	else if (dtx > 0) {
		keep(h.ans, [ now, dtx ]);
		changed = true;
	}
	return changed;
};

/** The device's peer is not in its tunnel: the next read starts a new baseline. */
export function gone(h) {
	h.rx = null;
	h.tx = null;
};

/** Forget events older than HISTORY seconds. */
export function prune(h, now) {
	let cut = now - HISTORY;
	h.hsev = filter(h.hsev, (t) => t > cut);
	h.knocks = filter(h.knocks, (t) => t > cut);
	h.epev = filter(h.epev, (e) => e[0] > cut);
	h.ans = filter(h.ans, (e) => e[0] > cut);
};

/** Endpoint changes within the span that went back to an endpoint seen before in it (A → B → A → B: 2). */
function returns(h, now) {
	let seen = null, n = 0;
	for (let e in h.epev)
		if (now - e[0] < CHURN_SPAN) {
			if (seen == null) {
				seen = {};
				seen[e[2]] = true;
			}
			if (seen[e[1]])
				n++;
			seen[e[1]] = true;
		}
	return n;
}

function churning(h, now) {
	let hs = filter(h.hsev, (t) => now - t < CHURN_SPAN);
	if (length(hs) < CHURN_COUNT)
		return false;
	let short = 0;
	for (let i = 1; i < length(hs); i++)
		if (hs[i] - hs[i - 1] < CHURN_GAP)
			short++;
	return short >= CHURN_COUNT - 1;
}

function dropped(h, now) {
	if (now - h.start < DROP_SPAN || now - h.data < DROP_SPAN || !(h.hs > 0 && now - h.hs < DROP_HS))
		return false;
	let n = 0, bytes = 0;
	for (let a in h.ans)
		if (now - a[0] < DROP_SPAN) {
			n++;
			bytes += a[1];
		}
	return n >= DROP_ANSWERS && bytes < DROP_TX;
}

/**
 * What the history says about the device at `now` (`on`: it is online, as
 * the watcher decides it): null (nothing wrong, or nothing to tell), or
 *   'trying'    not online, but its initiations reach the router and are
 *               answered, and it never finishes connecting (the network
 *               may block it, or its configuration is out of date: a
 *               stale preshared key looks the same)
 *   'shared'    connecting over and over from two or more alternating
 *               endpoints (ip:port): one configuration on two devices
 *   'unstable'  connecting over and over from one place: the connection
 *               keeps breaking
 *   'dropped'   connected, but nothing it sends gets through: the router
 *               drops it (an old address in its configuration)
 */
export function classify(h, now, on) {
	if (!on) {
		let n = 0;
		for (let t in h.knocks)
			if (now - t < TRY_SPAN)
				n++;
		return n >= TRY_KNOCKS ? 'trying' : null;
	}
	if (churning(h, now))
		return returns(h, now) >= SHARE_RETURNS ? 'shared' : 'unstable';
	return dropped(h, now) ? 'dropped' : null;
};

/**
 * Turn a classification into what is shown (h.state, h.since): a state, or
 * a change of state, shows once classify() gave it for HOLD seconds (since
 * = when it began); nothing wrong shows at once when the device is online
 * (it works), else after HOLD as well. Returns the change, { from, to }
 * (either may be null), or null when what is shown stays.
 */
export function settle(h, raw, now, on) {
	if (raw == h.state) {
		h.pend = null;
		return null;
	}
	let since = now;
	if (raw != null || !on) {
		if (h.pend == null || h.pend.state != raw) {
			h.pend = { state: raw, since: now };
			return null;
		}
		if (now - h.pend.since < HOLD)
			return null;
		since = h.pend.since;
	}
	let from = h.state;
	h.state = raw;
	h.since = raw != null ? since : 0;
	h.pend = null;
	return { from, to: raw };
};

/**
 * What the device's link does at `now` for the set-up sheet (pure; `on`: it
 * is online, as the watcher decides it): { state, due }. state is
 *   'trying'   its initiations reach the router and are answered, and no
 *              handshake follows (SETUP_KNOCKS within SETUP_SPAN): the
 *              network blocks the answers, or the configuration is not this
 *              device's any more
 *   'flowing'  online, and data came in during this session (since h.sess)
 *   'nodata'   online for SETUP_QUIET seconds, nothing but handshakes and
 *              keepalives came in, and the router answered packets it
 *              dropped: an old address in the configuration
 *   null       none of these (waiting, idle, or away)
 * due: when the state may change with time alone (a knock ages out, the
 * quiet span ends), 0 for never: anything else comes with a read.
 */
export function setup_state(h, now, on) {
	let n = 0;
	for (let i = length(h.knocks) - 1; i >= 0; i--) {
		let t = h.knocks[i];
		if (t <= h.hs || now - t >= SETUP_SPAN)
			break;
		if (++n == SETUP_KNOCKS)
			return { state: 'trying', due: t + SETUP_SPAN };
	}
	if (!on || !h.sess)
		return { state: null, due: 0 };
	if (h.data >= h.sess)
		return { state: 'flowing', due: 0 };
	if (now - h.sess < SETUP_QUIET)
		return { state: null, due: h.sess + SETUP_QUIET };
	let a = h.ans[length(h.ans) - 1];
	return { state: a != null && a[0] >= h.sess ? 'nodata' : null, due: 0 };
};

/**
 * Bring h.setup to setup_state() after a read at `now` (`moved`: what
 * observe() returned). Most reads cost a few compares: the state is worked
 * out again only when something happened, the device came or went, data
 * came in while it is not 'flowing', or its `due` time came. Returns true
 * when h.setup changed ({ state, since: when it began } or null).
 */
export function setup(h, now, on, moved) {
	// A session begins with the handshake that brought the device online.
	if (!on)
		h.sess = 0;
	else if (!h.sess)
		h.sess = h.hs;
	let came = on != h.on;
	h.on = on;
	let cur = h.setup?.state;
	if (!moved && !came && !(h.due && now >= h.due) && !(h.data == now && cur != 'flowing'))
		return false;
	let s = setup_state(h, now, on);
	h.due = s.due;
	if (s.state == cur)
		return false;
	h.setup = s.state != null ? { state: s.state, since: now } : null;
	return true;
};

/** setup() of every device: { device id: { state, since } }, devices with none left out. */
export function setups(hist) {
	let out = {};
	for (let id, h in hist)
		if (h.setup != null)
			out[id] = h.setup;
	return out;
};

/** What is shown for every device: { device id: { state, since } }, devices with nothing to show left out. */
export function shown(hist) {
	let out = {};
	for (let id, h in hist)
		if (h.state != null)
			out[id] = { state: h.state, since: h.since };
	return out;
};

/**
 * The activity event for a change settle() made, or null: device_failing
 * (detail: the new state) when a state shows, device_recovered (detail:
 * the state it had) when it clears while the device is online. One that
 * clears while the device is away (it stopped trying, it was paused) logs
 * nothing: nobody saw it work.
 */
export function event_for(change, dev, on) {
	if (!change)
		return null;
	if (change.to != null)
		return { type: 'device_failing', person: dev.person, device: dev.id, detail: change.to };
	if (on && change.from != null)
		return { type: 'device_recovered', person: dev.person, device: dev.id, detail: change.from };
	return null;
};
