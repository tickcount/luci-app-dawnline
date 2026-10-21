// dawnline.link: what a device's counters say about its link, on synthetic
// sequences of one read a second, run the way the agent's watcher runs them
// (observe, the set-up state at once, then classify and settle when
// something happened or CHECK_EVERY passed); and the pieces on their own.
import * as link from 'dawnline.link';

const T0 = 1800000000;
const A = '203.0.113.7:41821', B = '198.51.100.4:50123';

/*
 * `seconds` reads from T0. `at(s)` gives what happened in second s: { drx,
 * dtx (bytes in, out), hs (a handshake completed), ep (the endpoint now),
 * gone (the peer is not in the tunnel) }. Returns the history, the changes
 * of what is shown: [ { s, from, to, since (seconds from T0), ev } ], those of
 * the set-up state: [ { s, state } ], and the seconds where the set-up state
 * kept by setup() was not what setup_state() gives then (it should never be).
 */
function run(seconds, at, opts) {
	opts ??= {};
	let ka = opts.ka ?? link.KEEPALIVE, window = opts.window ?? 190;
	let h = link.fresh(T0);
	let peer = { endpoint: opts.ep ?? A, handshake: opts.hs0 ?? 0, rx: 1000, tx: 1000 };
	let changes = [], raws = {}, setups = [], lag = [];
	for (let s = 0; s < seconds; s++) {
		let t = T0 + s, x = at(s) ?? {};
		peer.rx += x.drx ?? 0;
		peer.tx += x.dtx ?? 0;
		if (x.hs)
			peer.handshake = t;
		if (x.ep)
			peer.endpoint = x.ep;
		let on = peer.handshake > 0 && t - peer.handshake < window;
		let moved = false;
		if (x.gone)
			link.gone(h);
		else
			moved = link.observe(h, peer, t, ka);
		if (link.setup(h, t, on, moved))
			push(setups, { s, state: h.setup?.state ?? null });
		if (link.setup_state(h, t, on).state != (h.setup?.state ?? null))
			push(lag, s);
		if (!moved && t - h.checked < link.CHECK_EVERY)
			continue;
		h.checked = t;
		link.prune(h, t);
		h.raw = link.classify(h, t, on);
		if (h.raw)
			raws[h.raw] ??= s;
		let ch = link.settle(h, h.raw, t, on);
		if (ch)
			push(changes, { s, from: ch.from, to: ch.to, since: h.since ? h.since - T0 : 0,
				ev: link.event_for(ch, { id: 'd_1', person: 'p_1' }, on)?.type ?? null });
	}
	return { h, changes, raws, setups, lag };
}

// A phone in use: keep-alive 25 s, new keys every ~125 s (the initiation in
// one second, the packet that confirms it in the next), something sent or
// received now and then.
function phone(s, busy) {
	let x = {};
	if (s % 125 == 3)
		x = { drx: 148, dtx: 92 };
	else if (s % 125 == 4)
		x = { hs: true, drx: 32 };
	else if (s % 25 == 0)
		x = { drx: 32 };
	if (busy && s % 30 < 4)
		x = { ...x, drx: (x.drx ?? 0) + 1400, dtx: (x.dtx ?? 0) + 9000 };
	return x;
}

test('no state for a phone in use', () => {
	let r = run(1800, (s) => phone(s, true));
	eq(r.changes, [], 'half an hour of normal use');
	eq(r.raws, {}, 'not even for a moment');
});

test('no state for a sleeping phone', () => {
	eq(run(1800, (s) => phone(s, false)).changes, [], 'keep-alives and new keys only');
	// Then it stops sending at all (deep sleep, out of range): it goes offline, nothing else.
	let r = run(1200, (s) => s < 300 ? phone(s, false) : {});
	eq(r.changes, [], 'silent after five minutes');
	eq(r.raws, {}, 'silence is no failure');
	// The same with the disguise's content padding: keep-alives of 42-132 bytes.
	eq(run(1800, (s) => s % 25 == 0 ? { drx: 42 + (s % 90) } : phone(s, false), { ka: 132 }).changes, [], 'padded keep-alives');
});

test('no state for a phone that left with traffic still coming', () => {
	// Online and busy until 100 s, then gone; the internet keeps sending to it for a while.
	let at = (s) => s < 100 ? phone(s, true) : (s % 3 == 0 ? { dtx: 1400 } : {});
	eq(run(900, at).changes, [], 'the online window ends it');
	eq(run(900, at, { window: 400 }).changes, [], 'a long keep-alive window: no handshake within DROP_HS ends it');
});

