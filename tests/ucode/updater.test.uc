// usr/libexec/dawnline/updater: a call without a command it knows prints the usage and changes nothing (no job for
// Components, no history, no "update failed" in the service log).
import * as fs from 'fs';

const REPO = `${sourcepath(0, true)}/../..`;
const UPDATER = `${REPO}/package/luci-app-dawnline/root/usr/libexec/dawnline/updater`;
const MODULES = `${REPO}/package/luci-app-dawnline/root/usr/share/ucode/*.uc`;
const JOB = '/var/run/dawnline/update-job.json';

/** The updater run with `args`: { code, out } (stdout and stderr together). */
function updater(args) {
	let p = fs.popen(`ucode -L '${MODULES}' '${UPDATER}' ${args} 2>&1; echo "exit=$?"`, 'r');
	let out = p.read('all') ?? '';
	p.close();
	let m = match(out, /exit=([0-9]+)\s*$/);
	return { code: m ? +m[1] : -1, out: replace(out, /exit=[0-9]+\s*$/, '') };
}

test('without a command it knows: the usage, nothing written', () => {
	for (let args in [ '', 'frobnicate', 'install', "install ''" ]) {
		fs.unlink(JOB);
		let r = updater(args);
		eq(r.code, 2, `exit code for "${args}"`);
		ok(index(r.out, 'Usage:') == 0, `usage for "${args}"`);
		ok(index(r.out, 'updater install app | app@<tag>') > 0, `the commands for "${args}"`);
		ok(!fs.access(JOB), `no job for "${args}"`);
	}
});

test('asked for help: the usage, exit 0', () => {
	for (let args in [ '-h', '--help', 'help' ]) {
		let r = updater(args);
		eq(r.code, 0, `exit code for "${args}"`);
		ok(index(r.out, 'Usage:') == 0, `usage for "${args}"`);
	}
});
