// dawnline.netifd: drift(), the watchdog's look at a server's interface
// (network.<ifname> against what sync() writes, markers aside), on the
// fixture's server and a section this test puts into /etc/config/network
// the way sync() writes it, and takes out again.
import { readfile, writefile, unlink } from 'fs';
import { cursor } from 'uci';
import { uci_put } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as awg from 'dawnline.awg';
import * as netifd from 'dawnline.netifd';

const NETWORK = '/etc/config/network';

test('drift: the interface as Dawnline set it, and edited outside it', () => {
	let had = readfile(NETWORK);
	if (had == null)
		writefile(NETWORK, '');
	let m = core.load();
	let srv = m.servers.main;
	let c = cursor();
	c.load('network');
	c.set('network', 'awgmain', 'interface');
	for (let k, v in awg.netifd_options(srv))
		uci_put(c, 'network', 'awgmain', k, v);
	c.set('network', 'awgmain', '_dawnline', 'main');
	c.set('network', 'awgmain', '_dawnline_name', srv.name);
	c.commit('network');
	let edit = (opt, val) => {
		uci_put(c, 'network', 'awgmain', opt, val);
		c.commit('network');
		return netifd.drift(m);
	};
	let got = { as_set: netifd.drift(m) };
	got.renamed = edit('_dawnline_name', 'Renamed in LuCI');
	got.edited = edit('mtu', '1420');
	got.more = edit('awg_jc', null);
	edit('mtu', `${core.tunnel_mtu(srv)}`);
	got.restored = edit('awg_jc', srv.obf.jc);
	got.disabled = edit('disabled', '1');
	edit('disabled', null);
	got.foreign = edit('_dawnline', 'someone');
	m.servers.main.enabled = false;
	got.off = netifd.drift(m);
	// Put the router back as the other tests know it.
	c.delete('network', 'awgmain');
	c.commit('network');
	if (had == null)
		unlink(NETWORK);
	eq(got.as_set, { main: [] }, 'as sync() writes it');
	eq(got.renamed, { main: [] }, 'the markers are not compared');
	eq(got.edited, { main: [ 'mtu' ] }, 'an option changed by hand');
	eq(got.more, { main: [ 'mtu', 'awg_jc' ] }, 'and one removed, by name only');
	eq(got.restored, { main: [] }, 'put back');
	eq(got.disabled, { main: [ 'disabled' ] }, 'switched off outside Dawnline');
	eq(got.foreign, {}, "a section that isn't the server's is not looked at");
	eq(got.off, {}, 'a server turned off is not looked at');
});