test('trying: knocks that never finish connecting', () => {
	// Never connected: an initiation every 5 s for 90 s, then a pause, again and again.
	let knocking = (s) => (s % 120 < 90 && s % 5 == 0) ? { drx: 148, dtx: 92 } : {};
	let r = run(600, knocking);
	// The first read is the baseline: the knocks count from 5 s.
	eq(r.raws.trying, 15, 'from the third accepted initiation');
	eq(r.changes[0], { s: 195, from: null, to: 'trying', since: 15, ev: 'device_failing' }, 'shown once it held 3 minutes');
	eq(length(r.changes), 1, 'and kept through the pauses');
	// It gets through at 400 s: working again at once.
	let r2 = run(600, (s) => s < 400 ? knocking(s) : (s == 400 ? { hs: true, drx: 148 + 1400, dtx: 4000 } : phone(s, true)));
	eq(r2.changes[1], { s: 400, from: 'trying', to: null, since: 0, ev: 'device_recovered' }, 'connected: recovered');
	// It gives up (the app was turned off): the state goes without a "recovered".
	let r3 = run(1200, (s) => s < 300 ? knocking(s) : {});
	eq(r3.changes[1].to, null, 'cleared');
	eq(r3.changes[1].ev, null, 'nobody saw it work');
	// The last knock at 295 s: it ages out of TRY_SPAN by 415 s, and HOLD passes by 595 s.
	eq(r3.changes[1].s, 595, 'only after the knocks aged out and HOLD passed');
});

test('trying after a session that ran out', () => {
	// Online until 200 s; then its new keys never complete (the answers are lost).
	let at = (s) => s < 200 ? phone(s, true) : (s % 5 == 0 ? { drx: 148, dtx: 92 } : {});
	let r = run(900, at);
	eq(r.changes[0].to, 'trying', 'after the online window');
	ok(r.changes[0].s > 129 + 190, 'not while the old session still counted');
});

test('shared: one configuration on two devices', () => {
	// Each takes the session from the other every 20 s; the endpoint flips with every packet.
	let r = run(600, (s) => ({ hs: s % 20 == 0, drx: 2000, dtx: 6000, ep: s % 2 ? B : A }));
	eq(r.raws.shared, 60, 'from the fourth handshake');
	eq(r.changes[0], { s: 240, from: null, to: 'shared', since: 60, ev: 'device_failing' }, 'shown once it held');
	eq(r.raws.unstable, null, 'never taken for a breaking connection');
	// Two devices behind one NAT: one address, two ports.
	let r2 = run(600, (s) => ({ hs: s % 20 == 0, drx: 2000, dtx: 6000, ep: s % 2 ? '203.0.113.7:1111' : '203.0.113.7:2222' }));
	eq(r2.changes[0]?.to, 'shared', 'told apart by port');
});

test('unstable: connecting over and over from one place', () => {
	let r = run(600, (s) => ({ hs: s % 20 == 0, drx: s % 20 < 5 ? 3000 : 0, dtx: s % 20 < 5 ? 9000 : 0 }));
	eq(r.raws.unstable, 60, 'from the fourth quick handshake');
	eq(r.changes[0], { s: 240, from: null, to: 'unstable', since: 60, ev: 'device_failing' }, 'shown once it held');
	// Moving once (wifi to mobile) while it breaks is still the connection, not a second device.
	let r2 = run(600, (s) => ({ hs: s % 20 == 0, drx: 3000, dtx: 9000, ep: s < 100 ? A : B }));
	eq(r2.changes[0]?.to, 'unstable', 'one move is no alternation');
	// It settles down: working again once the quick handshakes left the span.
	let r3 = run(1200, (s) => s < 300 ? { hs: s % 20 == 0, drx: 3000, dtx: 9000 } : phone(s, true));
	eq(r3.changes[1]?.to, null, 'cleared');
	eq(r3.changes[1]?.ev, 'device_recovered', 'online: recovered');
	// Normal key renewals never churn, even at RekeyAfterTime's shortest (100 s).
	eq(run(1800, (s) => ({ hs: s % 100 == 0, drx: s % 25 == 0 ? 32 : 0 })).changes, [], '3.1 timers');
});

/*
 * An old address after renumbering: every packet it sends is dropped after
 * decryption (not counted in rx), the router answers with a keepalive every
 * ~10 s, the device renews its keys every ~125 s (the first packet under them
 * is data, so only the initiation shows in rx).
 */
