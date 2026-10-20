// dawnline.loop: the "like a home device" link's errors, stored as codes and
// put into words when read.
import * as loop from 'dawnline.loop';

test('error_text', () => {
	eq(loop.error_text(null), null, 'no error');
	eq(loop.error_text({ code: 'no_lan' }), 'No LAN detected.', 'no LAN');
	eq(loop.error_text({ code: 'not_bridge', dev: 'eth1' }), 'eth1 is not a bridge, so Dawnline cannot join the LAN as a device.', 'not a bridge');
	eq(loop.error_text({ code: 'no_address', net: 'lan' }), 'No free address on lan.', 'no address');
	eq(loop.error_text({ code: 'setup', detail: 'ip: RTNETLINK answers: File exists' }), 'Setup failed: ip: RTNETLINK answers: File exists', 'setup');
	eq(loop.error_text('an old message'), 'an old message', 'older files: as written');
});
