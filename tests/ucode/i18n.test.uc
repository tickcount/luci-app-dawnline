// dawnline.i18n: without LuCI's catalogs (this rootfs has no luci-base) every
// message stays English, whatever language is asked for; plural forms pick
// by the count.
import * as i18n from 'dawnline.i18n';

test('English without a catalog', () => {
	i18n.use('ru');
	eq(i18n.current(), null, 'no Russian catalog here');
	eq(i18n._('Backup not found.'), 'Backup not found.', 'as written');
	eq(sprintf(i18n.N_(1, '%d device', '%d devices'), 1), '1 device', 'singular');
	eq(sprintf(i18n.N_(5, '%d device', '%d devices'), 5), '5 devices', 'plural');
	eq(i18n.N_(0, 'a', 'b'), 'b', 'zero takes the plural in English');
});

test('only plain language codes', () => {
	for (let l in [ null, '', 'en', 'ru; rm -rf /', '../../etc', 'russian', 42 ]) {
		i18n.use(l);
		eq(i18n.current(), null, `${l}`);
	}
});
