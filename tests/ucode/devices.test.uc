// The admin's device methods (dawnline.rpc.people over dawnline.devices): what
// counts as handing a configuration out, and New keys as setting the device up
// again. The real calls on the fixture: the stand-in awg makes the keys, the
// sync's nft and awg steps fail harmlessly in the container. /etc/config/dawnline
// and the issued and reconnect marks are put back after.
import { readfile, writefile, unlink } from 'fs';
import { DATA_DIR, ensure_dir } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as awg from 'dawnline.awg';
import * as people from 'dawnline.rpc.people';

const CONFIG = '/etc/config/dawnline';
const ISSUED = `${DATA_DIR}/issued.json`;
const RECONNECT = `${DATA_DIR}/reconnect.json`;

// fn(), then the files as they were, whatever fn did.
function kept(paths, fn) {
	let had = map(paths, (p) => readfile(p));
	let err = null;
	try {
		fn();
	}
	catch (e) {
		err = e;
	}
	for (let i = 0; i < length(paths); i++)
		had[i] == null ? unlink(paths[i]) : writefile(paths[i], had[i]);
	if (err)
		die(err.message ?? `${err}`);
}

function call(name, args) {
	return people.methods[name].call({ args });
}

test('device_config: a look marks nothing, a delivery does', () => {
	ensure_dir(DATA_DIR, 0o700);
	kept([ ISSUED ], () => {
		let old = sprintf('%J', { alice_phone: '00000000' });
		writefile(ISSUED, old);
		ok(index(call('device_config', { id: 'alice_phone' }).conf ?? '', '[Peer]') >= 0, 'the configuration comes back');
		eq(readfile(ISSUED), old, 'without issue: issued.json left alone');
		call('device_config', { id: 'alice_phone', issue: false });
		eq(readfile(ISSUED), old, 'issue false: the same');
		call('device_config', { id: 'alice_phone', issue: true });
		let m = core.load();
		eq(awg.issued().alice_phone, awg.config_fingerprint(m, m.devices.alice_phone), 'issue: what it holds now counts as handed out');
		eq(call('device_config', { id: 'nobody', issue: true }).error, 'Unknown device.', 'an unknown device');
	});
});

test('device_rotate: New keys set the device up again', () => {
	kept([ CONFIG, ISSUED, RECONNECT ], () => {
		unlink(RECONNECT);
		let before = core.load().devices.alice_phone;
		let t0 = time();
		let c = call('device_rotate', { id: 'alice_phone' });
		ok(c.error == null && index(c.conf ?? '', '[Peer]') >= 0, `the new configuration comes back (${c.error})`);
		let m = core.load();
		ok(m.devices.alice_phone.preshared_key != before.preshared_key, 'new keys');
		let at = awg.reconnects().alice_phone;
		ok(at >= t0 && at <= time(), `a reconnect mark at the rotation (${at})`);
		eq(awg.handshake_since(t0 - 30, at), 0, "the old keys' last handshake no longer counts: Not set up yet, with Connect");
		eq(awg.issued().alice_phone, awg.config_fingerprint(m, m.devices.alice_phone), 'its new configuration is the one handed out');
	});
	eq(core.load().devices.alice_phone.private_key, '', 'the fixture is back');
});