function renumbered(s) {
	if (s % 125 == 3)
		return { drx: 148, dtx: 92 };
	if (s % 125 == 4)
		return { hs: true };
	return s % 10 == 7 ? { dtx: 32 } : {};
}

test('dropped: connected, but nothing it sends gets through', () => {
	let r = run(900, renumbered, { hs0: T0 - 30 });
	// Classified on the router's next answer after DROP_SPAN (187 s).
	eq(r.raws.dropped, 187, 'once DROP_SPAN passed without data');
	eq(r.changes[0], { s: 367, from: null, to: 'dropped', since: 187, ev: 'device_failing' }, 'shown once it held');
	// Imported again at 500 s: data flows, working at once.
	let r2 = run(900, (s) => s < 500 ? renumbered(s) : (s == 500 ? { hs: true, drx: 3000, dtx: 9000 } : phone(s, true)), { hs0: T0 - 30 });
	eq(r2.changes[1], { s: 500, from: 'dropped', to: null, since: 0, ev: 'device_recovered' }, 'recovered');
	// With the disguise's padding the router's answers are bigger; still under DROP_TX.
	let r3 = run(900, (s) => { let x = renumbered(s); if (x.dtx == 32) x.dtx = 32 + 1400; return x; }, { hs0: T0 - 30, ka: 132 });
	eq(r3.changes[0]?.to, 'dropped', 'padded answers');
	// Not before the history covers DROP_SPAN (the agent just started).
	eq(run(170, renumbered, { hs0: T0 - 30 }).raws, {}, 'too early to tell');
});

test('counters that restart are a new baseline', () => {
	let h = link.fresh(T0);
	let peer = { endpoint: A, handshake: T0, rx: 50000, tx: 90000 };
	link.observe(h, peer, T0, 32);
	peer.rx = 148;
	peer.tx = 92;
	link.observe(h, peer, T0 + 1, 32);
	eq([ h.rx, h.tx, length(h.knocks), h.data ], [ 148, 92, 0, 0 ], 'the peer was added again: no knock, no data');
	link.gone(h);
	eq(h.rx, null, 'not in the tunnel');
	eq(link.observe(h, { ...peer, rx: 5000 }, T0 + 2, 32), false, 'back: a baseline, nothing counted');
	eq(h.data, 0, 'no data from the jump');
});

test('knock and bare', () => {
	eq([ link.knock(148), link.knock(296), link.knock(444) ], [ true, true, true ], 'one to three initiations');
	eq([ link.knock(592), link.knock(180), link.knock(0) ], [ false, false, false ], 'too many, with something else, nothing');
	eq([ link.bare(32, 32, false), link.bare(0, 32, false), link.bare(180, 32, true), link.bare(124, 32, true), link.bare(92, 32, true) ],
		[ true, true, true, true, true ], 'keepalive, nothing; in a handshake\'s second: initiation + keepalive, response + keepalive, response');
	// Plain data is 32 + a multiple of 16: an IPv4 header alone is 64, a TCP ACK 80 or 96.
	eq([ link.bare(64, 32, false), link.bare(80, 32, true), link.bare(96, 32, false), link.bare(1480, 32, true), link.bare(5000, 32, false) ],
		[ false, false, false, false, false ], 'data');
	eq([ link.bare(180, 32, false), link.bare(124, 32, false), link.bare(92, 32, false) ], [ false, false, false ],
		'handshake messages only count in the second a handshake completed');
	// Padding makes it fuzzy: in a handshake's second anything up to three initiations, a response and a
	// padded keepalive; in any other second one padded keepalive, never more.
	eq([ link.bare(100, 132, false), link.bare(148 + 132, 132, true), link.bare(3 * 148 + 92 + 132, 132, true), link.bare(3 * 148 + 92 + 133, 132, true) ],
		[ true, true, true, false ], 'padded keepalives');
	eq([ link.bare(133, 132, false), link.bare(148 + 52, 132, false), link.bare(668, 132, false) ], [ false, false, false ],
		'small packets on Maximum: data');
});

