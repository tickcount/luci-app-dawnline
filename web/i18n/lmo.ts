// The LMO catalog LuCI loads (/usr/lib/lua/luci/i18n/<name>.<lang>.lmo), made
// from a .po byte for byte as LuCI's po2lmo makes it. The release packages are
// built by the SDK's own po2lmo (luci.mk); this one is for the dev deploy
// (scripts/build-release.sh), which has no SDK.
//
// Layout: the translations, each padded with zeros to 4 bytes, in the .po's
// order (the Plural-Forms formula first, under key 0); then an index entry per
// string, sorted by key: key hash, number of forms, offset, length (big-endian
// uint32s); then the index's offset. A key is the msgid, with "ctx\x01" before
// it and "\x02<n>" after it for plural form n; its hash is Paul Hsieh's
// SuperFastHash seeded with the length (lmo.c sfh_hash, cbi.js sfh).
//
//   node i18n/lmo.ts in.po out.lmo

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePo, type Po } from './po.ts';

/** SuperFastHash of the bytes, seeded with their length, as a uint32. */
export function sfh(data: Uint8Array): number {
  const get16 = (i: number) => data[i] | (data[i + 1] << 8);
  const s8 = (i: number) => (data[i] << 24) >> 24;
  let hash = data.length >>> 0;
  if (!data.length) return 0;
  let i = 0;
  for (let n = data.length >>> 2; n > 0; n--, i += 4) {
    hash = (hash + get16(i)) >>> 0;
    const tmp = ((get16(i + 2) << 11) ^ hash) >>> 0;
    hash = ((hash << 16) ^ tmp) >>> 0;
    hash = (hash + (hash >>> 11)) >>> 0;
  }
  switch (data.length & 3) {
    case 3:
      hash = (hash + get16(i)) >>> 0;
      hash = (hash ^ (hash << 16)) >>> 0;
      hash = (hash ^ (s8(i + 2) << 18)) >>> 0;
      hash = (hash + (hash >>> 11)) >>> 0;
      break;
    case 2:
      hash = (hash + get16(i)) >>> 0;
      hash = (hash ^ (hash << 11)) >>> 0;
      hash = (hash + (hash >>> 17)) >>> 0;
      break;
    case 1:
      hash = (hash + s8(i)) >>> 0;
      hash = (hash ^ (hash << 10)) >>> 0;
      hash = (hash + (hash >>> 1)) >>> 0;
  }
  hash = (hash ^ (hash << 3)) >>> 0;
  hash = (hash + (hash >>> 5)) >>> 0;
  hash = (hash ^ (hash << 4)) >>> 0;
  hash = (hash + (hash >>> 17)) >>> 0;
  hash = (hash ^ (hash << 25)) >>> 0;
  hash = (hash + (hash >>> 6)) >>> 0;
  return hash;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

export function lmo(po: Po): Uint8Array {
  const chunks: Uint8Array[] = [];
  const index: { key: number; forms: number; offset: number; length: number }[] = [];
  let offset = 0;
  const add = (key: number, forms: number, value: Uint8Array) => {
    const padded = new Uint8Array(value.length + ((4 - (value.length % 4)) % 4));
    padded.set(value);
    index.push({ key, forms, offset, length: value.length });
    chunks.push(padded);
    offset += padded.length;
  };
  const pf = po.header.find(([k]) => k === 'Plural-Forms');
  if (pf) add(0, 0, utf8(pf[1]));
  for (const e of po.entries) {
    if (!e.str[0]) continue;
    e.str.forEach((s, i) => {
      if (!s) return;
      const key = utf8(`${e.ctx !== undefined ? `${e.ctx}\u0001` : ''}${e.id}${e.plural !== undefined ? `\u0002${i}` : ''}`);
      const value = utf8(s);
      const k = sfh(key);
      // An unchanged string is left out: LuCI shows the English anyway.
      if (k !== sfh(value)) add(k, e.str.length, value);
    });
  }
  index.sort((a, b) => a.key - b.key);
  const out = new Uint8Array(offset + index.length * 16 + (offset > 0 ? 4 : 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  for (const x of index) {
    for (const v of [x.key, x.forms, x.offset, x.length]) {
      view.setUint32(at, v);
      at += 4;
    }
  }
  if (offset > 0) view.setUint32(at, offset);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) {
    console.error('usage: node i18n/lmo.ts in.po out.lmo');
    process.exit(2);
  }
  fs.writeFileSync(dst, lmo(parsePo(fs.readFileSync(src, 'utf8'))));
}
