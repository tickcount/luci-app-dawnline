#!/usr/bin/ucode
'use strict';
// Dawnline ucode unit tests. Runs every *.test.uc beside this file (in name
// order; migrate.test.uc changes /etc/config/dawnline, so it sorts after the
// tests that read the fixture as it is) with four helpers in scope:
//   test(name, fn)            one case; a thrown error or die() fails it
//   eq(got, want, note)       deep equality (JSON form), note names the case
//   ok(cond, note)            a true value
//   throws(fn, re, note)      fn must throw; the message must match re when given
// tests/ucode/run.sh prepares the fixtures and starts this with the modules
// on -L; an optional argument runs only the files whose name contains it.
import { lsdir } from 'fs';

let dir = sourcepath(0, true);
let passed = 0, failed = 0, file = null;

function eq(got, want, note) {
	let g = sprintf('%J', got), w = sprintf('%J', want);
	if (g != w)
		die(`${note ? note + ': ' : ''}got ${g}, want ${w}`);
}

function ok(cond, note) {
	if (!cond)
		die(note ?? 'expected a true value');
}

function throws(fn, re, note) {
	let msg = null;
	try {
		fn();
	}
	catch (e) {
		msg = e.message ?? `${e}`;
	}
	if (msg == null)
		die(`${note ?? 'call'} did not throw`);
	if (re && !match(msg, re))
		die(`${note ?? 'call'} threw "${msg}", not ${re}`);
	return msg;
}

function test(name, fn) {
	try {
		fn();
		passed++;
	}
	catch (e) {
		failed++;
		// The first frame in the test file itself (not eq()/ok() in here).
		let at = filter(e.stacktrace ?? [], (f) => f.filename && index(f.filename, '/run.uc') < 0)[0];
		printf('FAIL %s: %s\n  %s%s\n', file, name, e.message ?? `${e}`, at ? ` (${at.filename}:${at.line})` : '');
	}
}

for (file in sort(lsdir(dir) ?? [])) {
	if (!match(file, /\.test\.uc$/) || (ARGV[0] && index(file, ARGV[0]) < 0))
		continue;
	try {
		include(`${dir}/${file}`, { test, eq, ok, throws });
	}
	catch (e) {
		failed++;
		printf('FAIL %s: could not run\n  %s\n', file, e.message ?? `${e}`);
	}
}
printf('%d passed, %d failed\n', passed, failed);
exit(failed ? 1 : 0);