test('keepalive_max', () => {
	eq(link.keepalive_max(null), 32, 'no server');
	eq(link.keepalive_max({ obf: {} }), 32, 'no disguise');
	eq(link.keepalive_max({ obf: { content_padding_addition: '10-100' } }), 132, 'content padding');
	eq(link.keepalive_max({ obf: { content_padding_addition: '40' } }), 72, 'a fixed padding');
	eq(link.keepalive_max({ obf: { content_padding_addition: '10-100', random_trailers: 'on' } }), 132, 'content padding wins over trailers');
	eq(link.keepalive_max({ obf: { random_trailers: 'on' } }), 1532, 'random trailers: up to a full packet');
	let m = { servers: { s_1: { obf: { content_padding_addition: '10-100' } } }, people: { p_1: { server: 's_1' } },
		devices: { d_1: { person: 'p_1' }, d_2: { person: 'p_gone' } } };
	eq(link.keepalive_sizes(m), { d_1: 132, d_2: 32 }, 'per device');
});

test('settle holds a state before it shows', () => {
	let h = link.fresh(T0);
	eq(link.settle(h, 'trying', T0, false), null, 'new: waits');
	eq(link.settle(h, 'trying', T0 + link.HOLD - 1, false), null, 'still waits');
	eq(link.settle(h, 'trying', T0 + link.HOLD, false), { from: null, to: 'trying' }, 'held: shown');
	eq([ h.state, h.since ], [ 'trying', T0 ], 'since it began');
	eq(link.settle(h, 'unstable', T0 + 200, true), null, 'another state waits too');
	eq(link.settle(h, 'trying', T0 + 210, true), null, 'and is forgotten when the first comes back');
	eq(h.pend, null, 'nothing pending');
	eq(link.settle(h, null, T0 + 220, true), { from: 'trying', to: null }, 'online and fine: at once');
	eq([ h.state, h.since ], [ null, 0 ], 'nothing shown');
	eq(link.shown({ d_1: h, d_2: { state: 'shared', since: 5 } }), { d_2: { state: 'shared', since: 5 } }, 'only what shows');
	eq(link.event_for({ from: 'shared', to: null }, { id: 'd_2', person: 'p_1' }, true),
		{ type: 'device_recovered', person: 'p_1', device: 'd_2', detail: 'shared' }, 'recovered event');
	eq(link.event_for({ from: null, to: 'dropped' }, { id: 'd_2', person: 'p_1' }, true),
		{ type: 'device_failing', person: 'p_1', device: 'd_2', detail: 'dropped' }, 'failing event');
	eq(link.event_for(null, { id: 'd_2' }, true), null, 'no change');
});

// The agent moves the person's revision on every change settle() makes, so a
// state that clears while the device is away (no event) still leaves the page.
test('settle clears a state silently while the device is away', () => {
	let h = link.fresh(T0);
	link.settle(h, 'trying', T0, false);
	link.settle(h, 'trying', T0 + link.HOLD, false);
	eq(link.settle(h, null, T0 + 300, false), null, 'it stopped trying: waits');
	let ch = link.settle(h, null, T0 + 300 + link.HOLD, false);
	eq(ch, { from: 'trying', to: null }, 'then a change: nothing shown');
	eq(link.event_for(ch, { id: 'd_1', person: 'p_1' }, false), null, 'without an activity event');
});

/*
 * The set-up sheet's states: at once, no HOLD. Each run also checks that the
 * state setup() keeps, worked out only when something happened, is what
 * setup_state() gives on every read.
 */
test('setup: knocks that never finish connecting', () => {
	let knocking = (s) => (s % 120 < 90 && s % 5 == 0) ? { drx: 148, dtx: 92 } : {};
	let r = run(300, knocking);
	// The first read is the baseline: the knocks count from 5 s.
	eq(slice(r.setups, 0, 3), [ { s: 10, state: 'trying' }, { s: 100, state: null }, { s: 125, state: 'trying' } ],
		'with the second initiation; gone 15 s after the last one (85 s); back with the next two');
	eq(run(130, knocking).h.setup, { state: 'trying', since: T0 + 125 }, 'since it began again');
	eq(r.lag, [], 'never behind');
	// One initiation that the next second confirms is a connection, not a knock.
	let ok1 = run(60, (s) => s == 10 ? { drx: 148, dtx: 92 } : s == 11 ? { hs: true, drx: 32 } : {});
	eq(ok1.setups, [], 'one knock, then the handshake: nothing to tell (idle)');
	// Knocking again while an older session still counts as online: it is trying now.
	let late = run(300, (s) => s < 200 ? phone(s, true) : (s % 5 == 0 ? { drx: 148, dtx: 92 } : {}));
	eq(late.setups[length(late.setups) - 1], { s: 205, state: 'trying' }, 'its new keys never complete');
	eq(late.lag, [], 'never behind');
});

