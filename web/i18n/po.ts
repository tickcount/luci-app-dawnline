// Gettext catalogs (.pot / .po) as Dawnline writes them: the subset LuCI's
// po2lmo reads. Entries have an optional msgctxt, a msgid, an optional
// msgid_plural and the msgstr (or msgstr[n], one per plural form), with their
// "#:" source references. Strings are one line each and know two escapes, \"
// and \\: po2lmo copies any other escape as written ("\n" stays a backslash and
// an n), so extract.ts refuses newlines and tabs in strings, and backslashes in
// translations. No dates in the header: a catalog changes only when its strings do.
//
// Pure: no files. extract.ts reads and writes the catalogs; the portal's
// bundle turns a .po into a lookup table with catalogOf().

export interface Entry {
  ctx?: string;
  id: string;
  plural?: string;
  /** The translation: one string, or one per plural form. '' where there is none yet. */
  str: string[];
  /** Where the string is used: "src/admin/pages/people.ts:120". */
  refs: string[];
}

export interface Po {
  /** Header fields in their order ("Language", "Plural-Forms", …). */
  header: [string, string][];
  entries: Entry[];
}

/** An entry's identity: its context and msgid (the plural form shares its msgid's). */
export const keyOf = (e: { ctx?: string; id: string }) => (e.ctx ? `${e.ctx}\u0004${e.id}` : e.id);

export const translated = (e: Entry) => e.str.length > 0 && e.str.every((s) => s !== '');

/** A quoted po string's content: \" and \\ read, any other escape kept as written (the header's \n). */
function unquote(s: string, line: number): string {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
  if (!m) throw new Error(`po line ${line}: expected a quoted string, got ${s}`);
  return m[1].replace(/\\(.)/g, (all, c: string) => (c === '"' || c === '\\' ? c : all));
}

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

type Draft = { ctx?: string; id?: string; plural?: string; str: string[]; refs: string[] };

export function parsePo(text: string): Po {
  const po: Po = { header: [], entries: [] };
  let cur: Draft = { str: [], refs: [] };
  // Where a continuation line ("…") goes: the field the last keyword opened.
  let append: ((s: string) => void) | null = null;
  const flush = () => {
    if (cur.id === '' && cur.ctx === undefined) {
      for (const f of (cur.str[0] ?? '').split('\\n')) {
        const i = f.indexOf(':');
        if (i > 0) po.header.push([f.slice(0, i).trim(), f.slice(i + 1).trim()]);
      }
    } else if (cur.id !== undefined) {
      const e: Entry = { id: cur.id, str: cur.str.map((s) => s ?? ''), refs: cur.refs };
      if (cur.ctx !== undefined) e.ctx = cur.ctx;
      if (cur.plural !== undefined) e.plural = cur.plural;
      po.entries.push(e);
    }
    cur = { str: [], refs: [] };
  };
  text.split(/\r?\n/).forEach((raw, n) => {
    const line = raw.trim();
    if (!line) return void (append = null);
    if (line.startsWith('#')) {
      if (cur.id !== undefined) flush();
      if (line.startsWith('#:')) cur.refs.push(...line.slice(2).trim().split(/\s+/).filter(Boolean));
      append = null;
      return;
    }
    if (line.startsWith('"')) {
      if (!append) throw new Error(`po line ${n + 1}: a string outside an entry`);
      return append(unquote(line, n + 1));
    }
    const m = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d)\])?)\s+(".*")$/.exec(line);
    if (!m) throw new Error(`po line ${n + 1}: cannot read ${line}`);
    const [, kw, idx, val] = m;
    const v = unquote(val, n + 1);
    if ((kw === 'msgctxt' || kw === 'msgid') && cur.id !== undefined) flush();
    if (kw === 'msgctxt') {
      cur.ctx = v;
      append = (s) => (cur.ctx += s);
    } else if (kw === 'msgid') {
      cur.id = v;
      append = (s) => (cur.id += s);
    } else if (kw === 'msgid_plural') {
      cur.plural = v;
      append = (s) => (cur.plural += s);
    } else {
      const i = idx === undefined ? 0 : Number(idx);
      cur.str[i] = v;
      append = (s) => (cur.str[i] += s);
    }
  });
  flush();
  return po;
}

export function writePo(po: Po): string {
  const out = ['msgid ""', 'msgstr ""', ...po.header.map(([k, v]) => `${quote(`${k}: ${v}`).slice(0, -1)}\\n"`), ''];
  for (const e of po.entries) {
    for (const r of e.refs) out.push(`#: ${r}`);
    if (e.ctx !== undefined) out.push(`msgctxt ${quote(e.ctx)}`);
    out.push(`msgid ${quote(e.id)}`);
    if (e.plural !== undefined) {
      out.push(`msgid_plural ${quote(e.plural)}`);
      e.str.forEach((s, i) => out.push(`msgstr[${i}] ${quote(s)}`));
    } else out.push(`msgstr ${quote(e.str[0] ?? '')}`);
    out.push('');
  }
  return out.join('\n');
}

/** The number of plural forms a catalog's header declares (2 when it says nothing). */
export function pluralForms(po: Po): number {
  const pf = po.header.find(([k]) => k === 'Plural-Forms')?.[1] ?? '';
  const m = /nplurals\s*=\s*(\d+)/.exec(pf);
  return m ? Number(m[1]) : 2;
}

/** What the portal looks strings up in: translated strings by key, plural forms by the singular's key. */
export interface Catalog {
  s: Record<string, string>;
  p: Record<string, string[]>;
}

/** A .po as a lookup table: translated entries only (an untranslated string stays English). */
export function catalogOf(po: Po): Catalog {
  const c: Catalog = { s: {}, p: {} };
  for (const e of po.entries) {
    if (!translated(e)) continue;
    if (e.plural !== undefined) c.p[keyOf(e)] = e.str;
    else c.s[keyOf(e)] = e.str[0];
  }
  return c;
}