test('setup: a new device that connects and passes data', () => {
	// It knocks at 10 s, the next second its first packets under the new keys carry data.
	let at = (s) => s < 10 ? {} : s == 10 ? { drx: 148, dtx: 92 } : s == 11 ? { hs: true, drx: 32 + 1400, dtx: 4000 } : phone(s, true);
	let r = run(900, at);
	eq(r.setups, [ { s: 11, state: 'flowing' } ], 'flowing with the handshake, and through every new key after');
	eq(r.h.setup, { state: 'flowing', since: T0 + 11 }, 'since then');
	eq(r.lag, [], 'never behind');
	// A first keepalive only, data a few seconds later.
	let r2 = run(60, (s) => s == 11 ? { hs: true, drx: 32 } : s == 14 ? { drx: 1400, dtx: 9000 } : {});
	eq(r2.setups, [ { s: 14, state: 'flowing' } ], 'with the first data');
	// Busy until 300 s, then gone: its session ends 190 s after its last handshake (254 s).
	let r3 = run(600, (s) => s < 300 ? phone(s, true) : {});
	eq(r3.setups, [ { s: 30, state: 'flowing' }, { s: 444, state: null } ], 'data from 30 s (what came before the handshake does not count); away: nothing');
	eq(r3.lag, [], 'never behind');
});

test('setup: idle is not "no data"', () => {
	// Connected, keepalives only: the router sends nothing back, nothing to tell.
	let r = run(900, (s) => phone(s, false));
	eq(r.setups, [], 'a sleeping phone');
	eq(r.lag, [], 'never behind');
	// The router sends it something now and then, and it answers: data flows.
	eq(run(120, (s) => s == 4 ? { hs: true, drx: 32 } : s == 30 ? { dtx: 300, drx: 96 } : {}).setups,
		[ { s: 30, state: 'flowing' } ], 'an answer is data');
});

test('setup: connected, but nothing it sends comes through', () => {
	// An old address: its first handshake at 4 s, the router's answers to what it drops at 7, 17, 27 s...
	let r = run(400, renumbered);
	eq(r.setups, [ { s: 19, state: 'nodata' } ], 'SETUP_QUIET after the handshake, with an answer in it');
	eq(r.lag, [], 'never behind, through its new keys at 128 s');
	// Imported again at 300 s: data flows at once.
	let r2 = run(400, (s) => s < 300 ? renumbered(s) : s == 300 ? { hs: true, drx: 3000, dtx: 9000 } : phone(s, true));
	eq(r2.setups, [ { s: 19, state: 'nodata' }, { s: 300, state: 'flowing' } ], 'then flowing');
	// The router answers only after the quiet span: shown with the answer.
	let slow = run(60, (s) => s == 4 ? { hs: true } : s == 25 ? { dtx: 32 } : {});
	eq(slow.setups, [ { s: 25, state: 'nodata' } ], 'with the first answer');
	eq(slow.lag, [], 'never behind');
});

test('setup: light traffic on Maximum is data', () => {
	// Content padding of 10-100: keep-alives of 42-132 bytes. A phone that only sends small packets (a DNS
	// query, a SYN, ACKs: 150-600 bytes a second), and an answer now and then in a second it sent nothing.
	let at = (s) => s == 3 ? { drx: 148, dtx: 92 } : s == 4 ? { hs: true, drx: 42 } :
		s > 4 && s % 3 == 0 ? { drx: 150 + (s % 5) * 100, dtx: 1200 } : s % 7 == 0 ? { dtx: 600 } : {};
	let r = run(60, at, { ka: 132 });
	eq(r.setups, [ { s: 6, state: 'flowing' } ], 'flowing with its first small packets, never "no data"');
	eq(r.lag, [], 'never behind');
	// A keep-alive alone in a second is still no data: an idle phone on Maximum stays idle.
	eq(run(120, (s) => s == 4 ? { hs: true, drx: 42 } : s % 25 == 0 ? { drx: 42 + (s % 90) } : {}, { ka: 132 }).setups, [],
		'padded keep-alives');
});

test('setups', () => {
	let h = link.fresh(T0);
	eq(link.setups({ d_1: h, d_2: { setup: { state: 'trying', since: 5 } } }), { d_2: { state: 'trying', since: 5 } }, 'only devices with one');
	eq(link.setup_state(h, T0, false), { state: null, due: 0 }, 'nothing seen: nothing');
});
